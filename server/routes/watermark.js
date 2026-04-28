import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import multer from 'multer';
import sharp from 'sharp';

const router = Router();
const jobs = new Map();

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const PROCESSED_DIR = path.join(process.cwd(), 'processed');

// IOPaint (LaMa AI model) server URL
const IOPAINT_URL = process.env.IOPAINT_URL || 'http://127.0.0.1:8090';

[UPLOADS_DIR, PROCESSED_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/');
    cb(ok ? null : new Error('Unsupported file type'), ok);
  }
});

// ============================================================
// UPLOAD
// ============================================================

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const file = req.file;
    const isVideo = file.mimetype.startsWith('video/');
    const jobId = path.basename(file.filename, path.extname(file.filename));
    let w = 1920, h = 1080;
    let thumbnailPath = null;

    if (!isVideo) {
      const meta = await sharp(file.path).metadata();
      w = meta.width; h = meta.height;
      thumbnailPath = path.join(UPLOADS_DIR, `${jobId}_thumb.jpg`);
      await sharp(file.path)
        .resize({ width: 1200, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(thumbnailPath);
    } else {
      try {
        const d = await getVideoDimensions(file.path);
        w = d.width; h = d.height;
      } catch {}
      thumbnailPath = path.join(UPLOADS_DIR, `${jobId}_thumb.jpg`);
      try {
        await extractVideoThumbnail(file.path, thumbnailPath);
      } catch { thumbnailPath = null; }
    }

    jobs.set(jobId, {
      id: jobId, originalPath: file.path, originalName: file.originalname,
      mimeType: file.mimetype, isVideo, status: 'uploaded', progress: 0,
      processedPath: null, error: null, createdAt: Date.now(),
      width: w, height: h, thumbnailPath
    });

    res.json({
      success: true, jobId, isVideo, width: w, height: h,
      filename: file.originalname,
      previewUrl: `/api/watermark/preview/${jobId}`,
      thumbnailUrl: thumbnailPath ? `/api/watermark/thumb/${jobId}` : null
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message || 'Upload failed' });
  }
});

// ============================================================
// PREVIEW / THUMBNAIL
// ============================================================

router.get('/thumb/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || !job.thumbnailPath || !fs.existsSync(job.thumbnailPath))
    return res.status(404).json({ error: 'Thumbnail not found' });
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  fs.createReadStream(job.thumbnailPath).pipe(res);
});

router.get('/preview/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || !fs.existsSync(job.originalPath))
    return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Type', job.mimeType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  const stat = fs.statSync(job.originalPath);
  res.setHeader('Content-Length', stat.size);
  fs.createReadStream(job.originalPath).pipe(res);
});

// ============================================================
// PROCESS — AI-powered watermark removal
// ============================================================

router.post('/process', async (req, res) => {
  try {
    const { jobId, regions, method } = req.body;
    if (!jobId || !regions?.length)
      return res.status(400).json({ error: 'Job ID and regions required' });
    const job = jobs.get(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!fs.existsSync(job.originalPath))
      return res.status(404).json({ error: 'File gone' });
    job.status = 'processing'; job.progress = 0; job.error = null;
    res.json({ success: true, jobId });

    try {
      if (job.isVideo) {
        await processVideo(job, regions);
      } else {
        await processImageWithAI(job, regions);
      }
      job.status = 'completed'; job.progress = 100;
    } catch (err) {
      console.error('Processing error:', err);
      job.status = 'error'; job.error = err.message;
    }
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
});

// ============================================================
// STATUS — SSE progress stream
// ============================================================

router.get('/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
    'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'
  });
  const send = d => res.write(`data: ${JSON.stringify(d)}\n\n`);
  const iv = setInterval(() => {
    const j = jobs.get(req.params.id);
    if (!j) { send({ status: 'error', error: 'Gone' }); clearInterval(iv); res.end(); return; }
    send({ status: j.status, progress: j.progress, error: j.error });
    if (j.status === 'completed' || j.status === 'error') {
      clearInterval(iv); setTimeout(() => res.end(), 500);
    }
  }, 300);
  req.on('close', () => clearInterval(iv));
});

// ============================================================
// DOWNLOAD
// ============================================================

router.get('/download/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  if (job.status !== 'completed' || !job.processedPath)
    return res.status(400).json({ error: 'Not ready' });
  if (!fs.existsSync(job.processedPath))
    return res.status(404).json({ error: 'File missing' });
  const ext = path.extname(job.processedPath);
  const safeName = (job.originalName || 'processed').replace(/[^a-zA-Z0-9_\-. ]/g, '').replace(/\.[^.]+$/, '');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}_no_watermark${ext}"`);
  res.setHeader('Content-Type', job.mimeType);
  res.setHeader('Content-Length', fs.statSync(job.processedPath).size);
  fs.createReadStream(job.processedPath).pipe(res);
});

// ============================================================
// IMAGE PROCESSING — Uses IOPaint's LaMa AI model
// ============================================================

async function processImageWithAI(job, regions) {
  const inputPath = job.originalPath;
  const ext = path.extname(inputPath).toLowerCase();
  const outExt = ['.png', '.webp'].includes(ext) ? ext : '.jpg';
  const outPath = path.join(PROCESSED_DIR, `${job.id}_out${outExt}`);

  job.progress = 5;

  // Read the original image as PNG buffer (IOPaint needs consistent format)
  const meta = await sharp(inputPath).metadata();
  const W = meta.width, H = meta.height;

  // Convert image to PNG base64 for IOPaint API
  const imgPngBuffer = await sharp(inputPath).png().toBuffer();
  const imageBase64 = imgPngBuffer.toString('base64');

  job.progress = 15;

  // Create a mask image: black background (keep), white areas (remove/inpaint)
  // The mask must be the same size as the image
  const maskCanvas = sharp({
    create: {
      width: W,
      height: H,
      channels: 3,
      background: { r: 0, g: 0, b: 0 } // Black = keep
    }
  });

  // Draw white rectangles for each watermark region
  const whiteRects = regions.map(r => {
    const rx = Math.max(0, Math.round(r.x * W));
    const ry = Math.max(0, Math.round(r.y * H));
    const rw = Math.min(W - rx, Math.max(1, Math.round(r.w * W)));
    const rh = Math.min(H - ry, Math.max(1, Math.round(r.h * H)));
    return { rx, ry, rw, rh };
  }).filter(r => r.rw > 0 && r.rh > 0);

  if (whiteRects.length === 0) {
    throw new Error('No valid regions to process');
  }

  // Build composite overlays for the mask (white rectangles on black)
  const whiteOverlays = whiteRects.map(r => ({
    input: Buffer.from(
      `<svg width="${r.rw}" height="${r.rh}">
        <rect x="0" y="0" width="${r.rw}" height="${r.rh}" fill="white"/>
      </svg>`
    ),
    left: r.rx,
    top: r.ry
  }));

  const maskPngBuffer = await maskCanvas
    .composite(whiteOverlays)
    .png()
    .toBuffer();

  const maskBase64 = maskPngBuffer.toString('base64');

  job.progress = 25;
  console.log(`[Watermark] Sending to IOPaint: image=${W}x${H}, ${whiteRects.length} regions`);

  // Call IOPaint API with LaMa model
  const requestBody = JSON.stringify({
    image: imageBase64,
    mask: maskBase64,
    hd_strategy: 'Resize',
    hd_strategy_resize_limit: 2048,
    hd_strategy_crop_trigger_size: 800,
    hd_strategy_crop_margin: 128
  });

  job.progress = 30;

  const response = await fetch(`${IOPAINT_URL}/api/v1/inpaint`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: requestBody
  });

  job.progress = 80;

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`IOPaint API error (${response.status}): ${errorText}`);
  }

  // IOPaint returns the result as base64 encoded image in JSON
  const resultData = await response.json();

  job.progress = 90;

  // The response is a base64 encoded image string
  let resultBase64;
  if (typeof resultData === 'string') {
    resultBase64 = resultData;
  } else if (resultData.image) {
    resultBase64 = resultData.image;
  } else {
    // Try to use the response directly
    resultBase64 = JSON.stringify(resultData);
  }

  // Remove data URI prefix if present
  if (resultBase64.startsWith('data:')) {
    resultBase64 = resultBase64.split(',')[1];
  }

  // Decode and save
  const resultBuffer = Buffer.from(resultBase64, 'base64');

  if (outExt === '.png') {
    await sharp(resultBuffer).png().toFile(outPath);
  } else if (outExt === '.webp') {
    await sharp(resultBuffer).webp({ quality: 95 }).toFile(outPath);
  } else {
    await sharp(resultBuffer).jpeg({ quality: 95 }).toFile(outPath);
  }

  job.progress = 100;
  job.processedPath = outPath;
  console.log(`[Watermark] Done: ${outPath}`);
}

// ============================================================
// VIDEO PROCESSING — Uses ffmpeg delogo filter
// ============================================================

function processVideo(job, regions) {
  return new Promise((resolve, reject) => {
    const ext = path.extname(job.originalPath);
    const outPath = path.join(PROCESSED_DIR, `${job.id}_out${ext === '.mov' ? '.mp4' : ext}`);
    job.progress = 5;

    const filters = regions.map(r => {
      const x = Math.max(0, Math.round(r.x * job.width));
      const y = Math.max(0, Math.round(r.y * job.height));
      const w = Math.max(1, Math.round(r.w * job.width));
      const h = Math.max(1, Math.round(r.h * job.height));
      return `delogo=x=${x}:y=${y}:w=${w}:h=${h}`;
    }).filter(Boolean);

    if (!filters.length) return reject(new Error('No valid regions'));

    const args = [
      '-i', job.originalPath,
      '-vf', filters.join(','),
      '-c:a', 'copy',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-movflags', '+faststart',
      '-y', outPath
    ];

    const proc = spawn('ffmpeg', args);
    let stderr = '';

    proc.stderr.on('data', d => {
      const line = d.toString(); stderr += line;
      const tm = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (tm) {
        const cur = parseInt(tm[1]) * 3600 + parseInt(tm[2]) * 60 + parseFloat(tm[3]);
        const dm = stderr.match(/Duration:\s+(\d+):(\d+):(\d+\.\d+)/);
        if (dm) {
          const tot = parseInt(dm[1]) * 3600 + parseInt(dm[2]) * 60 + parseFloat(dm[3]);
          if (tot > 0) job.progress = Math.min(95, Math.round(cur / tot * 95));
        }
      }
    });

    proc.on('close', code => {
      if (code !== 0) {
        console.error('FFmpeg stderr:', stderr.slice(-1000));
        return reject(new Error(`FFmpeg failed (code ${code})`));
      }
      job.processedPath = outPath;
      resolve(outPath);
    });

    proc.on('error', err => reject(new Error('FFmpeg not found: ' + err.message)));
  });
}

// ============================================================
// HELPERS
// ============================================================

function getVideoDimensions(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'json', filePath]);
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => {
      try {
        const s = JSON.parse(out).streams?.[0];
        resolve({ width: s?.width || 1920, height: s?.height || 1080 });
      } catch { resolve({ width: 1920, height: 1080 }); }
    });
    proc.on('error', () => resolve({ width: 1920, height: 1080 }));
  });
}

function extractVideoThumbnail(videoPath, outPath) {
  return new Promise((resolve, reject) => {
    const args = ['-i', videoPath, '-ss', '00:00:01', '-vframes', '1',
      '-vf', 'scale=1200:-1', '-q:v', '3', '-y', outPath];
    const proc = spawn('ffmpeg', args);
    proc.on('close', code => {
      if (code === 0 && fs.existsSync(outPath)) resolve(outPath);
      else reject(new Error('Thumbnail extraction failed'));
    });
    proc.on('error', reject);
  });
}

// Cleanup old jobs every 15 min
setInterval(() => {
  const cutoff = Date.now() - 3600000;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) {
      [job.originalPath, job.processedPath, job.thumbnailPath].forEach(p => {
        if (p && fs.existsSync(p)) try { fs.unlinkSync(p); } catch {}
      });
      jobs.delete(id);
    }
  }
}, 900000);

export default router;

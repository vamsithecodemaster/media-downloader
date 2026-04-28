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

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const file = req.file;
    const isVideo = file.mimetype.startsWith('video/');
    const jobId = path.basename(file.filename, path.extname(file.filename));
    let w = 1920, h = 1080;
    if (!isVideo) {
      const meta = await sharp(file.path).metadata();
      w = meta.width; h = meta.height;
    } else {
      try {
        const d = await getVideoDimensions(file.path);
        w = d.width; h = d.height;
      } catch {}
    }
    jobs.set(jobId, {
      id: jobId, originalPath: file.path, originalName: file.originalname,
      mimeType: file.mimetype, isVideo, status: 'uploaded', progress: 0,
      processedPath: null, error: null, createdAt: Date.now(), width: w, height: h
    });
    res.json({ success: true, jobId, isVideo, width: w, height: h,
      filename: file.originalname, previewUrl: `/api/watermark/preview/${jobId}` });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Upload failed' });
  }
});

router.get('/preview/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || !fs.existsSync(job.originalPath))
    return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Type', job.mimeType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  fs.createReadStream(job.originalPath).pipe(res);
});

router.post('/process', async (req, res) => {
  try {
    const { jobId, regions, method } = req.body;
    if (!jobId || !regions?.length)
      return res.status(400).json({ error: 'Job ID and regions required' });
    const job = jobs.get(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!fs.existsSync(job.originalPath))
      return res.status(404).json({ error: 'File gone' });
    job.status = 'processing'; job.progress = 0;
    res.json({ success: true, jobId });
    try {
      if (job.isVideo) await processVideo(job, regions);
      else await processImage(job, regions, method || 'fill');
      job.status = 'completed'; job.progress = 100;
    } catch (err) {
      job.status = 'error'; job.error = err.message;
    }
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
});

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

async function processImage(job, regions, method) {
  const ext = path.extname(job.originalPath);
  const outPath = path.join(PROCESSED_DIR, `${job.id}_out${ext}`);
  job.progress = 10;
  const meta = await sharp(job.originalPath).metadata();
  const { width: W, height: H } = meta;
  const buf = await sharp(job.originalPath).ensureAlpha().raw().toBuffer();
  job.progress = 30;
  const ch = 4;
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    const rx = Math.max(0, Math.round(r.x * W));
    const ry = Math.max(0, Math.round(r.y * H));
    const rw = Math.min(W - rx, Math.round(r.w * W));
    const rh = Math.min(H - ry, Math.round(r.h * H));
    if (rw <= 0 || rh <= 0) continue;
    if (method === 'fill') fillRegion(buf, W, H, ch, rx, ry, rw, rh);
    else blurRegion(buf, W, H, ch, rx, ry, rw, rh);
    job.progress = 30 + Math.round((i + 1) / regions.length * 50);
  }
  job.progress = 85;
  const out = sharp(buf, { raw: { width: W, height: H, channels: ch } });
  const le = ext.toLowerCase();
  if (le === '.png') await out.png({ quality: 100 }).toFile(outPath);
  else if (le === '.webp') await out.webp({ quality: 95 }).toFile(outPath);
  else await out.jpeg({ quality: 95 }).toFile(outPath);
  job.processedPath = outPath;
}

function fillRegion(buf, W, H, ch, rx, ry, rw, rh) {
  const margin = Math.max(8, Math.round(Math.min(rw, rh) * 0.25));
  for (let y = ry; y < ry + rh && y < H; y++) {
    for (let x = rx; x < rx + rw && x < W; x++) {
      const relX = (x - rx) / rw, relY = (y - ry) / rh;
      const lx = Math.max(0, rx - margin), rx2 = Math.min(W - 1, rx + rw + margin);
      const ty = Math.max(0, ry - margin), by = Math.min(H - 1, ry + rh + margin);
      const idx = (y * W + x) * ch;
      for (let c = 0; c < 3; c++) {
        const lv = buf[(y * W + lx) * ch + c], rv = buf[(y * W + rx2) * ch + c];
        const tv = buf[(ty * W + x) * ch + c], bv = buf[(by * W + x) * ch + c];
        buf[idx + c] = Math.round(((lv * (1 - relX) + rv * relX) + (tv * (1 - relY) + bv * relY)) / 2);
      }
    }
  }
}

function blurRegion(buf, W, H, ch, rx, ry, rw, rh) {
  const rad = Math.max(6, Math.round(Math.min(rw, rh) * 0.12));
  const tmp = Buffer.from(buf);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = ry; y < ry + rh && y < H; y++) {
      for (let x = rx; x < rx + rw && x < W; x++) {
        let r = 0, g = 0, b = 0, cnt = 0;
        for (let dy = -rad; dy <= rad; dy++) {
          for (let dx = -rad; dx <= rad; dx++) {
            const sx = Math.min(W - 1, Math.max(0, x + dx));
            const sy = Math.min(H - 1, Math.max(0, y + dy));
            const si = (sy * W + sx) * ch;
            r += buf[si]; g += buf[si + 1]; b += buf[si + 2]; cnt++;
          }
        }
        const di = (y * W + x) * ch;
        tmp[di] = Math.round(r / cnt); tmp[di + 1] = Math.round(g / cnt); tmp[di + 2] = Math.round(b / cnt);
      }
    }
    for (let y = ry; y < ry + rh && y < H; y++) {
      for (let x = rx; x < rx + rw && x < W; x++) {
        const i = (y * W + x) * ch;
        buf[i] = tmp[i]; buf[i + 1] = tmp[i + 1]; buf[i + 2] = tmp[i + 2];
      }
    }
  }
}

function processVideo(job, regions) {
  return new Promise((resolve, reject) => {
    const ext = path.extname(job.originalPath);
    const outPath = path.join(PROCESSED_DIR, `${job.id}_out${ext === '.mov' ? '.mp4' : ext}`);
    job.progress = 5;
    const filters = regions.map(r => {
      const x = Math.round(r.x * job.width), y = Math.round(r.y * job.height);
      const w = Math.round(r.w * job.width), h = Math.round(r.h * job.height);
      return w > 0 && h > 0 ? `delogo=x=${x}:y=${y}:w=${w}:h=${h}` : null;
    }).filter(Boolean);
    if (!filters.length) return reject(new Error('No valid regions'));
    const args = ['-i', job.originalPath, '-vf', filters.join(','),
      '-c:a', 'copy', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
      '-movflags', '+faststart', '-y', outPath];
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
      if (code !== 0) return reject(new Error(`FFmpeg failed (${code})`));
      job.processedPath = outPath; resolve(outPath);
    });
    proc.on('error', err => reject(new Error('FFmpeg error: ' + err.message)));
  });
}

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

// Cleanup old jobs
setInterval(() => {
  const cutoff = Date.now() - 3600000;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) {
      [job.originalPath, job.processedPath].forEach(p => {
        if (p && fs.existsSync(p)) try { fs.unlinkSync(p); } catch {}
      });
      jobs.delete(id);
    }
  }
}, 900000);

export default router;

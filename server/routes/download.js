import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { getMediaInfo, downloadMedia } from '../utils/ytdlp.js';

const router = Router();

// In-memory store for active downloads
const downloads = new Map();

// Downloads directory
const DOWNLOADS_DIR = path.join(process.cwd(), 'downloads');

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

/**
 * POST /api/info
 * Fetch media metadata from a URL
 */
router.post('/info', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const info = await getMediaInfo(url.trim());
    res.json({ success: true, data: info });
  } catch (error) {
    console.error('Error fetching media info:', error.message);
    res.status(500).json({
      error: error.message || 'Failed to fetch media info',
      details: error.message
    });
  }
});

/**
 * POST /api/download
 * Start a media download
 */
router.post('/download', async (req, res) => {
  try {
    const { url, formatId, ext, title } = req.body;

    if (!url || !formatId) {
      return res.status(400).json({ error: 'URL and formatId are required' });
    }

    const downloadId = uuidv4();
    const safeTitle = (title || 'download')
      .replace(/[^a-zA-Z0-9_\- ]/g, '')
      .substring(0, 100)
      .trim() || 'download';
    const outputPath = path.join(DOWNLOADS_DIR, `${downloadId}_${safeTitle}`);

    // Initialize download state
    downloads.set(downloadId, {
      id: downloadId,
      url,
      formatId,
      ext: ext || 'mp4',
      title: title || 'Unknown',
      status: 'downloading',
      progress: { percent: 0 },
      filePath: null,
      error: null,
      createdAt: Date.now()
    });

    res.json({ success: true, downloadId });

    // Start download in background
    try {
      const filePath = await downloadMedia(
        url,
        formatId,
        outputPath,
        ext || 'mp4',
        (progress) => {
          const dl = downloads.get(downloadId);
          if (dl) {
            dl.progress = { ...dl.progress, ...progress };
          }
        }
      );

      const dl = downloads.get(downloadId);
      if (dl) {
        dl.status = 'completed';
        dl.progress = { percent: 100, status: 'Complete' };
        dl.filePath = filePath;
      }
    } catch (error) {
      console.error('Download error:', error.message);
      const dl = downloads.get(downloadId);
      if (dl) {
        dl.status = 'error';
        dl.error = error.message;
      }
    }
  } catch (error) {
    console.error('Error starting download:', error.message);
    res.status(500).json({
      error: error.message || 'Failed to start download',
      details: error.message
    });
  }
});

/**
 * GET /api/progress/:id
 * Server-Sent Events endpoint for real-time progress
 */
router.get('/progress/:id', (req, res) => {
  const { id } = req.params;
  const download = downloads.get(id);

  if (!download) {
    return res.status(404).json({ error: 'Download not found' });
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send progress updates every 500ms
  const interval = setInterval(() => {
    const dl = downloads.get(id);
    if (!dl) {
      sendEvent({ status: 'error', error: 'Download not found' });
      clearInterval(interval);
      res.end();
      return;
    }

    sendEvent({
      status: dl.status,
      progress: dl.progress,
      error: dl.error
    });

    // If download is complete or errored, stop sending updates
    if (dl.status === 'completed' || dl.status === 'error') {
      clearInterval(interval);
      setTimeout(() => res.end(), 500);
    }
  }, 500);

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(interval);
  });
});

/**
 * GET /api/file/:id
 * Serve a completed download file
 */
router.get('/file/:id', (req, res) => {
  const { id } = req.params;
  const download = downloads.get(id);

  if (!download) {
    return res.status(404).json({ error: 'Download not found' });
  }

  if (download.status !== 'completed' || !download.filePath) {
    return res.status(400).json({ error: 'Download not yet complete' });
  }

  // Find the actual file (yt-dlp may change the extension)
  let filePath = download.filePath;

  if (!fs.existsSync(filePath)) {
    // Try to find the file by checking common extensions
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    const possibleExts = ['.mp4', '.mkv', '.webm', '.mp3', '.m4a', '.opus', '.ogg'];

    for (const ext of possibleExts) {
      const candidate = path.join(dir, base + ext);
      if (fs.existsSync(candidate)) {
        filePath = candidate;
        break;
      }
    }
  }

  if (!fs.existsSync(filePath)) {
    // Try scanning the downloads directory for files starting with the download ID
    const files = fs.readdirSync(DOWNLOADS_DIR);
    const match = files.find(f => f.startsWith(id));
    if (match) {
      filePath = path.join(DOWNLOADS_DIR, match);
    } else {
      return res.status(404).json({ error: 'File not found on disk' });
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.opus': 'audio/opus',
    '.ogg': 'audio/ogg'
  };

  const safeTitle = (download.title || 'download').replace(/[^a-zA-Z0-9_\- ]/g, '');
  const filename = `${safeTitle}${ext}`;

  res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Length', stat.size);

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);

  stream.on('error', (err) => {
    console.error('File stream error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error streaming file' });
    }
  });
});

/**
 * Cleanup old downloads periodically (older than 1 hour)
 */
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [id, dl] of downloads) {
    if (dl.createdAt < oneHourAgo) {
      // Delete file if it exists
      if (dl.filePath && fs.existsSync(dl.filePath)) {
        try {
          fs.unlinkSync(dl.filePath);
        } catch (e) {
          console.error('Error deleting file:', e.message);
        }
      }
      downloads.delete(id);
    }
  }

  // Also clean orphaned files in downloads directory
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    const activeIds = new Set([...downloads.keys()]);
    for (const file of files) {
      const fileId = file.split('_')[0];
      if (!activeIds.has(fileId)) {
        const aged = Date.now() - fs.statSync(path.join(DOWNLOADS_DIR, file)).mtimeMs;
        if (aged > 60 * 60 * 1000) {
          fs.unlinkSync(path.join(DOWNLOADS_DIR, file));
        }
      }
    }
  } catch (e) {
    // Ignore cleanup errors
  }
}, 15 * 60 * 1000); // Every 15 minutes

export default router;

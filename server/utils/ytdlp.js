import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * Fetch media information using yt-dlp --dump-json
 * @param {string} url - The media URL
 * @returns {Promise<object>} Parsed media info
 */
export function getMediaInfo(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-json',
      '--no-warnings',
      '--no-playlist',
      '--flat-playlist',
      '--force-ipv4',
      '--extractor-args', 'youtube:player_client=android,web'
    ];

    const cookiesPath = path.join(process.cwd(), 'cookies.txt');
    if (fs.existsSync(cookiesPath)) {
      args.push('--cookies', cookiesPath);
    }

    args.push(url);

    const proc = spawn('yt-dlp', args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      }
      try {
        const info = JSON.parse(stdout);

        // Extract available formats and organize them
        const formats = extractFormats(info);

        resolve({
          id: info.id,
          title: info.title || 'Unknown Title',
          description: info.description?.substring(0, 200) || '',
          thumbnail: info.thumbnail || info.thumbnails?.[info.thumbnails.length - 1]?.url || '',
          duration: info.duration || 0,
          uploader: info.uploader || info.channel || 'Unknown',
          platform: info.extractor_key || info.extractor || 'Unknown',
          url: info.webpage_url || url,
          formats,
          originalUrl: url
        });
      } catch (e) {
        reject(new Error('Failed to parse media info: ' + e.message));
      }
    });

    proc.on('error', (err) => {
      reject(new Error('Failed to spawn yt-dlp: ' + err.message));
    });
  });
}

/**
 * Extract and organize available formats from yt-dlp info
 */
function extractFormats(info) {
  const formats = [];
  const seen = new Set();

  if (!info.formats || !Array.isArray(info.formats)) {
    // If no detailed formats, return a default best option
    return [{
      id: 'best',
      label: 'Best Quality',
      quality: 'best',
      ext: info.ext || 'mp4',
      type: 'video+audio',
      filesize: null
    }];
  }

  // Video formats - find unique resolutions
  const videoFormats = info.formats
    .filter(f => f.vcodec && f.vcodec !== 'none' && f.height)
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  const resolutions = [
    { height: 2160, label: '4K', fps: [60, 30] },
    { height: 1440, label: '2K', fps: [60, 30] },
    { height: 1080, label: '1080p', fps: [60, 30] },
    { height: 720, label: '720p', fps: [60, 30] },
    { height: 480, label: '480p', fps: [30] },
    { height: 360, label: '360p', fps: [30] },
  ];

  for (const res of resolutions) {
    for (const fps of res.fps) {
      const match = videoFormats.find(f =>
        f.height === res.height &&
        (fps === 60 ? (f.fps >= 50) : (f.fps < 50 || !f.fps))
      );
      if (match) {
        const key = `${res.height}p${fps === 60 ? '60' : ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          formats.push({
            id: `bestvideo[height=${res.height}]${fps === 60 ? '[fps>=50]' : '[fps<50]'}+bestaudio/best[height=${res.height}]`,
            label: `${res.label}${fps === 60 ? ' 60fps' : ''}`,
            quality: key,
            ext: 'mp4',
            type: 'video+audio',
            filesize: match.filesize || match.filesize_approx || null,
            height: res.height,
            fps: fps
          });
        }
      }
    }
  }

  // Always add a "Best Available" option at the top
  formats.unshift({
    id: 'bestvideo+bestaudio/best',
    label: 'Best Available',
    quality: 'best',
    ext: 'mp4',
    type: 'video+audio',
    filesize: null
  });

  // Add audio-only options
  formats.push({
    id: 'bestaudio',
    label: 'Audio Only (Best)',
    quality: 'audio',
    ext: 'mp3',
    type: 'audio',
    filesize: null
  });

  return formats;
}

/**
 * Download media using yt-dlp
 * @param {string} url - Media URL
 * @param {string} formatId - yt-dlp format selector string
 * @param {string} outputPath - Output file path (without extension)
 * @param {string} ext - Desired extension (mp4, mp3, etc.)
 * @param {function} onProgress - Progress callback
 * @returns {Promise<string>} Final file path
 */
export function downloadMedia(url, formatId, outputPath, ext, onProgress) {
  return new Promise((resolve, reject) => {
    const outputTemplate = outputPath + '.%(ext)s';
    const args = [
      '-f', formatId,
      '--merge-output-format', ext === 'mp3' ? 'mp4' : 'mp4',
      '--no-playlist',
      '--no-warnings',
      '--newline', // Each progress update on a new line
      '--force-ipv4',
      '--extractor-args', 'youtube:player_client=android,web',
      '-o', outputTemplate
    ];

    const cookiesPath = path.join(process.cwd(), 'cookies.txt');
    if (fs.existsSync(cookiesPath)) {
      args.push('--cookies', cookiesPath);
    }
    
    args.push(url);

    // If audio only, extract audio
    if (ext === 'mp3') {
      args.splice(0, 0, '-x', '--audio-format', 'mp3');
      // Remove -f and format args for audio extraction
      const fIdx = args.indexOf('-f');
      if (fIdx !== -1) {
        args.splice(fIdx, 2);
      }
      // Remove merge output format for audio
      const mIdx = args.indexOf('--merge-output-format');
      if (mIdx !== -1) {
        args.splice(mIdx, 2);
      }
    }

    const proc = spawn('yt-dlp', args);
    let stderr = '';
    let lastFile = '';

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        // Parse progress: [download]  45.2% of ~150.00MiB at 5.00MiB/s ETA 00:15
        const progressMatch = line.match(
          /\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\w+)\s+at\s+([\d.]+\w+\/s)\s+ETA\s+(\S+)/
        );
        if (progressMatch && onProgress) {
          onProgress({
            percent: parseFloat(progressMatch[1]),
            totalSize: progressMatch[2],
            speed: progressMatch[3],
            eta: progressMatch[4]
          });
        }

        // Parse destination: [download] Destination: filename.ext
        const destMatch = line.match(/\[download\] Destination:\s+(.+)/);
        if (destMatch) {
          lastFile = destMatch[1].trim();
        }

        // Parse merge: [Merger] Merging formats into "filename"
        const mergeMatch = line.match(/\[Merger\] Merging formats into "(.+)"/);
        if (mergeMatch) {
          lastFile = mergeMatch[1].trim();
          if (onProgress) {
            onProgress({ percent: 99, status: 'Merging video and audio...' });
          }
        }

        // Already downloaded
        const alreadyMatch = line.match(/\[download\] (.+) has already been downloaded/);
        if (alreadyMatch) {
          lastFile = alreadyMatch[1].trim();
          if (onProgress) {
            onProgress({ percent: 100, status: 'Already downloaded' });
          }
        }

        // Download complete: 100%
        if (line.includes('100%') || line.includes('100.0%')) {
          if (onProgress) {
            onProgress({ percent: 100, status: 'Processing...' });
          }
        }
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || `yt-dlp download failed with code ${code}`));
      }
      resolve(lastFile || outputPath);
    });

    proc.on('error', (err) => {
      reject(new Error('Failed to spawn yt-dlp: ' + err.message));
    });
  });
}

/**
 * Format duration in seconds to human-readable string
 */
export function formatDuration(seconds) {
  if (!seconds) return 'Unknown';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

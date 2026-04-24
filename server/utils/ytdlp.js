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

function extractFormats(info) {
  const formats = [];
  
  // Add global "Best" explicitly built for high compatibility (avc/h264 format)
  // Note: pipe | inside ~= is a yt-dlp selector separator, so we chain with / instead
  formats.push({
    id: 'bestvideo[vcodec~=avc][ext=mp4]+bestaudio[ext=m4a]/bestvideo[vcodec~=hev][ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    label: 'Best Compatible (MP4)',
    quality: 'best_compatible',
    ext: 'mp4',
    type: 'video+audio',
    filesize: null
  });

  if (!info.formats || !Array.isArray(info.formats)) {
    formats.unshift({
      id: 'best',
      label: 'Best Available',
      quality: 'best',
      ext: info.ext || 'mp4',
      type: 'video+audio',
      filesize: null
    });
    return formats;
  }

  // Pre-process formats to extract width/height if necessary
  const processedFormats = info.formats.map(f => {
    let w = f.width || 0;
    let h = f.height || 0;
    if (!w && !h && f.resolution && typeof f.resolution === 'string' && f.resolution.includes('x')) {
      const parts = f.resolution.split('x');
      w = parseInt(parts[0], 10) || 0;
      h = parseInt(parts[1], 10) || 0;
    }
    return { ...f, width: w, height: h };
  });

  const videoFormats = processedFormats
    .filter(f => f.vcodec && f.vcodec !== 'none' && (f.height || f.width))
    .sort((a, b) => {
      const aSize = (a.height || 0) * (a.width || 0);
      const bSize = (b.height || 0) * (b.width || 0);
      if (bSize !== aSize) return bSize - aSize;
      return (b.fps || 0) - (a.fps || 0);
    });

  const getResLabel = (width, height, formatNote) => {
    const short = Math.min(width || 0, height || 0);
    const long = Math.max(width || 0, height || 0);

    if (short >= 2160 || long >= 3800) return { r: 2160, l: '4K' };
    if (short >= 1440 || long >= 2500) return { r: 1440, l: '2K' };
    if (short >= 1080 || long >= 1900) return { r: 1080, l: '1080p FHD' };
    if (short >= 720 || long >= 1200) return { r: 720, l: '720p HD' };
    if (short >= 480 || long >= 800) return { r: 480, l: '480p SD' };
    if (short >= 360 || long >= 600) return { r: 360, l: '360p SD' };
    if (formatNote && typeof formatNote === 'string') return { r: short || long || 0, l: formatNote };
    return { r: short || long || 0, l: `${short || long}p` };
  };

  const formatGroups = new Map();

  for (const f of videoFormats) {
    const res = getResLabel(f.width, f.height, f.format_note);
    // Ignore absurdly small resolutions natively
    if (res.r === 0 && (!f.format_note || f.format_note.includes('audio'))) continue;
    
    const is60fps = f.fps && f.fps >= 50;
    const isAVC = f.vcodec && (f.vcodec.includes('avc') || f.vcodec.includes('h264') || f.vcodec.includes('hev') || f.vcodec.includes('h265') || f.vcodec.includes('hevc'));
    const isMP4 = f.ext === 'mp4';
    
    const key = `${res.r}-${is60fps ? '60' : '30'}`;
    
    if (!formatGroups.has(key)) {
      formatGroups.set(key, []);
    }
    formatGroups.get(key).push({ ...f, isAVC, isMP4, resLabel: res.l, is60fps });
  }

  // Iterate over detected resolution groups
  for (const [key, group] of formatGroups) {
    group.sort((a, b) => {
      if (a.isAVC && !b.isAVC) return -1;
      if (!a.isAVC && b.isAVC) return 1;
      if (a.isMP4 && !b.isMP4) return -1;
      if (!a.isMP4 && b.isMP4) return 1;
      return (b.tbr || 0) - (a.tbr || 0); // fallback to highest bitrate
    });

    const bestForRes = group[0];
    const fpsStr = bestForRes.is60fps ? ' 60fps' : '';
    const label = `${bestForRes.resLabel}${fpsStr}`;
    
    let formatId = bestForRes.format_id;
    // If format doesn't natively include audio, bundle best audio with it
    if (bestForRes.acodec === 'none' || !bestForRes.acodec) {
      // Prioritize m4a audio to naturally align with mp4 container
      formatId = `${bestForRes.format_id}+bestaudio[ext=m4a]/bestaudio/best`;
    }

    formats.push({
      id: formatId,
      label: label,
      quality: key,
      ext: 'mp4',
      type: 'video+audio',
      filesize: bestForRes.filesize || bestForRes.filesize_approx || null,
      height: bestForRes.height,
      fps: bestForRes.fps
    });
  }

  // Add the general "Best Available" explicit bypass
  formats.unshift({
    id: 'bestvideo+bestaudio/best',
    label: 'Best Available (Original)',
    quality: 'best',
    ext: 'mp4',
    type: 'video+audio',
    filesize: null
  });

  // Add audio-only option
  formats.push({
    id: 'bestaudio[ext=m4a]/bestaudio/best',
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

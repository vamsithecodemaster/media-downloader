// Watermark Remover - Client Logic
const API_URL = '/api/watermark';

// DOM Elements
const els = {
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('file-input'),
  uploadProgress: document.getElementById('upload-progress'),
  uploadProgressFill: document.getElementById('upload-progress-fill'),
  uploadStatus: document.getElementById('upload-status'),
  uploadSection: document.getElementById('upload-section'),
  editorSection: document.getElementById('editor-section'),
  editorFilename: document.getElementById('editor-filename'),
  canvas: document.getElementById('editor-canvas'),
  canvasWrap: document.getElementById('canvas-wrap'),
  selectionOverlay: document.getElementById('selection-overlay'),
  undoBtn: document.getElementById('undo-btn'),
  clearBtn: document.getElementById('clear-btn'),
  regionCount: document.getElementById('region-count'),
  processBtn: document.getElementById('process-btn'),
  processBtnText: document.getElementById('process-btn-text'),
  processLoader: document.getElementById('process-loader'),
  processProgress: document.getElementById('process-progress'),
  processProgressFill: document.getElementById('process-progress-fill'),
  processPercent: document.getElementById('process-percent'),
  processStatus: document.getElementById('process-status'),
  completeSection: document.getElementById('complete-section'),
  downloadBtn: document.getElementById('download-btn'),
  newFileBtn: document.getElementById('new-file-btn'),
  toastContainer: document.getElementById('toast-container'),
  methodFill: document.getElementById('method-fill'),
  methodBlur: document.getElementById('method-blur'),
};

// State
let currentJob = null;
let regions = [];
let isDrawing = false;
let drawStart = null;
let activeRect = null;
let selectedMethod = 'fill';
let mediaImage = null;
let originalWidth = 0;
let originalHeight = 0;

// Init
function init() {
  setupDropzone();
  setupCanvasEvents();
  setupToolbar();

  els.newFileBtn.addEventListener('click', resetToUpload);
  els.processBtn.addEventListener('click', handleProcess);
  els.downloadBtn.addEventListener('click', handleDownload);
}

// ---- Dropzone ----
function setupDropzone() {
  const dz = els.dropzone;

  ['dragenter', 'dragover'].forEach(e => {
    dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(e => {
    dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.remove('dragover'); });
  });

  dz.addEventListener('drop', (ev) => {
    const file = ev.dataTransfer?.files?.[0];
    if (file) uploadFile(file);
  });

  els.fileInput.addEventListener('change', (ev) => {
    const file = ev.target.files?.[0];
    if (file) uploadFile(file);
  });
}

// ---- Upload ----
async function uploadFile(file) {
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    showToast('Please upload an image or video file', 'error');
    return;
  }

  if (file.size > 500 * 1024 * 1024) {
    showToast('File too large. Maximum 500MB', 'error');
    return;
  }

  els.uploadProgress.hidden = false;
  els.uploadProgressFill.style.width = '0%';
  els.uploadStatus.textContent = 'Uploading...';
  els.dropzone.style.display = 'none';

  const formData = new FormData();
  formData.append('file', file);

  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/upload`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        els.uploadProgressFill.style.width = `${pct}%`;
        els.uploadStatus.textContent = `Uploading... ${pct}%`;
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        if (data.success) {
          currentJob = data;
          originalWidth = data.width;
          originalHeight = data.height;
          showEditor(data);
        } else {
          throw new Error(data.error || 'Upload failed');
        }
      } else {
        const err = JSON.parse(xhr.responseText);
        throw new Error(err.error || 'Upload failed');
      }
    };

    xhr.onerror = () => { throw new Error('Upload failed'); };
    xhr.send(formData);
  } catch (err) {
    showToast(err.message, 'error');
    resetUploadUI();
  }
}

// ---- Editor ----
function showEditor(data) {
  els.uploadSection.hidden = true;
  els.editorSection.hidden = false;
  els.editorFilename.textContent = data.filename || 'Select Watermark Area';
  regions = [];
  updateRegionUI();

  const previewUrl = data.previewUrl;

  if (data.isVideo) {
    // For video, show first frame via video element
    loadVideoFrame(previewUrl);
  } else {
    loadImage(previewUrl);
  }
}

function loadImage(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    mediaImage = img;
    drawCanvas();
  };
  img.onerror = () => showToast('Failed to load preview', 'error');
  img.src = url;
}

function loadVideoFrame(url) {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.preload = 'auto';

  video.onloadeddata = () => {
    video.currentTime = 0.5; // Seek to 0.5s for a good frame
  };

  video.onseeked = () => {
    // Draw video frame to a temporary canvas to get an image
    const tc = document.createElement('canvas');
    tc.width = video.videoWidth;
    tc.height = video.videoHeight;
    const tctx = tc.getContext('2d');
    tctx.drawImage(video, 0, 0);

    const img = new Image();
    img.onload = () => {
      mediaImage = img;
      drawCanvas();
    };
    img.src = tc.toDataURL();
  };

  video.onerror = () => showToast('Failed to load video preview', 'error');
  video.src = url;
}

function drawCanvas() {
  if (!mediaImage) return;
  const canvas = els.canvas;
  const ctx = canvas.getContext('2d');

  // Set canvas size to match image
  canvas.width = mediaImage.naturalWidth || mediaImage.width;
  canvas.height = mediaImage.naturalHeight || mediaImage.height;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(mediaImage, 0, 0);
}

// ---- Canvas Events (Selection) ----
function setupCanvasEvents() {
  const wrap = els.canvasWrap;

  wrap.addEventListener('mousedown', (e) => startDraw(e));
  wrap.addEventListener('mousemove', (e) => moveDraw(e));
  wrap.addEventListener('mouseup', (e) => endDraw(e));
  wrap.addEventListener('mouseleave', (e) => endDraw(e));

  // Touch support
  wrap.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startDraw(e.touches[0]);
  }, { passive: false });
  wrap.addEventListener('touchmove', (e) => {
    e.preventDefault();
    moveDraw(e.touches[0]);
  }, { passive: false });
  wrap.addEventListener('touchend', (e) => {
    e.preventDefault();
    endDraw(e.changedTouches?.[0]);
  }, { passive: false });
}

function getCanvasPoint(e) {
  const rect = els.canvasWrap.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height
  };
}

function startDraw(e) {
  if (e.target.closest('.wm-selection-rect')) return; // Don't draw when clicking delete
  isDrawing = true;
  drawStart = getCanvasPoint(e);

  // Create active selection visual
  activeRect = document.createElement('div');
  activeRect.className = 'wm-active-selection';
  els.selectionOverlay.appendChild(activeRect);
}

function moveDraw(e) {
  if (!isDrawing || !drawStart || !activeRect) return;
  const current = getCanvasPoint(e);

  const left = Math.min(drawStart.x, current.x) * 100;
  const top = Math.min(drawStart.y, current.y) * 100;
  const width = Math.abs(current.x - drawStart.x) * 100;
  const height = Math.abs(current.y - drawStart.y) * 100;

  activeRect.style.left = `${left}%`;
  activeRect.style.top = `${top}%`;
  activeRect.style.width = `${width}%`;
  activeRect.style.height = `${height}%`;
}

function endDraw(e) {
  if (!isDrawing || !drawStart) return;
  isDrawing = false;

  if (activeRect) {
    activeRect.remove();
    activeRect = null;
  }

  if (!e) return;
  const end = getCanvasPoint(e);

  const x = Math.min(drawStart.x, end.x);
  const y = Math.min(drawStart.y, end.y);
  const w = Math.abs(end.x - drawStart.x);
  const h = Math.abs(end.y - drawStart.y);

  // Minimum selection size (1% of canvas)
  if (w < 0.01 || h < 0.01) {
    drawStart = null;
    return;
  }

  // Clamp to valid range
  const region = {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    w: Math.max(0, Math.min(1 - x, w)),
    h: Math.max(0, Math.min(1 - y, h))
  };

  regions.push(region);
  drawStart = null;
  updateRegionUI();
}

function updateRegionUI() {
  // Clear old selection rects
  els.selectionOverlay.innerHTML = '';

  regions.forEach((region, idx) => {
    const rect = document.createElement('div');
    rect.className = 'wm-selection-rect';
    rect.style.left = `${region.x * 100}%`;
    rect.style.top = `${region.y * 100}%`;
    rect.style.width = `${region.w * 100}%`;
    rect.style.height = `${region.h * 100}%`;

    // Delete button (the ::after pseudo-element handles the visual)
    rect.addEventListener('click', (e) => {
      regions.splice(idx, 1);
      updateRegionUI();
    });

    els.selectionOverlay.appendChild(rect);
  });

  const count = regions.length;
  els.regionCount.textContent = `${count} region${count !== 1 ? 's' : ''} selected`;
  els.undoBtn.disabled = count === 0;
  els.clearBtn.disabled = count === 0;
  els.processBtn.disabled = count === 0;
}

// ---- Toolbar ----
function setupToolbar() {
  els.undoBtn.addEventListener('click', () => {
    if (regions.length > 0) {
      regions.pop();
      updateRegionUI();
    }
  });

  els.clearBtn.addEventListener('click', () => {
    regions = [];
    updateRegionUI();
  });

  [els.methodFill, els.methodBlur].forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.wm-method-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedMethod = btn.dataset.method;
    });
  });
}

// ---- Process ----
async function handleProcess() {
  if (!currentJob || regions.length === 0) return;

  els.processBtn.disabled = true;
  els.processBtnText.hidden = true;
  els.processLoader.hidden = false;
  els.processProgress.hidden = false;
  els.completeSection.hidden = true;
  els.processProgressFill.style.width = '0%';
  els.processPercent.textContent = '0%';
  els.processStatus.textContent = 'Starting...';

  try {
    const res = await fetch(`${API_URL}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: currentJob.jobId,
        regions,
        method: selectedMethod
      })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Processing failed');

    // Connect to SSE for progress
    connectSSE(currentJob.jobId);
  } catch (err) {
    showToast(err.message, 'error');
    resetProcessUI();
  }
}

function connectSSE(jobId) {
  const es = new EventSource(`${API_URL}/status/${jobId}`);

  es.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.status === 'error') {
      es.close();
      showToast(data.error || 'Processing failed', 'error');
      resetProcessUI();
      return;
    }

    if (data.progress !== undefined) {
      const pct = Math.min(100, Math.max(0, data.progress));
      els.processProgressFill.style.width = `${pct}%`;
      els.processPercent.textContent = `${pct}%`;

      if (pct < 30) els.processStatus.textContent = 'Analyzing media...';
      else if (pct < 70) els.processStatus.textContent = 'Removing watermark...';
      else if (pct < 95) els.processStatus.textContent = 'Finalizing...';
      else els.processStatus.textContent = 'Almost done...';
    }

    if (data.status === 'completed') {
      es.close();
      els.processProgress.hidden = true;
      els.completeSection.hidden = false;
      els.processBtnText.hidden = false;
      els.processLoader.hidden = true;
      els.processBtn.disabled = false;
      showToast('Watermark removed successfully!', 'success');
    }
  };

  es.onerror = () => {
    es.close();
    if (els.completeSection.hidden) {
      showToast('Connection lost', 'error');
      resetProcessUI();
    }
  };
}

function handleDownload() {
  if (!currentJob) return;
  window.location.href = `${API_URL}/download/${currentJob.jobId}`;
}

// ---- Reset / Utility ----
function resetToUpload() {
  els.editorSection.hidden = true;
  els.uploadSection.hidden = false;
  els.dropzone.style.display = '';
  els.uploadProgress.hidden = true;
  els.fileInput.value = '';
  els.completeSection.hidden = true;
  els.processProgress.hidden = true;
  currentJob = null;
  regions = [];
  mediaImage = null;
}

function resetUploadUI() {
  els.dropzone.style.display = '';
  els.uploadProgress.hidden = true;
}

function resetProcessUI() {
  els.processBtn.disabled = false;
  els.processBtnText.hidden = false;
  els.processLoader.hidden = true;
  els.processProgress.hidden = true;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icon = type === 'error'
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff5050" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4cd964" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  toast.innerHTML = `${icon} <span>${message}</span>`;
  els.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove());
  }, 4000);
}

init();

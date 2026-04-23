// API configuration
const API_URL = '/api';

// DOM Elements
const elements = {
  urlInput: document.getElementById('url-input'),
  fetchBtn: document.getElementById('fetch-btn'),
  pasteBtn: document.getElementById('paste-btn'),
  platformIcon: document.getElementById('platform-icon'),
  inputCard: document.getElementById('input-card'),
  
  previewSection: document.getElementById('preview-section'),
  previewThumbnail: document.getElementById('preview-thumbnail'),
  previewDuration: document.getElementById('preview-duration'),
  previewPlatform: document.getElementById('preview-platform'),
  previewTitle: document.getElementById('preview-title'),
  previewUploader: document.getElementById('preview-uploader'),
  
  formatGrid: document.getElementById('format-grid'),
  downloadBtn: document.getElementById('download-btn'),
  
  progressSection: document.getElementById('progress-section'),
  progressFill: document.getElementById('progress-fill'),
  progressPercent: document.getElementById('progress-percent'),
  progressInfo: document.getElementById('progress-info'),
  
  completeSection: document.getElementById('complete-section'),
  saveBtn: document.getElementById('save-btn'),
  
  historySection: document.getElementById('history-section'),
  historyList: document.getElementById('history-list'),
  clearHistoryBtn: document.getElementById('clear-history-btn'),
  
  toastContainer: document.getElementById('toast-container')
};

// State
let currentMediaInfo = null;
let selectedFormatId = null;
let currentDownloadId = null;
let eventSource = null;

// Platform detection regex
const platforms = [
  { name: 'youtube', regex: /(?:youtube\.com|youtu\.be)/i },
  { name: 'instagram', regex: /instagram\.com/i },
  { name: 'twitter', regex: /(?:twitter\.com|x\.com)/i },
  { name: 'tiktok', regex: /tiktok\.com/i },
  { name: 'reddit', regex: /reddit\.com/i },
  { name: 'facebook', regex: /(?:facebook\.com|fb\.watch)/i }
];

// Initialize
function init() {
  setupEventListeners();
  loadHistory();
}

// Event Listeners
function setupEventListeners() {
  elements.fetchBtn.addEventListener('click', handleFetch);
  
  elements.urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleFetch();
  });
  
  elements.urlInput.addEventListener('input', () => {
    updatePlatformIcon(elements.urlInput.value);
  });
  
  elements.pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      elements.urlInput.value = text;
      updatePlatformIcon(text);
      if (isValidUrl(text)) handleFetch();
    } catch (err) {
      showToast('Clipboard access denied', 'error');
    }
  });

  elements.downloadBtn.addEventListener('click', handleDownload);
  elements.saveBtn.addEventListener('click', handleSaveFile);
  elements.clearHistoryBtn.addEventListener('click', clearHistory);
}

// Platform Icon Detection
function updatePlatformIcon(url) {
  elements.platformIcon.className = 'input-icon';
  const iconSvg = elements.platformIcon.querySelector('svg');
  
  let detected = null;
  for (const platform of platforms) {
    if (platform.regex.test(url)) {
      detected = platform.name;
      elements.platformIcon.classList.add(platform.name);
      break;
    }
  }

  // Update SVG based on platform
  if (detected === 'youtube') {
    iconSvg.innerHTML = `<path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33 2.78 2.78 0 0 0 1.94 2c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.33 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/>`;
  } else if (detected === 'instagram') {
    iconSvg.innerHTML = `<rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>`;
  } else if (detected === 'twitter') {
    iconSvg.innerHTML = `<path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"/>`;
  } else {
    // Default link icon
    iconSvg.innerHTML = `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />`;
  }
}

// Fetch Media Info
async function handleFetch() {
  const url = elements.urlInput.value.trim();
  if (!isValidUrl(url)) {
    showToast('Please enter a valid URL', 'error');
    return;
  }

  if (/(?:youtube\.com|youtu\.be)/i.test(url)) {
    showToast('YouTube is no longer supported.', 'error');
    return;
  }

  setLoading(true);
  resetUI();

  try {
    const res = await fetch(`${API_URL}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await res.json();
    
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch media info');
    }

    currentMediaInfo = data.data;
    renderPreview(currentMediaInfo);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setLoading(false);
  }
}

// Render Preview & Formats
function renderPreview(info) {
  elements.previewSection.hidden = false;
  elements.previewThumbnail.src = info.thumbnail || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24"><path fill="%23666" d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>';
  elements.previewDuration.textContent = formatDuration(info.duration);
  elements.previewPlatform.textContent = info.platform;
  elements.previewTitle.textContent = info.title;
  elements.previewUploader.textContent = info.uploader;

  // Render formats
  elements.formatGrid.innerHTML = '';
  
  if (info.formats && info.formats.length > 0) {
    info.formats.forEach((fmt, index) => {
      const option = document.createElement('div');
      option.className = 'format-option';
      if (index === 0) {
        option.classList.add('selected');
        selectedFormatId = fmt.id;
      }

      const icon = fmt.type === 'audio' 
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>';

      let sizeText = fmt.filesize ? formatBytes(fmt.filesize) : '';
      if (sizeText) sizeText = ` • ${sizeText}`;

      option.innerHTML = `
        <div class="format-type-icon" style="width: 24px; height: 24px;">${icon}</div>
        <div class="format-label">${fmt.label}</div>
        <div class="format-meta">${fmt.ext.toUpperCase()}${sizeText}</div>
      `;

      option.dataset.formatId = fmt.id;
      option.dataset.ext = fmt.ext;
      
      option.addEventListener('click', () => {
        document.querySelectorAll('.format-option').forEach(el => el.classList.remove('selected'));
        option.classList.add('selected');
        selectedFormatId = fmt.id;
      });

      elements.formatGrid.appendChild(option);
    });
  }
}

// Start Download
async function handleDownload() {
  if (!currentMediaInfo || !selectedFormatId) return;

  const selectedOption = document.querySelector('.format-option.selected');
  const ext = selectedOption ? selectedOption.dataset.ext : 'mp4';

  elements.downloadBtn.disabled = true;
  elements.progressSection.hidden = false;
  elements.completeSection.hidden = true;
  
  // Reset progress bar
  elements.progressFill.style.width = '0%';
  elements.progressPercent.textContent = '0%';
  elements.progressInfo.textContent = 'Requesting download...';

  try {
    const res = await fetch(`${API_URL}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: currentMediaInfo.originalUrl,
        formatId: selectedFormatId,
        ext: ext,
        title: currentMediaInfo.title
      })
    });

    const data = await res.json();
    
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to start download');
    }

    currentDownloadId = data.downloadId;
    connectToSSE(currentDownloadId, currentMediaInfo);

  } catch (err) {
    showToast(err.message, 'error');
    elements.downloadBtn.disabled = false;
    elements.progressSection.hidden = true;
  }
}

// Connect to Server-Sent Events for Progress
function connectToSSE(downloadId, mediaInfo) {
  if (eventSource) eventSource.close();

  eventSource = new EventSource(`${API_URL}/progress/${downloadId}`);

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.status === 'error') {
      eventSource.close();
      showToast(data.error || 'Download failed', 'error');
      elements.downloadBtn.disabled = false;
      elements.progressSection.hidden = true;
      return;
    }

    if (data.progress) {
      const p = data.progress;
      const percent = Math.min(100, Math.max(0, p.percent || 0));
      
      elements.progressFill.style.width = `${percent}%`;
      elements.progressPercent.textContent = `${percent.toFixed(1)}%`;
      
      if (p.status) {
        elements.progressInfo.textContent = p.status;
      } else if (p.speed && p.eta) {
        elements.progressInfo.textContent = `${p.speed} - ETA: ${p.eta}`;
      }
    }

    if (data.status === 'completed') {
      eventSource.close();
      elements.progressSection.hidden = true;
      elements.completeSection.hidden = false;
      elements.downloadBtn.disabled = false;
      
      // Save to history
      saveToHistory({
        id: downloadId,
        title: mediaInfo.title,
        platform: mediaInfo.platform,
        thumbnail: mediaInfo.thumbnail,
        timestamp: Date.now()
      });
      
      showToast('Download complete!', 'success');
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
    // Don't show error if we just completed
    if (elements.completeSection.hidden) {
      showToast('Connection lost. The download may still complete on the server.', 'error');
      elements.downloadBtn.disabled = false;
    }
  };
}

// Trigger File Save
function handleSaveFile() {
  if (!currentDownloadId) return;
  // Trigger file download using the browser
  window.location.href = `${API_URL}/file/${currentDownloadId}`;
}

// --- History Management ---

function loadHistory() {
  try {
    const history = JSON.parse(localStorage.getItem('mediagrab_history')) || [];
    renderHistory(history);
  } catch (e) {
    console.error('Failed to load history', e);
  }
}

function saveToHistory(item) {
  try {
    let history = JSON.parse(localStorage.getItem('mediagrab_history')) || [];
    // Remove if already exists (by title within recent time)
    history = history.filter(h => h.id !== item.id);
    history.unshift(item);
    // Keep only last 10
    history = history.slice(0, 10);
    localStorage.setItem('mediagrab_history', JSON.stringify(history));
    renderHistory(history);
  } catch (e) {
    console.error('Failed to save history', e);
  }
}

function renderHistory(history) {
  if (!history || history.length === 0) {
    elements.historySection.hidden = true;
    return;
  }

  elements.historySection.hidden = false;
  elements.historyList.innerHTML = '';

  history.forEach(item => {
    const el = document.createElement('div');
    el.className = 'history-item';
    
    const date = new Date(item.timestamp).toLocaleDateString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    el.innerHTML = `
      <img src="${item.thumbnail}" class="history-thumb" alt="" referrerpolicy="no-referrer" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22 fill=%22%23222%22><rect width=%22100%25%22 height=%22100%25%22/></svg>'">
      <div class="history-info">
        <div class="history-title" title="${item.title}">${item.title}</div>
        <div class="history-meta">${item.platform} • Downloaded ${date}</div>
      </div>
      <button class="clay-btn clay-btn-sm" onclick="window.location.href='${API_URL}/file/${item.id}'" title="Save File">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
      </button>
    `;
    elements.historyList.appendChild(el);
  });
}

function clearHistory() {
  localStorage.removeItem('mediagrab_history');
  elements.historySection.hidden = true;
}

// --- Utils ---

function setLoading(isLoading) {
  elements.inputCard.classList.toggle('loading', isLoading);
  const btnText = elements.fetchBtn.querySelector('.btn-text');
  const btnLoader = elements.fetchBtn.querySelector('.btn-loader');
  
  if (isLoading) {
    btnText.hidden = true;
    btnLoader.hidden = false;
  } else {
    btnText.hidden = false;
    btnLoader.hidden = true;
  }
}

function resetUI() {
  elements.previewSection.hidden = true;
  elements.progressSection.hidden = true;
  elements.completeSection.hidden = true;
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icon = type === 'error' 
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff5050" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'
    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4cd964" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
    
  toast.innerHTML = `${icon} <span>${message}</span>`;
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove());
  }, 4000);
}

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

// Start
init();

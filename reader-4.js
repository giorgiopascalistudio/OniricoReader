/* ═══════════════════════════════════════════════════
   ONIRICO READER v4 — PDF.js + StPageFlip
   Fixes: multi-PDF, zoom, pan, logo, built-in library
═══════════════════════════════════════════════════ */
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const $ = id => document.getElementById(id);

/* ── State ── */
let pageFlip    = null;
let pdfDoc      = null;
let totalPages  = 0;
let currentPage = 1;
let playing     = false;
let playTimer   = null;
let playSpeed   = 3500;
let zoomLevel   = 1;
let panX        = 0, panY = 0;
let isPanning   = false, startX = 0, startY = 0;
let handMode    = false;
let currentPdfUrl  = null;
let currentPdfName = null;

const speedMap    = [1500, 2500, 3500, 5000, 8000];
const speedLabels = ['1.5s','2.5s','3.5s','5s','8s'];
const ZOOM_STEP   = 0.2;
const ZOOM_MIN    = 0.5;
const ZOOM_MAX    = 4;

/* ═══ BUILT-IN PDFs ═══
   Aggiungi qui i tuoi PDF locali nella cartella pdfs/
   Esempio: { name: 'Catalogo 2025', file: 'pdfs/catalogo2025.pdf' }
*/
const BUILTIN_PDFS = [
  { name: 'Brochure Onirico 2026', file: 'Brochure_Onirico_2026.pdf' },
];

/* ═══════════════════════════════════════════════════
   LIBRARY
═══════════════════════════════════════════════════ */
function initLibrary() {
  BUILTIN_PDFS.forEach(p => addLibraryCard(p.name, p.file));

  $('lib-upload').onchange = e => {
    const f = e.target.files[0];
    if (f) openFile(f);
    e.target.value = '';
  };
  $('card-upload').onchange = e => {
    const f = e.target.files[0];
    if (f) {
      const url = URL.createObjectURL(f);
      addLibraryCard(f.name.replace(/\.pdf$/i, ''), url);
      openUrl(url, f.name.replace(/\.pdf$/i, ''));
    }
    e.target.value = '';
  };

  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f?.type === 'application/pdf') openFile(f);
  });
}

function addLibraryCard(name, url) {
  const grid = $('pdf-grid');
  const addCard = grid.querySelector('.add-card');
  const card = document.createElement('div');
  card.className = 'pdf-card';
  card.innerHTML = `
    <div class="card-thumb"><span class="pdf-icon">PDF</span></div>
    <div class="card-info"><div class="card-name" title="${name}">${name}</div></div>`;
  card.addEventListener('click', () => openUrl(url, name));
  grid.insertBefore(card, addCard);

  /* genera thumbnail prima pagina */
  generateThumb(url, card.querySelector('.card-thumb'));
}

async function generateThumb(url, container) {
  try {
    const doc = await pdfjsLib.getDocument(url).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 0.5 });
    const cv = document.createElement('canvas');
    cv.width = vp.width; cv.height = vp.height;
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    container.innerHTML = '';
    cv.style.width = '100%'; cv.style.height = '100%'; cv.style.objectFit = 'contain';
    container.appendChild(cv);
  } catch(e) { /* usa icona default */ }
}

/* ═══════════════════════════════════════════════════
   OPEN
═══════════════════════════════════════════════════ */
function openFile(file) {
  const url = URL.createObjectURL(file);
  openUrl(url, file.name.replace(/\.pdf$/i, ''));
}

async function openUrl(url, name) {
  showView('reader');
  $('doc-title').textContent = name || '—';
  currentPdfUrl  = url;
  currentPdfName = name || '—';
  showSpinner(true);
  resetZoomPan();

  try {
    /* ── distruggi pageFlip precedente ── */
    if (pageFlip) {
      try { pageFlip.destroy(); } catch(e) {}
      pageFlip = null;
    }

    /* ── reset stato ── */
    stopPlay();
    pdfDoc = null; totalPages = 0; currentPage = 1;
    $('thumb-list').innerHTML = '';

    /* ── svuota e ricrea book-container ── */
    const area = $('zoom-pan-wrap');
    const oldContainer = $('book-container');
    if (oldContainer) oldContainer.remove();
    const bookContainer = document.createElement('div');
    bookContainer.id = 'book-container';
    area.insertBefore(bookContainer, area.firstChild);

    /* ── carica PDF ── */
    pdfDoc = await pdfjsLib.getDocument(url).promise;
    totalPages = pdfDoc.numPages;

    /* ── calcola dimensioni pagina ── */
    const firstPage = await pdfDoc.getPage(1);
    const readingArea = $('reading-area');
    const areaW = readingArea.clientWidth;
    const areaH = readingArea.clientHeight;
    const vp0 = firstPage.getViewport({ scale: 1 });
    const scale = Math.min((areaH / vp0.height) * 0.92, ((areaW / 2) / vp0.width) * 0.92, 2);
    const pageW = Math.floor(vp0.width * scale);
    const pageH = Math.floor(vp0.height * scale);

    /* ── renderizza tutte le pagine su canvas ── */
    const canvases = [];
    for (let i = 1; i <= totalPages; i++) {
      const pg = await pdfDoc.getPage(i);
      const vp = pg.getViewport({ scale });
      const cv = document.createElement('canvas');
      cv.width = pageW; cv.height = pageH;
      cv.className = 'book-page-canvas';
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      canvases.push(cv);
    }

    /* ── crea thumbnails ── */
    buildThumbs(canvases);

    /* ── inizializza StPageFlip ── */
    pageFlip = new St.PageFlip(bookContainer, {
      width: pageW, height: pageH,
      size: 'fixed',
      drawShadow: true,
      flippingTime: 700,
      usePortrait: true,
      startZIndex: 10,
      autoSize: true,
      showCover: false,
    });

    pageFlip.loadFromImages(canvases.map(cv => {
      const tmp = document.createElement('canvas');
      tmp.width = cv.width; tmp.height = cv.height;
      tmp.getContext('2d').drawImage(cv, 0, 0);
      /* converti in img src per StPageFlip */
      return cv.toDataURL();
    }));

    pageFlip.on('flip', e => {
      currentPage = e.data + 1;
      updateUI();
    });

    updateUI();
    showSpinner(false);
  } catch (err) {
    showSpinner(false);
    console.error('Errore apertura PDF:', err);
    alert('Errore nel caricamento del PDF: ' + err.message);
  }
}

/* ═══════════════════════════════════════════════════
   THUMBNAILS
═══════════════════════════════════════════════════ */
function buildThumbs(canvases) {
  const list = $('thumb-list');
  list.innerHTML = '';
  canvases.forEach((cv, i) => {
    const item = document.createElement('div');
    item.className = 'thumb-item' + (i === 0 ? ' active' : '');
    item.dataset.page = i + 1;
    const mini = document.createElement('canvas');
    const ratio = cv.height / cv.width;
    mini.width = 120; mini.height = Math.round(120 * ratio);
    mini.getContext('2d').drawImage(cv, 0, 0, mini.width, mini.height);
    const num = document.createElement('div');
    num.className = 'thumb-page-num';
    num.textContent = i + 1;
    item.appendChild(mini);
    item.appendChild(num);
    item.addEventListener('click', () => goToPage(i + 1));
    list.appendChild(item);
  });
}

function updateThumbActive() {
  document.querySelectorAll('.thumb-item').forEach(el => {
    el.classList.toggle('active', +el.dataset.page === currentPage);
  });
  const active = $('thumb-list').querySelector('.thumb-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

/* ═══════════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════════ */
function goToPage(n) {
  if (!pageFlip || n < 1 || n > totalPages) return;
  pageFlip.flip(n - 1);
  currentPage = n;
  updateUI();
}
function nextPage() { goToPage(currentPage + 1); }
function prevPage() { goToPage(currentPage - 1); }

function updateUI() {
  $('page-indicator').textContent = `${currentPage} / ${totalPages}`;
  const pct = totalPages > 1 ? (currentPage - 1) / (totalPages - 1) * 100 : 0;
  $('progress-fill').style.width = pct + '%';
  $('progress-thumb').style.left  = pct + '%';
  updateThumbActive();
}

/* ═══════════════════════════════════════════════════
   PLAY
═══════════════════════════════════════════════════ */
function togglePlay() {
  playing ? stopPlay() : startPlay();
}
function startPlay() {
  if (!totalPages) return;
  playing = true;
  $('play-icon').innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
  playTimer = setInterval(() => {
    if (currentPage >= totalPages) stopPlay();
    else nextPage();
  }, playSpeed);
}
function stopPlay() {
  playing = false;
  if (playTimer) { clearInterval(playTimer); playTimer = null; }
  $('play-icon').innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
}

/* ═══════════════════════════════════════════════════
   ZOOM & PAN
═══════════════════════════════════════════════════ */
function applyTransform() {
  $('zoom-pan-wrap').style.transform =
    `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
}
function resetZoomPan() {
  zoomLevel = 1; panX = 0; panY = 0;
  applyTransform();
}
function zoomIn()  { zoomLevel = Math.min(ZOOM_MAX, +(zoomLevel + ZOOM_STEP).toFixed(2)); applyTransform(); }
function zoomOut() { zoomLevel = Math.max(ZOOM_MIN, +(zoomLevel - ZOOM_STEP).toFixed(2)); if (zoomLevel <= 1) { panX = 0; panY = 0; } applyTransform(); }

function initZoomPan() {
  const wrap = $('zoom-pan-wrap');
  const area = $('reading-area');

  /* scroll to zoom */
  area.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.deltaY < 0) zoomIn(); else zoomOut();
  }, { passive: false });

  /* mouse pan */
  wrap.addEventListener('mousedown', e => {
    if (!handMode) return;
    isPanning = true;
    startX = e.clientX - panX;
    startY = e.clientY - panY;
    wrap.classList.add('panning');
  });
  window.addEventListener('mousemove', e => {
    if (!isPanning) return;
    panX = e.clientX - startX;
    panY = e.clientY - startY;
    applyTransform();
  });
  window.addEventListener('mouseup', () => {
    isPanning = false;
    wrap.classList.remove('panning');
  });

  /* touch pan */
  let touchStart = null;
  wrap.addEventListener('touchstart', e => {
    if (!handMode || e.touches.length !== 1) return;
    touchStart = { x: e.touches[0].clientX - panX, y: e.touches[0].clientY - panY };
  }, { passive: true });
  wrap.addEventListener('touchmove', e => {
    if (!handMode || !touchStart || e.touches.length !== 1) return;
    panX = e.touches[0].clientX - touchStart.x;
    panY = e.touches[0].clientY - touchStart.y;
    applyTransform();
  }, { passive: true });
  wrap.addEventListener('touchend', () => { touchStart = null; });
}

/* ═══════════════════════════════════════════════════
   VIEWS
═══════════════════════════════════════════════════ */
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-' + id).classList.add('active');
}
function showSpinner(v) {
  $('loading-spinner').style.display = v ? 'flex' : 'none';
}

/* ═══════════════════════════════════════════════════
   PROGRESS BAR CLICK
═══════════════════════════════════════════════════ */
function initProgress() {
  $('progress-track').addEventListener('click', e => {
    const rect = $('progress-track').getBoundingClientRect();
    const pct  = (e.clientX - rect.left) / rect.width;
    goToPage(Math.max(1, Math.round(pct * (totalPages - 1)) + 1));
  });
}

/* ═══════════════════════════════════════════════════
   SHARE
═══════════════════════════════════════════════════ */
function openShareModal() {
  if (!currentPdfUrl) return;

  // blob: URLs are local — warn user they must use a hosted URL
  const isBlob = currentPdfUrl.startsWith('blob:');
  const input  = $('share-input');
  const note   = $('share-note');

  if (isBlob) {
    input.value = '';
    input.placeholder = 'PDF non hostato — vedi nota';
    note.textContent  = '⚠ Questo PDF è stato caricato localmente. Per condividerlo caricalo su GitHub e aggiungilo come PDF built-in.';
    note.className    = 'share-note warn';
  } else {
    const shareUrl = buildShareUrl(currentPdfUrl, currentPdfName);
    input.value       = shareUrl;
    input.placeholder = '';
    note.textContent  = '';
    note.className    = 'share-note';
    navigator.clipboard.writeText(shareUrl).catch(() => {});
  }

  $('share-modal').style.display = 'flex';
}

function buildShareUrl(pdfUrl, name) {
  const base = location.origin + location.pathname.replace(/[^/]*$/, '') + 'shared.html';
  return base + '?pdf=' + encodeURIComponent(pdfUrl) + '&name=' + encodeURIComponent(name || '');
}

/* ═══════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initLibrary();
  initZoomPan();
  initProgress();

  $('btn-close').addEventListener('click', () => { stopPlay(); showView('library'); });

  /* share modal */
  $('btn-share').addEventListener('click', openShareModal);
  $('share-close').addEventListener('click', () => { $('share-modal').style.display = 'none'; });
  $('share-modal').addEventListener('click', e => {
    if (e.target === $('share-modal')) $('share-modal').style.display = 'none';
  });
  $('share-copy').addEventListener('click', () => {
    const val = $('share-input').value;
    if (!val) return;
    navigator.clipboard.writeText(val).then(() => {
      const btn  = $('share-copy');
      const note = $('share-note');
      btn.classList.add('copied');
      note.textContent = '✓ Link copiato negli appunti!';
      note.className   = 'share-note ok';
      setTimeout(() => btn.classList.remove('copied'), 2000);
    });
  });
  $('btn-prev').addEventListener('click', prevPage);
  $('btn-next').addEventListener('click', nextPage);
  $('btn-prev2').addEventListener('click', prevPage);
  $('btn-next2').addEventListener('click', nextPage);
  $('btn-first').addEventListener('click', () => goToPage(1));
  $('btn-last').addEventListener('click', () => goToPage(totalPages));
  $('btn-play').addEventListener('click', togglePlay);

  /* zoom buttons */
  $('btn-zoom-in').addEventListener('click', zoomIn);
  $('btn-zoom-out').addEventListener('click', zoomOut);
  $('btn-zoom-reset').addEventListener('click', resetZoomPan);

  /* hand tool toggle */
  $('btn-hand').addEventListener('click', () => {
    handMode = !handMode;
    $('btn-hand').classList.toggle('active', handMode);
    $('reading-area').classList.toggle('hand-mode', handMode);
  });

  /* thumbnails */
  $('btn-thumbs').addEventListener('click', () => {
    $('thumb-sidebar').classList.toggle('open');
  });

  /* fullscreen */
  $('btn-fs').addEventListener('click', () => {
    document.fullscreenElement
      ? document.exitFullscreen()
      : $('view-reader').requestFullscreen();
  });

  /* speed */
  $('speed-slider').addEventListener('input', e => {
    const idx = +e.target.value;
    playSpeed = speedMap[idx];
    $('speed-label').textContent = speedLabels[idx];
    if (playing) { stopPlay(); startPlay(); }
  });

  /* keyboard */
  document.addEventListener('keydown', e => {
    if (!$('view-reader').classList.contains('active')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextPage();
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   prevPage();
    if (e.key === 'Escape') { stopPlay(); showView('library'); }
    if (e.key === '+' || e.key === '=') zoomIn();
    if (e.key === '-') zoomOut();
    if (e.key === '0') resetZoomPan();
  });
});

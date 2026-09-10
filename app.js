/* VDBench Explorer: a static sample overview. Image paths are relative to the JSON file. */
'use strict';

const mobile = window.matchMedia('(max-width: 799px)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const state = {
  topics: [], selectedId: null, search: '', showImages: true,
  layout: mobile.matches ? 'vertical' : 'horizontal', layoutChosen: false,
  activePeriod: 0, imgIndex: new Map(), imageSources: [], imagePosition: 0,
  drawerOpen: false, scrollFrame: 0, scrollLockUntil: 0, toastTimer: 0,
};
const els = {};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// A content hash prevents cached preview copies from masking restored originals.
const imageSrc = image => `data/${image.src.replace(/^\.?\/?data\//, '')}${image.sha256 ? `?v=${image.sha256.slice(0, 12)}` : ''}`;
const currentTopic = () => state.topics.find(t => t.id === state.selectedId);
const motion = () => reducedMotion.matches ? 'instant' : 'smooth';
const yearsLabel = p => p.year_start == null || p.year_end == null ? p.period || '' : p.year_start === p.year_end ? String(p.year_start) : `${p.year_start}–${p.year_end}`;

function init() {
  ['search', 'search-clear', 'entry-list', 'list-head', 'stage', 'app', 'top-count',
    'topic-index', 'topics-toggle', 'index-close', 'index-backdrop', 'side', 'side-wrap',
    'side-toggle', 'lightbox', 'lightbox-img', 'lightbox-title', 'lightbox-gt',
    'lightbox-close', 'lightbox-error', 'image-prev', 'image-next', 'toast'].forEach(id => {
    els[id] = document.getElementById(id);
  });
  els.search.addEventListener('input', () => { state.search = els.search.value.trim(); renderList(); });
  els['search-clear'].addEventListener('click', clearSearch);
  els['entry-list'].addEventListener('click', event => {
    const button = event.target.closest('[data-topic]');
    if (button) selectTopic(Number(button.dataset.topic), true);
    if (event.target.closest('[data-clear]')) clearSearch();
  });
  els['topics-toggle'].addEventListener('click', () => setDrawer(!state.drawerOpen));
  els['index-close'].addEventListener('click', () => setDrawer(false));
  els['index-backdrop'].addEventListener('click', () => setDrawer(false));
  els['side-toggle'].addEventListener('click', () => {
    const collapsed = els['side-wrap'].classList.toggle('collapsed');
    els['side-toggle'].setAttribute('aria-expanded', String(!collapsed));
  });
  els.stage.addEventListener('click', handleStageClick);
  els.stage.addEventListener('change', event => {
    if (event.target.id !== 'img-toggle') return;
    state.showImages = event.target.checked;
    els.app.classList.toggle('hide-images', !state.showImages);
  });
  els.stage.addEventListener('scroll', () => { if (state.layout === 'vertical') queueScrollSync(); }, { passive: true });
  els.app.addEventListener('error', event => {
    if (event.target.tagName === 'IMG') {
      const figure = event.target.closest('.fig');
      if (figure) figure.classList.add('is-broken');
      else event.target.style.visibility = 'hidden';
    }
  }, true);
  els['lightbox-close'].addEventListener('click', () => els.lightbox.close());
  els.lightbox.addEventListener('click', event => {
    if (event.target !== els.lightbox) return;
    const box = els.lightbox.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) els.lightbox.close();
  });
  els.lightbox.addEventListener('close', () => {
    els['lightbox-img'].removeAttribute('src');
    if (state.imageOpener?.isConnected) state.imageOpener.focus({ preventScroll: true });
  });
  els['lightbox-img'].addEventListener('error', () => { els['lightbox-error'].hidden = false; els['lightbox-img'].style.visibility = 'hidden'; });
  els['image-prev'].addEventListener('click', () => moveImage(-1));
  els['image-next'].addEventListener('click', () => moveImage(1));
  document.addEventListener('keydown', handleKeydown);
  window.addEventListener('hashchange', restoreRoute);
  mobile.addEventListener('change', () => {
    setDrawer(false, false);
    if (!state.layoutChosen) setLayout(mobile.matches ? 'vertical' : 'horizontal', false);
  });
  loadTopics();
}

async function loadTopics() {
  els.stage.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('data/topics.json');
    if (!response.ok) throw new Error('Dataset overview unavailable');
    const topics = await response.json();
    if (!Array.isArray(topics) || !topics.length || topics.some(t => !Array.isArray(t.temporal_evolution))) throw new Error('Invalid topic data');
    state.topics = topics;
    const periods = topics.reduce((sum, t) => sum + t.temporal_evolution.length, 0);
    els['top-count'].innerHTML = `<b>${topics.length}</b> topics<span class="count-divider" aria-hidden="true">/</span><b>${periods}</b> periods`;
    restoreRoute();
  } catch {
    els['list-head'].textContent = 'Collection unavailable';
    els.stage.innerHTML = '<div class="error-state"><span class="loading-mark" aria-hidden="true">◈</span><h1>The collection could not be opened</h1><p>Check your connection and try again. If you opened this file directly, serve the folder with a local web server.</p><button type="button" class="text-button" data-retry>Try again <span aria-hidden="true">↻</span></button></div>';
  } finally {
    els.stage.removeAttribute('aria-busy');
  }
}

function readRoute() {
  const params = new URLSearchParams(location.hash.slice(1));
  const topic = state.topics.find(t => t.id === Number(params.get('topic'))) || state.topics[0];
  const period = Math.max(0, Math.min(topic.temporal_evolution.length - 1, (Number(params.get('period')) || 1) - 1));
  return { topic, period: Math.floor(period) };
}

function restoreRoute() {
  if (!state.topics.length) return;
  if (location.hash === '#stage' && currentTopic()) return;
  if (els.lightbox.open) els.lightbox.close();
  const { topic, period } = readRoute();
  state.selectedId = topic.id;
  state.activePeriod = period;
  renderList();
  renderTopic();
  if (period) requestAnimationFrame(() => navigatePeriod(period, false));
}

function writeRoute(push = false) {
  const hash = `#topic=${state.selectedId}&period=${state.activePeriod + 1}`;
  if (location.hash !== hash) history[push ? 'pushState' : 'replaceState'](null, '', hash);
}

function selectTopic(id, focusHeading = false) {
  if (!state.topics.some(t => t.id === id)) return;
  state.selectedId = id;
  state.activePeriod = 0;
  setDrawer(false, false);
  renderList();
  renderTopic();
  writeRoute(true);
  if (focusHeading) document.getElementById('topic-title').focus({ preventScroll: true });
  els['entry-list'].querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

function clearSearch() {
  state.search = '';
  els.search.value = '';
  renderList();
  els.search.focus();
}

function normalized(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function firstThumb(topic) {
  const image = topic.temporal_evolution.flatMap(p => p.images || [])[0];
  return image ? imageSrc(image) : null;
}

function renderList() {
  const words = normalized(state.search).split(/\s+/).filter(Boolean);
  const topics = state.topics.filter(topic => words.every(word => normalized(topic.visual_element).includes(word)));
  els['list-head'].textContent = state.search ? `${topics.length} of ${state.topics.length} topics` : `${topics.length} topics`;
  els['search-clear'].hidden = !state.search;
  els.search.parentElement.querySelector('kbd').hidden = !!state.search;
  if (!topics.length) {
    els['entry-list'].innerHTML = `<div class="empty"><p>No topics match “${esc(state.search)}”.</p><button type="button" class="text-button" data-clear>Clear search</button></div>`;
    return;
  }
  els['entry-list'].innerHTML = topics.map(topic => {
    const thumb = firstThumb(topic);
    return `<button type="button" class="entry-item${topic.id === state.selectedId ? ' selected' : ''}" data-topic="${topic.id}"${topic.id === state.selectedId ? ' aria-current="true"' : ''}>
      ${thumb ? `<img class="ei-thumb" src="${esc(thumb)}" loading="lazy" decoding="async" width="43" height="43" alt="">` : '<span class="ei-thumb" aria-hidden="true"></span>'}
      <span class="ei-text"><span class="ei-name">${esc(topic.visual_element)}</span><span class="ei-meta">${topic.temporal_evolution.length} periods</span></span></button>`;
  }).join('');
}

function renderTopic() {
  const topic = currentTopic();
  if (!topic) return;
  const periods = topic.temporal_evolution;
  state.imgIndex = new Map();
  state.imageSources = [];
  const topicPosition = state.topics.indexOf(topic);
  document.title = `${topic.visual_element} — VDBench Explorer`;
  els.stage.scrollTop = 0;
  els.stage.innerHTML = `
    <div class="stage-head">
      <div class="topic-topline"><span class="topic-kicker">Visual diachrony <span aria-hidden="true">/</span> <span class="topic-number">Topic ${String(topic.id).padStart(2, '0')}</span></span><div class="topic-actions"><button type="button" class="text-button" data-share aria-label="Copy link to this topic and period">Copy link <span aria-hidden="true">↗</span></button></div></div>
      <h1 class="entry-title" id="topic-title" tabindex="-1">${esc(topic.visual_element)}</h1>
      ${topic.annotation ? `<p class="entry-lede">${esc(topic.annotation)}</p>` : ''}
    </div>
    <div class="timeline-tools">
      <div class="timeline-tools-top"><div class="timeline-label"><h2>Chronology</h2><span>${periods.length} periods</span></div><div class="view-controls">
        <label class="tog"><input type="checkbox" id="img-toggle"${state.showImages ? ' checked' : ''}> Images</label>
        <div class="seg" role="group" aria-label="Timeline layout"><button type="button" class="seg-btn${state.layout === 'horizontal' ? ' active' : ''}" data-layout="horizontal" aria-pressed="${state.layout === 'horizontal'}"><span class="layout-glyph" aria-hidden="true">▥</span> Timeline</button><button type="button" class="seg-btn${state.layout === 'vertical' ? ' active' : ''}" data-layout="vertical" aria-pressed="${state.layout === 'vertical'}"><span class="layout-glyph" aria-hidden="true">☰</span> Reading</button></div>
      </div></div>
      <div class="period-navigation"><nav class="period-jumps" aria-label="Jump to a period">${periods.map((p, i) => `<button type="button" class="period-jump" data-period="${i}" aria-label="Go to period ${i + 1}: ${esc(yearsLabel(p))}, ${esc(p.context || '')}">${esc(yearsLabel(p))}</button>`).join('')}</nav><div class="period-arrows"><button type="button" class="icon-button" data-period-step="-1" aria-label="Previous period">←</button><button type="button" class="icon-button" data-period-step="1" aria-label="Next period">→</button></div></div>
    </div>
    <div class="plates${state.layout === 'vertical' ? ' vertical' : ''}" id="plates" role="region" aria-label="Chronological plates" tabindex="0">${periods.map(renderPlate).join('')}</div>
    <div class="stage-footer"><nav class="topic-pagination" aria-label="Browse adjacent topics"><button type="button" class="text-button" data-topic-step="-1"${topicPosition === 0 ? ' disabled' : ''}><span aria-hidden="true">←</span> Previous topic</button><button type="button" class="text-button" data-topic-step="1"${topicPosition === state.topics.length - 1 ? ' disabled' : ''}>Next topic <span aria-hidden="true">→</span></button></nav></div>`;
  document.getElementById('plates').addEventListener('scroll', () => { if (state.layout === 'horizontal') queueScrollSync(); }, { passive: true });
  setActivePeriod(state.activePeriod);
  renderSide(topic);
}

function figure(image, cls, period, eager = false) {
  const src = imageSrc(image);
  const description = image.caption || `${currentTopic().visual_element}, ${yearsLabel(period)}`;
  state.imgIndex.set(src, { ...image, period });
  state.imageSources.push(src);
  return `<button type="button" class="fig ${cls}" data-full="${esc(src)}" aria-label="Open sample: ${esc(description)}"><img src="${esc(src)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" alt="${esc(description)}"></button>`;
}

function renderPlate(period, index) {
  const [lead, ...rest] = period.images || [];
  return `<article class="plate" id="period-${index + 1}" aria-labelledby="period-title-${index + 1}">
    <div class="plate-head"><span class="plate-node" aria-hidden="true"></span><span class="plate-no">PL. ${String(index + 1).padStart(2, '0')}</span><h3 class="plate-years" id="period-title-${index + 1}">${esc(yearsLabel(period))}</h3>${period.context ? `<span class="plate-ctx">${esc(period.context)}</span>` : ''}</div>
    <div class="plate-body">${lead ? `<div class="figs">${figure(lead, 'fig-lead', period, index < 2)}${rest.length ? `<div class="fig-pair">${rest.map(image => figure(image, '', period)).join('')}</div>` : ''}</div>` : ''}<p class="plate-text">${esc(period.meaning || '')}</p></div></article>`;
}

function renderSide(topic) {
  // Preserve the audited citations and their exact destinations.
  els.side.innerHTML = `<h2 class="side-title">Topic sources</h2>${(topic.sources || []).map(source => `<div class="source"><p>${esc(source.citation || 'Source')}</p>${/^https?:\/\//i.test(source.url || '') ? `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.url)}<span class="sr-only"> (opens in a new tab)</span></a>` : ''}</div>`).join('') || '<p class="empty">No sources recorded.</p>'}`;
  els.side.scrollTop = 0;
}

function handleStageClick(event) {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.full) openLightbox(button.dataset.full, button);
  else if (button.dataset.layout) setLayout(button.dataset.layout);
  else if (button.dataset.period != null) navigatePeriod(Number(button.dataset.period));
  else if (button.dataset.periodStep) navigatePeriod(state.activePeriod + Number(button.dataset.periodStep));
  else if (button.dataset.topicStep) {
    const topic = state.topics[state.topics.indexOf(currentTopic()) + Number(button.dataset.topicStep)];
    if (topic) selectTopic(topic.id, true);
  } else if (button.hasAttribute('data-share')) copyLink();
  else if (button.hasAttribute('data-retry')) loadTopics();
}

function setLayout(mode, chosen = true) {
  state.layout = mode;
  if (chosen) state.layoutChosen = true;
  const plates = document.getElementById('plates');
  if (!plates) return;
  plates.classList.toggle('vertical', mode === 'vertical');
  els.stage.querySelectorAll('[data-layout]').forEach(button => {
    const active = button.dataset.layout === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (state.activePeriod) navigatePeriod(state.activePeriod, false);
  else { plates.scrollLeft = 0; els.stage.scrollTop = 0; }
}

function setActivePeriod(index) {
  const periods = currentTopic()?.temporal_evolution || [];
  state.activePeriod = Math.max(0, Math.min(index, periods.length - 1));
  els.stage.querySelectorAll('[data-period]').forEach(button => {
    const active = Number(button.dataset.period) === state.activePeriod;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  const previous = els.stage.querySelector('[data-period-step="-1"]');
  const next = els.stage.querySelector('[data-period-step="1"]');
  if (previous) previous.disabled = state.activePeriod === 0;
  if (next) next.disabled = state.activePeriod >= periods.length - 1;
}

function navigatePeriod(index, animate = true) {
  const plates = document.getElementById('plates');
  if (!plates) return;
  setActivePeriod(index);
  state.scrollLockUntil = performance.now() + (animate && !reducedMotion.matches ? 700 : 80);
  const plate = plates.children[state.activePeriod];
  if (!plate) return;
  const behavior = animate ? motion() : 'instant';
  if (state.layout === 'horizontal') {
    plates.scrollTo({ left: plate.offsetLeft - plates.children[0].offsetLeft, behavior });
  } else {
    const toolbar = els.stage.querySelector('.timeline-tools');
    const top = plate.getBoundingClientRect().top - els.stage.getBoundingClientRect().top + els.stage.scrollTop - toolbar.offsetHeight - 20;
    els.stage.scrollTo({ top: Math.max(0, top), behavior });
  }
  revealPeriodJump(behavior);
  writeRoute();
}

function revealPeriodJump(behavior = 'instant') {
  const button = els.stage.querySelector('.period-jump.active');
  if (!button) return;
  const nav = button.parentElement;
  const left = button.offsetLeft - nav.offsetLeft;
  if (left < nav.scrollLeft || left + button.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollTo({ left: left - 12, behavior });
}

function queueScrollSync() {
  if (state.scrollFrame) return;
  state.scrollFrame = requestAnimationFrame(() => {
    state.scrollFrame = 0;
    if (performance.now() < state.scrollLockUntil) return;
    const plates = document.getElementById('plates');
    if (!plates?.children.length) return;
    const articles = [...plates.children];
    let index = 0;
    if (state.layout === 'horizontal') {
      const step = articles[1] ? articles[1].offsetLeft - articles[0].offsetLeft : 1;
      index = Math.round(plates.scrollLeft / step);
      if (plates.scrollWidth > plates.clientWidth && plates.scrollLeft + plates.clientWidth >= plates.scrollWidth - 3) index = articles.length - 1;
    } else {
      const edge = els.stage.querySelector('.timeline-tools').getBoundingClientRect().bottom + 35;
      articles.forEach((article, i) => { if (article.getBoundingClientRect().top <= edge) index = i; });
      if (els.stage.scrollTop + els.stage.clientHeight >= els.stage.scrollHeight - 3) index = articles.length - 1;
    }
    if (state.activePeriod !== index) { setActivePeriod(index); revealPeriodJump(); writeRoute(); }
  });
}

async function copyLink() {
  writeRoute();
  try {
    await navigator.clipboard.writeText(location.href);
    notify('Link copied — ready to share.');
  } catch {
    notify('Copy the page address to share this period.');
  }
}

function notify(message) {
  clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add('visible');
  state.toastTimer = setTimeout(() => els.toast.classList.remove('visible'), 3500);
}

function setDrawer(open, restoreFocus = true) {
  state.drawerOpen = open && mobile.matches;
  els['topic-index'].classList.toggle('open', state.drawerOpen);
  els['index-backdrop'].hidden = !state.drawerOpen;
  els['topics-toggle'].setAttribute('aria-expanded', String(state.drawerOpen));
  for (const element of [els.stage, els['side-wrap'], document.querySelector('.bar'), document.querySelector('.dataset-banner')]) element.inert = state.drawerOpen;
  if (state.drawerOpen) {
    els['topic-index'].setAttribute('role', 'dialog');
    els['topic-index'].setAttribute('aria-modal', 'true');
    els['index-close'].focus();
  } else {
    els['topic-index'].removeAttribute('role');
    els['topic-index'].removeAttribute('aria-modal');
    if (restoreFocus && mobile.matches) els['topics-toggle'].focus({ preventScroll: true });
  }
}

function openLightbox(src, opener) {
  state.imageOpener = opener;
  state.imagePosition = state.imageSources.indexOf(src);
  updateLightbox();
  els.lightbox.showModal();
}

function moveImage(direction) {
  const next = state.imagePosition + direction;
  if (next < 0 || next >= state.imageSources.length) return;
  state.imagePosition = next;
  updateLightbox();
}

function updateLightbox() {
  const src = state.imageSources[state.imagePosition];
  const gt = state.imgIndex.get(src);
  if (!gt) return;
  els['lightbox-error'].hidden = true;
  els['lightbox-img'].style.visibility = '';
  els['lightbox-img'].src = src;
  els['lightbox-img'].alt = gt.caption || currentTopic().visual_element;
  els['lightbox-title'].textContent = currentTopic().visual_element;
  els['lightbox-gt'].innerHTML = renderGtPanel(gt);
  els['lightbox-gt'].scrollTop = 0;
  els.lightbox.querySelector('.lightbox-inner').scrollTop = 0;
  els['image-prev'].disabled = state.imagePosition === 0;
  els['image-next'].disabled = state.imagePosition === state.imageSources.length - 1;
}

function renderGtPanel(gt) {
  const rows = [['Year', gt.point_year], ['Scene', gt.scene], ['Activity', gt.activity], ['Trend', gt.trend], ['Image ID', gt.image_id]].filter(([, value]) => value != null && value !== '');
  return `<span class="eyebrow">Period</span><p class="lb-period">${esc(yearsLabel(gt.period))}</p><p class="lb-context">${esc(gt.period.context || '')}</p><h3 class="lb-title">Ground truth</h3>${gt.caption ? `<p class="lb-caption">${esc(gt.caption)}</p>` : ''}<dl class="lb-facts">${rows.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
}

function handleKeydown(event) {
  if (els.lightbox.open) {
    if (event.key === 'ArrowLeft') { event.preventDefault(); moveImage(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); moveImage(1); }
    return;
  }
  if (state.drawerOpen) {
    if (event.key === 'Escape') { event.preventDefault(); setDrawer(false); return; }
    if (event.key === 'Tab') {
      const focusable = [...els['topic-index'].querySelectorAll('button,input,a[href]')].filter(el => !el.disabled && el.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }
  const editing = event.target.matches('input,textarea,select,[contenteditable="true"]');
  if (event.key === '/' && !editing && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    if (mobile.matches) setDrawer(true);
    els.search.focus();
  }
  if (event.key === 'Escape' && document.activeElement === els.search && state.search) clearSearch();
  if (!editing && event.target.id === 'plates' && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? currentTopic().temporal_evolution.length - 1 : state.activePeriod + (event.key === 'ArrowRight' ? 1 : -1);
    navigatePeriod(index);
  }
}

init();

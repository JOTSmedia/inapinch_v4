// Actual Keys footage. Videos are decorative; the Leaflet geography stays interactive.
export function createOcean() {
  const region = document.querySelector('.map-region');
  const app = document.getElementById('app');
  if (!region || !app) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const buttons = ['ocean-motion-btn', 'header-motion-btn'].map(id => document.getElementById(id)).filter(Boolean);
  let paused = reduced.matches;
  try { paused = paused || localStorage.getItem('in-a-pinch:ocean') === 'paused'; } catch {}

  const scenery = document.createElement('div');
  scenery.className = 'site-backdrop';
  scenery.setAttribute('aria-hidden', 'true');
  app.before(scenery);
  const ocean = document.createElement('div');
  ocean.className = 'ocean-footage';
  ocean.setAttribute('aria-hidden', 'true');
  region.prepend(ocean);

  function makeVideo(container, src, poster) {
    const video = document.createElement('video');
    video.className = 'background-video';
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.loop = true;
    video.preload = 'none';
    video.poster = poster;
    video.disablePictureInPicture = true;
    video.tabIndex = -1;
    video.setAttribute('aria-hidden', 'true');
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    container.append(video);
    return { video, container, src, visible: true, blocked: false, failed: false, pending: false };
  }
  const videos = [
    makeVideo(scenery, 'assets/key-west-background.mp4', 'assets/key-west-background-poster.jpg'),
    makeVideo(ocean, 'assets/ocean-water.mp4', 'assets/ocean-water-poster.jpg'),
  ];

  function updateControls() {
    const stopped = paused || videos.every(item => item.blocked || item.failed);
    const label = stopped ? 'Play background videos' : 'Pause background videos';
    const symbol = stopped ? '<path d="M4 2.5v11L13 8z"/>' : '<rect x="4" y="2.5" width="3" height="11" rx=".5"/><rect x="9" y="2.5" width="3" height="11" rx=".5"/>';
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(!stopped));
      button.setAttribute('aria-label', label);
      button.title = label;
      button.innerHTML = `<span class="motion-icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">${symbol}</svg></span>${button.id === 'ocean-motion-btn' ? `<span class="motion-label">${stopped ? 'Play video' : 'Pause video'}</span>` : ''}`;
    }
  }

  async function syncVideo(item) {
    if (paused || document.body.dataset.city!=='key-west' || document.hidden || !item.visible || item.failed || getComputedStyle(item.container).visibility === 'hidden') {
      item.video.pause();
      return;
    }
    if (item.pending || !item.video.paused) return;
    // Don't fetch the clips until motion is permitted. Posters remain available.
    if (!item.video.getAttribute('src')) item.video.src = item.src;
    item.pending = true;
    let aborted = false;
    try {
      await item.video.play();
      item.blocked = false;
      if (paused || document.body.dataset.city!=='key-west' || document.hidden || !item.visible) item.video.pause();
    } catch (error) {
      aborted = error?.name === 'AbortError';
      if (!aborted) item.blocked = true;
    } finally {
      item.pending = false;
      updateControls();
      if (aborted && !paused && !document.hidden) void syncVideo(item);
    }
  }

  function syncAll() {
    updateControls();
    for (const item of videos) void syncVideo(item);
  }
  for (const item of videos) item.video.addEventListener('error', () => {
    item.failed = true;
    item.video.hidden = true;
    updateControls();
  });
  for (const button of buttons) button.addEventListener('click', () => {
    paused = button.getAttribute('aria-pressed') === 'true';
    if (!paused) for (const item of videos) item.blocked = false;
    try { localStorage.setItem('in-a-pinch:ocean', paused ? 'paused' : 'moving'); } catch {}
    syncAll();
  });
  reduced.addEventListener('change', event => {
    paused = event.matches;
    if (!paused) try { paused = localStorage.getItem('in-a-pinch:ocean') === 'paused'; } catch {}
    syncAll();
  });
  document.addEventListener('visibilitychange', syncAll);
  document.addEventListener('citychange',syncAll);
  window.addEventListener('pagehide', () => videos.forEach(item => item.video.pause()));
  window.addEventListener('pageshow', syncAll);
  new MutationObserver(syncAll).observe(app, { attributes: true, attributeFilter: ['data-view'] });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const item = videos.find(item => item.container === entry.target);
        if (!item) continue;
        item.visible = entry.isIntersecting;
        void syncVideo(item);
      }
    });
    videos.forEach(item => observer.observe(item.container));
  }
  syncAll();
}

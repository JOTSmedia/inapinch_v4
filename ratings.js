/** Shared anonymous ratings. Draft selections stay in memory; votes live on the server. */
const API = '/api/ratings';
const scores = new Map();
const ownScores = new Map();
const drafts = new Map();
const messages = new Map();
let status = 'loading';
let onChange = () => {};
let onToast = () => {};
let bound = false;
let loadingPromise = null;
let mutation = null;

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

function selectedScore(id) {
  return drafts.get(id) ?? ownScores.get(id) ?? 0;
}

function refreshView(focus) {
  onChange();
  if (!focus) return;
  queueMicrotask(() => {
    const candidates = document.querySelectorAll('[data-rating-action]');
    const control = [...candidates].find(node => node.dataset.ratingId === focus.id &&
      node.dataset.ratingAction === focus.action &&
      (focus.value === undefined || Number(node.dataset.ratingValue) === focus.value) && !node.disabled);
    control?.focus({ preventScroll: true });
  });
}

function acceptSnapshot(body) {
  if (!body || typeof body !== 'object' || !body.ratings || typeof body.ratings !== 'object' ||
      Array.isArray(body.ratings) || !body.myRatings || typeof body.myRatings !== 'object' || Array.isArray(body.myRatings)) {
    throw new Error('The ratings service returned an unreadable response. Please retry.');
  }
  const nextScores = new Map();
  const nextOwnScores = new Map();
  for (const [id, rating] of Object.entries(body.ratings)) {
    if (!rating || !Number.isFinite(rating.average) || rating.average < 1 || rating.average > 5 ||
        !Number.isInteger(rating.count) || rating.count < 1) {
      throw new Error('The ratings service returned an unreadable response. Please retry.');
    }
    nextScores.set(id, { average: rating.average, count: rating.count });
  }
  for (const [id, rating] of Object.entries(body.myRatings)) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error('The ratings service returned an unreadable response. Please retry.');
    }
    nextOwnScores.set(id, rating);
  }
  scores.clear();
  ownScores.clear();
  for (const [id, rating] of nextScores) scores.set(id, rating);
  for (const [id, rating] of nextOwnScores) ownScores.set(id, rating);
}

async function callAPI(method = 'GET', body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(API, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    let result;
    try { result = await response.json(); } catch {
      throw new Error('The ratings service could not be reached. Please retry.');
    }
    if (!response.ok) {
      throw new Error(typeof result?.error === 'string' ? result.error : 'Ratings could not be updated. Please retry.');
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadRatings() {
  if (loadingPromise) return loadingPromise;
  if (mutation) return;
  status = 'loading';
  refreshView();
  loadingPromise = (async () => {
    try {
      acceptSnapshot(await callAPI());
      status = 'ready';
      messages.clear();
    } catch {
      status = 'error';
    } finally {
      loadingPromise = null;
      refreshView();
    }
  })();
  return loadingPromise;
}

/** Call once after the directory has rendered. This binds its own delegated handlers. */
export async function initRatings(changeCallback, toastCallback) {
  if (typeof changeCallback === 'function') onChange = changeCallback;
  if (typeof toastCallback === 'function') onToast = toastCallback;
  if (!bound) {
    document.addEventListener('click', event => {
      if (event.target?.closest?.('[data-rating-action]')) void handleRatingClick(event);
    });
    document.addEventListener('keydown', handleRatingKeydown);
    bound = true;
  }
  return loadRatings();
}

/** Unrated places have average:null and count:0; never treat them as zero-star reviews. */
export function getRating(id) {
  const rating = status === 'ready' ? scores.get(id) : undefined;
  return {
    average: rating?.average ?? null,
    count: rating?.count ?? 0,
    myRating: status === 'ready' ? ownScores.get(id) ?? null : null,
    status,
  };
}

export function ratingSummaryHTML(id) {
  const safeId = escapeHTML(id);
  if (status === 'loading') return '<div class="rating-summary" aria-live="polite">Loading ratings…</div>';
  if (status === 'error') return `<div class="rating-summary rating-message">Ratings unavailable <button type="button" class="rating-retry" data-rating-action="retry" data-rating-id="${safeId}">Retry</button></div>`;
  const rating = scores.get(id);
  if (!rating) return '<div class="rating-summary"><span aria-hidden="true">☆</span> No ratings yet</div>';
  const countLabel = `${rating.count} ${rating.count === 1 ? 'rating' : 'ratings'}`;
  return `<div class="rating-summary" aria-label="${escapeHTML(rating.average.toFixed(1))} out of 5 stars, ${escapeHTML(countLabel)}"><span aria-hidden="true">★</span> <strong>${escapeHTML(rating.average.toFixed(1))}</strong><span>· ${escapeHTML(countLabel)}</span></div>`;
}

export function ratingPanelHTML(id) {
  const safeId = escapeHTML(id);
  const own = ownScores.get(id) ?? 0;
  const selected = selectedScore(id);
  const pending = mutation?.id === id;
  const disabled = status !== 'ready' || Boolean(mutation);
  const dirty = selected > 0 && selected !== own;
  const error = messages.get(id);
  const actionLabel = pending ? mutation.action === 'remove' ? 'Removing…' : 'Saving…' : own ? 'Update rating' : 'Submit rating';
  const stars = [1, 2, 3, 4, 5].map(value => `<button type="button" class="rating-star${value <= selected ? ' selected' : ''}" role="radio" aria-checked="${value === selected}" aria-label="${value} ${value === 1 ? 'star' : 'stars'}" tabindex="${value === (selected || 1) ? '0' : '-1'}" data-rating-action="select" data-rating-id="${safeId}" data-rating-value="${value}"${disabled ? ' disabled' : ''}><span aria-hidden="true">★</span></button>`).join('');
  return `<section class="detail-section rating-panel" data-rating-panel="${safeId}" aria-labelledby="rating-heading-${safeId}" aria-busy="${pending}">
    <h3 id="rating-heading-${safeId}">The bathroom verdict</h3>
    ${ratingSummaryHTML(id)}
    <p class="rating-prompt">Rate a bathroom you actually used.</p>
    <div class="rating-stars" role="radiogroup" aria-label="Your rating from 1 to 5 stars" aria-disabled="${disabled}">${stars}</div>
    <p class="rating-message" aria-live="polite">${status === 'loading' ? 'Loading community ratings…' : status === 'error' ? 'Ratings are unavailable right now. Retry to load and submit a rating.' : error ? escapeHTML(error) : pending ? mutation.action === 'remove' ? 'Removing your rating…' : 'Saving your rating…' : own ? `Your current rating: ${own} out of 5.${dirty ? ` Selected: ${selected} out of 5. Submit to update.` : ''}` : selected ? `${selected} out of 5 selected. Submit to share your rating.` : 'Choose 1 to 5 stars, then submit.'}</p>
    <div class="rating-actions"><button type="button" class="rating-submit" data-rating-action="submit" data-rating-id="${safeId}"${disabled || !dirty ? ' disabled' : ''}>${actionLabel}</button>${own && status === 'ready' ? `<button type="button" class="rating-remove" data-rating-action="remove" data-rating-id="${safeId}"${disabled ? ' disabled' : ''}>Remove my rating</button>` : ''}${error ? `<button type="button" class="rating-retry" data-rating-action="retry" data-rating-id="${safeId}"${mutation ? ' disabled' : ''}>Refresh ratings</button>` : ''}</div>
    <p class="rating-privacy">No account needed. One rating per bathroom in this browser. You can update or remove it. Clearing cookies or using another browser resets recognition of your vote.</p>
  </section>`;
}

export async function handleRatingClick(event) {
  const control = event.target?.closest?.('[data-rating-action]');
  if (!control) return false;
  event.preventDefault();
  event.stopPropagation();
  if (control.disabled) return true;
  const { ratingId: id, ratingAction: action } = control.dataset;
  if (!id) return true;
  if (action === 'retry') {
    await loadRatings();
    return true;
  }
  if (status !== 'ready' || mutation) return true;
  if (action === 'select') {
    const value = Number(control.dataset.ratingValue);
    if (!Number.isInteger(value) || value < 1 || value > 5) return true;
    drafts.set(id, value);
    messages.delete(id);
    refreshView({ id, action: 'select', value });
    return true;
  }
  if (action !== 'submit' && action !== 'remove') return true;
  const rating = selectedScore(id);
  if (action === 'submit' && (!rating || rating === ownScores.get(id))) return true;
  mutation = { id, action };
  messages.delete(id);
  refreshView();
  let succeeded = false;
  try {
    const result = await callAPI(action === 'remove' ? 'DELETE' : 'POST', action === 'remove' ? { placeId: id } : { placeId: id, rating });
    acceptSnapshot(result);
    drafts.delete(id);
    succeeded = true;
  } catch (error) {
    const message = error?.name === 'AbortError' || error instanceof TypeError
      ? 'We could not confirm this change. Refresh ratings to check before trying again.'
      : error?.message || 'Your rating could not be updated. Please retry.';
    messages.set(id, message);
  } finally {
    mutation = null;
    refreshView({ id, action: 'select', value: selectedScore(id) || 1 });
  }
  if (succeeded) onToast(action === 'remove' ? 'Your rating was removed.' : 'Your rating was saved. Thanks for helping the next person.');
  return true;
}

export function handleRatingKeydown(event) {
  const control = event.target?.closest?.('[data-rating-action="select"]');
  if (!control || control.disabled || mutation || status !== 'ready') return false;
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (!keys.includes(event.key)) return false;
  event.preventDefault();
  event.stopPropagation();
  const current = Number(control.dataset.ratingValue);
  const value = event.key === 'Home' ? 1 : event.key === 'End' ? 5 :
    event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (current === 1 ? 5 : current - 1) : (current === 5 ? 1 : current + 1);
  const id = control.dataset.ratingId;
  drafts.set(id, value);
  messages.delete(id);
  refreshView({ id, action: 'select', value });
  return true;
}

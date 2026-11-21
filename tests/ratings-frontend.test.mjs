import assert from 'node:assert/strict';
import { test } from 'node:test';

let moduleNumber = 0;
async function setup(responder) {
  const calls = [];
  const toasts = [];
  globalThis.document = { addEventListener() {}, querySelectorAll() { return []; } };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options });
    return responder(options, calls.length);
  };
  const module = await import(`../ratings.js?test=${moduleNumber++}`);
  return { module, calls, toasts, init: () => module.initRatings(() => {}, message => toasts.push(message)) };
}
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const empty = { ratings: {}, myRatings: {} };
const click = (action, value) => ({
  target: { closest: () => ({ dataset: { ratingId: 'bayview', ratingAction: action, ratingValue: String(value ?? '') }, disabled: false }) },
  preventDefault() {}, stopPropagation() {},
});

test('frontend shows loading, then server-backed empty state, and selecting stars never posts', async () => {
  const { module, calls, init } = await setup(() => response(empty));
  assert.match(module.ratingSummaryHTML('bayview'), /Loading ratings/);
  await init();
  assert.match(module.ratingSummaryHTML('bayview'), /No ratings yet/);
  await module.handleRatingClick(click('select', 4));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.match(module.ratingPanelHTML('bayview'), /4 out of 5 selected/);
  assert.equal(module.getRating('bayview').count, 0);
  assert.match(module.ratingPanelHTML('bayview'), /Rate a bathroom you actually used\./);
});

test('frontend waits for confirmed submission and uses its real returned aggregate', async () => {
  let finish;
  const { module, calls, toasts, init } = await setup(options => options.method === 'GET' ? response(empty) : new Promise(resolve => { finish = resolve; }));
  await init();
  await module.handleRatingClick(click('select', 5));
  const submitted = module.handleRatingClick(click('submit'));
  assert.match(module.ratingPanelHTML('bayview'), /Saving your rating/);
  assert.equal(module.getRating('bayview').count, 0);
  assert.equal(toasts.length, 0);
  finish(response({ ratings: { bayview: { average: 4.5, count: 2 } }, myRatings: { bayview: 5 } }));
  await submitted;
  assert.deepEqual(JSON.parse(calls[1].body), { placeId: 'bayview', rating: 5 });
  assert.equal(calls[1].credentials, 'same-origin');
  assert.equal(module.getRating('bayview').count, 2);
  assert.equal(module.getRating('bayview').myRating, 5);
  assert.equal(toasts.length, 1);
  assert.match(module.ratingPanelHTML('bayview'), /Remove my rating/);
});

test('failed ratings do not fabricate success, preserve drafts, and escape error text', async () => {
  const { module, toasts, init } = await setup(options => options.method === 'GET' ? response(empty) : response({ error: '<bad> unavailable' }, 503));
  await init();
  await module.handleRatingClick(click('select', 2));
  await module.handleRatingClick(click('submit'));
  assert.equal(toasts.length, 0);
  assert.equal(module.getRating('bayview').myRating, null);
  assert.equal(module.getRating('bayview').count, 0);
  const panel = module.ratingPanelHTML('bayview');
  assert.match(panel, /&lt;bad&gt; unavailable/);
  assert.match(panel, /Refresh ratings/);
  assert.match(panel, /data-rating-value="2"[^>]*><span/);
  assert.doesNotMatch(panel, /<bad>/);
});

test('keyboard radio selection changes the draft and withdrawal uses DELETE', async () => {
  const initial = { ratings: { bayview: { average: 3, count: 1 } }, myRatings: { bayview: 3 } };
  const { module, calls, init } = await setup(options => response(options.method === 'DELETE' ? empty : initial));
  await init();
  assert.equal(module.handleRatingKeydown({ ...click('select', 3), key: 'Home' }), true);
  assert.match(module.ratingPanelHTML('bayview'), /Selected: 1 out of 5/);
  assert.equal(calls.length, 1);
  await module.handleRatingClick(click('remove'));
  assert.equal(calls[1].method, 'DELETE');
  assert.deepEqual(JSON.parse(calls[1].body), { placeId: 'bayview' });
  assert.equal(module.getRating('bayview').myRating, null);
  assert.equal(module.getRating('bayview').count, 0);
});

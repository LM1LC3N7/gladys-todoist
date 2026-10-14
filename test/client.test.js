// -----------------------------------------------------------------------------
// The Todoist client (src/todoist/client.js): what leaves, the published
// limits turned into a budget, the real error answers.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { RATE_LIMITS, USER_AGENT } from '../src/constants.js';
import { TodoistClient } from '../src/todoist/client.js';
import { IDS, fixture, installTodoist, json, text, todoistState } from './helpers/fakeTodoist.js';

const TOKEN = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';
let todoist;
afterEach(() => todoist?.restore());

function client({ now = () => 0, limits } = {}) {
  return new TodoistClient({ token: TOKEN, now, ...(limits ? { limits } : {}) });
}

test('the sync is a form POST with the token in the Authorization header only', async () => {
  todoist = installTodoist();
  const answer = await client().sync('*', ['items', 'projects', 'user']);
  assert.equal(answer.full_sync, true);
  const [call] = todoist.calls;
  assert.equal(call.url, 'https://api.todoist.com/api/v1/sync');
  assert.deepEqual(call.form, {
    sync_token: '*',
    resource_types: '["items","projects","user"]',
  });
  assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(call.headers['User-Agent'], USER_AGENT);
  assert.ok(!call.url.includes(TOKEN));
});

test('a filter is read page after page with the cursor, in the language of the filter', async () => {
  const state = todoistState();
  state.pageSize = 2;
  todoist = installTodoist(state);
  const tasks = await client().filter('#Maison', 'fr');
  assert.deepEqual(
    tasks.map((t) => t.id),
    [IDS.BINS, IDS.PLUMBER, IDS.CANTEEN, IDS.HEADING],
  );
  assert.deepEqual(
    todoist.calls.map((c) => [c.params.query, c.params.lang, c.params.cursor]),
    [
      ['#Maison', 'fr', undefined],
      ['#Maison', 'fr', 'c2.x'],
    ],
  );
  await client().filter('@courses', 'en');
  assert.equal(todoist.calls.at(-1).params.lang, undefined, 'English is the default');
});

test('a refused token (real answer) is final: nothing more leaves', async () => {
  const state = todoistState();
  state.fail = () => json(fixture('sync-401.json'), 401, { 'retry-after': '4' });
  todoist = installTodoist(state);
  const api = client();
  await assert.rejects(api.sync('*', ['items']), (err) => {
    assert.equal(err.code, 'unauthorized');
    assert.equal(err.final, true);
    assert.equal(err.tag, 'AUTH_INVALID_TOKEN');
    assert.ok(!err.message.includes(TOKEN));
    return true;
  });
  await assert.rejects(api.closeTask(IDS.BREAD), { code: 'unauthorized' });
  assert.equal(todoist.calls.length, 1);
});

test('a 429 pauses every call for retry_after; other errors are told apart', async () => {
  const clock = { now: 1_000_000 };
  const state = todoistState();
  state.fail = (call) =>
    call.path.endsWith('/sync')
      ? json({ error: 'Too many requests', error_extra: { retry_after: 90 } }, 429)
      : undefined;
  todoist = installTodoist(state);
  const api = client({ now: () => clock.now });
  await assert.rejects(api.sync('tok-1', ['items']), (err) => {
    assert.equal(err.code, 'rate_limited');
    assert.equal(err.retryAt, 1_000_000 + 90_000);
    return true;
  });
  await assert.rejects(api.filter('today'), { code: 'rate_limited' });
  assert.equal(todoist.calls.length, 1, 'paused: refused before leaving');
  clock.now += 91_000;
  await assert.rejects(api.closeTask('nope'), { code: 'not_found' });
  state.fail = () => text(fixture('rest-v2-410.txt'), 410);
  await assert.rejects(api.addTask({ content: 'x' }), { code: 'gone' });
  state.fail = () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(api.quickAdd('x'), { code: 'network' });
});

test('the published limits become a budget: requests and full syncs per 15 minutes', async () => {
  const clock = { now: 0 };
  todoist = installTodoist();
  const limits = { ...RATE_LIMITS, REQUESTS: 3, FULL_SYNCS: 1 };
  const api = client({ now: () => clock.now, limits });
  await api.sync('*', ['items']);
  await assert.rejects(api.sync('*', ['items']), { code: 'budget' });
  await api.sync('tok-1', ['items']);
  await api.sync('tok-1', ['items']);
  await assert.rejects(api.sync('tok-1', ['items']), (err) => {
    assert.equal(err.code, 'budget');
    assert.equal(err.retryAt, RATE_LIMITS.WINDOW);
    return true;
  });
  assert.equal(todoist.calls.length, 3, 'the refused calls never left');
  assert.deepEqual(api.usage(), { requests: 3, fullSyncs: 1 });
  clock.now = RATE_LIMITS.WINDOW + 1;
  await api.sync('tok-1', ['items']);
  assert.deepEqual(api.usage(), { requests: 1, fullSyncs: 0 });
  // Our share stays under the published figures.
  assert.ok(RATE_LIMITS.REQUESTS <= RATE_LIMITS.PUBLISHED_REQUESTS / 2);
  assert.ok(RATE_LIMITS.FULL_SYNCS <= RATE_LIMITS.PUBLISHED_FULL_SYNCS / 2);
});

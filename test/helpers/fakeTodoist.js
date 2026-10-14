// -----------------------------------------------------------------------------
// A fake Todoist for the tests: replaces `fetch`, answers the API v1 routes
// from a mutable account (the tasks change like Todoist changes them, with a
// version per change so the incremental sync returns what changed since a
// token), records every call, and fails loudly on an unexpected URL. No test
// touches the network.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { setFetch } from '../../src/http.js';

setFetch(async (url) => {
  throw new Error(`Network call without a fake fetch in a test: ${url}`);
});

export function fixture(name) {
  const text = readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
  return name.endsWith('.json') ? JSON.parse(text) : text;
}

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
export const text = (body, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

/** 10:00 in Paris on Wednesday 14 October 2026, the morning of the fixture. */
export const FIXTURE_NOW = Date.parse('2026-10-14T08:00:00Z');

export const IDS = {
  INBOX: '6Xg0Inbox0000001',
  HOME: '6Xg0Maison000002',
  SHOP: '6Xg0Courses00003',
  WORK: '6Xg0Travail00004',
  BINS: '6Xh0Bins00000001',
  BREAD: '6Xh0Bread0000002',
  PLUMBER: '6Xh0Plumber00003',
  MEETING: '6Xh0Meeting00004',
  READ: '6Xh0Read00000005',
  CANTEEN: '6Xh0Canteen00006',
  HEADING: '6Xh0Heading00007',
};

const strip = ({ _v, ...rest }) => rest;
const day = 24 * 60 * 60_000;

/** The account as Todoist serves it; every field can be edited by a test. */
export function todoistState({ now = () => FIXTURE_NOW } = {}) {
  const full = fixture('sync-full.json');
  const state = {
    now,
    version: 1,
    nextId: 10,
    items: new Map(full.items.map((i) => [i.id, { ...i, _v: 1 }])),
    projects: new Map(full.projects.map((p) => [p.id, { ...p, _v: 1 }])),
    user: full.user,
    userVersion: 1,
    /** Page size of tasks/filter (small to exercise the cursor). */
    pageSize: 200,
    /** How Todoist would parse a due string (the fake only knows a few). */
    parseDue: (string, lang) => ({
      date: '2026-10-15T18:00:00',
      string,
      lang: lang ?? 'fr',
      is_recurring: false,
      timezone: null,
    }),
    /** What a filter matches: "#Project" or "@label", else nothing. */
    filter: (query, items) => {
      const project = /^#(.+)$/.exec(query);
      if (project) {
        const found = [...state.projects.values()].find((p) => p.name === project[1]);
        return items.filter((i) => i.project_id === found?.id);
      }
      const label = /^@(.+)$/.exec(query);
      return label ? items.filter((i) => i.labels.includes(label[1])) : [];
    },
    /** (call) => Response | undefined: an error injected before the routes. */
    fail: () => undefined,
  };
  return state;
}

/** A change made in the Todoist apps: the next incremental sync returns it. */
export function change(state, id, patch) {
  state.version += 1;
  const current = state.items.get(id);
  state.items.set(id, { ...current, ...patch, _v: state.version });
}

/** A task added in the Todoist apps (a copy of the created-task fixture). */
export function addInApp(state, patch) {
  state.version += 1;
  const id = patch.id ?? `6Xh0App${String(state.nextId++).padStart(9, '0')}`;
  const item = {
    ...fixture('task-created.json'),
    added_at: new Date(state.now()).toISOString(),
    completed_count: 0,
    ...patch,
    id,
    _v: state.version,
  };
  state.items.set(id, item);
  return id;
}

const active = (state) => [...state.items.values()].filter((i) => !i.checked && !i.is_deleted);

function sync(state, form) {
  const token = form.sync_token;
  if (token === '*') {
    return json({
      full_sync: true,
      full_sync_date_utc: new Date(state.now()).toISOString(),
      sync_token: `tok-${state.version}`,
      temp_id_mapping: {},
      items: active(state).map(strip),
      projects: [...state.projects.values()].map(strip),
      user: state.user,
    });
  }
  const match = /^tok-(\d+)$/.exec(token ?? '');
  if (!match) {
    return json(
      {
        error: 'Invalid argument value',
        error_code: 20,
        error_extra: { argument: 'sync_token', event_id: '0'.repeat(32) },
        error_tag: 'INVALID_ARGUMENT_VALUE',
        http_code: 400,
      },
      400,
    );
  }
  const since = Number(match[1]);
  const answer = {
    full_sync: false,
    sync_token: `tok-${state.version}`,
    temp_id_mapping: {},
    items: [...state.items.values()].filter((i) => i._v > since).map(strip),
    projects: [...state.projects.values()].filter((p) => p._v > since).map(strip),
  };
  if (state.userVersion > since) {
    answer.user = state.user;
  }
  return json(answer);
}

function create(state, body, { quick = false } = {}) {
  state.version += 1;
  const id = `6Xh0Gladys${String(state.nextId++).padStart(6, '0')}`;
  const item = {
    ...fixture('task-created.json'),
    id,
    content: quick ? body.text : body.content,
    project_id: quick
      ? state.user.inbox_project_id
      : (body.project_id ?? state.user.inbox_project_id),
    priority: body.priority ?? 1,
    labels: body.labels ?? [],
    due: body.due_string ? state.parseDue(body.due_string, body.due_lang) : null,
    added_at: new Date(state.now()).toISOString(),
    completed_count: 0,
    _v: state.version,
  };
  state.items.set(id, item);
  return json(strip(item));
}

function close(state, id) {
  const item = state.items.get(id);
  if (!item || item.checked || item.is_deleted) {
    return json(
      {
        error: 'Task not found',
        error_code: 478,
        error_extra: { event_id: '0'.repeat(32), retry_after: 3 },
        error_tag: 'NOT_FOUND',
        http_code: 404,
      },
      404,
    );
  }
  if (item.due?.is_recurring) {
    // Todoist moves a recurring task to its next date (a week later here).
    const next = new Date(Date.parse(`${item.due.date.slice(0, 10)}T00:00:00Z`) + 7 * day);
    const date = next.toISOString().slice(0, 10) + item.due.date.slice(10);
    change(state, id, {
      due: { ...item.due, date },
      completed_count: (item.completed_count ?? 0) + 1,
    });
  } else {
    change(state, id, {
      checked: true,
      completed_at: new Date(state.now()).toISOString(),
      completed_count: (item.completed_count ?? 0) + 1,
    });
  }
  return new Response(null, { status: 204 });
}

function filter(state, params) {
  const all = state.filter(params.query, active(state));
  const offset = params.cursor ? Number(/^c(\d+)\.x$/.exec(params.cursor)[1]) : 0;
  const size = Math.min(Number(params.limit ?? 50), state.pageSize);
  const results = all.slice(offset, offset + size).map(strip);
  const next = offset + size < all.length ? `c${offset + size}.x` : null;
  return json({ results, next_cursor: next });
}

function route(state, call) {
  const { method, path } = call;
  if (method === 'POST' && path === '/api/v1/sync') {
    return sync(state, call.form);
  }
  if (method === 'POST' && path === '/api/v1/tasks') {
    return create(state, call.json);
  }
  if (method === 'POST' && path === '/api/v1/tasks/quick') {
    return create(state, call.json, { quick: true });
  }
  const match = /^\/api\/v1\/tasks\/([^/]+)\/close$/.exec(path);
  if (method === 'POST' && match) {
    return close(state, decodeURIComponent(match[1]));
  }
  if (method === 'GET' && path === '/api/v1/tasks/filter') {
    return filter(state, call.params);
  }
  return undefined;
}

/** Install the fake Todoist; returns { state, calls, count, restore }. */
export function installTodoist(state = todoistState()) {
  const calls = [];
  const previous = setFetch(async (url, init = {}) => {
    const parsed = new URL(url);
    const type = String(init.headers?.['Content-Type'] ?? '');
    const call = {
      method: init.method ?? 'GET',
      url,
      host: parsed.host,
      path: parsed.pathname,
      params: Object.fromEntries(parsed.searchParams),
      headers: init.headers ?? {},
      form: type.startsWith('application/x-www-form-urlencoded')
        ? Object.fromEntries(new URLSearchParams(init.body))
        : undefined,
      json: type.startsWith('application/json') ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const answer = state.fail(call) ?? route(state, call);
    if (!answer) {
      throw new Error(`Unexpected network call in a test: ${call.method} ${url}`);
    }
    return answer;
  });
  return {
    state,
    calls,
    /** The calls to one route, e.g. count('POST', /\/sync$/). */
    count: (method, pattern) =>
      calls.filter((c) => c.method === method && pattern.test(c.path)).length,
    /** The sync calls with their token: ['*', 'tok-1', ...]. */
    syncTokens: () => calls.filter((c) => c.path === '/api/v1/sync').map((c) => c.form.sync_token),
    restore: () => setFetch(previous),
  };
}

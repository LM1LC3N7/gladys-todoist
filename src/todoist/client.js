// -----------------------------------------------------------------------------
// The Todoist API v1 client (https://developer.todoist.com/api/v1/). Every
// method resolves raw JSON: turning it into values is ./model.js's job.
//
// Authentication: "Authorization: Bearer <token>", the personal API token of
// the account. The token never appears in a URL, a log line or an error.
//
// Pacing, from the published limits (src/constants.js, RATE_LIMITS): every
// request is counted in a sliding 15-minute window, the full syncs in their
// own; past our share of the limits, a call is refused here before it leaves
// (`budget`). A 429 pauses every call for Todoist's `retry_after`. A refused
// token is final: nothing more is sent until the configuration changes.
// -----------------------------------------------------------------------------

import {
  MAX_PAGES,
  MAX_PAUSE,
  PAGE_LIMIT,
  RATE_LIMITS,
  RATE_LIMIT_PAUSE,
  TODOIST_API_URL,
} from '../constants.js';
import { HttpError, request } from '../http.js';
import { errorOf, pageOf } from './model.js';

export class TodoistError extends Error {
  /**
   * `code`: no_token | unauthorized (final until the configuration changes) |
   * forbidden | not_found | bad_request | rate_limited | budget | gone | http |
   * timeout | network.
   */
  constructor(code, message, { status, tag, retryAt } = {}) {
    super(message);
    this.name = 'TodoistError';
    this.code = code;
    this.status = status;
    this.tag = tag;
    this.retryAt = retryAt;
  }

  get final() {
    return this.code === 'unauthorized';
  }
}

/** Requests in a sliding window: [instants], oldest first. */
class Window {
  constructor(span) {
    this.span = span;
    this.times = [];
  }

  count(now) {
    while (this.times.length > 0 && this.times[0] <= now - this.span) {
      this.times.shift();
    }
    return this.times.length;
  }

  add(now) {
    this.times.push(now);
  }
}

export class TodoistClient {
  constructor({ token = '', now = Date.now, baseUrl = TODOIST_API_URL, limits = RATE_LIMITS }) {
    this.token = token;
    this.now = now;
    this.baseUrl = baseUrl;
    this.limits = limits;
    this.requests = new Window(limits.WINDOW);
    this.fullSyncs = new Window(limits.WINDOW);
    this.pausedUntil = 0;
    /** The error of a refused token: thrown again without a request. */
    this.refused = undefined;
  }

  /** Requests made in the current 15-minute window. */
  usage() {
    const now = this.now();
    return { requests: this.requests.count(now), fullSyncs: this.fullSyncs.count(now) };
  }

  /** Count a request about to leave, or refuse it. */
  admit({ full = false } = {}) {
    if (!this.token) {
      throw new TodoistError('no_token', 'No Todoist API token configured');
    }
    if (this.refused) {
      throw this.refused;
    }
    const now = this.now();
    if (now < this.pausedUntil) {
      throw new TodoistError('rate_limited', 'Todoist asked to slow down', {
        retryAt: this.pausedUntil,
      });
    }
    if (this.requests.count(now) >= this.limits.REQUESTS) {
      throw new TodoistError('budget', 'request budget of the 15-minute window used up', {
        retryAt: this.requests.times[0] + this.limits.WINDOW,
      });
    }
    if (full && this.fullSyncs.count(now) >= this.limits.FULL_SYNCS) {
      throw new TodoistError('budget', 'full sync budget of the 15-minute window used up', {
        retryAt: this.fullSyncs.times[0] + this.limits.WINDOW,
      });
    }
    this.requests.add(now);
    if (full) {
      this.fullSyncs.add(now);
    }
  }

  wrap(err) {
    if (err instanceof TodoistError) {
      return err;
    }
    if (err instanceof HttpError) {
      const { tag, message, retryAfter } = errorOf(err.body);
      const detail = message || err.message;
      const options = { status: err.status, tag };
      if (err.status === 401) {
        // Todoist adds a retry_after even here, but the documentation says
        // not to retry the same token: the user has to fix it.
        this.refused = new TodoistError('unauthorized', 'Todoist refused the API token', options);
        return this.refused;
      }
      if (err.status === 429) {
        const wait = retryAfter ?? err.retryAfter;
        const pause = wait ? wait * 1000 : RATE_LIMIT_PAUSE;
        this.pausedUntil = this.now() + Math.min(MAX_PAUSE, pause);
        return new TodoistError('rate_limited', 'Todoist asked to slow down (429)', {
          ...options,
          retryAt: this.pausedUntil,
        });
      }
      if (err.status === 403) {
        return new TodoistError('forbidden', `Todoist refused the request: ${detail}`, options);
      }
      if (err.status === 404) {
        return new TodoistError('not_found', `Todoist does not know it: ${detail}`, options);
      }
      if (err.status === 410) {
        return new TodoistError('gone', 'Todoist retired this endpoint', options);
      }
      if (err.status === 400) {
        return new TodoistError('bad_request', `Todoist refused the request: ${detail}`, options);
      }
      return new TodoistError('http', `Todoist answered ${err.status}: ${detail}`, options);
    }
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return new TodoistError('timeout', 'Todoist did not answer in time');
    }
    return new TodoistError('network', `network error (${err?.message ?? err})`);
  }

  async call(method, path, { json, form, query, full = false } = {}) {
    this.admit({ full });
    const search = query ? `?${new URLSearchParams(query)}` : '';
    try {
      return await request(`${this.baseUrl}${path}${search}`, {
        method,
        json,
        form,
        headers: { Authorization: `Bearer ${this.token}` },
      });
    } catch (err) {
      throw this.wrap(err);
    }
  }

  // --- The API -------------------------------------------------------------------------

  /**
   * POST sync (form-encoded): `*` for everything, else the token of the last
   * answer for what changed since.
   */
  sync(syncToken, resources) {
    return this.call('POST', 'sync', {
      form: { sync_token: syncToken, resource_types: JSON.stringify(resources) },
      full: syncToken === '*',
    });
  }

  /**
   * GET tasks/filter, every page (cursor pagination) up to MAX_PAGES, as
   * tasks (see taskOf). `lang` is the language the filter is written in.
   */
  async filter(query, lang) {
    const tasks = [];
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params = { query, limit: String(PAGE_LIMIT) };
      if (lang && lang !== 'en') {
        params.lang = lang;
      }
      if (cursor) {
        params.cursor = cursor;
      }
      const answer = pageOf(await this.call('GET', 'tasks/filter', { query: params }));
      tasks.push(...answer.tasks);
      cursor = answer.cursor;
      if (!cursor) {
        break;
      }
    }
    return tasks;
  }

  /** POST tasks: { content, due_string, due_lang, project_id, priority, labels } -> the task. */
  addTask(body) {
    return this.call('POST', 'tasks', { json: body });
  }

  /** POST tasks/quick: the Quick Add parser of the apps (#project @label p1 dates) -> the task. */
  quickAdd(text) {
    return this.call('POST', 'tasks/quick', { json: { text } });
  }

  /** POST tasks/{id}/close: completes a task, moves a recurring one to its next date. */
  closeTask(taskId) {
    return this.call('POST', `tasks/${encodeURIComponent(taskId)}/close`);
  }
}

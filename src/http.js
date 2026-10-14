// -----------------------------------------------------------------------------
// The only place that talks to the network: `fetch` with a timeout and an
// identifiable User-Agent. The tests replace it with `setFetch()`.
//
// Errors carry the path of the URL only: never its query (a filter typed by
// the user) nor the request headers (the API token).
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, USER_AGENT } from './constants.js';

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace the fetch implementation (tests only). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

export class HttpError extends Error {
  /** `body`: the parsed JSON answer when it is JSON, else its text (cut). */
  constructor(status, url, body, retryAfter) {
    // `error` is the message of a Todoist error answer; anything else is cut.
    const detail =
      body && typeof body === 'object' ? (body.error ?? '') : String(body ?? '').slice(0, 200);
    super(`HTTP ${status} on ${new URL(url).pathname}${detail ? `: ${detail}` : ''}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    /** Seconds the server asks to wait (the Retry-After header). */
    this.retryAfter = retryAfter;
  }
}

function parse(text) {
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * One request. `json` is sent JSON-encoded, `form` form-encoded; resolves the
 * parsed JSON answer (undefined when empty), throws an HttpError on a non-2xx
 * status.
 */
export async function request(
  url,
  { method = 'GET', headers = {}, json, form, timeout = HTTP_TIMEOUT } = {},
) {
  const init = {
    method,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(Math.max(1, timeout)),
  };
  if (form !== undefined) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    init.body = new URLSearchParams(form).toString();
  } else if (json !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  }
  const response = await fetchImpl(url, init);
  const text = await response.text();
  const body = parse(text);
  if (!response.ok) {
    const header = Number(response.headers.get('retry-after'));
    throw new HttpError(response.status, url, body, header > 0 ? header : undefined);
  }
  return body;
}

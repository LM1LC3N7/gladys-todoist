// -----------------------------------------------------------------------------
// Todoist JSON -> plain tasks, projects and account settings, and the merge
// of a sync answer into the local store. Pure. Every Todoist field name the
// integration reads is here, so a change of the API is fixed in one place.
//
// A task: { id, content, projectId, sectionId, parentId, priority ('p1' to
// 'p4'), labels, due, checked, deleted, completedCount, addedAt, order,
// uncompletable, url }.
// -----------------------------------------------------------------------------

import { TASK_URL } from '../constants.js';

/** Todoist's API counts the priorities backwards: 4 is the "p1" of the apps. */
const FROM_API = { 4: 'p1', 3: 'p2', 2: 'p3', 1: 'p4' };
const TO_API = { p1: 4, p2: 3, p3: 2, p4: 1 };

export const priorityOf = (value) => FROM_API[Number(value)] ?? 'p4';
export const apiPriority = (priority) => TO_API[priority];

const array = (value) => (Array.isArray(value) ? value : []);
const id = (value) =>
  value === null || value === undefined || value === '' ? null : String(value);

/**
 * The text of a task as the apps show it: a Markdown link "[text](url)"
 * becomes its text. Bounded patterns: no backtracking on a hostile content.
 */
export function plainText(text) {
  return String(text ?? '')
    .replace(/\[([^\]\n]{0,500})\]\(([^)\s]{0,2000})\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The due object: { date, time, instant, recurring, string }.
 *   - a date only ("2026-10-14"): time null;
 *   - a floating time ("2026-10-14T19:00:00"): the wall time of the user;
 *   - a fixed time ("2026-10-14T08:30:00.000000Z"): `instant` is set.
 * Some answers carry the time in a separate `datetime`: it wins.
 */
export function dueOf(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = String(raw.datetime || raw.date || '');
  const match =
    /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(
      value,
    );
  if (!match) {
    return null;
  }
  const [, date, hours, minutes, zone] = match;
  const instant = zone ? Date.parse(value) : null;
  return {
    date,
    time: hours ? `${hours}:${minutes}` : null,
    instant: Number.isFinite(instant) ? instant : null,
    recurring: raw.is_recurring === true,
    string: typeof raw.string === 'string' ? raw.string : '',
  };
}

export function taskOf(raw) {
  const content = plainText(raw.content);
  // "* text" is an uncompletable task (a heading in a list): no check-off.
  const uncompletable = content.startsWith('* ');
  const addedAt = Date.parse(raw.added_at ?? '');
  return {
    id: String(raw.id),
    content: uncompletable ? content.slice(2).trim() : content,
    projectId: id(raw.project_id),
    sectionId: id(raw.section_id),
    parentId: id(raw.parent_id),
    priority: priorityOf(raw.priority),
    labels: array(raw.labels).map(String),
    due: dueOf(raw.due),
    checked: raw.checked === true,
    deleted: raw.is_deleted === true,
    completedCount: Number.isInteger(raw.completed_count) ? raw.completed_count : null,
    addedAt: Number.isFinite(addedAt) ? addedAt : null,
    order: Number(raw.child_order) || 0,
    uncompletable,
    url: `${TASK_URL}${encodeURIComponent(raw.id)}`,
  };
}

export function projectOf(raw) {
  return {
    id: String(raw.id),
    name: plainText(raw.name),
    inbox: raw.inbox_project === true,
    archived: raw.is_archived === true,
    deleted: raw.is_deleted === true,
  };
}

/**
 * What the integration keeps of the sync `user`: the time zone, the language
 * and the Inbox. The object also carries the API token and the email: they
 * are never kept, logged nor forwarded.
 */
export function userOf(raw) {
  return {
    timeZone: typeof raw?.tz_info?.timezone === 'string' ? raw.tz_info.timezone : undefined,
    lang: typeof raw?.lang === 'string' ? raw.lang : undefined,
    inboxProjectId: id(raw?.inbox_project_id),
  };
}

/** The store before the first sync: `*` asks Todoist for everything. */
export function emptyStore() {
  return {
    syncToken: '*',
    tasks: new Map(),
    projects: new Map(),
    user: { timeZone: 'UTC', lang: 'en', inboxProjectId: null },
    syncedAt: 0,
  };
}

/**
 * Merge a sync answer into the store (a new store, the old one untouched).
 * The store keeps the active tasks only; `changes` lists every task of the
 * answer with the version the store had before ({ before, after }), which is
 * what the triggers compare.
 */
export function mergeSync(store, answer, now) {
  const base = store ?? emptyStore();
  const full = answer?.full_sync === true;
  const tasks = full ? new Map() : new Map(base.tasks);
  const projects = full ? new Map() : new Map(base.projects);
  const changes = [];
  for (const raw of array(answer?.items)) {
    if (raw?.id === undefined || raw?.id === null) {
      continue;
    }
    const after = taskOf(raw);
    changes.push({ before: base.tasks.get(after.id), after });
    if (after.checked || after.deleted) {
      tasks.delete(after.id);
    } else {
      tasks.set(after.id, after);
    }
  }
  for (const raw of array(answer?.projects)) {
    if (raw?.id === undefined || raw?.id === null) {
      continue;
    }
    const project = projectOf(raw);
    if (project.archived || project.deleted) {
      projects.delete(project.id);
    } else {
      projects.set(project.id, project);
    }
  }
  const user = { ...base.user };
  if (answer?.user) {
    for (const [key, value] of Object.entries(userOf(answer.user))) {
      if (value !== undefined && value !== null) {
        user[key] = value;
      }
    }
  }
  return {
    store: {
      syncToken: typeof answer?.sync_token === 'string' ? answer.sync_token : base.syncToken,
      tasks,
      projects,
      user,
      syncedAt: now,
    },
    changes,
    full,
  };
}

/** The tasks of a paginated answer ({ results, next_cursor }). */
export function pageOf(answer) {
  return {
    tasks: array(answer?.results)
      .filter((raw) => raw?.id !== undefined && raw?.id !== null)
      .map(taskOf),
    cursor:
      typeof answer?.next_cursor === 'string' && answer.next_cursor ? answer.next_cursor : null,
  };
}

/**
 * What Todoist says in an error answer: { tag, message, retryAfter }, the
 * last one in seconds (`error_extra.retry_after`, sent with any error).
 */
export function errorOf(body) {
  if (body && typeof body === 'object') {
    const retryAfter = Number(body.error_extra?.retry_after);
    return {
      tag: typeof body.error_tag === 'string' ? body.error_tag : '',
      message: typeof body.error === 'string' ? body.error.slice(0, 200) : '',
      retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    };
  }
  return { tag: '', message: String(body ?? '').slice(0, 200), retryAfter: undefined };
}

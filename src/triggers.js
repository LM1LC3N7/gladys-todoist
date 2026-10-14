// -----------------------------------------------------------------------------
// Readings -> scene events. Pure. One event per transition, and nothing on
// the first reading:
//   - "task added" / "task completed" compare two consecutive syncs (the
//     store before, the tasks of the incremental answer);
//   - "task due" fires once per task and due instant, when the clock crosses
//     it; the dues already passed at the first sync are marked as announced.
// -----------------------------------------------------------------------------

import { ADDED_MARGIN, MAX_EVENTS_PER_READING, SCENE_TRIGGERS } from './constants.js';
import { dueInfo, eventData } from './tasks.js';

/**
 * The events of an incremental sync. `previous` is the store before it
 * (undefined at the first reading), `changes` what mergeSync returned.
 */
export function syncEvents(previous, changes, ctx) {
  if (!previous || previous.syncedAt === 0) {
    return [];
  }
  const added = [];
  const completed = [];
  for (const { before, after } of changes) {
    if (after.deleted) {
      continue; // a deleted task is not a completed one
    }
    if (!before) {
      // Unknown to the store: new, unless Todoist created it long before
      // (a reopened task, the tasks of an unarchived project).
      const recent = after.addedAt === null || after.addedAt >= previous.syncedAt - ADDED_MARGIN;
      if (!after.checked && recent) {
        added.push({ key: SCENE_TRIGGERS.ADDED, data: eventData(after, ctx) });
      }
      continue;
    }
    // A recurring task is not checked when closed: Todoist moves it to its
    // next date and counts one more completion.
    const recurring =
      !after.checked &&
      before.completedCount !== null &&
      after.completedCount !== null &&
      after.completedCount > before.completedCount;
    if ((after.checked && !before.checked) || recurring) {
      // The occurrence that was completed: the due date it had before.
      completed.push({
        key: SCENE_TRIGGERS.COMPLETED,
        data: { ...eventData({ ...after, due: before.due }, ctx), recurring },
      });
    }
  }
  return [...added.slice(0, MAX_EVENTS_PER_READING), ...completed.slice(0, MAX_EVENTS_PER_READING)];
}

const dueKey = (task, at) => `${task.id}|${at}`;

/** The dues already reached at the first reading: announced, they never fire. */
export function dueBaseline(tasks, ctx) {
  const announced = new Map();
  for (const task of tasks) {
    const info = dueInfo(task, ctx);
    if (info && info.at <= ctx.now) {
      announced.set(dueKey(task, info.at), info.at);
    }
  }
  return announced;
}

/**
 * The "task due" events at `ctx.now`: the dues within (now - grace, now] not
 * announced yet, oldest first. `grace` covers a task synced a little after
 * its due time (it is the poll interval plus a tick); a task created after
 * its due time never fires. Returns the events and the keys to remember.
 */
export function dueEvents(tasks, ctx, { grace, announced }) {
  const found = [];
  for (const task of tasks) {
    const info = dueInfo(task, ctx);
    if (!info || info.at > ctx.now || info.at <= ctx.now - grace) {
      continue;
    }
    if (task.addedAt !== null && task.addedAt > info.at) {
      continue;
    }
    const key = dueKey(task, info.at);
    if (!announced.has(key)) {
      found.push({ key, at: info.at, task });
    }
  }
  found.sort((a, b) => a.at - b.at);
  const kept = found.slice(0, MAX_EVENTS_PER_READING);
  return {
    events: kept.map(({ task }) => ({ key: SCENE_TRIGGERS.DUE, data: eventData(task, ctx) })),
    marks: found.map(({ key, at }) => [key, at]),
  };
}

/** Forget the announced dues that can no longer come back into the window. */
export function pruneAnnounced(announced, now, grace) {
  for (const [key, at] of announced) {
    if (at <= now - grace) {
      announced.delete(key);
    }
  }
  return announced;
}

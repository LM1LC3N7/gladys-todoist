// -----------------------------------------------------------------------------
// The dashboard widget "Todoist tasks". Pure.
//
// The vocabulary allows at most 4 buttons per card: up to 3 tasks get their
// own check-off button (they work on Gladys 5.1: a button with params); with
// more tasks, the first 2 keep theirs and a "Check off…" form lists the
// others (a `select`). An "Add" form is always last. Forms need Gladys 5.2.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_ACTIONS, WIDGET_PICK_OPTIONS, WIDGET_ROWS, completeKey } from './constants.js';
import { T } from './i18n.js';
import { dueInfo, dueText, isOverdue, projectName } from './tasks.js';

/** The colour of each priority, close to the apps' (red, orange, blue, grey). */
export const PRIORITY_COLORS = {
  p1: WIDGET_COLORS.DANGER,
  p2: WIDGET_COLORS.WARNING,
  p3: WIDGET_COLORS.INFO,
  p4: WIDGET_COLORS.NEUTRAL,
};

const cut = (text, max) => {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
const same = (text) => ({ en: text, fr: text });
const pick = (text, language) => (typeof text === 'string' ? text : (text[language] ?? text.en));
/** A plain or multi-language text, cut to `max` characters per language. */
const bound = (text, max) =>
  typeof text === 'string'
    ? cut(text, max)
    : Object.fromEntries(Object.entries(text).map(([lang, value]) => [lang, cut(value, max)]));

/** A body-only content: the empty or degraded states. */
export function messageWidget(text, { heading = 'Todoist', ttl = 300 } = {}) {
  return {
    ttl_seconds: ttl,
    components: [
      { type: 'text', text: bound(heading, 40), variant: 'heading' },
      { type: 'text', text: bound(text, 300), variant: 'body' },
    ],
  };
}

function row(task, ctx, { language, showProject }) {
  const info = dueInfo(task, ctx);
  const late = isOverdue(info, ctx);
  const parts = [];
  if (late) {
    parts.push(pick(T.widget.overdue, language));
  }
  parts.push(dueText(info, ctx, language) || pick(T.widget.noDate, language));
  const project = showProject ? projectName(task, ctx) : '';
  if (project) {
    parts.push(project);
  }
  return {
    label: cut(task.content, 40),
    value: cut(parts.join(' · '), 40),
    icon: late ? 'alert-circle' : !info ? 'circle' : info.allDay ? 'calendar' : 'clock',
    color: PRIORITY_COLORS[task.priority] ?? WIDGET_COLORS.NEUTRAL,
  };
}

function completeButton(task, index) {
  return {
    type: 'button',
    label: cut(task.content, 24),
    icon: 'check',
    // An accidental tap would close a task (or move a recurring one): ask first.
    action: { key: completeKey(index + 1), params: { id: task.id }, confirm: true },
  };
}

function pickButton(tasks) {
  const options = tasks.slice(0, WIDGET_PICK_OPTIONS);
  return {
    type: 'button',
    label: T.widget.pick,
    icon: 'check-square',
    action: {
      key: WIDGET_ACTIONS.PICK,
      fields: [
        {
          key: 'task',
          type: 'select',
          required: true,
          label: T.widget.task,
          default: options[0].id,
          options: options.map((t) => ({ value: t.id, label: same(cut(t.content, 40)) })),
        },
      ],
    },
  };
}

function addButton() {
  return {
    type: 'button',
    label: T.widget.add,
    icon: 'plus',
    style: 'primary',
    action: {
      key: WIDGET_ACTIONS.ADD,
      fields: [
        {
          key: 'content',
          type: 'string',
          required: true,
          label: T.widget.task,
          placeholder: T.widget.taskPlaceholder,
        },
        {
          key: 'due',
          type: 'string',
          required: false,
          label: T.widget.due,
          placeholder: T.widget.duePlaceholder,
        },
      ],
    },
  };
}

/**
 * The content: a title, the count, the tasks (10 rows at most, the last one
 * counting the rest) with their priority colour, due time and overdue mark,
 * the check-off buttons and the "Add" form. `tasks` comes sorted.
 */
export function tasksWidget({ title, tasks, ctx, language = 'en', showProject = true, ttl = 120 }) {
  const components = [{ type: 'text', text: bound(title, 40), variant: 'heading' }];
  if (tasks.length === 0) {
    components.push({ type: 'text', text: T.widget.empty, variant: 'body' });
  } else {
    const overdue = tasks.filter((t) => isOverdue(dueInfo(t, ctx), ctx)).length;
    components.push({
      type: 'text',
      text: T.widget.summary(tasks.length, overdue),
      variant: 'caption',
    });
    const shown = tasks.length > WIDGET_ROWS ? tasks.slice(0, WIDGET_ROWS - 1) : tasks;
    const rows = shown.map((t) => row(t, ctx, { language, showProject }));
    if (tasks.length > shown.length) {
      rows.push({
        label: T.widget.more(tasks.length - shown.length),
        value: '…',
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
    components.push({ type: 'status', items: rows });
    const open = tasks.filter((t) => !t.uncompletable);
    if (open.length <= 3) {
      components.push(...open.map((t, i) => completeButton(t, i)));
    } else {
      components.push(...open.slice(0, 2).map((t, i) => completeButton(t, i)), pickButton(open));
    }
  }
  components.push(addButton());
  return { ttl_seconds: Math.max(60, Math.min(3600, Math.round(ttl))), components };
}

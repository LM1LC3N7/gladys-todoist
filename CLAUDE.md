# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors.

## What this is

A Gladys Assistant **external integration** of type `provider` (no device):
a Node.js service (Node 22+, ESM, no build step) in its own sandboxed Docker
container, talking to Gladys through `@gladysassistant/integration-sdk`
(v0.15). It reads a **Todoist** account through the official API v1
(`api.todoist.com/api/v1`, a personal API token) and puts the tasks on the
dashboard (a widget with check-off buttons and an add form) and in the
scenes (actions add, complete, read; triggers task due, task added, task
completed). Unofficial: not affiliated with Doist. Same shape as
`gladys-bring` (a list-based provider by the same author).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js               SDK wiring only (handlers registered before connect())
src/app.js             TodoistApp: lifecycle, sync loop, due tick, own changes,
                       scene actions, widget, test button
src/todoist/client.js  the API client: Bearer token, endpoints, the request
                       budget (sliding 15-minute windows), TodoistError
src/todoist/model.js   Todoist JSON -> tasks / projects / account, the sync
                       merge, pages (pure; every Todoist field name is here)
src/tasks.js           due instants, overdue, sorting, local filter, lookups,
                       texts, applyOwnChange (pure)
src/time.js            wall times in an IANA time zone, no library (pure)
src/triggers.js        syncs -> task added / completed, clock -> task due (pure)
src/widget.js          the "tasks" widget (pure)
src/config.js          config_schema normalized (DEFAULTS, BOUNDS), fingerprint
src/constants.js       endpoint, pacing, limits, manifest keys
src/i18n.js            runtime texts (en/fr)
src/http.js            the only network access (fetch, timeout, User-Agent)
test/fixtures/         a full sync shaped after the v1 documentation; the 401
                       answers and the 410 of the retired REST v2 are real
test/helpers/          a fake Todoist (versioned account, incremental sync,
                       pagination), fake timers; Gladys is the SDK's fake
```

## Rules

- **Unofficial.** Every user-facing surface says "unofficial connector, not
  affiliated with Doist". Never use the Todoist logo or its red check mark.
- **Keys are forever**: the manifest keys (`src/constants.js`), the trigger
  field and variable keys, the priority values `p1` to `p4`, the action
  output keys and the widget setting keys (`filter`, `project`) are stored in
  user scenes and dashboards. Never rename them. The widget button keys
  (`add`, `complete_1` to `complete_3`, `complete_pick`) are stored nowhere
  but stay stable.
- **The token is a secret**: sent only in the `Authorization` header to
  `api.todoist.com`, never in a URL, a log line, an error or a status. The
  sync `user` object carries the token and the email too: `userOf` keeps the
  time zone, the language and the Inbox id only.
- **A refused token is final** (`TodoistError.final`): nothing more is sent
  until the configuration changes; Todoist's `retry_after` on a 401 is
  ignored, as its documentation says.
- **Be polite with Todoist: the published limits.** Per user and per 15
  minutes: 1000 partial syncs, 100 full syncs ("Request limits"); the REST
  endpoints publish no figure and are counted in the same window. The client
  keeps to half of each (`RATE_LIMITS`: 500 requests, 50 full syncs) and
  refuses a call before it leaves beyond that; a 429 pauses every call for
  `retry_after` (60 s without it, 15 minutes at most). In practice:
  - start: one full sync (`*`); a reconnection to Gladys with the same
    configuration resumes with an incremental one (the store and the memory
    of the triggers stay; the sync token lives in memory only);
  - every `poll_minutes` (2 by default, never below 1) while `watch_tasks`:
    one incremental sync (`items`, `projects`, `user`); about 7 requests per
    15 minutes;
  - a change made through Gladys: the write (`POST tasks`, `tasks/quick` or
    `tasks/{id}/close`) and one incremental sync to read it back;
  - the "task due" check: a local minute tick, no request;
  - the widget and the scene actions reuse the store (a sync younger than
    30 s, or than the poll interval for the widget while watching); the
    default filter `today | overdue` is evaluated locally; any other filter
    is one `tasks/filter` read (pages of 200, 5 pages at most), cached a
    minute per filter;
  - a sync token Todoist refuses (400) is replaced by one full sync;
  - the integration cannot know whether a scene uses a trigger: the cheap
    incremental sync keeps running while `watch_tasks` is on (default); off,
    nothing runs in the background.
- **One event per transition** (`src/triggers.js`): the first reading fires
  nothing. "Task added": a task unknown to the store whose `added_at` is
  after the previous sync (minus 10 minutes): a reopened task is not new.
  "Task completed": `checked` became true, or `completed_count` grew (a
  recurring task is moved, not checked). "Task due": once per task and due
  instant, when the clock enters (now − grace, now], grace = poll interval +
  1 minute; the dues already passed at the first sync are marked announced,
  a task created after its due time never fires. At most 20 events of a kind
  per reading.
- **No scene loop**: a change made through Gladys is applied to the store
  first (`applyOwnChange`), so the next sync sees no transition for it.
- **Time zone**: due times are read in the time zone of the Todoist account
  (`tz_info.timezone`), never the container's (UTC). A date-only task is
  "due" at `due_hour` (9 by default).
- **Scene matching is equality** (core): the `project` trigger field is the
  project name as Todoist shows it (a provider has no `source` for its own
  lists, so it cannot be a select of the account's projects); `priority` is
  a `multi_select` ("any of these"). Never promise "contains" in a field.
- **The widget budget**: 4 buttons and one key per button. Up to 3 tasks get
  their own check-off button (`complete_N`, the task id in `params`,
  `confirm: true`, works on Gladys 5.1); beyond, the first 2 keep theirs and
  `complete_pick` opens a select of the others; `add` is a form (5.2).
- **Built blind for the reads and the writes**: no Todoist account here. The
  shapes come from the API v1 documentation (saved OpenAPI) and the official
  TypeScript SDK (`@doist/todoist-sdk`); the 401 and 410 answers are real.
  Every Todoist field name lives in `src/todoist/`, so a user report fixes
  one place; `TODO.md` lists what to confirm.
- **Read-only rootfs**: write nothing on disk; the store lives in memory.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag.
- **Changelog**: every user-visible change adds a line under
  `## [Unreleased]` in `CHANGELOG.md`.
- **Manifest texts** are `{ en, fr }` objects; the catalog description holds
  10 to 100 characters per language; `test/manifest.test.js` ties the
  manifest to the code (and `test/app.test.js` the event variables and the
  action outputs to what the code returns).
- **User-facing text** is bilingual, `docs/en.md` and `docs/fr.md` kept in
  sync. Comments explain why, in English.
- **Tests never touch the network** (`installTodoist` replaces `fetch`); the
  widget contents pass the SDK's `validateWidgetContent`.

## CI and pushes

- Group the commits and push **at most once a day**, unless the maintainer
  explicitly asks otherwise: the GitHub Actions quota is limited.
- If every CI job fails in under 2 seconds, the quota is exhausted: it is
  not a bug in the code.
- The Docker image cannot be built in the Claude Code cloud container (no
  network for `apk` inside `docker build`): the CI builds it.

## Checking a field against the real API

The documentation is a single Redoc page embedding the OpenAPI document; the
Sync API is described in its "Sync" tag. With a token:

```bash
T=...   # never commit it
curl -s https://api.todoist.com/api/v1/sync -H "Authorization: Bearer $T" \
  -d sync_token='*' -d resource_types='["items","projects","user"]' | python3 -m json.tool | less
curl -s 'https://api.todoist.com/api/v1/tasks/filter?query=today%20%7C%20overdue' -H "Authorization: Bearer $T"
```

Anonymize an answer (ids, names, contents, email, token, avatars) before it
becomes a fixture.

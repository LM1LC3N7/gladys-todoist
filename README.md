# gladys-todoist

[Gladys Assistant](https://gladysassistant.com) external integration for
**[Todoist](https://www.todoist.com/)**: today's tasks on the dashboard, add
and complete tasks from scenes, scene triggers "task due", "task added" and
"task completed". **Unofficial, not affiliated with Doist.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (TodoistApp)
                 ├─ src/todoist/client.js   sync, filter, add, quick add, close; the request budget
                 ├─ src/todoist/model.js    Todoist JSON -> tasks, projects, account; sync merge (pure)
                 ├─ src/tasks.js            due instants, sorting, lookups, own changes (pure)
                 ├─ src/triggers.js         readings -> scene events (pure)
                 └─ src/widget.js           the tasks widget (pure)
```

- **Account**: the personal API token (a `secret` field), sent to Todoist
  only, in the `Authorization` header. Todoist API v1
  (`api.todoist.com/api/v1`), the one that replaced REST v2 and Sync v9.
- **Reading**: one full `/sync` at start, then an incremental one (the
  `sync_token` of the previous answer) every 2 minutes while the tasks are
  watched, and right after a change made through Gladys. The default filter
  `today | overdue` is evaluated on the synced tasks; any other filter goes
  to `tasks/filter` (cursor pagination), cached a minute.
- **Pacing**: Todoist publishes 1000 incremental and 100 full syncs per user
  and per 15 minutes; the client counts every request in a sliding window,
  keeps to half of each, and pauses on a 429 for `retry_after`.
- **Triggers**: "task added" and "task completed" compare two consecutive
  syncs (a recurring completion is seen by its `completed_count`); "task
  due" is a local minute tick on the synced tasks, in the time zone of the
  Todoist account. The first reading fires nothing, and the changes made
  through Gladys fire nothing either.
- **Widget**: the tasks with their priority colour, due time and overdue
  mark, a check-off button per task (three at most, the vocabulary allows 4
  buttons) or a "Check off…" form, and an "Add" form.

Webhooks would need an OAuth app registered with Doist: out of scope, the
incremental sync is cheap enough.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npx github:GladysAssistant/integration-store .  # store admission checks
```

The fixtures in `test/fixtures/` are shaped after the API v1 documentation;
the error answers (401, and the 410 of the retired REST v2) are real.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0. Todoist is a trademark of Doist.

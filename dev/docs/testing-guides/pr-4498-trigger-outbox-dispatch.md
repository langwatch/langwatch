# PR #4498 testing guide — trigger outbox dispatch, Liquid templating, email caps

Branch: `feat/trigger-outbox-dispatch` → `main`.
ADRs: 026, 027, 028, 029, 030, 031, 035.

## What shipped

Trigger notifications (email + Slack) and persist-class actions
(`ADD_TO_DATASET`, `ADD_TO_ANNOTATION_QUEUE`) now go through a
transactional outbox on the event-sourcing GroupQueue instead of
firing in-line from the reactor. Authors get a staged automations
drawer to build the trigger + a Monaco-Liquid template editor for
email + Slack; every dispatch pays a `traceDebounceMs` settle window
first (so datasets get the settled trace, not the half-formed one),
respects per-project and per-recipient email caps, and gets audited
in the `ReactorOutbox` PG table.

## Env vars & feature flags

The outbox itself is **always on** — no feature flag. The old cron
`handleSendEmail` / `handleSendSlackMessage` still exists and runs for
un-flagged projects only via the graph-triggers path (see PR #5013);
notify + persist dispatch for trace/eval triggers rides the outbox
unconditionally.

| Setting | Purpose | Default | Notes |
|---|---|---|---|
| `BASE_HOST` | Rendered into email deep links and unsubscribe URLs. Outbox setup throws at boot if unset. | (required) | Must be a fully-qualified URL, no trailing slash. |
| `TRIGGER_EMAIL_HOURLY_CAP` | Per-`(project, trigger)` hourly cap in the dispatcher's cadence stage. Over-cap → dispatcher drops the send with `logger.error` and audit row `dropped: over trigger-email cap`. | `100` | Immediate-cadence triggers are the only realistic case that reaches this cap. |
| `TRIGGER_EMAIL_TENANT_DAILY_CAP` | Per-project daily total (counts *recipients*, not dispatches). Over-cap → drop with `logger.warn` and audit row `dropped: over project daily email cap`. | `10000` | Backstop for many-immediate-triggers projects. |
| `FEATURE_FLAG_FORCE_ENABLE=release_ui_ai_gateway_menu_enabled` | Unrelated to this PR. Listed only because a project sidebar without it may hide surfaces some QAs expect to see. | on by default in registry | Ignore unless the sidebar looks wrong. |

The outbox lives under `processRole === "worker"` only. In `pnpm dev`
that's the workers concurrent process; if you're running the app
without workers, the outbox never drains and nothing dispatches.
Watch the worker startup log for `outbox runtime attached`.

## Setup

```bash
make quickstart all-local          # local CH + PG + Redis + app + workers
pnpm dev                            # from langwatch/
```

- `pnpm prisma migrate deploy` runs automatically inside `all-local`;
  if you run migrations by hand, this PR adds the `ReactorOutbox`
  table + enum, and adds nullable `notificationCadence`,
  `traceDebounceMs`, `emailSubjectTemplate`, `emailBodyTemplate`,
  `slackTemplate`, `slackTemplateType` columns to `Trigger`.
- No ClickHouse migrations in this PR.
- Test tenant prep: log in, create/pick a project, ingest at least
  3 traces (any SDK will do — the collector docs' python quickstart
  works). Set an SMTP/SES config or use MailHog / a catch-all inbox
  for the email tests.

## Golden path — happy flow

### 1. Author a trigger through the new drawer

1. Log in → open the project → sidebar → **Automations**.
2. Click **+ New automation** (top-right).
3. **Type stage**: pick **Alert on traces**. Click through.
4. **Conditions stage**: filter on any facet (e.g. `has_error = true`).
   Save. The staged drawer keeps you inside the same automation until
   you Confirm each stage.
5. **Cadence stage**: leave at `immediate` for now. Verify the summary
   shows "1 message per trace" and Save unlocks (the drawer must not
   let you save with cadence unconfirmed — regression trap below).
6. **Type stage** (return): pick **Send email**. Enter your test address.
7. **Template stage**: leave the default template. Click **Preview** —
   should render actual sample data from the last matching trace.
8. Save. Row lands in the automations list with a "Type: Send email"
   column and "immediate" cadence.

### 2. Fire the trigger

1. Ingest a matching trace (send one with the SDK, or replay one from
   the trace explorer).
2. Wait `traceDebounceMs` (default 30s) — during this window the
   dispatcher is holding a `settle` row in `ReactorOutbox`.
3. Email arrives with a Markdown → HTML body rendered from the Liquid
   template. Deep links point at `${BASE_HOST}/…`.

### 3. Test-fire from the drawer

1. Automations → row → **Test-fire**.
2. Recipient list is NOT accepted — the server always sends to the
   authenticated session user's email (ADR-031 §1). The UI shouldn't
   even show a recipient field.
3. A Slack test-fire only sends to the trigger's own webhook URL, and
   only if the URL matches `https://hooks.slack.com/`.

### 4. Persist-class action (ADR-035)

1. Add a second automation on the same conditions, type
   **Add to dataset**, target any dataset.
2. Ingest a matching trace.
3. **Wait the debounce window (default 30s)**.
4. Dataset row appears with the fully-settled trace — inputs, outputs,
   metadata all present. The row's content matches what the trace
   explorer shows a minute later.

### 5. Slack Block Kit

1. Author a **Send Slack message** trigger, template type
   **Block Kit**. Pick a preset (`trace_alert_compact`, `one_liner`,
   `digest_compact`, `digest_evaluator_rollup`, `digest_inline_rich`,
   or `eval_failure_detailed`).
2. Save. Fire. Slack post lands rendered — no literal `&amp;`
   artefacts in `M&Ms`-style names (regression trap below).

## Regression traps — what to specifically re-verify

The multi-agent audits during this cycle found and fixed the following.
Each one is a real bug that shipped in a prior draft; re-verify the
positive behaviour is present.

- **Outbox runtime actually attaches.** Worker boot must log
  `outbox runtime attached` before the first dispatch. If it never
  logs, the runtime failed to wire — every enqueue silently fails
  closed at `eventSourcing.ts:508` in prod. Sanity-check on any fresh
  worker deploy.
- **Persist action goes through settle first.** Add-to-dataset must
  NOT fire inline on the first matching event. Add a trigger with
  `traceDebounceMs = 30000`, ingest a trace, verify the dataset row
  appears ~30s later (not immediately) and contains the settled
  content. If it fires inline you'll see truncated `input` /
  `output` on the row.
- **Persist retry does not silently swallow.** Simulate a transient
  dataset write failure (bump `datasets.appendRows` to throw once)
  and verify the outbox retries — `ReactorOutbox` row moves through
  `pending → dispatching → failed → pending → dispatched`. The
  `TriggerSent` claim must be written **after** the dispatch
  succeeds, not before; if you see claim on failed rows the retry is
  silently suppressed.
- **Non-retryable errors dead-letter.** Author a Slack trigger with a
  bogus webhook (not on `hooks.slack.com`). Fire. Expected: single
  `DispatchError(retryable: false)`, row moves straight to
  `dead-letter`. If the queue retries, `categorizeError` regressed.
- **Liquid engine budget-limited.** Paste a hostile template into the
  Monaco editor (any looped construct with `renderLimit`-bustable
  size — `{% for _ in (0..1000) %}{% for _ in (0..1000) %}…{% endfor %}{% endfor %}`).
  Save. Preview should error out on the render budget, NOT hang the
  browser or server. Regression = "server thread stuck rendering."
- **Test-fire cannot spam.** In the drawer, try to construct a URL
  hitting `testFireTemplate.webhook` with a non-Slack webhook. Server
  rejects — Zod validates `https://hooks.slack.com/` prefix; defence
  in depth in `triggerNotifier` + `sendSlackWebhook`.
- **Slack templates render entity-clean.** In a trace with input
  containing `M&Ms` or `foo & bar`, verify the Slack post shows
  literally `M&Ms`, NOT `M&amp;Ms`. Slack mrkdwn does not decode HTML
  entities; the P0 sweep stripped the erroneous `| replace: "&", "&amp;"` chains
  from all 6 bundled templates.
- **Image blocks blocked in Slack templates.** Save a Block Kit
  template containing `{ "type": "image", ... }`. Monaco lints it as
  a schema violation; server also strips images at dispatch (Slack
  image blocks are a tracking-pixel vector, banned to match the
  markdown sanitizer's `<img>` ban). Same for nested
  `context.elements[]` — server recursively strips non-text elements.
- **`onCheckedChange` on Switch.** In the automations drawer, toggle
  the trigger's "Active" switch. It must actually flip — this
  regressed once because `~/components/ui/switch` explicitly
  `Omit`s `onChange`.
- **`filters` is an object.** In the DB, `Trigger.filters` must be
  a JSON object `{}`, NEVER the string `"{}"`. Query:

  ```sql
  SELECT id, filters, jsonb_typeof(filters) FROM "Trigger" WHERE ...;
  ```

  `jsonb_typeof` must return `object`; if it says `string` you've
  regressed the graph-alert-builder SSOT (relevant to PR #5015).
- **Cadence stage unconfirmed blocks Save.** Open the drawer on a
  brand-new automation. Do not visit the Cadence stage. Try to save.
  Save button says "review the cadence" and stays disabled.
- **`BASE_HOST` unset explodes at boot.** Comment `BASE_HOST` out of
  `.env`, restart workers. Boot fails with a loud error, NOT a silent
  "email links go nowhere" scenario.
- **Email hourly cap trips.** Set `TRIGGER_EMAIL_HOURLY_CAP=3`. Fire
  4 matching traces on an immediate-cadence trigger. Fourth email is
  DROPPED — audit row logs `dropped: over trigger-email cap` at
  `error` level. Redis key
  `trigger-email-cap:{projectId}:{triggerId}:{hourFloor}` = 3.
- **Project daily cap trips.** Set `TRIGGER_EMAIL_TENANT_DAILY_CAP=5`.
  Two triggers, 3 recipients each, fire twice. Second batch of 6
  drops with `dropped: over project daily email cap` at `warn` level.
- **Unsubscribe deep link works.** Open one of the sent emails. Click
  the unsubscribe link. Land on `/unsubscribe?token=…` without
  needing to log in. Suppress the recipient. Fire the trigger again;
  that recipient is NOT included in the outgoing send.

## Rollback plan

There is no flag to disable — the outbox is unconditional for
notify + persist dispatch on trace/eval triggers. Rollback is:

1. Redeploy the previous image.
2. `ReactorOutbox` table + enum + the new `Trigger` columns are inert
   under the old code. Migrations are additive; no down migration.
3. Any pending outbox rows sit until the new image ships again.
4. Cron-based graph-trigger send-email / send-slack paths were NOT
   touched by this PR — they keep running for un-flagged projects
   under PR #5013's flag.

## Failure modes to alert on

- Sentry: `DispatchError` with `retryable: true` looping past 5
  attempts on the same `(reactorName, dedupKey)` → dead-letter is
  fine, but a stuck loop = queue retry decision regressed.
- Sentry: `outbox runtime not attached` at worker boot → PR-4498
  hoist regressed. Redeploy or hotfix immediately.
- CloudWatch: `column does not exist` on any `Trigger.*` column →
  a worker deployed ahead of the DB migration.
- Grafana / metrics: `ReactorOutbox` row age p99 climbing past
  `traceDebounceMs + 60s` → drainer stalled or leased-lock stuck.
- CloudWatch grep: `dropped: over trigger-email cap` at high rate on
  a single trigger → real abuse or a mis-configured customer;
  investigate the trigger, don't just bump the cap.
- CloudWatch grep: `dropped: over project daily email cap` → same,
  scoped to the whole project.
- Sentry: `LIQUID_RENDER_TIMEOUT` at high rate → someone shipped a
  hostile template through the editor; the render boundary caught
  it but the author needs a nudge.
- CloudWatch grep: `TriggerSent` unique violations after retries →
  the claim-post-dispatch ordering regressed.

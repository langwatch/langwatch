# PR #4498 testing guide — trigger outbox dispatch, Liquid templating, email caps

Branch: `feat/trigger-outbox-dispatch` → `main`. ADRs: 026, 027, 028, 029, 030, 031, 035.

## What shipped

Trigger notifications (email + Slack) and persist-class actions
(`ADD_TO_DATASET`, `ADD_TO_ANNOTATION_QUEUE`) now go through a
transactional outbox on the event-sourcing GroupQueue instead of firing
in-line from the reactor. Authors get a staged automations drawer plus a
Monaco-Liquid template editor for email + Slack. Every dispatch pays a
`traceDebounceMs` settle window first (so datasets get the settled trace,
not the half-formed one), respects per-project and per-recipient email
caps, and is audited in the `ReactorOutbox` PG table.

## Env vars & feature flags

The outbox is **always on** — no feature flag. The old cron
`handleSendEmail` / `handleSendSlackMessage` still runs for un-flagged
projects only via the graph-triggers path (see PR #5013); notify +
persist dispatch for trace/eval triggers rides the outbox
unconditionally.

| Setting | Purpose | Default | Notes |
|---|---|---|---|
| `BASE_HOST` | Rendered into email deep links and unsubscribe URLs. Outbox setup throws at boot if unset. | (required) | Fully-qualified URL, no trailing slash. |
| `TRIGGER_EMAIL_HOURLY_CAP` | Per-`(project, trigger)` hourly cap in the cadence stage. Over-cap → drop with `logger.error`, audit row `dropped: over trigger-email cap`. | `100` | Only immediate-cadence triggers realistically reach this. |
| `TRIGGER_EMAIL_TENANT_DAILY_CAP` | Per-project daily total (counts *recipients*, not dispatches). Over-cap → drop with `logger.warn`, audit row `dropped: over project daily email cap`. | `10000` | Backstop for many-immediate-triggers projects. |
| `FEATURE_FLAG_FORCE_ENABLE=release_ui_ai_gateway_menu_enabled` | Unrelated to this PR; a sidebar without it may hide surfaces some QAs expect. | on by default | Ignore unless the sidebar looks wrong. |

The outbox lives under `processRole === "worker"` only — in `pnpm dev`
the workers process. Without workers the outbox never drains and nothing
dispatches. Watch the worker startup log for `outbox runtime attached`.

## Setup

```bash
make quickstart all-local          # local CH + PG + Redis + app + workers
pnpm dev                            # from langwatch/
```

- `prisma migrate deploy` runs automatically inside `all-local`. This PR
  adds the `ReactorOutbox` table + enum, and nullable
  `notificationCadence`, `traceDebounceMs`, `emailSubjectTemplate`,
  `emailBodyTemplate`, `slackTemplate`, `slackTemplateType` columns on
  `Trigger`. No ClickHouse migrations.
- Test tenant prep: log in, pick a project, ingest ≥3 traces (any SDK).
  Set an SMTP/SES config or use MailHog / a catch-all inbox for email
  tests.

## Golden path — happy flow

### 1. Author a trigger through the new drawer

1. Log in → project → sidebar → **Automations** → **+ New automation**.
2. **Type stage**: pick **Alert on traces**. Click through.
3. **Conditions stage**: filter on any facet (e.g. `has_error = true`),
   Save. The staged drawer keeps you in the same automation until you
   Confirm each stage.
4. **Cadence stage**: leave at `immediate`. Summary shows "1 message per
   trace"; Save unlocks (must not save with cadence unconfirmed —
   regression trap below).
5. **Type stage** (return): pick **Send email**, enter your test address.
6. **Template stage**: leave the default. **Preview** should render
   actual sample data from the last matching trace.
7. Save. Row lands with a "Type: Send email" column and "immediate"
   cadence.

### 2. Fire the trigger

1. Ingest a matching trace (SDK, or replay from the trace explorer).
2. Wait `traceDebounceMs` (default 30s) — the dispatcher holds a `settle`
   row in `ReactorOutbox` during this window.
3. Email arrives, Markdown → HTML body rendered from the Liquid template.
   Deep links point at `${BASE_HOST}/…`.

### 3. Test-fire from the drawer

1. Automations → row → **Test-fire**.
2. Recipient list is NOT accepted — the server always sends to the
   authenticated session user's email (ADR-031 §1). The UI shouldn't show
   a recipient field.
3. A Slack test-fire only sends to the trigger's own webhook URL, and
   only if it matches `https://hooks.slack.com/`.

### 4. Persist-class action (ADR-035)

1. Add a second automation on the same conditions, type **Add to
   dataset**, any dataset target.
2. Ingest a matching trace. **Wait the debounce window (default 30s)**.
3. Dataset row appears with the fully-settled trace — inputs, outputs,
   metadata all present, matching what the trace explorer shows a minute
   later.

### 5. Slack Block Kit

1. Author a **Send Slack message** trigger, template type **Block Kit**.
   Pick a preset (`trace_alert_compact`, `one_liner`, `digest_compact`,
   `digest_evaluator_rollup`, `digest_inline_rich`, or
   `eval_failure_detailed`).
2. Save. Fire. Slack post lands rendered — no literal `&amp;` artefacts
   in `M&Ms`-style names (regression trap below).

## Regression traps — what to specifically re-verify

Each is a real bug that shipped in a prior draft; confirm the positive
behaviour is present.

- **Outbox runtime actually attaches.** Worker boot must log
  `outbox runtime attached` before the first dispatch. If it never logs,
  every enqueue silently fails closed at `eventSourcing.ts:508`.
  Sanity-check on any fresh worker deploy.
- **Persist action goes through settle first.** With
  `traceDebounceMs = 30000`, ingest a trace; the dataset row must appear
  ~30s later (not immediately) with settled content. Inline firing shows
  truncated `input` / `output`.
- **Persist retry does not silently swallow.** Bump `datasets.appendRows`
  to throw once; the outbox must retry — `ReactorOutbox` row moves
  `pending → dispatching → failed → pending → dispatched`. The
  `TriggerSent` claim must be written **after** dispatch succeeds; a claim
  on failed rows means the retry is silently suppressed.
- **Non-retryable errors dead-letter.** Author a Slack trigger with a
  bogus webhook (not on `hooks.slack.com`). Fire. Expected: single
  `DispatchError(retryable: false)`, row goes straight to `dead-letter`.
  A retry means `categorizeError` regressed.
- **Liquid engine budget-limited.** Paste a `renderLimit`-bustable loop
  (`{% for _ in (0..1000) %}{% for _ in (0..1000) %}…{% endfor %}{% endfor %}`)
  into Monaco. Save. Preview must error on the render budget, NOT hang
  the browser or server.
- **Test-fire cannot spam.** Construct a URL hitting
  `testFireTemplate.webhook` with a non-Slack webhook — server rejects
  (Zod validates the `https://hooks.slack.com/` prefix; defence in depth
  in `triggerNotifier` + `sendSlackWebhook`).
- **Slack templates render entity-clean.** With input containing `M&Ms`
  or `foo & bar`, the Slack post shows literally `M&Ms`, NOT `M&amp;Ms`.
  Slack mrkdwn does not decode HTML entities; the P0 sweep stripped the
  `| replace: "&", "&amp;"` chains from all 6 bundled templates.
- **Image blocks blocked in Slack templates.** Save a Block Kit template
  with `{ "type": "image", ... }`. Monaco lints it; server also strips
  images at dispatch (tracking-pixel vector, matching the markdown
  sanitizer's `<img>` ban). Same for nested `context.elements[]` non-text
  elements.
- **`onCheckedChange` on Switch.** Toggle the trigger's "Active" switch —
  it must flip. Regressed once because `~/components/ui/switch` explicitly
  `Omit`s `onChange`.
- **`filters` is an object.** `Trigger.filters` must be JSON object `{}`,
  NEVER string `"{}"`. `SELECT id, filters, jsonb_typeof(filters) FROM
  "Trigger" WHERE ...;` must return `object`; `string` regressed the
  graph-alert-builder SSOT (relevant to PR #5015).
- **Cadence stage unconfirmed blocks Save.** On a brand-new automation,
  skip the Cadence stage and try to save — button says "review the
  cadence" and stays disabled.
- **`BASE_HOST` unset explodes at boot.** Comment it out of `.env`,
  restart workers. Boot fails loudly, NOT a silent "email links go
  nowhere".
- **Email hourly cap trips.** `TRIGGER_EMAIL_HOURLY_CAP=3`, fire 4
  matching traces on an immediate trigger. Fourth email DROPPED — audit
  `dropped: over trigger-email cap` at `error`. Redis key
  `trigger-email-cap:{projectId}:{triggerId}:{hourFloor}` = 3.
- **Project daily cap trips.** `TRIGGER_EMAIL_TENANT_DAILY_CAP=5`, two
  triggers × 3 recipients fire twice. Second batch of 6 drops with
  `dropped: over project daily email cap` at `warn`.
- **Unsubscribe deep link works.** Open a sent email, click unsubscribe,
  land on `/unsubscribe?token=…` without logging in. Suppress the
  recipient. Fire again; that recipient is NOT in the send.

## Rollback plan

No flag to disable — the outbox is unconditional for notify + persist on
trace/eval triggers. Rollback:

1. Redeploy the previous image.
2. `ReactorOutbox` table + enum + new `Trigger` columns are inert under
   old code. Migrations are additive; no down migration.
3. Pending outbox rows sit until the new image ships again.
4. Cron-based graph-trigger send paths were NOT touched — they keep
   running for un-flagged projects under PR #5013's flag.

## Failure modes to alert on

- Sentry: `DispatchError` `retryable: true` looping past 5 attempts on
  the same `(reactorName, dedupKey)` → dead-letter is fine, a stuck loop
  = queue retry decision regressed.
- Sentry: `outbox runtime not attached` at worker boot → PR-4498 hoist
  regressed. Redeploy or hotfix immediately.
- CloudWatch: `column does not exist` on any `Trigger.*` column → a
  worker deployed ahead of the DB migration.
- Grafana: `ReactorOutbox` row age p99 past `traceDebounceMs + 60s` →
  drainer stalled or leased-lock stuck.
- CloudWatch grep: `dropped: over trigger-email cap` at high rate on one
  trigger → real abuse or mis-config; investigate, don't just bump the
  cap.
- CloudWatch grep: `dropped: over project daily email cap` → same, whole
  project.
- Sentry: `LIQUID_RENDER_TIMEOUT` at high rate → a hostile template got
  through; the render boundary caught it but the author needs a nudge.
- CloudWatch grep: `TriggerSent` unique violations after retries → the
  claim-post-dispatch ordering regressed.

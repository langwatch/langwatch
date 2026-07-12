# PR #5015 testing guide — graph alerts in the automations drawer + Liquid templates (ADR-034 Phases 5.1 / 5.2 / 8 / 8.1)

Branch: `pr/06-graph-alerts-ui-templates`. Stacked on PR #5014 — merge it first.

## What shipped

The user-facing layer of the graph-trigger migration (ADR-034), plus
four features the branch grew after: scheduled reports + the
`ScheduledJob` scheduler (ADR-044), the facet-shaped automations drawer
and trace-query subjects (ADR-043), the Block Kit template suite + Slack
bot-token delivery (ADR-040 / ADR-041), and outbox payload slimming that
stopped customer trace content landing in `ReactorOutbox.payload`.

- **Phase 5.1.** Automations drawer supports graph-threshold alerts.
  `automation.upsert` accepts a discriminated `graphAlert` sub-shape when
  `customGraphId` is set; restricts action to `SEND_EMAIL` /
  `SEND_SLACK_MESSAGE`; validates `customGraphId` belongs to the project.
  The `Trigger` row is the exact shape `graphs.updateById` writes today —
  shared `buildGraphAlertTriggerData` SSOT. List view gets a "Type"
  column and a "Graph: {name}" summary; edit hydrates the threshold rule
  from `actionParams`. `TypePicker` disables `ADD_TO_DATASET` /
  `ADD_TO_ANNOTATION_QUEUE` cards when source is `customGraph`.
- **Phase 5.2 + 8.** Dashboard chart-card **Add alert** button and the
  `/analytics/custom` page's two callsites repoint to the automations
  drawer, pre-filled with `prefilledGraphId` and `prefilledSeriesName`
  (canonical `{index}/{key|metric}/{aggregation}`). Shared
  `deriveSeriesIdentifier` keeps the entry points from drifting.
- **Phase 8.1.** Graph-trigger dispatch routes through Liquid templates
  instead of the cron's hardcoded `handleSendEmail` /
  `handleSendSlackMessage`. New `GraphAlertTemplateContext` (`trigger` /
  `graph` / `metric` / `condition` / `currentValue` / `occurredAt` /
  `reason` / `project`; `operatorLabel` + `timePeriodLabel` resolved).
  Per-trigger Monaco templates override the alert defaults. See
  [ADR-036](../adr/036-liquid-templates-for-trigger-notifications.md) and
  [specs/triggers/event-sourced-graph-triggers.feature](../../../specs/triggers/event-sourced-graph-triggers.feature).

The legacy `AlertDrawer` component was DELETED — the automations drawer
is the only graph-alert authoring surface.

## Env vars & feature flags

**No new flags.** Graph-alert authoring is on for all drawer users.
Dispatch through Liquid templates is on the same per-project switch from
PR #5013.

| Flag | Purpose | Set to enable NEW flow | Set to keep OLD flow |
|---|---|---|---|
| `release_es_graph_triggers_firing` | Required for graph alerts authored here to fire via the Liquid dispatch path. OFF → cron fires them via the pre-Liquid hardcoded format. The drawer flow surfaces authoring; this flag controls firing. | PostHog ON. Local: `FEATURE_FLAG_FORCE_ENABLE=release_es_graph_triggers_firing`. | Default OFF. Cron fires with pre-Liquid formats. |

To fully test THIS PR's dispatch path (Liquid templates + graph-alert
context), both must be true: (1) author the graph alert via the
automations drawer (always available); (2) project has
`release_es_graph_triggers_firing` ON. Only 1 still gives a
correctly-persisted `Trigger` row; the cron renders it with its
hardcoded format until the flag flips.

## Setup

```bash
make quickstart all-local          # local CH + PG + Redis + app + workers
pnpm dev                            # from langwatch/
```

- All prior PR migrations must be applied (PR #4498's `ReactorOutbox`
  + Trigger columns; PR #5012/#5014's slim + rollup tables).
- **This PR ships one consolidated Postgres migration,**
  `20260712000000_reports_scheduler_and_trigger_facets`. Run
  `prisma migrate deploy` before testing. It carries:
  - The `ScheduledJob` table (backs the reports scheduler), incl. retry
    columns `attempts` (NOT NULL default 0) and nullable `lastError`.
  - The `TriggerKind` enum + a NOT NULL `Trigger.triggerKind` column,
    **with a data backfill** (`UPDATE "Trigger" SET "triggerKind" =
    'ALERT' WHERE "customGraphId" IS NOT NULL`).
  - A nullable `Trigger.filterQuery` column.
  - A nullable `TriggerSent.openIncidentKey` column with a single-column
    unique index (the atomic open-incident claim for graph alerts).
- Test tenant prep: one project with `release_es_graph_triggers_firing`
  ON, one dashboard with a custom-graph chart. Have an email you can
  inbox and a Slack webhook you can watch.

## Golden path — happy flow

### 1. End-to-end graph alert from the drawer

1. Log in → project → sidebar → **Automations** → **+ New automation**.
2. **Type stage**: pick **Alert on graph threshold**.
3. **Conditions stage**: pick a custom graph and a series (dropdown
   labelled `{index}/{key|metric}/{aggregation}`). Set operator = `gt`,
   threshold = `100`, time period = `15` minutes.
4. **Cadence stage**: leave at `immediate`, confirm.
5. **Type stage** (return): pick **Send email**, enter address.
6. **Template stage**: leave the alert-default. Preview should render
   `{{ metric.label }}`, `{{ currentValue }}`, and the chart deep link.
7. Save.

Verify the `Trigger` row in Postgres:

```sql
SELECT id, name, action, "customGraphId",
       jsonb_typeof(filters) AS filters_type,
       "actionParams" ->> 'threshold' AS threshold
FROM "Trigger" WHERE ...;
```

Expected:
- `name` = exactly what you typed, with any legacy `Alert:` prefix
  stripped (the Type column already labels the row a Graph alert).
- `customGraphId` populated.
- `filters_type` = `object`. **Never `string`.** (Regression trap.)
- `threshold` matches what you set.

### 2. Dashboard "Add alert" button

1. Open a dashboard containing the chart card. Click **Add alert**.
2. Automations drawer opens with `prefilledGraphId` = the chart's graph
   id, and the first series pre-selected and LOCKED.
3. Save. Row written with the SSOT builder.

### 3. Standalone `/analytics/custom` page

1. Navigate to `/<project>/analytics/custom`.
2. Two callsites — saved reports and the ad-hoc chart — both **Add
   alert** buttons route through the automations drawer with pre-fill.

### 4. Editing an existing alert hydrates

1. From the automations list, click a graph-alert row → Edit.
2. Threshold rule (`operator`, `threshold`, `timePeriod`, `seriesName`)
   hydrates from `actionParams`. Not blank, not defaulted.
3. Change a value, save. Updated via the same SSOT builder — no drift
   between create + update paths.

### 5. Custom Liquid template on a graph alert

1. Edit a graph alert; open the template editor.
2. Author a template using the new context: `{{ trigger.name }}`,
   `{{ metric.label }}`, `{{ condition }}`, `{{ currentValue }}`,
   `{{ occurredAt }}`, `{{ reason }}`, `{{ operatorLabel }}`,
   `{{ timePeriodLabel }}`, `{{ project.slug }}`.
3. Preview renders live. Save.
4. With `release_es_graph_triggers_firing` ON, fire the alert (breach
   the metric). Email / Slack post uses YOUR template, not the default.

### 6. Persist actions blocked for graph alerts

1. Author a new graph alert. On the Type stage, confirm the Action group
   (`ADD_TO_DATASET` / `ADD_TO_ANNOTATION_QUEUE`) is not rendered — graph
   alerts only show the Notify group.
2. Server-side gate: smuggle one through in the wire payload and
   `automation.upsert` throws `BAD_REQUEST` when `customGraphId` is set.

### 7. Scheduled report, end to end (ADR-044)

1. Create a report from the drawer: pick a dashboard or a trace query as
   subject, a cadence, and a delivery channel.
2. Confirm a `ScheduledJob` row appears with `targetType = 'REPORT'` and
   a `nextRunAt` matching the cadence in the project's timezone.
3. Wait for (or hand-advance `nextRunAt` to) the slot; confirm the report
   is delivered exactly once, with real tables/charts.
4. **Pause the report.** Confirm the `ScheduledJob` goes inactive and the
   list stops ticking a next-run. Re-enable and confirm it comes back.
5. **Edit the saved report.** Confirm the drawer hydrates it as a report
   (subject, cadence, topN all return) and that saving does not silently
   convert it into a trace automation.
6. Confirm a report does **not** notify on every ingested trace: send
   traffic and confirm the channel stays quiet until its slot.
7. Reject bad cadences: an unparseable cron and a sub-15-minute cadence
   must both fail at save with a clear message, leaving no active report.

### 8. Slack bot-token delivery (ADR-040 / ADR-041)

1. Connect the Slack app, author an alert with bot delivery, pick a
   channel from the picker (verify it lists a real workspace's channels,
   not an empty list).
2. Fire it; confirm it posts via `chat.postMessage`, rendering the Block
   Kit layout.
3. **With `release_es_graph_triggers_firing` OFF** (the shipped default),
   confirm a bot-delivery graph alert still delivers via the cron path,
   and a failed delivery does not mark the alert "currently firing".

### 9. Trace-query subjects (ADR-043)

1. Author an automation with a trace-query subject; confirm the live
   "N traces matched" preview agrees with the trace list for the same
   query.
2. Fire it; confirm it matches the same traces the preview showed — in
   particular for an `origin:` filter, where the in-memory dispatch
   evaluator and the compiled SQL must agree.

### 10. The outbox carries no customer content

After any trace automation fires, inspect the project's `ReactorOutbox`
rows and confirm no payload contains the trace's input or output text —
the payload carries identities (ids) only.

## Regression traps — what to specifically re-verify

- **`filters` is an OBJECT, not a STRING.** The builder writes
  `filters: {}` (Prisma `InputJsonValue`); regression signature is
  `filters: '{}'` (string). `SELECT id FROM "Trigger" WHERE
  jsonb_typeof(filters) = 'string';` must return zero rows. If not, the
  dispatch drift bug is live and filter evaluation explodes or matches
  nothing.
- **Legacy `Alert:` prefix stripped, never re-added.** Save a trigger
  named `alert: cost spike`. Row must read `cost spike` — the builder
  strips a leading `alert:` (`/^\s*alert:\s*/i`). A pre-existing
  `Alert: foo` row cleans up to `foo` on its next save.
- **SSOT builder covers UPDATE too.** `graphs.updateById`'s UPDATE branch
  previously bypassed `buildGraphAlertTriggerData` and wrote an inline
  shape; P0 fix routed it through the builder. Edit an alert via the
  dashboard chart card and compare its `Trigger` row to one edited via
  the drawer — must be byte-identical. Any structural drift = SSOT
  regressed.
- **`createdByUserId` is server-stamped, not client-supplied.** P0 fix
  stripped `input.actionParams.createdByUserId` from the wire schema.
  Intercept the wire payload in devtools, edit `createdByUserId`, send —
  the server unconditionally stamps `ctx.session.user.id` on
  annotation-queue automations, ignoring the wire value.
- **`ADD_TO_DATASET` / `ADD_TO_ANNOTATION_QUEUE` throw on graph alerts,
  don't no-op.** `dispatchGraphAlertAction` used to no-op on
  persist-class (silently dropping the notification); P0 fix throws
  `DispatchError({ retryable: false })` so the row dead-letters. Author a
  graph alert with a persist action (via API bypass), fire it, verify the
  dead-letter message reads "graph alerts don't support persist actions."
- **`BASE_HOST` unset explodes.** Same as PR #4498 — outbox setup throws
  at boot; regression = silent broken deep links in graph-alert emails.
- **`metric.label` header injection stripped.** A series name with `\r\n`
  (CR/LF) must be stripped by `buildGraphAlertTemplateContext` before it
  reaches the email subject. Author an alert with a `\r\n` series name
  (via SQL if needed), fire it — outbound email must be single-line
  subject.
- **Legacy `AlertDrawer` deleted.** Grep the frontend for `AlertDrawer` —
  expect zero component references (only historical comments). A
  reappearing component = deletion regressed.
- **Slack template escape chain is gone.** A graph-alert Slack post with
  a series/graph name containing `&` must render literally `&`, NOT
  `&amp;`. Same P0 as PR #4498, scoped to graph-alert templates.
- **Block Kit `image` blocks blocked.** Save a graph-alert Slack template
  with `{"type":"image",...}` or a nested `context.elements[]` non-text
  element. Monaco flags it; server strips it at dispatch.
- **Switch uses `onCheckedChange`.** Toggle the graph alert's active
  state from the list view. It must actually flip.
- **Analytics/custom page migration.** `analytics/custom/index.tsx` has 2
  broken call sites migrated by the deep-review fix. Load the page — no
  console errors, no red banner; both callsites still route through the
  drawer.

## Rollback plan

1. Flip `release_es_graph_triggers_firing` OFF for affected projects.
   Cron picks up their graph alerts on the next 3-minute tick and
   dispatches with the pre-Liquid format. Drawer-written rows keep
   working — the SSOT builder writes the exact shape the cron handles.
2. To also stop authoring, hide the graph-alert type from the
   `TypePicker`. No flag; a small commit removing the type suffices.
3. Migrations are inert under old code paths. No down migration.
4. The legacy `AlertDrawer` was deleted — if the drawer flow is broken in
   prod, roll back by reverting this PR.

## Failure modes to alert on

- Sentry: `filters is not an object` on trigger dispatch → the
  string-vs-object regression is live; check types with the SQL above.
- Sentry: `BAD_REQUEST` from `automation.upsert` on persist action with
  `customGraphId` set → intentional guard firing; may mean the
  `TypePicker` didn't disable persist cards.
- Grafana / audit table: `ReactorOutbox` graphEval rows in `dead-letter`
  with reason "graph alerts don't support persist actions" →
  mis-configured trigger, alert the customer.
- CloudWatch grep: literal `&amp;` in Slack post content from graph
  alerts → escape chain regressed.
- Sentry: `header injection detected` on outbound trigger emails →
  `metric.label` sanitizer regressed.
- Grafana: authoring-drawer save latency p99 spike → deep-review fix N1
  (SSOT builder routing) was reverted; upsert doing double writes.

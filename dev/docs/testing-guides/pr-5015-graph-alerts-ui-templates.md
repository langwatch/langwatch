# PR #5015 testing guide — graph alerts in the automations drawer + Liquid templates (ADR-034 Phases 5.1 / 5.2 / 8 / 8.1)

Branch: `pr/06-graph-alerts-ui-templates`.
Stacked on PR #5014 — merge PR #5014 first.

## What shipped

The user-facing layer of the graph-trigger migration.

- **Phase 5.1.** The automations drawer supports graph-threshold
  alerts. `automation.upsert` accepts a discriminated `graphAlert`
  sub-shape when `customGraphId` is set; restricts action to
  `SEND_EMAIL` / `SEND_SLACK_MESSAGE`; validates `customGraphId`
  belongs to the project. The `Trigger` row it writes is the exact
  same shape `graphs.updateById` writes today — shared
  `buildGraphAlertTriggerData` SSOT. List view gets a "Type" column
  and a "Graph: {name}" conditions summary; edit hydrates the
  threshold rule from `actionParams`. `TypePicker` disables
  `ADD_TO_DATASET` / `ADD_TO_ANNOTATION_QUEUE` cards when source is
  `customGraph`.
- **Phase 5.2 + 8.** Dashboard chart-card **Add alert** button and the
  standalone `/analytics/custom` page's two callsites are repointed to
  the automations drawer, pre-filled with `prefilledGraphId` and
  `prefilledSeriesName` (canonical `{index}/{key|metric}/{aggregation}`
  identifier). Shared `deriveSeriesIdentifier` helper keeps the entry
  points from drifting.
- **Phase 8.1.** Graph-trigger dispatch now routes through Liquid
  templates instead of the cron's hardcoded `handleSendEmail` /
  `handleSendSlackMessage`. New `GraphAlertTemplateContext` distinct
  from trace context (`trigger` / `graph` / `metric` / `condition` /
  `currentValue` / `occurredAt` / `reason` / `project`;
  `operatorLabel` + `timePeriodLabel` resolved). Per-trigger custom
  templates via Monaco override the alert-default templates.

The legacy `AlertDrawer` is kept registered as an unreachable fallback
per the side-by-side rollout directive — no code path in this PR opens
it.

## Env vars & feature flags

**No new flags.** Graph-alert authoring is on for all users of the
automations drawer. Dispatch through Liquid templates is on the same
per-project switch introduced by PR #5013.

| Flag | Purpose | Set to enable NEW flow | Set to keep OLD flow |
|---|---|---|---|
| `release_es_graph_triggers_firing` | Required for graph alerts authored here to fire via the new Liquid dispatch path. When OFF, the cron still fires them via the pre-Liquid hardcoded format. Same flag from PR #5013 — the drawer flow surfaces authoring, this flag controls firing. | PostHog ON. Local: `FEATURE_FLAG_FORCE_ENABLE=release_es_graph_triggers_firing`. | Default OFF. Cron fires the graph alert with pre-Liquid formats. |

To fully test THIS PR's dispatch path (Liquid templates + graph-alert
context), both must be true:

1. Author the graph alert via the automations drawer (this PR's
   authoring surface — always available).
2. Project has `release_es_graph_triggers_firing` ON (dispatch runs
   through the new outbox-reactor path that renders Liquid).

Only 1 above still gives you a correctly-persisted `Trigger` row; the
cron will render it with its hardcoded format until the flag flips.

## Setup

```bash
make quickstart all-local          # local CH + PG + Redis + app + workers
pnpm dev                            # from langwatch/
```

- All prior PR migrations must be applied (PR #4498's `ReactorOutbox`
  + Trigger columns; PR #5012/#5014's slim + rollup tables).
- Test tenant prep: one project with `release_es_graph_triggers_firing`
  ON, one dashboard with at least one custom-graph chart. Have an
  email address you can inbox and a Slack webhook you can watch.

## Golden path — happy flow

### 1. End-to-end graph alert from the drawer

1. Log in → project → sidebar → **Automations**.
2. Click **+ New automation**.
3. **Type stage**: pick **Alert on graph threshold**.
4. **Conditions stage**: pick a custom graph and a series (dropdown
   labelled `{index}/{key|metric}/{aggregation}`). Set
   operator = `gt`, threshold = `100`, time period = `15` minutes.
5. **Cadence stage**: leave at `immediate`, confirm.
6. **Type stage** (return): pick **Send email**, enter address.
7. **Template stage**: leave the alert-default template. Preview
   should render `{{ metric.label }}`, `{{ currentValue }}`, and the
   deep link to the chart.
8. Save.

Verify the resulting `Trigger` row in Postgres:

```sql
SELECT id, name, action, "customGraphId",
       jsonb_typeof(filters) AS filters_type,
       "actionParams" ->> 'threshold' AS threshold
FROM "Trigger" WHERE ...;
```

Expected:
- `name` = `Alert: <what-you-typed>` (single prefix, even if you
  typed `alert: cost spike` yourself).
- `customGraphId` populated.
- `filters_type` = `object`. **Never `string`.** (Regression trap.)
- `threshold` matches what you set.

### 2. Dashboard "Add alert" button

1. Open any dashboard containing the chart card.
2. Click **Add alert** on the chart card.
3. Automations drawer opens with `prefilledGraphId` = the chart's
   graph id, and the first series pre-selected and LOCKED.
4. Save. Row written with the SSOT builder.

### 3. Standalone `/analytics/custom` page

1. Navigate to `/<project>/analytics/custom`.
2. Two callsites — one for saved reports, one for the ad-hoc chart —
   both **Add alert** buttons route through the automations drawer
   with pre-fill.

### 4. Editing an existing alert hydrates

1. From the automations list, click a graph-alert row → Edit.
2. Threshold rule (`operator`, `threshold`, `timePeriod`,
   `seriesName`) hydrates from `actionParams`. Not blank, not
   defaulted.
3. Change a value, save. Row updated via the same SSOT builder — no
   drift between create + update paths.

### 5. Custom Liquid template on a graph alert

1. Edit a graph alert; open the template editor.
2. Author a template using the new context: `{{ trigger.name }}`,
   `{{ metric.label }}`, `{{ condition }}`, `{{ currentValue }}`,
   `{{ occurredAt }}`, `{{ reason }}`, `{{ operatorLabel }}`,
   `{{ timePeriodLabel }}`, `{{ project.slug }}`.
3. Preview renders live.
4. Save.
5. With `release_es_graph_triggers_firing` ON, fire the alert
   (breach the metric). Email / Slack post uses YOUR template, NOT
   the default.

### 6. Persist actions blocked for graph alerts

1. Author a new graph alert. On the Type stage, confirm the
   `ADD_TO_DATASET` and `ADD_TO_ANNOTATION_QUEUE` cards are visually
   disabled with a tooltip explaining "not available for graph
   alerts."
2. Server-side gate: even if you smuggle one through in the wire
   payload, `automation.upsert` throws `BAD_REQUEST` on those
   actions when `customGraphId` is set.

## Regression traps — what to specifically re-verify

- **`filters` is an OBJECT, not a STRING.** The graph-alert builder
  writes `filters: {}` (Prisma `InputJsonValue`). Regression
  signature: `filters: '{}'` (string). Two ways to hit it:

  ```sql
  SELECT id FROM "Trigger" WHERE jsonb_typeof(filters) = 'string';
  ```

  should return zero rows across the whole project. If it does not,
  the dispatch drift bug is live and the trigger's filter evaluation
  either explodes or silently matches nothing.
- **Case-insensitive `Alert:` prefix.** Save a trigger named
  `alert: cost spike`. Row must read `Alert: cost spike`, not
  `Alert: alert: cost spike`. Also test `ALERT: foo` — must not
  double-prefix. Regex is `/^\s*alert:\s*/i`.
- **SSOT builder covers UPDATE too.** `graphs.updateById`'s UPDATE
  branch previously bypassed `buildGraphAlertTriggerData` and wrote
  an inline shape. P0 fix routed it through the builder. Regression
  signature: edit an existing alert via the dashboard chart card;
  compare the resulting `Trigger` row to one edited via the
  automations drawer — they must be byte-identical. Any structural
  drift (missing keys, different `filters` shape) = SSOT regressed.
- **`createdByUserId` is server-stamped, not client-supplied.**
  P0 fix stripped `input.actionParams.createdByUserId` from the wire
  schema on `automation.upsert`. Regression: an attacker forges
  audit attribution. Verify by intercepting the wire payload with
  the browser devtools, editing the `createdByUserId` field, sending
  — the server unconditionally stamps `ctx.session.user.id` on
  annotation-queue automations, ignoring the wire value.
- **`ADD_TO_DATASET` / `ADD_TO_ANNOTATION_QUEUE` throw on graph
  alerts, don't no-op.** `dispatchGraphAlertAction` used to no-op
  when action was persist-class (a mis-configured alert would
  silently drop the notification without a signal). P0 fix throws
  `DispatchError({ retryable: false })` so the row dead-letters with
  an operator-actionable error. Author a graph alert somehow with a
  persist action (via API bypass), fire it, verify the dead-letter
  message reads "graph alerts don't support persist actions."
- **`BASE_HOST` unset explodes.** Same as PR #4498 — outbox setup
  throws at boot without `BASE_HOST`. Regression = silent broken
  deep links in graph-alert emails.
- **`metric.label` header injection stripped.** A malicious series
  name containing `\r\n` (CR/LF) must be stripped by
  `buildGraphAlertTemplateContext` before it lands in the email
  subject template. Author an alert with a series name literally
  containing `\r\n` (via SQL if the UI won't let you), fire it —
  outbound email must have a single-line subject.
- **Legacy `AlertDrawer` unreachable.** Grep the running frontend
  for anything opening `AlertDrawer`. Expected: zero call sites.
  It's registered but no code path reaches it — the side-by-side
  rollout directive keeps it around only as an unreachable fallback.
- **Slack template escape chain is gone.** In a graph-alert Slack
  post with a series or graph name containing `&`, the post must
  render literally `&`, NOT `&amp;`. Same P0 as PR #4498's Slack
  templates but scoped to the graph-alert-specific templates.
- **Block Kit `image` blocks blocked.** Try to save a graph-alert
  Slack template containing `{"type":"image",...}` or a nested
  `context.elements[]` non-text element. Monaco flags it; server
  strips it at dispatch.
- **Switch component uses `onCheckedChange`.** Toggle the graph
  alert's active state from the list view. It must actually flip.
- **Analytics/custom page migration.** `analytics/custom/index.tsx`
  has 2 broken call sites migrated by the deep-review fix. Load
  the page — no console errors, no red banner. The 2 callsites still
  route through the automations drawer.

## Rollback plan

1. Flip `release_es_graph_triggers_firing` OFF for affected projects.
   Cron picks up their graph alerts on the next 3-minute tick and
   dispatches them with the pre-Liquid hardcoded format. Rows written
   through the automations drawer keep working — the SSOT builder
   writes the exact same shape the cron already handles.
2. To also stop authoring, hide the automations drawer's graph-alert
   type from the `TypePicker`. There's no flag; a small commit
   removing the type suffices, then redeploy.
3. Migrations are inert under old code paths. No down migration.
4. Legacy `AlertDrawer` is still registered — it can be reopened by
   restoring the dashboard callsites' pre-repoint code path if the
   automations-drawer flow is broken in prod.

## Failure modes to alert on

- Sentry: `filters is not an object` on trigger dispatch → the
  string-vs-object regression is live; check `Trigger.filters`
  types with the SQL above.
- Sentry: `BAD_REQUEST` from `automation.upsert` on persist action
  with `customGraphId` set → intentional guard firing; may indicate
  the frontend `TypePicker` did not correctly disable persist cards.
- Grafana / audit table: `ReactorOutbox` graphEval rows in
  `dead-letter` state with reason "graph alerts don't support
  persist actions" → mis-configured trigger, alert the customer.
- CloudWatch grep: literal `&amp;` in Slack post content from
  graph alerts → escape chain regressed.
- Sentry: `header injection detected` on outbound trigger emails →
  `metric.label` sanitizer regressed.
- CloudWatch: `AlertDrawer opened` any occurrence → unreachable
  fallback was reached, meaning some new code path opened it.
  Investigate.
- Grafana: authoring-drawer save latency p99 spike → deep-review
  fix N1 (SSOT builder routing) was reverted; upsert doing double
  writes.

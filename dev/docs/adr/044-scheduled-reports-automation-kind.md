# ADR-044: Scheduled reports — a schedule-triggered automation kind

**Date:** 2026-07-10

**Status:** Proposed

## Context

Automations today notify on one of two triggers, and the product has never named
the distinction out loud:

- **Event-triggered** — a trace arrives matching a filter tree, and we notify
  (email / Slack). Stored as a `Trigger` with `customGraphId == null`
  (`prisma/schema.prisma:784`), evaluated reactively on the trace pipeline.
- **Condition-triggered** — a custom-graph metric crosses a threshold; an incident
  opens on breach and resolves on recovery. Stored as a `Trigger` with a non-null
  `customGraphId` FK, evaluated by the real-time activity subscriber plus the
  scheduled `graphAlertSweep` process manager for absence and recovery
  (ADR-034 Ph 5; the K8s `/api/cron/triggers` sweep was removed).

Customers keep asking for a **third** shape neither covers: *"every Monday 09:00,
post my evals dashboard to #quality"*, *"daily 07:00, the top-5 error traces from
last night as a table"*, *"this week's pass-rate vs last week's, as a chart."*
This is a **periodic, informational report** — a digest on a calendar. It fires
because the clock said so, not because something broke.

That reframing resolves a real tension: we call the condition-triggered shape an
"alert," but an alert is not always "something broke" — a scheduled comparative
digest is alert-shaped delivery with none of the incident semantics. The clean
split is by **what fires the automation**, and it wants a name of its own.

Two capabilities are missing entirely:

1. **A per-trigger calendar schedule.** Nothing carries a cron expression +
   day-of-week + time-of-day + timezone at the trigger level. `Trigger` has
   `lastRunAt Float`, `notificationCadence` (`immediate | 5min_digest |
   15min_digest | hourly_digest`), and `traceDebounceMs` — all *relative* windows
   anchored to an event, never an absolute wall-clock instant
   (`src/automations/cadences.ts:9-31`; `computeScheduledFor` snaps to the next
   epoch-aligned UTC boundary, `triggerActionDispatch.ts:60-79`). The only
   per-entity cron in the repo is the EE governance `IngestionSource.pullSchedule`
   (`prisma/schema.prisma:2333`), driven by a BullMQ repeatable job
   (`pullerQueue.ts:76-83`) — and it carries **no timezone**, so it runs UTC-only.
   There is no `nextRunAt`/`dueAt` column anywhere. **The calendar scheduler is the
   biggest net-new primitive in this ADR.**

2. **A whole-dashboard render.** A report's content is not a single number over a
   threshold; it is one-or-many graphs (or a trace list) rendered into a message.
   The graph-alert path already reads a saved graph and calls `getTimeseries`
   server-side (`evaluateGraphTrigger`, `graph-trigger-evaluation.service.ts:134-415`),
   but for exactly one series against a threshold. A report generalizes that to N
   graphs (or a trace query) and renders them, not a pass/fail.

As with ADR-040, most of the framework exists: the provider registry
(`src/automations/providers/`), the Liquid engine + its two render contexts
(ADR-036), the Block Kit allowlist and proposed native chart/table blocks
(ADR-041), the ADR-052 process-manager substrate, the fire-history surface
(`TriggerSent` + `ViewAutomationDrawer.tsx`), and the analytics service
(`AnalyticsService.getTimeseries`). This ADR's job is to *compose* them into a
schedule-triggered kind, and to design the one primitive that does not yet exist —
the calendar scheduler.

## Decision

Introduce **Report**, a third automation *kind* triggered by a calendar schedule.
A report renders a content source (a dashboard, a single custom graph, or a trace
query) into the existing notify channels (Slack / email / webhook) on a
cron-expression + IANA-timezone schedule, driven by a new **in-process scheduler
loop** — Postgres-leased with Redis used only for early wake signals, no cron
infrastructure, sleeping until the next job is due (see §4). Ship it dark behind
`release_scheduled_reports`.

---

### 1. Taxonomy — three automation kinds, split by what fires them

Make the split first-class and mutually exclusive **by trigger**:

| Kind | Fires when | Semantics | Today |
|------|-----------|-----------|-------|
| **Automation** | an event occurs — a trace lands matching `filters` | reactive, per-match (or digested) | `customGraphId == null` |
| **Alert** | a condition holds — a metric crosses a threshold | incident: opens on breach, resolves on recovery (`TriggerSent.resolvedAt`) | `customGraphId != null` |
| **Report** | the clock reaches a scheduled instant | periodic, informational; no breach, no incident | **new** |

The three are disjoint — an automation is not scheduled, a report has no
threshold, an alert has no calendar.

**Naming — internal vs user-facing.** The internal umbrella stays `Trigger` (the
Prisma model) and "Automations" (the module, drawer, provider registry) — we
rename nothing in the data layer. **Recommendation: keep a single "Automations"
page and surface the three kinds as first-class cards in the type picker
(Automation · Alert · Report), each with its own copy and empty state.** The three
are the same "when X, notify Y" shape sharing one drawer, one fire-history, one
channel set — three nav items would triple the surface for no gain, and the picker
already exists (`TypePicker.tsx`). *Rejected:* retitling the page "Alerts,
automations & reports" — more discoverable but verbose, and it fronts "alerts"
when the default kind is a trace automation. If discoverability testing later
demands the nouns in the nav, expose them as picker cards and let deep-links target
`?kind=report`, not three routes.

**Discriminator — make the kind explicit.** Today the trace-vs-alert split is the
*implicit* `customGraphId != null` heuristic, hard-branched in ~a dozen places
(`trigger.service.ts:33-51`, the upsert router `automations.ts:587-632`,
`draftReducer.ts` `SET_SOURCE`, `TypePicker.tsx`, both dispatch helpers). A third
kind does not compose onto that. **Add a `triggerKind` enum column** (`AUTOMATION
| ALERT | REPORT`, default `AUTOMATION`), backfilled (`customGraphId != null →
ALERT`, else `AUTOMATION`), as the single source of truth; `customGraphId`- and
schedule-presence become *consequences* of the kind, not the discriminator.
*Rejected:* a second implicit heuristic (`schedule != null → report`) — it would
leave three overlapping presence-rules a future reader must reconstruct, exactly
the fragility the current code suffers.

---

### 2. Shape — extend `Trigger`, do not fork a new model

**A Report is a `Trigger` row with `triggerKind = REPORT`, a new `schedule`
column, and its content source in `actionParams` — reusing the notify provider
pipeline wholesale.** Not a new model, not a new `TriggerAction`.

**Why not a new model.** A report shares ~90% of its machinery with the other
kinds: the notify providers (email/Slack/webhook), the four Liquid template
columns (ADR-036), the fire-history ledger (`TriggerSent`), the authoring drawer,
the provider registry, and the leased delivery paths. A `ScheduledReport` model
would fork every one. ADR-040 made the identical call for the webhook channel
(compose, don't fork); we follow it.

**Why not a new `TriggerAction`.** The `action` axis is the **channel** (`SEND_EMAIL
| SEND_SLACK_MESSAGE | SEND_WEBHOOK`) — orthogonal to the kind. A report can go to
any channel. Folding "report" into the action enum would multiply it (report×email,
report×slack, …) and duplicate the notify-vs-persist classing on a separate axis
(`NOTIFY_TRIGGER_ACTIONS` / `PERSIST_TRIGGER_ACTIONS`,
`triggerActionDispatch.ts:35-43`). A report is a **notify-class** dispatch on the
existing channels.

**Schema (additive):**

```prisma
enum TriggerKind { AUTOMATION  ALERT  REPORT }   // backfilled from customGraphId

model Trigger {
  // … existing fields …
  triggerKind  TriggerKind  @default(AUTOMATION)  // §1 discriminator
  // The report's calendar lives in the generic ScheduledJob table (§4), not on
  // Trigger — a REPORT row keeps one ScheduledJob("reportTrigger", trigger.id)
  // in sync on upsert. Trigger stays schedule-unaware; the scheduler stays
  // report-unaware.
}
```

**Content source lives in `actionParams`, not a top-level FK** — a discriminated
union in the existing `actionParams Json`:

```
reportSource:
  | { kind: "dashboard";    dashboardId: string }
  | { kind: "customGraph";  customGraphId: string }
  | { kind: "traceQuery";   filters: FilterTree; metric?: SeriesRef; topN: number }
comparison:  "none" | "previousPeriod"          // §3 this-vs-last framing
```

We deliberately do **not** reuse the top-level `Trigger.customGraphId` FK for a
single-graph report: it is `@unique` (`schema.prisma:784`) — one row per graph —
and it is the *alert* slot, so a report over an alerted-on graph would collide.
Keeping the source in `actionParams` (the ADR-040 precedent for webhook config)
avoids the collision and keeps `customGraphId` meaning exactly "the graph this
alert watches." The upsert router validates `dashboardId` / `customGraphId` belong
to the calling project (multitenancy gate, `automations.ts:619-631`). The report
reuses the four ADR-036 template columns and a new default family (§3), and ignores
`notificationCadence`/`traceDebounceMs` (event-relative; a report's timing is its
`schedule`).

---

### 3. Content source is orthogonal to the trigger

A report is **not** graph-only. Its trigger is a schedule; its *content* is one of
three sources. Single-graph is the degenerate 1-element dashboard; a trace top-N
table is a first-class citizen.

| `reportSource.kind` | Data primitive | Block Kit render (ADR-041) | Fallback |
|---------------------|----------------|----------------------------|----------|
| `dashboard` | enumerate `dashboard.graphs` (ordered), one `getTimeseries` per graph | one `data_visualization` chart per graph | sparkline / mrkdwn lines; email full render |
| `customGraph` | one `getTimeseries` (= 1-element dashboard) | one `data_visualization` chart | sparkline |
| `traceQuery` | the trace list / analytics surface (`api.traces.getAllForProject`, `AnalyticsService`) | one `table` block (Time · Score · Input · Link) | section-list |

**Dashboard enumeration** is a relational fetch: a `Dashboard` has-many
`CustomGraph` (`schema.prisma:644,652`); enumerate via `DashboardService.getById` →
`dashboard.repository.ts:50` (graphs ordered by `gridRow`, `gridColumn`). Each
`CustomGraph.graph` JSON is a `CustomGraphInput` (`CustomGraph.tsx:76`) — fully
self-describing (series, `graphType`, `groupBy`, `timeScale`, `includePrevious`).

**Graph rendering** reuses the exact server-side path the alert evaluator walks:
read `customGraph.graph`, build a `TimeseriesInputType` over the report window,
call `AnalyticsService.getTimeseries` (`analytics.service.ts:99`), which returns
`TimeseriesResult { previousPeriod, currentPeriod }` (`analytics/types.ts:122`) —
so the **this-vs-last comparison is native to the data**.
`graph-trigger-evaluation.service.ts:231-290` is the reference implementation to
generalize (one series → all series, threshold → chart).

**New report template context.** Add a third context interface beside
`TemplateContext` and `GraphAlertTemplateContext` (`templateContext.ts`), plus a
pure `buildReportTemplateContext({ …, baseHost })` and an example builder for
preview (mirroring `buildGraphAlertTemplateContext:285-381` /
`buildExampleGraphAlertTemplateContext:389-440`). Widening `renderTriggerSlack`'s
`context` union is a **type-only** change — the engine casts context to
`Record<string, unknown>` (`renderSlack.ts:108`), so no engine fork. Shape:

```ts
interface ReportTemplateContext {
  trigger: { id; name; editUrl };
  project: { name; slug; url };
  report:  { title; source: "dashboard"|"customGraph"|"traceQuery";
             period: { start; end; label };
             comparison: { previousStart; previousEnd } | null };
  dashboard: { id; name; url } | null;      // graph sources
  graphs: Array<{ id; name; url; chartType;
                  series: Array<{ name; points: {label;value}[];
                                  previousPoints?: {label;value}[] }>;
                  current: number; previous: number | null; delta: number | null }>;
  table: { columns: string[]; rows: string[][] } | null;   // traceQuery source
  occurredAt: string;
}
```

Each `graphs[i]` maps to an ADR-041 `data_visualization` block; `table` maps to an
ADR-041 `table` block. A new `REPORT_TRIGGER_DEFAULTS: TriggerTemplateDefaults` in
`defaults.ts` (mirroring `ALERT_TRIGGER_DEFAULTS:174-179`) is passed as the
`defaults` override on the report dispatch path; per-trigger custom Liquid still
overrides it.

**Message-size strategy — the load-bearing rendering constraint.** Slack caps a
message at **50 blocks** (~3000 chars/section). Nothing enforces or splits on this
today — there is no `MAX_BLOCKS` constant, `filterBlockKit` does not paginate, and
`sendRenderedSlackMessage` (`sendSlackWebhook.ts:157-180`) issues one
`IncomingWebhook.send`. A 20-graph dashboard at ~3 blocks/graph blows past 50 and
Slack rejects the whole payload. By channel:

- **Slack = curated top-N + link (default).** Render the first N graphs (N so total
  blocks ≤ ~45, leaving headroom; ≈ 10 charts), then append a url-only *"View full
  dashboard →"* button (ADR-041 `actions`) to `dashboard.url`. Introduce a
  `REPORT_SLACK_GRAPH_CAP` constant (net-new). Report the omitted count ("Showing
  10 of 24 graphs").
- **Email = full render.** Email (Liquid → Markdown → HTML) has no 50-block
  ceiling; the full dashboard renders naturally. Steer "whole dashboard" users to
  email, Slack to the highlights.
- **Threaded chunking (deferred).** Splitting across threaded messages needs a
  bot-token `chat.postMessage` channel — the *same* Slack-app OAuth lift ADR-041
  defers for `data_visualization`/`table`. Not in v1.

Because `data_visualization` and `table` are **"unverified — probe first"** on
incoming webhooks (ADR-041, host-locked to `hooks.slack.com` by
`slackWebhookGuard.ts:55-65`), the graph/table reports inherit ADR-041's delivery
probe: until it passes, Slack reports fall back to the allowlist-clean
sparkline/section-list. **Email is not probe-gated** and is the reliable
full-fidelity path from day one.

---

### 4. The scheduler — a generic durable primitive, report is its first consumer

The calendar scheduler does not exist and it is the load-bearing new piece. It
should **not** be built report-specific. Add a small, general-purpose
**durable scheduler** — a persisted set of cron entries and a cross-pod worker
loop that conditionally leases due entries — and make the report its *first
consumer*. (If it grows, promote it to its own ADR.) The scheduler knows nothing
about reports, dashboards, or graphs: it owns cron entries and firing; report
logic lives in the registered handler.

**Two ways to build it — poll a durable table, or park a delayed "wait" in the
queue.** A tempting alternative skips the periodic scan: enqueue each job *now*
with a far-in-advance delay (a week-long "wait") and let the queue deliver it when
the delay elapses. Clean mental model, and the right instinct on payload — you park
only a **tiny trigger, never data** (a discipline we adopt unconditionally below).
But we recommend **against** the queue-as-schedule *storage* model, for three
reasons:

1. **Durability.** A week-long delayed message lives in Redis; the GroupQueue is
   Redis-backed (the in-house GroupQueue, not BullMQ). A flush,
   eviction, failover, or migration silently drops every parked schedule — whereas
   a Postgres `ScheduledJob` row survives all of that. The *schedule* must not live
   only in a volatile queue.
2. **Recurring safety.** A delayed job fires once; "every Monday" means the handler
   re-enqueues the next wait when it fires — a self-perpetuating chain. If one fire
   is lost (a crash between pop and re-enqueue, a Redis blip), the chain breaks
   *silently and permanently*. A durable row cannot break the chain: the row still
   sits there and the next scan catches up. (ADR-023/025 is the cautionary tale of
   such a chain that had to be removed.)
3. **Edit / cancel / DST-recompute.** With parked waits, changing a schedule means
   finding and removing the queued job by id and re-adding; with a row it is one
   `UPDATE` of `cron`/`nextRunAt`, and every tick recomputes against current tz
   rules.

So: **durable `ScheduledJob` rows are the source of truth.** `SchedulerService`
sleeps until the nearest known due instant, capped by a 60 s polling backstop,
and Redis pub/sub wakes it early after a schedule change. Redis loss can increase
latency only; the bounded Postgres re-scan still finds every durable row.

**The tiny-trigger discipline (kept from the delayed-job idea).** The fire carries
**only** `{ targetType, targetId, slot }` — an identity, never a rendered report.
The handler re-derives everything (dashboard, graphs, query) from `targetId` when
it runs, so a schedule edited between scheduling and firing is honoured.

**Persisted schedule entries (`ScheduledJob`)** — one row per scheduled thing:

```prisma
model ScheduledJob {
  id          String    @id @default(nanoid())
  projectId   String                        // multitenancy + per-tenant fairness
  targetType  String                        // the consumer key, e.g. "reportTrigger"
  targetId    String                        // what to fire, e.g. the Trigger.id
  cron        String                         // "0 9 * * 1"
  timezone    String                         // IANA, e.g. "America/New_York"
  catchUp     String    @default("runLatest") // "skip" | "runLatest"
  active      Boolean   @default(true)
  nextRunAt   DateTime                        // forward marker, indexed
  lastSlot    DateTime?                        // last calendar instant fired
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @default(now()) @updatedAt
  @@index([active, nextRunAt])                 // the due-scan
  @@index([projectId, targetType, targetId])   // upsert/lookup by owner
}
```

`targetType`/`targetId` keep it agnostic — a report writes `("reportTrigger",
trigger.id)`; a future weekly-rollup or retention-report writes its own type. So
the report's schedule lives *here*, not on `Trigger` (§2's `schedule` column
collapses to "keep the `ScheduledJob` in sync on upsert").

**An in-process scheduler loop — no cron, no fixed tick.** Explicit decision
(supersedes a fixed-interval heartbeat framing): a long-lived **in-process loop**
on the worker that sleeps *until the next job is due*, not a cron entry or fixed 60
s poll. Redis only accelerates wake-up. The loop:

1. Reads `MIN(nextRunAt) WHERE active` — the soonest due instant across *all*
   target types — and **sleeps until exactly that instant**, capped by a
   `SCHEDULER_MAX_SLEEP_MS` backstop (~60 s) as a safety net, not the primary
   cadence.
2. Wakes **early** on a Redis signal when any job is created/edited/deleted (a
   pub/sub channel or `BLPOP` wakeup key the upsert path pokes), so a new "in 2
   minutes" job doesn't wait out the backstop.
3. On wake: `SELECT ... WHERE active AND nextRunAt <= now` (indexed due-scan), then
   conditionally lease each due row, invoke its registered handler with `{
   targetType, targetId, slot }`, and advance `nextRunAt` after successful
   settlement. Failures keep the slot and retry with bounded backoff.

**Cross-pod safety = Postgres conditional leases.** Every worker-capable pod may
run the loop and race the same conditional update; there is no leader or Redis
lease. Exactly one worker owns a slot, and a crashed lease becomes eligible for
retry after expiry.

**Consumer registration** — a `SchedulerRegistry` maps `targetType → handler`.
The report registers `"reportTrigger" → renderAndDispatchReport`; the scheduler
invokes it under the fenced lease. A second scheduled feature later is one row
type + one handler — no new tick, lock, or cron parser.

**Representation & `nextRunAt` computation.** Cron + IANA timezone, not a relative
window — "09:00 *their* Monday" is a UTC instant that moves across DST. Compute
`nextRunAt` in the entry's zone with a tz-aware cron evaluator (`cron-parser` is
present transitively via BullMQ and takes a `tz` option; `croner` is a tz-native
alternative) and persist it, so the tick is an indexed comparison, not a per-entry
re-parse. Spring-forward (a nonexistent wall-clock time) → fire at the next valid
instant; fall-back (a time that occurs twice) → the per-slot claim ensures a single
delivery. The UI offers a constrained day/time/frequency picker compiling to the
cron string plus an advanced escape hatch — the `PullScheduleField` pattern
(`ingestion-sources.tsx:1258`), the one existing per-entity cron precedent,
extended with the timezone it lacks.

**No double-firing (the correctness core).** The conditional row lease stops two
replicas from owning a slot concurrently. A crash after a provider accepts the
message but before settlement can still re-run the handler, so channel delivery
also uses a stable identity keyed on `(targetType, targetId, slot)`, the calendar
analog of the alert's `@@unique([triggerId, traceId])` incident claim. The report
also records its fire in
`TriggerSent`/`ReportSent` for the operator surface (§7), but the *at-most-once
guarantee lives in the scheduler*, so every future consumer inherits it.

**Missed-run / catch-up policy** (`ScheduledJob.catchUp`, framework-level):

- **`skip`** — on recovery, fast-forward `nextRunAt` to the next *future* instant;
  drop everything missed. (A Monday digest sent Wednesday is noise.)
- **`runLatest` (recommended default)** — fire exactly one catch-up for the *most
  recent* missed slot, then fast-forward. A short outage doesn't silently swallow a
  daily report; a week of downtime doesn't spew seven backfilled reports.
- The scheduler **never** replays every missed slot — the per-slot claim makes it
  *possible*, but a stampede of stale fires is worse than a gap.

Why not the K8s `/api/cron/triggers` sweep: it was project-blind, coarse
(3-minute), and has since been removed (ADR-034 Ph 5 — the graph-alert cron is
gone). 60 s granularity is ample for calendar reports.

---

### 5. Load & scale

A weekly report over a large dashboard is **N heavy ClickHouse `getTimeseries`
queries fired at once, on a cold cache** (the 30 s `getTimeseries` TTL,
`analytics.service.ts:52`, helps concurrent dashboard *views*, not a once-a-week
batch). One graph = one bucketed CH GROUP-BY (two when the tripwire runs the routed
+ legacy query in parallel, `analytics.service.ts:138`); N graphs fan out to N
independent queries with no batching. A synchronous 20-query loop inside one
dispatch would blow the render budget and hammer CH.

**Fan each graph's query out through process-manager intents / GroupQueue rather than a
synchronous loop.** A report "assemble" job enqueues N per-graph "compute" jobs
keyed by `projectId` (so GroupQueue's `TenantRateTracker` gives per-tenant fairness
and the global worker concurrency cap applies), collects the results, then renders +
dispatches — reusing the durability and back-pressure the graph-alert path rides.
Supplementary levers:

- **Prefer the rollup tables** (ADR-034) — a weekly digest is fine at coarse
  buckets, and the rollup is cheaper than the slim scan.
- **Reuse the 30 s cache** — if a report and a dashboard view coincide, the second
  is free.
- **Per-project concurrency cap** on report generation, and **jitter the dispatch**
  so every project's 09:00-Monday report does not stampede CH in the same second
  (the per-slot claim still pins the logical instant).

---

### 6. Config UI

Extend the automations drawer with the Report kind, mirroring the kind-aware
patterns PR #5015 built for alerts (`draftReducer.ts` `SET_SOURCE`,
`TypePicker.tsx` gating, `AutomationDrawer.tsx` `isGraphAlert` branches):

- **Type picker** gains a third card — *Report* — alongside Automation and Alert;
  selecting it sets `triggerKind = REPORT` and swaps the drawer body.
- **Content source** picker: *Dashboard* · *Single graph* · *Trace query* (filters
  + top-N). The trace-query builder reuses the existing trace filter UI; the
  dashboard/graph pickers reuse `api.dashboards.getAll` / `api.graphs.getAll`.
- **Schedule** field: a constrained frequency/day/time/timezone picker compiling to
  the cron string, with an advanced escape hatch (extend `PullScheduleField` with a
  timezone select). Show the computed "next run".
- **Comparison** toggle: *none* vs *vs previous period* (drives `includePrevious` /
  the `previousPeriod` series).
- **Channel + template + preview**: unchanged notify pipeline — pick
  email/Slack/webhook, pick or customize the template, preview against real recent
  data via the ADR-037 pane.
- **Copywriting** (per `copywriting.md`): the card says *what it does* ("A scheduled
  summary of a dashboard, posted on a calendar you choose"), never *how*.

---

### 7. Delivery & observability

A report "fire" is a scheduled send — it reuses the existing fire-history surface.
The per-slot `TriggerSent`/`ReportSent` claim is the delivery ledger;
`ViewAutomationDrawer.tsx`'s "Recent fires" panel lists report sends keyed on the
scheduled slot, with the rendered summary and any template-health warnings
(ADR-037). When the channel is the webhook (ADR-040), each attempt also lands in
`WebhookDelivery` with the same drill-down. A render failure falls back to the
default template and surfaces in the operator activity tab, as ADR-036 specifies
for the other kinds.

---

### 8. Rollout & phasing

- **Feature flag.** Add `release_scheduled_reports` to `FEATURE_FLAGS`
  (`src/server/featureFlag/registry.ts`), `scope: "PRODUCT"`, `defaultValue: false`,
  mirroring `release_webhook_automations`. Gate the picker card (client) *and* the
  upsert route + scheduler dispatch (server); staff/dev unhide via
  `FEATURE_FLAG_FORCE_ENABLE=release_scheduled_reports`.
- **Migrations.** All schema changes ship as a **single consolidated migration**,
  `20260712000000_reports_scheduler_and_trigger_facets`: the generic `ScheduledJob`
  table (incl. its two indexes and retry columns); the `TriggerKind` enum + a
  backfilled, NOT NULL `triggerKind` column (from `customGraphId`);
  `Trigger.filterQuery`; and a `TriggerSent.openIncidentKey` unique constraint. All
  additive; immutable-migration rule (fresh migration, never edit a deployed one).
  `reportSource`/`comparison` are `actionParams` JSON — no migration.
- **Phasing** (ordered to de-risk the scheduler first):
  - **P1 — the generic scheduler primitive + one source, no new blocks.** Ship the
    `ScheduledJob` table, the `SchedulerService` (due-scan + per-slot
    at-most-once claim + catch-up), the `SchedulerRegistry`, the `triggerKind`
    column, and a **single-graph** or **trace-query** report as the first
    `targetType` — rendered with *today's* allowlist-clean blocks (section-list /
    sparkline) on Slack and the **full render on email**. Proves scheduling
    correctness (no double-fire across deploys/DST/catch-up) without any ADR-041
    probe; the trace-query report is a natural first consumer since email renders it
    fully and the Slack fallback needs no new block.
  - **P2 — full dashboard report.** Enumerate `dashboard.graphs`, fan each query out
    through process intents (§5), render top-N + "view full dashboard" on Slack,
    full render on email. Adopt the ADR-041 `data_visualization` / `table` blocks **once
    the ADR-041 Phase 3 webhook probe passes** (or the bot-token channel lands).
  - **P3 — comparative "this vs last" framing.** Promote the `comparison` toggle to
    a first-class rendering: current-vs-previous overlaid per chart plus a delta,
    reusing `TimeseriesResult.previousPeriod` and `CustomGraphInput.includePrevious`.
- **Riskiest parts:** (1) **scheduler correctness** — a slot must fire exactly once
  across competing replicas, redeploys, lease expiry, and DST; the
  per-slot at-most-once claim + the durable `ScheduledJob.nextRunAt` (source of
  truth, not a parked queue message) + `runLatest` catch-up are the mitigations, and
  each must be covered by a test that *executes* the path (a simulated redeploy
  across a slot, a spring-forward instant, a dropped fire re-caught by the next
  scan), not a string assertion. (2) **Slack's 50-block ceiling** — the
  `REPORT_SLACK_GRAPH_CAP` + top-N-plus-link strategy is the guard, and the
  full-fidelity path is email.

## Rationale / Trade-offs

- **Why a kind, not a new model or action.** The report shares the notify channels,
  template engine, fire-history ledger, drawer, and leased delivery with the other
  kinds.
  Reusing them makes the calendar schedule and the multi-graph render the *only*
  genuinely new pieces; a new model or bespoke `TriggerAction` would fork three
  subsystems to add one trigger shape.
- **Why an explicit `triggerKind` over the implicit heuristic.** The codebase
  already pays for the implicit `customGraphId != null` split — a dozen scattered
  branches a reader must reassemble. A third kind is the moment to name the axis;
  the column is inspectable, indexable (the due-scan), and future-proof.
- **Why the durable scheduler over the K8s cron.** `ScheduledJob` rows are
  tenant-scoped, Postgres-leased, worker-only, retryable, and observable. The K8s
  cron was project-blind and coarse; durable rows preserve calendar slots across
  worker restarts and Redis loss.
- **Why cron + IANA timezone.** "Every Monday 09:00" is a timezone-anchored
  wall-clock instant; a relative window cannot express it, and a UTC-only cron (the
  `pullSchedule` precedent) sends the digest an hour off half the year.
- **Why a durable-row poll, not a parked delayed "wait"** (§4): a week-long delayed
  message stores the *schedule* in volatile Redis (lost on flush/failover), makes a
  recurring report a fragile self-perpetuating chain that dies silently if one fire
  is dropped, and turns an edit into a find-and-replace of queued jobs. A Postgres
  `ScheduledJob` row served by an intelligent loop with a 60 s polling backstop is
  crash- and Redis-loss-proof and self-healing. We keep the good half: the fire
  carries only a tiny `{ targetType, targetId, slot }` trigger, never a parked
  payload.
- **What we compromise.** The scheduler is real new surface — a worker loop, a cron
  evaluator, a per-slot claim, DST handling, a catch-up policy — with subtle
  correctness. The Slack 50-block limit forces a curated top-N compromise on large
  dashboards (mitigated by full-fidelity email). And a large-dashboard report is a
  burst of heavy CH queries we must queue and pace. All judged worth it against a
  bolt-on scheduler that double-fires or a render Slack rejects.

## Consequences

- **One new discriminator column (`triggerKind`) becomes the single source of
  truth** for the three-way taxonomy; the scattered `customGraphId != null` branches
  should migrate to read it, and the notify-vs-persist axis stays orthogonal.
- **A new generic calendar-scheduling primitive** — the `ScheduledJob` table, a
  single `SchedulerService` due-scan, a `SchedulerRegistry`, a cron+timezone
  representation, a framework-level per-slot at-most-once claim, and a catch-up
  policy — enters the platform alongside ADR-052's process managers.
  It is the first per-entity, timezone-aware calendar schedule and it is
  *report-agnostic*: future scheduled work (weekly rollups, retention reports)
  registers a `targetType` + handler and inherits cross-pod leasing, durability, and
  exactly-once firing for free. If it accretes, promote it to its own ADR.
- **A third render context (`ReportTemplateContext`) and default family**
  (`REPORT_TRIGGER_DEFAULTS`) join the templating module; the renderer union widens
  by one type. The report leans on ADR-041's `data_visualization` / `table` blocks
  and inherits its incoming-webhook probe gate — native-chart render is Phase-2,
  email is full-fidelity from Phase 1.
- **A message-size discipline (`REPORT_SLACK_GRAPH_CAP` + top-N-plus-link)** is
  introduced where none existed; a large dashboard now degrades gracefully on Slack
  instead of being rejected.
- **Report generation queues per-graph CH queries through process intents**, adding
  scheduled burst load that per-tenant fairness + rollup routing + jitter keep
  bounded.
- **Fire-history and the authoring drawer gain a report shape** — a scheduled send
  keyed on its calendar slot — reusing existing surfaces.
- **Shipped dark behind `release_scheduled_reports`**; GA is a later PostHog
  rollout + default flip.
- **Deferred to fast-follow:** threaded multi-message Slack dashboards (bot-token
  channel), per-graph image export, sub-minute schedule precision, and per-project
  default report templates.

## References

- [ADR-036](./036-liquid-templates-for-trigger-notifications.md) — Liquid engine +
  the two render contexts the report's third context joins; fall-back-to-default and
  test-fire discipline the report reuses.
- [ADR-037](./037-automation-operator-surfaces.md) — authoring drawer + live preview
  + fire-history the report configuration and delivery surface extend.
- [ADR-052](./052-automations-on-process-manager-substrate.md) — the durable wake,
  leased intent, and GroupQueue substrate used by automation reactions.
- [ADR-025](./025-remove-orphan-sweep.md) — the removed self-perpetuating reactor
  chain; the cautionary tale for why a "re-enqueue the next wait" queue-chain is
  rejected in favour of a durable-row poll.
- [ADR-040](./040-webhook-http-request-automation-channel.md) — the webhook notify
  channel a report can target, and the precedent for putting channel/source config
  in `actionParams` rather than a new column.
- [ADR-041](./041-modern-block-kit-notification-template-suite.md) — the native
  `data_visualization` (chart) and `table` blocks the report renders into, and the
  incoming-webhook probe / host-lock constraint the report inherits.
- [ADR-034](./034-event-sourced-analytics-materialization.md) — the slim/rollup
  analytics tables `getTimeseries` reads; report queries prefer the rollup.
- PR #5015 (`feat(automations): graph alerts in automations drawer + Liquid template
  wiring`) — the kind-aware drawer, `graphAlert` sub-shape, and
  `graph-trigger-evaluation.service.ts` this report generalizes.
- `src/server/app-layer/automations/graph-trigger-evaluation.service.ts` — the
  server-side "stored graph → `getTimeseries`" evaluator the report render extends
  from one series to many.
- `src/server/dashboards/dashboard.repository.ts` / `prisma/schema.prisma`
  (`Dashboard`, `CustomGraph`) — dashboard→graphs enumeration.
- `ee/governance/services/pullers/pullerQueue.ts` + `IngestionSource.pullSchedule` —
  the one existing per-entity cron primitive (BullMQ `repeat.pattern`, no timezone)
  the report scheduler's representation learns from and improves on.

## Amendment 2026-07-22 (ADR-063)

The taxonomy, `triggerKind` discriminator, schedule model, and scheduler
all stand. Superseded
([ADR-063](./063-automations-domain-packages-customer-api-and-agent-surface.md)):
§1's recommendation to "surface the three kinds as first-class cards in the
type picker" and §6's type-picker card — creation is intent-first (three
outcome cards; the kind is derived). On the wire, the customer API names
the discriminator `kind` (`automation` | `alert` | `report`), mapping 1:1
onto `triggerKind`; the data layer renames nothing, as decided here.

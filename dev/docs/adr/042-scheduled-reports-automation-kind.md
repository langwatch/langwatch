# ADR-042: Scheduled reports — a schedule-triggered automation kind

**Date:** 2026-07-10

**Status:** Proposed

## Context

Automations today notify on one of two triggers, and the product has never
named the distinction out loud:

- **Event-triggered** — a trace arrives matching a filter tree, and we notify
  (email / Slack). Stored as a `Trigger` with `customGraphId == null`
  (`prisma/schema.prisma:784`), evaluated reactively on the trace pipeline.
- **Condition-triggered** — a custom-graph metric crosses a threshold; an
  incident opens on breach and resolves on recovery. Stored as a `Trigger`
  with a non-null `customGraphId` FK, evaluated by the real-time outbox
  reactor + the 30 s graph-trigger heartbeat (ADR-034 Ph 5) or the legacy
  `/api/cron/triggers` sweep (`src/server/routes/cron.ts:205`).

Customers keep asking for a **third** shape that neither covers: *"every Monday
09:00, post my evals dashboard to #quality"*, *"daily 07:00, the top-5 error
traces from last night as a table"*, *"this week's pass-rate vs last week's, as
a chart."* This is a **periodic, informational report** — a digest on a
calendar. It never "fires because something broke"; it fires because the clock
said so.

That reframing resolves a real tension in the current vocabulary. We have been
calling the condition-triggered shape an "alert," but an alert is not always
"something broke" — a scheduled comparative digest is an alert-shaped delivery
with none of the incident semantics. The clean split is by **what fires the
automation**, and it wants a name of its own.

Two capabilities are missing entirely:

1. **A per-trigger calendar schedule.** Nothing in the codebase carries a cron
   expression + day-of-week + time-of-day + timezone at the trigger level.
   `Trigger` has `lastRunAt Float`, `notificationCadence`
   (`immediate | 5min_digest | 15min_digest | hourly_digest`), and
   `traceDebounceMs` — all *relative* windows anchored to an event, never an
   absolute wall-clock instant (`src/automations/cadences.ts:9-31`;
   `computeScheduledFor` snaps to the next epoch-aligned UTC boundary in
   `src/server/event-sourcing/pipelines/shared/triggerActionDispatch.ts:60-79`).
   The only per-entity cron in the whole repo is the EE governance
   `IngestionSource.pullSchedule` (`prisma/schema.prisma:2333`), driven by a
   BullMQ repeatable job (`ee/governance/services/pullers/pullerQueue.ts:76-83`)
   — and it carries **no timezone**, so it runs UTC-only. There is no
   `nextRunAt`/`dueAt` column anywhere. **The calendar scheduler is the biggest
   net-new primitive in this ADR.**

2. **A whole-dashboard render.** A report's content is not a single number over
   a threshold; it is one-or-many graphs (or a trace list) rendered into a
   message. The graph-alert path already reads a saved graph and calls
   `getTimeseries` server-side (`evaluateGraphTrigger`,
   `src/server/app-layer/triggers/graph-trigger-evaluation.service.ts:134-415`),
   but for exactly one series against a threshold. A report generalizes that to
   N graphs (or a trace query) and renders them, not a pass/fail.

The good news, as with ADR-040, is that most of the framework already exists:
the provider registry (`src/automations/providers/`), the Liquid template engine
and its two render contexts (ADR-036, `src/shared/templating/`), the Block Kit
allowlist and the proposed native chart/table blocks (ADR-041), the outbox
heartbeat scheduling primitive (ADR-039), the fire-history surface
(`TriggerSent` + `ViewAutomationDrawer.tsx`), and the analytics service
(`AnalyticsService.getTimeseries`, `src/server/app-layer/analytics/`). This
ADR's job is to *compose* them into a schedule-triggered kind, and to design the
one primitive that does not yet exist — the calendar scheduler.

## Decision

Introduce **Report**, a third automation *kind* triggered by a calendar
schedule. A report renders a content source (a dashboard, a single custom
graph, or a trace query) into the existing notify channels (Slack / email /
webhook) on a cron-expression + IANA-timezone schedule (the *representation*),
driven by a new **in-process scheduler loop** — Redis-orchestrated, no cron
infrastructure, sleeping until the next job is due (see the Scheduler section).
Ship it dark behind `release_scheduled_reports`.

---

### 1. Taxonomy — three automation kinds, split by what fires them

Make the split first-class and mutually exclusive **by trigger**:

| Kind | Fires when | Semantics | Today |
|------|-----------|-----------|-------|
| **Automation** | an event occurs — a trace lands matching `filters` | reactive, per-match (or digested) | `Trigger.customGraphId == null` |
| **Alert** | a condition holds — a metric crosses a threshold | incident: opens on breach, resolves on recovery (`TriggerSent.resolvedAt`) | `Trigger.customGraphId != null` |
| **Report** | the clock reaches a scheduled instant | periodic, informational; no breach, no incident | **new** |

This resolves the "alerts aren't always something broke" tension: *broke* is an
**Alert** (a condition became true), *periodic information* is a **Report** (a
schedule elapsed). The three are disjoint — an automation is not scheduled, a
report has no threshold, an alert has no calendar.

**Naming — internal vs user-facing.** The internal umbrella stays
`Trigger` (the Prisma model) and "Automations" (the module, the drawer, the
provider registry). We rename nothing in the data layer. **Recommendation for
the user-facing surface: keep a single "Automations" page, and surface the three
kinds as first-class cards in the type picker (Automation · Alert · Report),
each with its own copy and empty state.** Justification: the three are the same
"when X, notify Y" shape sharing one drawer, one fire-history, one channel set —
three separate nav items would triple the surface for no conceptual gain, and
the picker already exists (`TypePicker.tsx`). *Rejected:* retitling the page
"Alerts, automations & reports" — more discoverable but verbose, and it puts
"alerts" first when the default/most-common kind is a trace automation. If
discoverability testing later demands the nouns in the nav, expose them as
picker cards and let search/deep-links target `?kind=report`, not as three
routes.

**Discriminator — make the kind explicit.** Today the trace-vs-alert split is
the *implicit* `customGraphId != null` heuristic, hard-branched in ~a dozen
places (`trigger.service.ts:33-51`, the upsert router `automations.ts:587-632`,
`draftReducer.ts` `SET_SOURCE`, `TypePicker.tsx`, both dispatch helpers). A
third kind does not compose onto that heuristic. **Add a `triggerKind` enum
column** (`AUTOMATION | ALERT | REPORT`, default `AUTOMATION`), backfilled
(`customGraphId != null → ALERT`, else `AUTOMATION`), and make it the single
source of truth going forward; `customGraphId`-presence and schedule-presence
become *consequences* of the kind, not the discriminator. *Rejected:* a second
implicit heuristic (`schedule != null → report`) — it would leave three
overlapping presence-rules that a future reader must reconstruct, exactly the
fragility the current code already suffers from.

---

### 2. Shape — extend `Trigger`, do not fork a new model

**Recommendation: a Report is a `Trigger` row with `triggerKind = REPORT`, a
new `schedule` column, and its content source in `actionParams` — reusing the
notify provider pipeline wholesale.** It is *not* a new model and *not* a new
`TriggerAction`.

**Why not a new model.** A report shares ~90% of its machinery with the other
kinds: the notify providers (email/Slack/webhook), the four Liquid template
columns (ADR-036), the fire-history ledger (`TriggerSent`), the authoring
drawer, the provider registry, and the outbox dispatch path. A `ScheduledReport`
model would fork every one of those. ADR-040 made the identical call for the
webhook channel (compose, don't fork); we follow it.

**Why not a new `TriggerAction`.** The `action` axis is the **channel**
(`SEND_EMAIL | SEND_SLACK_MESSAGE | SEND_WEBHOOK`) — orthogonal to the kind. A
report can go to any channel, exactly like an automation or an alert. Folding
"report" into the action enum would multiply it (report×email, report×slack, …)
and duplicate the notify-vs-persist classing that already lives on a separate
axis (`NOTIFY_TRIGGER_ACTIONS` / `PERSIST_TRIGGER_ACTIONS`,
`triggerActionDispatch.ts:35-43`). A report is a **notify-class** dispatch on
the existing channels.

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

**Content source lives in `actionParams`, not a top-level FK.** The report's
source is a discriminated union stored in the existing `actionParams Json`:

```
reportSource:
  | { kind: "dashboard";    dashboardId: string }
  | { kind: "customGraph";  customGraphId: string }
  | { kind: "traceQuery";   filters: FilterTree; metric?: SeriesRef; topN: number }
comparison:  "none" | "previousPeriod"          // §3 this-vs-last framing
```

Note we deliberately do **not** reuse the top-level `Trigger.customGraphId` FK
for a single-graph report: that column is `@unique` (`schema.prisma:784`) — one
row per graph — and it is the *alert* slot. A report over a graph that is also
alerted-on would collide. Keeping the source in `actionParams` (the ADR-040
precedent for webhook config) avoids the collision and keeps `customGraphId`
meaning exactly "this is the graph this alert watches." The upsert router
validates `dashboardId` / `customGraphId` belong to the calling project
(multitenancy gate, mirroring `automations.ts:619-631`).

The report reuses the four ADR-036 template columns (`slackTemplateType`,
`slackTemplate`, `emailSubjectTemplate`, `emailBodyTemplate`) and a new default
family (§3). It ignores `notificationCadence`/`traceDebounceMs` (those are
event-relative; a report's timing is its `schedule`).

---

### 3. Content source is orthogonal to the trigger

A report is **not** graph-only. Its trigger is a schedule; its *content* is one
of three sources, rendered by the matching primitive. Single-graph is the
degenerate 1-element dashboard; a trace top-N table is a first-class citizen.

| `reportSource.kind` | Data primitive | Block Kit render (ADR-041) | Fallback |
|---------------------|----------------|----------------------------|----------|
| `dashboard` | enumerate `dashboard.graphs` (ordered), one `getTimeseries` per graph | one `data_visualization` chart per graph | unicode sparkline / mrkdwn lines; email full render |
| `customGraph` | one `getTimeseries` (= 1-element dashboard) | one `data_visualization` chart | sparkline |
| `traceQuery` | the trace list / analytics surface (`api.traces.getAllForProject`, `AnalyticsService`) | one `table` block (Time · Score · Input · Link) | section-list |

**Dashboard enumeration** is a relational fetch, not a JSON array: a `Dashboard`
has-many `CustomGraph` (`schema.prisma:644,652`); enumerate via
`DashboardService.getById` → `dashboard.repository.ts:50` (includes graphs
ordered by `gridRow`, `gridColumn`). Each `CustomGraph.graph` JSON is a
`CustomGraphInput` (`src/components/analytics/CustomGraph.tsx:76`) — fully
self-describing (series, `graphType`, `groupBy`, `timeScale`, `includePrevious`).

**Graph rendering** reuses the exact server-side path the alert evaluator
already walks: read `customGraph.graph`, build a `TimeseriesInputType` over the
report window, call `AnalyticsService.getTimeseries`
(`analytics.service.ts:99`), which returns
`TimeseriesResult { previousPeriod, currentPeriod }` (`analytics/types.ts:122`)
— so the **this-vs-last comparison is native to the data**, not something we
compute on top. `graph-trigger-evaluation.service.ts:231-290` is the reference
implementation to generalize (from one series → all series, threshold → chart).

**New report template context.** Add a third context interface beside
`TemplateContext` and `GraphAlertTemplateContext`
(`src/shared/templating/templateContext.ts`), plus a pure
`buildReportTemplateContext({ …, baseHost })` builder and an example builder for
preview (mirroring `buildGraphAlertTemplateContext:285-381` /
`buildExampleGraphAlertTemplateContext:389-440`). Widening
`renderTriggerSlack`'s `context` union is a **type-only** change — the engine
casts context to `Record<string, unknown>` (`renderSlack.ts:108`), so no engine
fork. Shape:

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

Each `graphs[i]` maps to an ADR-041 `data_visualization` block (one series =
`metric.label`, `data` = `points`, axes from labels). `table` maps to an ADR-041
`table` block. A new `REPORT_TRIGGER_DEFAULTS: TriggerTemplateDefaults` in
`defaults.ts` (mirroring `ALERT_TRIGGER_DEFAULTS:174-179`) is passed as the
`defaults` override on the report dispatch path; per-trigger custom Liquid still
overrides it.

**Message-size strategy — the load-bearing rendering constraint.** Slack caps a
message at **50 blocks** (and ~3000 chars/section). Nothing in the templating
code enforces or splits on this today — there is no `MAX_BLOCKS` constant,
`filterBlockKit` does not paginate, and `sendRenderedSlackMessage`
(`sendSlackWebhook.ts:157-180`) issues exactly one `IncomingWebhook.send`. A
20-graph dashboard at ~3 blocks/graph blows past 50 and Slack rejects the whole
payload. The strategy, by channel:

- **Slack = curated top-N + link (default).** Render the first N graphs
  (N chosen so total blocks ≤ ~45, leaving headroom for header/footer/CTA;
  ≈ 10 charts), then append a url-only *"View full dashboard →"* button
  (ADR-041 `actions`) pointing at `dashboard.url`. Introduce a
  `REPORT_SLACK_GRAPH_CAP` constant (net-new). Report the omitted count
  ("Showing 10 of 24 graphs").
- **Email = full render.** Email (Liquid → Markdown → HTML) has no 50-block
  ceiling; the full 20-graph dashboard renders naturally. Recommend steering
  "I want the whole dashboard" users to email, and Slack to the highlights.
- **Threaded chunking (deferred).** Splitting a dashboard across multiple
  messages threaded under the first needs a bot-token `chat.postMessage`
  channel — the *same* Slack-app OAuth lift ADR-041 defers for
  `data_visualization`/`table`. Not in v1.

Because `data_visualization` and `table` are **"unverified — probe first"** on
incoming webhooks (ADR-041 §"the binding constraint", host-locked to
`hooks.slack.com` by `slackWebhookGuard.ts:55-65`), the graph/table reports
inherit ADR-041's delivery probe: until it passes, Slack reports fall back to
the allowlist-clean sparkline/section-list, and the native-chart render waits on
either the probe or the bot-token channel. **Email is not probe-gated** and is
the reliable full-fidelity path from day one.

---

### 4. The scheduler — a generic event-sourcing primitive, report is its first consumer

The calendar scheduler does not exist and it is the load-bearing new piece. It
should **not** be built report-specific. Instead, add a small, general-purpose
**event-sourcing scheduler** — a persisted set of cron entries and one cross-pod
tick that, when an entry is due, fires it into the outbox — and make the report
its *first consumer*. This mirrors ADR-039 exactly: that ADR made the heartbeat
a framework primitive and the graph-trigger its first consumer; the scheduler is
the calendar-shaped sibling. (If it grows, promote it to its own ADR; it is
specified here because the report is what motivates and validates it.)

The design is deliberately tiny: **schedule → check → on-due, emit an
event/enqueue into the event-sourcing platform.** The scheduler knows nothing
about reports, dashboards, or graphs — it owns cron entries and firing; all
report logic lives in the handler the enqueue routes to.

**Two ways to build it — poll a durable table, or park a delayed "wait" in the
queue.** A tempting alternative is to skip the periodic scan entirely: enqueue
each job *now* with a far-in-advance delay (a week-long "wait"), and let the
queue deliver it when the delay elapses. It is a clean mental model and the
right instinct on payload — you would park only a **tiny trigger, never data**.
We adopt that discipline unconditionally (below), but recommend **against** the
queue-as-schedule *storage* model, for three reasons:

1. **Durability.** A week-long delayed message lives in Redis; the GroupQueue is
   Redis-backed (and is the in-house queue the outbox uses, not BullMQ). A
   flush, eviction, failover, or migration silently drops every parked schedule
   — whereas a Postgres `ScheduledJob` row is the durable source of truth that
   survives all of that. The *schedule* must not live only in a volatile queue.
2. **Recurring safety.** A delayed job fires once; "every Monday" means the
   handler re-enqueues the next wait when it fires — a self-perpetuating chain.
   If one fire is lost (a crash between pop and re-enqueue, a Redis blip), the
   chain breaks *silently and permanently* and the report just stops. A durable
   row cannot break the chain: the row still sits there and the next scan catches
   up. (ADR-023/025 is the cautionary tale of a self-perpetuating reactor chain
   that had to be removed.)
3. **Edit / cancel / DST-recompute.** Changing a schedule with parked waits means
   finding and removing the queued job by id and re-adding; with a row it is one
   `UPDATE` of `cron`/`nextRunAt`, and every tick recomputes against current tz
   rules.

So: **durable `ScheduledJob` rows are the source of truth, a 60 s reconciling
tick fires the due ones.** A precise delayed "wait" is a fine *latency*
optimization layered on top (schedule an exact wake for an imminent slot instead
of waiting up to a tick) — but only with the poll as a backstop, and it is
unnecessary at 60 s granularity, so v1 is pure poll and the exact-wake is a
documented future refinement.

**The tiny-trigger discipline (kept from the delayed-job idea, applies either
way).** The fire carries **only** `{ targetType, targetId, slot }` — an
identity, never a rendered report or a payload. The handler re-derives
everything (the dashboard, the graphs, the query) from `targetId` when it runs.
Nothing heavy ever sits parked in the queue, and a schedule edited between
scheduling and firing is honoured because the data is read fresh at fire time,
not frozen at schedule time.

**Persisted schedule entries (`ScheduledJob`).** A generic table, one row per
scheduled thing:

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

`targetType`/`targetId` keep it agnostic — a report writes
`("reportTrigger", trigger.id)`; a future weekly-rollup or retention-report
writes its own type. The report's schedule therefore lives *here*, not on
`Trigger` (§2's `schedule` column collapses to "the report keeps its
`ScheduledJob` in sync on upsert"); the scheduler stays report-unaware.

**An in-process scheduler loop — no cron, no fixed tick.** Explicit decision
(supersedes a fixed-interval heartbeat framing): the scheduler is a long-lived
**in-process loop** that lives on the worker and sleeps *until the next job is
due*, not a cron entry or a fixed 60 s poll. We do not want cron infrastructure;
Redis orchestrates. The loop:

1. Reads `MIN(nextRunAt) WHERE active` — the soonest due instant across *all*
   target types — and **sleeps until exactly that instant** (intelligent sleep),
   capped by a `SCHEDULER_MAX_SLEEP_MS` backstop (~60 s) purely as a safety net
   against a missed wakeup, not as the primary cadence.
2. Wakes **early** on a Redis signal when any job is created / edited / deleted
   (a pub/sub channel or a `BLPOP` wakeup key the upsert path pokes), so a new
   "in 2 minutes" job doesn't wait out the backstop. The sleep is
   `min(nextDueAt − now, MAX_SLEEP)` interrupted by the wakeup.
3. On wake: `SELECT ... WHERE active AND nextRunAt <= now` (indexed due-scan),
   and for each due entry emit one `OutboxEnqueueRequest` carrying
   `{ targetType, targetId, slot }` through `dispatchOutboxEnqueues` — the normal
   outbox path with retry, dedup, and audit — then advance `nextRunAt` to the
   next cron instant strictly after `now` and set `lastSlot`. Advancing
   `nextRunAt` is a **conditional update** (`WHERE nextRunAt = <the value we
   read>`) so two pods racing the same due row → exactly one wins the claim.

**Cross-pod safety = Redis leader-lock, reused, not reinvented.** Only one pod's
loop should be authoritative. Reuse the worker-role gating + Redis leader-lock
the heartbeat already implements (`heartbeat.scheduler.ts:268-285`): the loop
runs only where `processRole === "worker"` and holds a named Redis lease it
refreshes while looping; a follower pod blocks on lock acquisition and takes over
on lease expiry. The per-slot conditional `nextRunAt` update above is the
belt-and-braces backstop so even a split-brain window can't double-fire.

**Consumer registration** — a `SchedulerRegistry` maps `targetType → handler`,
the calendar analog of the heartbeat registry. The report registers
`"reportTrigger" → renderAndDispatchReport`. "When the schedule is due, trigger
something in the event-sourcing platform" = the enqueue is a first-class outbox
event; the registered handler runs on the outbox worker exactly like any
event-sourced reactor. Adding a second scheduled feature later is one row type +
one registered handler — no new tick, no new lock, no new cron parser.

**Representation & `nextRunAt` computation.** Cron + IANA timezone, not a
relative window — the customer means "09:00 *their* Monday," a UTC instant that
moves across DST. Compute `nextRunAt` in the entry's zone with a tz-aware cron
evaluator (`cron-parser` is already present transitively via BullMQ and takes a
`tz` option; `croner` is a tz-native alternative) and persist it, so the tick is
an indexed comparison, not a per-entry re-parse. The UI offers a constrained
day/time/frequency picker that compiles to the cron string plus an advanced
escape hatch — the `PullScheduleField` pattern
(`ee/governance/dashboard/pages/ingestion-sources.tsx:1258`), which is the one
existing per-entity cron precedent, extended with the timezone it lacks.

**No double-firing (the correctness core).** The leader-lock stops two replicas
ticking at once, but a redeploy mid-window, a lock-TTL expiry, or an outbox retry
could still re-observe a slot. Guard it in the framework with a **per-slot
at-most-once claim** keyed on `(targetType, targetId, slot)` — either a unique
row the enqueue inserts before dispatch, or the dispatch dedup identity itself.
A slot is delivered once no matter how many ticks or retries observe it — the
calendar analog of the alert's `@@unique([triggerId, traceId])` incident claim.
The report additionally records its fire in `TriggerSent`/`ReportSent` for the
operator surface (§7), but the *at-most-once guarantee lives in the scheduler*,
so every future consumer inherits it.

**Timezone + DST.** Compute `nextRunAt` in the IANA zone, store the resolved UTC
instant. Spring-forward (a wall-clock time that does not exist) → fire at the
next valid instant; fall-back (a time that occurs twice) → the per-slot claim
ensures a single delivery. "09:00 local" tracks DST automatically because the
cron is evaluated in the zone, not as a fixed offset.

**Missed-run / catch-up policy** (`ScheduledJob.catchUp`, framework-level):

- **`skip`** — on recovery, fast-forward `nextRunAt` to the next *future*
  instant; drop everything missed. (A Monday digest sent Wednesday is noise.)
- **`runLatest` (recommended default)** — fire exactly one catch-up for the
  *most recent* missed slot, then fast-forward. A short outage does not silently
  swallow a daily report; a week of downtime does not spew seven backfilled
  reports at once.
- The scheduler **never** replays every missed slot — the per-slot claim makes
  it *possible*, but a stampede of stale fires is worse than a gap.

Why not the K8s `/api/cron/triggers` sweep: it is project-blind, coarse
(3-minute), and being migrated *off* (ADR-034 Ph 5) — building the new primitive
on a deprecated, unlocked, timezone-blind surface is backwards. 60 s granularity
is ample for calendar reports; firing within a minute of the slot is correct.

---

### 5. Load & scale

A weekly report over a large dashboard is **N heavy ClickHouse `getTimeseries`
queries fired at once, on a cold cache** (the 30 s `getTimeseries` TTL,
`analytics.service.ts:52`, helps concurrent dashboard *views*, not a
once-a-week batch). One graph = one bucketed CH GROUP-BY (two when the tripwire
runs the routed + legacy query in parallel, `analytics.service.ts:138`); N
graphs fan out to N independent queries with no batching. A synchronous
20-query loop inside one dispatch would blow the render budget and hammer CH.

**Recommendation: fan each graph's query out through the existing outbox /
GroupQueue rather than a synchronous loop.** A report "assemble" job enqueues N
per-graph "compute" jobs keyed by `projectId` (so the outbox `TenantRateTracker`
gives per-tenant fairness and the global worker concurrency cap applies),
collects the results, then renders + dispatches. This reuses the same durability
and back-pressure the graph-alert path already rides. Supplementary levers:

- **Prefer the rollup tables** (ADR-034) for report queries — a weekly digest is
  fine at coarse buckets, and the rollup is cheaper than the slim scan.
- **Reuse the 30 s cache** — if a report and a dashboard view coincide, the
  second is free.
- **Per-project concurrency cap** on report generation, and **jitter the
  dispatch** so every project's 09:00-Monday report does not stampede CH in the
  same second (spread within a small window around the slot; the per-slot claim
  still pins the logical instant).

---

### 6. Config UI

Extend the automations drawer with the Report kind, mirroring the kind-aware
patterns PR #5015 built for alerts (`draftReducer.ts` `SET_SOURCE`,
`TypePicker.tsx` gating, `AutomationDrawer.tsx` `isGraphAlert` branches):

- **Type picker** gains a third card — *Report* — alongside Automation and
  Alert. Selecting it sets `triggerKind = REPORT` and swaps the drawer body.
- **Content source** picker: *Dashboard* (choose one) · *Single graph* · *Trace
  query* (filters + top-N). The trace-query builder reuses the existing trace
  filter UI; the dashboard/graph pickers reuse `api.dashboards.getAll` /
  `api.graphs.getAll`.
- **Schedule** field: a constrained frequency/day/time/timezone picker that
  compiles to the cron string, with an advanced cron escape hatch (extend the
  `PullScheduleField` pattern with a timezone select). Show the computed "next
  run" as confirmation.
- **Comparison** toggle: *none* vs *vs previous period* (drives
  `includePrevious` / the `previousPeriod` series).
- **Channel + template + preview**: unchanged notify pipeline — pick
  email/Slack/webhook, pick or customize the template, and preview against real
  recent data via the ADR-037 preview pane.
- **Copywriting** (per `copywriting.md`): the card says *what it does* ("A
  scheduled summary of a dashboard, posted on a calendar you choose"), never
  *how* ("a heartbeat-driven `data_visualization` render").

---

### 7. Delivery & observability

A report "fire" is a scheduled send — it reuses the existing fire-history
surface. The per-slot `TriggerSent`/`ReportSent` claim is the delivery ledger;
`ViewAutomationDrawer.tsx`'s "Recent fires" panel lists report sends keyed on
the scheduled slot (rather than a trace/incident), with the rendered summary and
any template-health warnings (ADR-037). When the channel is the webhook
(ADR-040), each attempt also lands in `WebhookDelivery` with the same drill-down.
A render failure falls back to the default template and surfaces in the operator
activity tab, exactly as ADR-036 specifies for the other kinds.

---

### 8. Rollout & phasing

- **Feature flag.** Add `release_scheduled_reports` to `FEATURE_FLAGS`
  (`src/server/featureFlag/registry.ts`), `scope: "PRODUCT"`,
  `defaultValue: false`, mirroring `release_webhook_automations`. Gate the picker
  card (client) *and* the upsert route + scheduler dispatch (server). Staff/dev
  unhide via `FEATURE_FLAG_FORCE_ENABLE=release_scheduled_reports`.
- **Migrations.** (a) the generic `ScheduledJob` table + its two indexes; (b)
  `TriggerKind` enum + `triggerKind` column, backfilled from `customGraphId`;
  (c) `TriggerSent`/`ReportSent` slot column (or the per-slot claim lives in the
  scheduler). All additive; immutable-migration rule (fresh migration, never edit
  a deployed one). `reportSource`/`comparison` are `actionParams` JSON — no
  migration.
- **Phasing** (ordered to de-risk the scheduler first — it is the riskiest
  part):
  - **P1 — the generic scheduler primitive + one source, no new blocks.** Ship
    the `ScheduledJob` table, the `schedulerHeartbeat` (due-scan + per-slot
    at-most-once claim + catch-up), the `SchedulerRegistry`, the `triggerKind`
    column, and a **single-graph** or **trace-query** report registered as the
    first `targetType` — rendered with *today's* allowlist-clean blocks
    (section-list / sparkline) on Slack and the **full render on email**. This
    proves calendar-scheduling correctness (no double-fire across
    deploys/DST/catch-up) as a reusable primitive, without depending on any
    ADR-041 probe. The trace-query table report is a natural first consumer
    because email renders it fully and the Slack section-list fallback needs no
    new block.
  - **P2 — full dashboard report.** Enumerate `dashboard.graphs`, fan each
    query out through the outbox (§5), render top-N + "view full dashboard" on
    Slack, full render on email. Adopt the ADR-041 `data_visualization` / `table`
    blocks for native charts/grids **once the ADR-041 Phase 3 webhook probe
    passes** (or the bot-token channel lands).
  - **P3 — comparative "this vs last" framing.** Promote the `comparison` toggle
    to a first-class rendering: current-vs-previous overlaid on each chart and a
    computed delta, reusing `TimeseriesResult.previousPeriod` and
    `CustomGraphInput.includePrevious`.

- **Riskiest parts, called out:** (1) **scheduler correctness** — a slot must
  fire exactly once across replica leadership changes, redeploys, lock-TTL
  expiry, and DST transitions; the per-slot at-most-once claim + the durable
  `ScheduledJob.nextRunAt` (source of truth, not a parked queue message) +
  `runLatest` catch-up are the mitigations, and each must be covered by a test
  that *executes* the path (a simulated redeploy across a slot, a spring-forward
  instant, a dropped fire re-caught by the next scan), not a string assertion.
  (2) **Slack's 50-block ceiling** — a large dashboard silently exceeds it today;
  the `REPORT_SLACK_GRAPH_CAP` + top-N-plus-link strategy is the guard, and the
  full-fidelity path is email.

## Rationale / Trade-offs

- **Why a kind, not a new model or action.** The report shares the notify
  channels, the template engine, the fire-history ledger, the drawer, and the
  outbox with the other two kinds. Reusing them means the calendar schedule and
  the multi-graph render are the *only* genuinely new pieces; a new model or a
  bespoke `TriggerAction` would fork three subsystems to add one trigger shape.
- **Why an explicit `triggerKind` over the implicit heuristic.** The codebase
  already pays for the implicit `customGraphId != null` split — a dozen scattered
  branches a reader must reassemble into "these are the two kinds." A third kind
  is the moment to name the axis. The column is inspectable, indexable (the
  heartbeat's due-scan), and future-proof.
- **Why the heartbeat over the K8s cron.** The heartbeat is worker-only, Redis
  leader-locked, and shares the outbox dispatch path (retry/dedup/audit). The
  cron is project-blind, coarse, and deprecated. Reusing the sanctioned primitive
  means the report scheduler inherits correctness properties instead of
  re-deriving them.
- **Why cron + IANA timezone.** "Every Monday 09:00" is a timezone-anchored
  wall-clock instant; a relative window cannot express it, and a UTC-only cron
  (the `pullSchedule` precedent) sends the digest an hour off half the year.
- **Why a durable-row poll, not a parked delayed "wait".** Enqueuing each job
  now with a week-long delay is tempting and payload-cheap, but it stores the
  *schedule* in volatile Redis (lost on flush/failover), makes a recurring
  report a fragile self-perpetuating chain that dies silently if one fire is
  dropped, and turns an edit into a find-and-replace of queued jobs. A Postgres
  `ScheduledJob` row reconciled by a 60 s tick is crash- and Redis-loss-proof and
  self-healing. We keep the good half of the idea unconditionally: the fire
  carries only a tiny `{ targetType, targetId, slot }` trigger, never a parked
  payload — the handler re-derives the report at fire time.
- **What we compromise.** The scheduler is real new surface — a heartbeat, a
  cron evaluator, a per-slot claim, DST handling, a catch-up policy — and its
  correctness is subtle. The Slack 50-block limit forces a curated top-N
  compromise on large dashboards (mitigated by full-fidelity email). And a report
  over a large dashboard is a burst of heavy CH queries we must queue and pace
  rather than fan out synchronously. All judged worth it against the alternative
  of a bolt-on scheduler that double-fires or a render that Slack rejects.

## Consequences

- **One new discriminator column (`triggerKind`) becomes the single source of
  truth** for the three-way taxonomy; the scattered `customGraphId != null`
  branches should migrate to read it, and the notify-vs-persist axis stays
  orthogonal.
- **A new generic calendar-scheduling primitive** — the `ScheduledJob` table, a
  single `schedulerHeartbeat` due-scan, a `SchedulerRegistry`, a cron+timezone
  representation, a framework-level per-slot at-most-once claim, and a catch-up
  policy — enters the event-sourcing platform as a sibling to ADR-039's
  heartbeat. It is the first per-entity calendar schedule and the first
  timezone-aware one, and it is *report-agnostic*: future scheduled work (weekly
  rollups, retention reports, digests) registers a `targetType` + handler and
  inherits cross-pod locking, durability, and exactly-once firing for free. If it
  accretes, promote it to its own ADR.
- **A third render context (`ReportTemplateContext`) and default family**
  (`REPORT_TRIGGER_DEFAULTS`) join the templating module; the renderer union
  widens by one type. The report leans on ADR-041's `data_visualization` /
  `table` blocks and therefore inherits its incoming-webhook probe gate — the
  native-chart render is Phase-2, email is full-fidelity from Phase 1.
- **A message-size discipline (`REPORT_SLACK_GRAPH_CAP` + top-N-plus-link)** is
  introduced where none existed; a large dashboard now degrades gracefully on
  Slack instead of being rejected.
- **Report generation queues per-graph CH queries through the outbox**, adding
  scheduled burst load that per-tenant fairness + rollup routing + jitter keep
  bounded.
- **Fire-history and the authoring drawer gain a report shape** — a scheduled
  send keyed on its calendar slot — reusing the existing surfaces.
- **Shipped dark behind `release_scheduled_reports`**; GA is a later PostHog
  rollout + default flip, like every other `release_*` flag.
- **Deferred to fast-follow:** threaded multi-message Slack dashboards
  (bot-token channel), per-graph image export, sub-minute schedule precision,
  and per-project default report templates.

## References

- [ADR-036](./036-liquid-templates-for-trigger-notifications.md) — Liquid
  template engine + the two render contexts the report's third context joins;
  fall-back-to-default and test-fire discipline the report reuses.
- [ADR-037](./037-automation-operator-surfaces.md) — authoring drawer + live
  preview + fire-history the report configuration and delivery surface extend.
- [ADR-039](./039-outbox-heartbeat.md) — the heartbeat tick the scheduler
  runs on (worker-only, Redis-leader-locked, `decide → dispatchOutboxEnqueues`);
  the generic `ScheduledJob` scheduler is its calendar-shaped sibling.
- [ADR-025](./025-remove-orphan-sweep.md) — the removed self-perpetuating
  reactor chain; the cautionary tale for why a "re-enqueue the next wait when
  this one fires" queue-chain is rejected in favour of a durable-row poll.
- [ADR-040](./040-webhook-http-request-automation-channel.md) — the webhook
  notify channel a report can target, and the precedent for putting channel/
  source config in `actionParams` rather than a new column.
- [ADR-041](./041-modern-block-kit-notification-template-suite.md) — the native
  `data_visualization` (chart) and `table` blocks the report renders into, and
  the incoming-webhook probe / host-lock constraint the report inherits.
- [ADR-034](./034-event-sourced-analytics-materialization.md) — the slim/rollup
  analytics tables `getTimeseries` reads; report queries prefer the rollup.
- PR #5015 (`feat(automations): graph alerts in automations drawer + Liquid
  template wiring`) — the kind-aware drawer, `graphAlert` sub-shape, and
  `graph-trigger-evaluation.service.ts` this report generalizes.
- `src/server/app-layer/triggers/graph-trigger-evaluation.service.ts` — the
  server-side "stored graph → `getTimeseries`" evaluator the report render
  extends from one series to many.
- `src/server/dashboards/dashboard.repository.ts` /
  `prisma/schema.prisma` (`Dashboard`, `CustomGraph`) — dashboard→graphs
  enumeration.
- `ee/governance/services/pullers/pullerQueue.ts` +
  `IngestionSource.pullSchedule` — the one existing per-entity cron primitive
  (BullMQ `repeat.pattern`, no timezone) the report scheduler's representation
  learns from and improves on.

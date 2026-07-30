---
title: Activity Monitor — event-sourcing architecture
description: Why Activity Monitor ingestion goes through the event log and derived projections instead of writing ClickHouse from the request handler, and how to extend it.
---

# Activity Monitor — event-sourcing architecture

## Why this exists

The original D2 receiver implementation (commits `1abae1676`,
`92e515cc2`) wrote OCSF-normalised events directly into ClickHouse
`gateway_activity_events` from the Hono receiver handler, and the
plan for anomaly detection (Option C v0) was a poller worker that
periodically swept active `AnomalyRule` rows and SELECT-ed against
the CH table.

Per @rchaves's 2026-04-27 directive — *"event sourcing is the one
true way"* — and @master_orchestrator's follow-up (rebase/learn from
[PR #3351](https://github.com/langwatch/langwatch/pull/3351)) we
redesigned the trigger architecture before the eval engine landed.
The receiver stopped writing ClickHouse from the request handler:
governed activity is appended to `event_log`, and everything read
later is derived from it by a projection.

> **The pipeline drawn below is the April 2026 design as it was first
> sliced, and the product took a different route through it.** Read
> [What shipped instead](#what-shipped-instead) before treating any of
> it as the current architecture.

## The pipeline

```
┌────────────────────────────────────────────────────────────────┐
│  /api/ingest/otel/:sourceId  /api/ingest/webhook/:sourceId      │
│  (Hono routes — auth, validate sourceId, parse body)            │
└────────────────────────┬───────────────────────────────────────┘
                         │
                         ▼  RecordActivityEventCommand
                ┌────────────────────┐
                │  event_log (CH)    │
                │  ActivityEventReceived           │
                └────────┬───────────┘
                         │
                         ▼  pipeline: activity-monitor-processing
                         │  aggregateType: "activity_event"
                         │
   ┌─────────────────────┴────────────────────────┐
   │                                              │
   ▼                                              ▼
┌──────────────────────────┐      ┌──────────────────────────────┐
│ Map projection           │      │ Fold projection              │
│  activityEventStorage    │      │  anomalyWindow               │
│  → gateway_activity_events│     │  → per-tenant rolling totals │
│  (CH, OCSF + AOS shape)  │      │   (in-memory + Redis cache)  │
└────────┬─────────────────┘      └──────────┬───────────────────┘
         │                                   │
         │ wakes:                            │ wakes:
         ▼                                   ▼
┌──────────────────────────┐      ┌──────────────────────────────┐
│ Event subscriber         │      │ Process manager              │
│  activityEventBroadcast  │      │  anomalyDetection            │
│  (real-time UI push for  │      │  - load active AnomalyRules  │
│   /governance dashboard) │      │  - evaluate per-rule type    │
└──────────────────────────┘      │  - if trigger:               │
                                  │    • upsert AnomalyAlert     │
                                  │    • dispatch via shared     │
                                  │      triggerActionDispatch   │
                                  └──────────────────────────────┘
```

The shape mirrors `pipelines/trace-processing/` — same
`definePipeline().withFoldProjection().withMapProjection().
withEventSubscriber()` builder, same
`EventSubscriberDefinition<EventShape>` contract, same
`triggerActionDispatch.ts` shared helper.

## What shipped instead

Two things in the plan above changed on the way to production, and
both are worth knowing before you extend this surface.

**There is no separate activity-event store or pipeline.** The
dedicated `gateway_activity_events` table was dropped, and governed
activity now rides the platform's ordinary trace ingestion: the
receiver stamps origin metadata on each span and log record
(`langwatch.origin.kind = "ingestion_source"`, plus the source's id,
organization and type) and hands the payload to the same trace
collection path `/api/otel/v1/traces` uses. A hidden per-organization
Governance Project carries the access control so governance data never
appears among a customer's own projects.

**The derived governance streams are map projections on the trace
pipeline.** `governance_kpis` (per-span spend and token contributions,
summed per source and hour at read time) and `governance_ocsf_events`
(one OCSF v1.1 audit row per governed span) are registered on
`trace-processing` as `governanceKpis` and `governanceOcsfEvents`.
Being projections is what makes them **rebuildable**: replaying a
window of the event log re-derives every row in it, so a write lost to
an outage is recoverable rather than a permanent hole in the audit
trail. Both derivations are pure functions of a single span, so a
rebuild reproduces the live row exactly.

**Anomaly evaluation is periodic, not event-driven.** The spend-spike
evaluator runs on its own five-minute tick and queries `governance_kpis`
for the current window and the six preceding ones; it does not fire per
event. An alert lands as an `AnomalyAlert` row.

Post-event work in general is expressed as an **event subscriber**, a
**projection**, or a **process manager**, and nothing else — see
[ADR-098](https://github.com/langwatch/langwatch/blob/main/dev/docs/adr/098-event-sourcing-core.md)
(successor to the retired ADR-075).
Subscribers and process managers run on the live event path only;
replay never re-runs them. Projections are the substrate for anything
someone later reads as fact, precisely because replay does rebuild
them.

## Why a dedicated pipeline (not bolted onto trace-processing)

Per @master_orchestrator's call: gateway/activity events have
different aggregate semantics from traces. A trace is a
multi-span aggregate that folds into a `TraceSummaryData` over
its lifetime. An activity event is a *single completed
observation* of upstream platform behaviour — there's no
multi-event aggregate to fold across; each event already has
final cost/tokens/actor when it arrives.

Bolting them onto `trace-processing` would force one of:

1. Activity events get represented as fake single-span traces
   (lossy + confusing — trace_summaries would mix gateway-proxied
   traces and per-event activity rows under the same TenantId).
2. trace_summaries grows a discriminator column and the fold
   projection becomes branchy.

Both make trace-processing harder to reason about and add coupling
between independently-evolving subsystems. A dedicated
`activity-monitor-processing` pipeline keeps each surface's
aggregate semantics clean.

That was the reasoning behind the plan below. In the end the
discriminator turned out to be cheap — origin metadata stamped on the
span itself — so governed activity rides `trace-processing` after all,
and the governance streams are derived from it by their own
projections rather than by a pipeline of their own.

## Aggregate identity

```
aggregateType:  "activity_event"
aggregateId:    EventId  (one event = one aggregate, no fold across events)
tenantId:       IngestionSource.id  (matches gateway_activity_events.TenantId)
```

The fold projection (`anomalyWindow`) does not aggregate events
*into* an aggregate — it aggregates *across* aggregates within a
tenant, keyed by tenant + rolling window. That's a different shape
from trace-processing's "fold spans into a trace summary" —
in our case the fold is "tally per-tenant rolling spend / request
count / per-actor breakdown for the past N minutes/hours". Same
machinery, different aggregate semantics.

## Slicing the redesign

Per @master_orchestrator's C0/C1/C2/C3 sequence. Kept as the record of
how the work was cut; the store and the anomaly path both landed
differently, as described above.

### C0 — this doc + spec updates
- This architecture doc.
- `specs/ai-gateway/governance/anomaly-detection.feature` updated to
  drop poller language; event-driven framing throughout.
- `AnomalyAlert` Prisma model + migration `20260427020000_add_anomaly_alert/`
  doc-comment updated to name the pipeline as producer.
- Existing receivers continue to write CH directly until C1 lands —
  this slice is doc-only so the team can review the architecture
  before more code moves.

### C1 — receiver → event_log → projection
- New event schema: `ActivityEventReceived` with the OCSF-normalised
  ActivityEventRow shape.
- New command: `RecordActivityEventCommand` wired into the
  pipeline.
- Refactor `/api/ingest/otel/:sourceId` and
  `/api/ingest/webhook/:sourceId` to call the command instead of
  writing CH directly.
- Map projection `activityEventStorage` writes to
  `gateway_activity_events` (replaces today's direct insert).
- Dogfood: curl → 202 → row visible in CH (same as today, just via
  event-sourced path).

### C2 — AnomalyAlert + anomaly detection for one rule type
- Apply the AnomalyAlert migration that's already drafted but
  doesn't ship behaviour yet.
- Add `anomalyWindow` fold projection (per-tenant rolling totals).
- Add `anomalyDetection` for `spend_spike` only first
  (cleanest mapping to the existing CostUSD field).
- Wire into `api.activityMonitor.recentAnomalies` (replaces current
  `[]` stub).
- Dogfood: create rule in Alexis's UI → curl violating event →
  alert appears on `/governance` within ~30s.

### C3 — Dispatch destinations
- Generic webhook + log-only first (matches PR #3351's
  triggerActionDispatch shape).
- Slack / PagerDuty / SIEM / email follow as per-destination
  adapter slices once the detection path is proven.

## What we keep from the v0 receiver code

- `IngestionSourceService` (CRUD + auth) — unchanged.
- `gateway_activity_events` CH schema (migration `00019_*`) —
  unchanged. The map projection writes the same columns.
- OTel + webhook normalisers (`normalizers/otel.ts` etc.) —
  unchanged. They get called from the map projection now instead of
  the receiver handler.
- All receiver auth + sourceId-mismatch + 24h secret rotation grace —
  unchanged.

## What we drop from the v0 receiver code

- The direct `ActivityEventRepository.insert(...)` call from the
  receiver handler. The receiver instead enqueues an event into
  the pipeline; the map projection does the actual CH insert.
- The AnomalyEvaluatorService sketch that swept a bespoke activity
  table. The periodic sweep itself survived — the shipped evaluator
  still runs on a timer — but it reads the derived `governance_kpis`
  rows rather than a store of its own.

## Test strategy per slice

| Slice | BDD spec | Integration test | Dogfood |
|-------|----------|------------------|---------|
| C0 (this) | anomaly-detection.feature updated | n/a (doc + schema) | architecture review in-channel |
| C1 | activity-monitor pipeline scenarios in `activity-monitor.feature` | pipeline test: append event → projection fires → CH row | curl → 202 → CH SELECT |
| C2 | spend_spike scenario in anomaly-detection.feature | evaluator test: violating window → AnomalyAlert.upsert called | UI rule + violating event → /governance shows alert |
| C3 | dispatch scenarios in anomaly-detection.feature | dispatch test: dispatch helper called with right shape | webhook receives canonical body |

Each slice ships its own BDD + integration coverage before code
lands, and there is exactly one production path: a test drives the
same evaluator the scheduled tick drives, never a parallel
implementation kept alive for the test suite.

## Cross-references

- [PR #3351 — feat: event-driven trace triggers via reactor](https://github.com/langwatch/langwatch/pull/3351)
  (the pattern this redesign learns from).
- [`anomaly-detection.feature`](https://github.com/langwatch/langwatch/blob/main/specs/ai-gateway/governance/anomaly-detection.feature)
  — user-facing contract, updated for event-sourcing.
- [`anomaly-rules.feature`](https://github.com/langwatch/langwatch/blob/main/specs/ai-gateway/governance/anomaly-rules.feature)
  — configuration entity (already shipped, unchanged).
- [`activity-monitor.feature`](https://github.com/langwatch/langwatch/blob/main/specs/ai-gateway/governance/activity-monitor.feature)
  — admin UI contract (already shipped; pipeline section adds in C1).
- [`architecture.md`](./architecture.md) — top-level governance
  architecture; this doc is the activity-monitor deep-dive linked
  from the "Activity Monitor (Tier C/D)" block.

---
title: Activity Monitor — event-sourcing architecture
description: Why the receiver → event_log → projection reactor → anomaly reactor pipeline replaces the original direct-CH-write design, and how to extend it.
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
The receiver now appends an `ActivityEventReceived` event to
`event_log`, and a dedicated `activity-monitor-processing` pipeline
takes over from there. Anomaly detection becomes a reactor that
fires *as new events arrive*, not a worker that polls.

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
│ Reactor                  │      │ Reactor                      │
│  activityEventBroadcast  │      │  anomalyDetection            │
│  (real-time UI push for  │      │  - load active AnomalyRules  │
│   /governance dashboard) │      │  - evaluate per-rule type    │
└──────────────────────────┘      │  - if trigger:               │
                                  │    • upsert AnomalyAlert     │
                                  │    • dispatch via shared     │
                                  │      triggerActionDispatch   │
                                  └──────────────────────────────┘
```

The shape mirrors `pipelines/trace-processing/` (PR #3351's
alertTrigger reactor) — same `definePipeline().withFoldProjection().
withMapProjection().withReactor()` builder, same
`ReactorDefinition<EventShape, FoldState>` contract, same
`triggerActionDispatch.ts` shared helper.

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

Per @master_orchestrator's C0/C1/C2/C3 sequence:

### C0 — this doc + spec updates
- This architecture doc.
- `specs/ai-gateway/governance/anomaly-detection.feature` updated to
  drop poller language; reactor framing throughout.
- `AnomalyAlert` Prisma model + migration `20260427020000_add_anomaly_alert/`
  doc-comment updated to reference the reactor as producer.
- Existing receivers continue to write CH directly until C1 lands —
  this slice is doc-only so the team can review the architecture
  before more code moves.

### C1 — receiver → event_log → projection reactor
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

### C2 — AnomalyAlert + anomaly reactor for one rule type
- Apply the AnomalyAlert migration that's already drafted but
  doesn't ship behaviour yet.
- Add `anomalyWindow` fold projection (per-tenant rolling totals).
- Add `anomalyDetection` reactor for `spend_spike` only first
  (cleanest mapping to the existing CostUSD field).
- Wire into `api.activityMonitor.recentAnomalies` (replaces current
  `[]` stub).
- Dogfood: create rule in Alexis's UI → curl violating event →
  alert appears on `/governance` within ~30s.

### C3 — Dispatch destinations
- Generic webhook + log-only first (matches PR #3351's
  triggerActionDispatch shape).
- Slack / PagerDuty / SIEM / email follow as per-destination
  adapter slices once the reactor pattern is proven.

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
- The poller-based AnomalyEvaluatorService design that was sketched
  but never shipped. Replaced by the anomaly reactor.

## Test strategy per slice

| Slice | BDD spec | Integration test | Dogfood |
|-------|----------|------------------|---------|
| C0 (this) | anomaly-detection.feature updated | n/a (doc + schema) | architecture review in-channel |
| C1 | activity-monitor pipeline scenarios in `activity-monitor.feature` | pipeline test: append event → projection fires → CH row | curl → 202 → CH SELECT |
| C2 | spend_spike scenario in anomaly-detection.feature | reactor test: violating fold state → AnomalyAlert.upsert called | UI rule + violating event → /governance shows alert |
| C3 | dispatch scenarios in anomaly-detection.feature | reactor test: dispatch helper called with right shape | webhook receives canonical body |

Each slice ships its own BDD + integration coverage before code
lands; production architecture is reactor-only — `evaluateNow`
appends a synthetic event and lets the reactor handle it (test
harness, not parallel code path).

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

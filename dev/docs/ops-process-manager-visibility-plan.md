# Plan: process-manager visibility in ops

Status: BUILT (all three phases; alert routes remain infra-side)
Date: 2026-08-13
Spec: [specs/ops/process-manager-visibility.feature](../../specs/ops/process-manager-visibility.feature),
[specs/ops/event-subscriber-visibility.feature](../../specs/ops/event-subscriber-visibility.feature)

**What shipped** (same day): `/ops/processes` — fleet strip + per-name table
(`listProcessFleet`), instance list with process-key search, instance drawer
(state JSON, paged outbox, per-message trace links from the stored carrier),
the audited actions (wake now, redrive dead — per message and per instance —
and release lapsed lease, every one landing in `AuditLog` under
`targetKind: "process_instance"` with a recent-actions list on the page), and
the `pm_*` Prometheus gauges (`process-manager/metrics.ts`, scrape-time
collect off the same fleet counts; per-pod global values — aggregate with
`max()`). The same page carries the **event subscribers** card: the registry
(`getEventSubscriberMetadata`) joined to the live pipeline tree and paused
keys, with pause/unpause through the existing pipeline controls at
`<pipeline>/subscriber/<name>`.

Implementation notes that differ from the sketch below:
- The fleet reads live in `ProcessOpsPrismaRepository` behind
  `ManagerExplorerService` (the existing PM ops home), not a new service.
- The cross-tenant aggregates use raw SQL with the tenancy guard's explicit
  `-- @tenancy` opt-out — the same posture as the substrate's own wake
  scanner. Keyed reads and every write stay on guarded queries carrying
  projectId (actions take the full ref for exactly this reason).
- **Deliberately no new index.** The model itself forbids casual index adds
  (a deploy-time CREATE INDEX share-locks the hottest write table — see the
  `ProcessManagerOutbox` schema comment); the existing
  `(status, nextAttemptAt, leasedUntil)` and per-ref indexes carry the
  queries at retention-bounded volumes. If the per-name groupBy ever hurts,
  the index is ops-managed via CREATE INDEX CONCURRENTLY per the
  table-purge runbook.
- Grafana alert routes on the `pm_*` gauges are a saas-infra change, tracked
  there, not here.

The `/ops` surface covers queues (groups, blocked, DLQ, parked), projections,
blobs, and the scheduler. The process-manager substrate (ADR-049) has **no
surface at all**: eight pipelines run durable processes through it today
(langy-conversation, gateway-spend, automations, topic-clustering, plus the
maintenance families), and when one sticks, the operator's only tools are
`psql` and grep.

## What exists (the machine we would be looking at)

```text
            event committed                      wake due
                 │                                  │
                 ▼                                  ▼
        ┌─ subscriber job ─┐              ┌─ processWakeWorker ─┐
        │  (GroupQueue)    │              │  scans nextWakeAt   │
        └────────┬─────────┘              └──────────┬──────────┘
                 │                                   │
                 ▼                                   ▼
        ┌──────────────── evolve(state, input) ───────────────┐
        │  pure: (prev, event|wake) → {state, nextWakeAt,     │
        │                              intents[]}             │
        └────────────────────────┬────────────────────────────┘
                                 │  ONE atomic commit (PG):
                                 ▼
   ┌───────────────────┬──────────────────────┬──────────────────────┐
   │ ProcessManager    │ ProcessManager       │ ProcessManager       │
   │ Inbox             │ Instance             │ Outbox               │
   │ (idempotency      │ (state, revision,    │ (pending→dispatched  │
   │  markers)         │  nextWakeAt)         │  |dead; attempts,    │
   │                   │                      │  nextAttemptAt,      │
   │                   │                      │  leasedUntil+token)  │
   └───────────────────┴──────────────────────┴──────────┬───────────┘
                                                         │
                                              ┌──────────▼──────────┐
                                              │ outboxDispatcher    │
                                              │ leases due pending, │
                                              │ delivers intents    │
                                              └─────────────────────┘
```

Retention is already centralized (`process-manager-maintenance` reaps inbox +
outbox by predicate across every processName — see its pipeline header for the
2.8M-row incident that forced that). Everything else is invisible.

## The failure modes an operator needs to SEE

Each of these is a real state the tables can be in; none of them reaches a
human today until a customer notices the symptom.

| Signal | Meaning | Where it hides |
| --- | --- | --- |
| `dead` outbox messages | Intents given up on — the effect never happened and never will until redriven | `Outbox.status = 'dead'`, count by processName |
| Overdue pending | Delivery failing and backing off; attempts climbing | `status = 'pending' AND nextAttemptAt < now - threshold` |
| Lapsed lease | A dispatcher died mid-delivery; the message waits out the full lease | `status = 'pending' AND leasedUntil < now` |
| Overdue wake | The wake worker is starved, dead, or the fleet was down | `Instance.nextWakeAt < now - threshold` (already indexed) |
| Stalled instance | Inbox rows arriving but revision not advancing | join inbox recency against `Instance.updatedAt` |

Worth stating on the surface itself: **the outbox lease is not renewed
mid-delivery** — a delivery that legitimately outlives its lease and a
dispatcher that died look identical until the fencing token check at
completion. The lapsed-lease panel must say "died OR still delivering", not
"died", or it will train operators to redrive in-flight work.

## Proposed surface

New page `/ops/processes`, laid out per `best_practices/ops-dashboard.md`
(strip → health → structure → detail; space proportional to trouble):

```text
┌ strip ─ Instances · Due wakes (overdue N) · Outbox pending · Dead ────┐
├ health ─ one line when clear; expands per processName when not ──────┤
├ table ─ one row per processName ─────────────────────────────────────┤
│  NAME              INSTANCES  OVERDUE WAKES  PENDING  LAPSED  DEAD   │
│  langy.conversation   1,204        0            3       0      0     │
│  automations            310        2 ⚠         41      1 ⚠    7 ⚠   │
├ detail ─ click a row → instance list; click an instance → drawer ────┤
└──────────────────────────────────────────────────────────────────────┘

Instance drawer (reuses the group-detail drawer idiom):
┌───────────────────────────────────────────────────────────────┐
│ automations / project_x / rule_42        [Traces] [Copy key]  │
│ Status: waiting · Revision 17 · Next wake in 4m               │
│ ── State ──────────────── structured first, JSON on toggle ── │
│ ── Outbox (1–20 of 34) ── per-message: intentType, status,    │
│    attempts, next attempt, lease; trace link from the         │
│    message's OWN traceCarrier (exact, not a text search)      │
└───────────────────────────────────────────────────────────────┘
```

The `traceCarrier` column is the quiet win: every outbox row already stores
the W3C carrier captured at commit, so the drawer links straight to the
producing trace via the existing `grafanaLinks` builders — no log grepping.

## Data plane

Request-time Postgres reads through the standard repository/service pair
(`processOps.repository.ts` → `processOps.service.ts` → `ops` router), gated
by `ops:view` like every other ops read. No ADR-090 snapshot involvement:
these are indexed PG aggregates, cheap at request time, and unlike the Redis
scans there is no per-pod divergence to reconcile. The dashboard tile (if we
want one later) can ride the existing detail cycle.

Index check before building:
- `Instance.nextWakeAt` — already indexed ✅
- `Outbox (processName, status)` — needed for the per-name counts
- `Outbox (status, nextAttemptAt)` — likely exists for dispatcher leasing;
  verify, add if not

Multitenancy note: these are platform-level tables keyed by
projectId/tenantId per row. The ops surface is cross-tenant by design (like
the queues page); every query still scopes or aggregates explicitly, never
`SELECT *` across payloads — and payloads/state may hold tenant data, so the
drawer shows state behind the same admin gate as job payloads on the queues
page.

## Actions (phase 2, `ops:manage`, audited)

Follow the scheduler pattern: every mutation lands in the existing ops audit
trail and surfaces in a "recent actions" list on the page.

| Action | Effect | Guard |
| --- | --- | --- |
| Wake now | `nextWakeAt = now` for one instance | Safe — `evolve` receives `now` and clamps; confirm names the process |
| Redrive dead message | `status = 'pending'`, `nextAttemptAt = now` (attempts kept) | messageKey idempotency makes double-delivery a no-op at the consumer; confirm |
| Redrive all dead for a processName | same, bulk | typed confirmation, canary-first like the DLQ redrive |
| Release lapsed lease | clear `leaseToken`/`leasedUntil` | states the "died OR still delivering" risk; the fencing token makes the worst case a duplicate the messageKey absorbs |

Explicitly NOT offered: editing instance state (domain-owned; an operator
mutation would fork it from what evolve derived), deleting instances
(retention owns that), and any per-message payload editing.

## Phasing

1. **Read-only** — page, per-name table, instance drawer, spec + tests.
   Pure addition; no schema change beyond the two indexes.
2. **Actions + audit** — the four mutations above, wired like the scheduler's.
3. **Signals** — Prometheus gauges (`pm_outbox_dead_total`,
   `pm_wakes_overdue`), a dashboard strip tile, and alert routes once the
   numbers have baselines.

## Open questions for review

- Does the instance list need server-side search (by processKey) on day one,
  or is per-name paging enough until someone asks?
- Should "overdue" thresholds be per-processName config or one global knob?
  (Proposal: one global knob to start; the table shows raw ages either way.)
- The lapsed-lease release: worth building at all, or does documenting "wait
  out the lease" cover the real cases? Leaning build-it-later — phase 3.

# ADR-090: One elected writer produces the ops snapshot every pod serves

**Date:** 2026-08-11

**Status:** Proposed

**Relates to:** [ADR-004](./004-docker-dev-environment.md) (process roles; the collector today runs in every role), [ADR-052](./052-automations-on-process-manager-substrate.md) (deleted the previous Redis leader lock in favour of revision fencing — the direction this ADR takes a reasoned exception to), [ADR-039](./039-outbox-heartbeat.md) (superseded; the leader-lock design 052 removed), [specs/ops/queue-discovery.feature](../../../specs/ops/queue-discovery.feature) (the last time per-pod ops scanning had to be reined in), [specs/event-sourcing/tenant-soft-cap.feature](../../../specs/event-sourcing/tenant-soft-cap.feature) (owns tenant parking — the concept this ADR's drill-down finally surfaces), [specs/event-sourcing/poison-group-park-guard.feature](../../../specs/event-sourcing/poison-group-park-guard.feature) (the *other* "park", which lives in the blocked set), [specs/ops/dashboard-latency.feature](../../../specs/ops/dashboard-latency.feature) (the latency and peak tiles this ADR relocates into the snapshot).

Behavioural contract: [specs/ops/shared-ops-snapshot.feature](../../../specs/ops/shared-ops-snapshot.feature). The presentation of this data — including the parked drill-down panel — is specified in [specs/ops/ops-dashboard-density.feature](../../../specs/ops/ops-dashboard-density.feature) against the conventions in [dev/docs/best_practices/ops-dashboard.md](../best_practices/ops-dashboard.md).

## Context

The ops dashboard is fed by `OpsMetricsCollector`, a per-process singleton that every pod with a Redis connection starts at boot — web pods and workers alike, with no role gate (`presets.ts`). Each collector scans the GroupQueue keyspace every 2 seconds, holds the result in process memory, and broadcasts it to that pod's SSE subscribers. Production runs on the order of fourteen pods, so the same scan runs fourteen times every 2 seconds, and each viewer's browser is pinned to whichever pod its SSE stream happened to land on.

Because a full scan fourteen times per 2 seconds would be ruinous, the per-pod scan samples: it reads the top and bottom `SUMMARY_TOP_N = 200` of each ready zset and `SRANDMEMBER`s at most 200 blocked groups. Everything derived from that sample inherits its blindness. The result is a page whose panels tell different stories about the same Redis:

| Panel | Source | Completeness |
|---|---|---|
| Blocked / Parked / Pending tiles, chart | `SCARD` / `ZCARD` per queue, collector, 2s | exact |
| Top Errors | blocked-with-error groups **within the 200-per-end sample** | sample |
| Blocked card | full `SSCAN` of the blocked set, per viewer, on mount | exhaustive |
| Anomalous tenants | `AnomalyStateStore`, the enqueue-rate breaker | different signal |
| Parked | nothing — counted, never enumerated | — |

Three concrete failures follow.

One word needs pinning down before the rest reads correctly. **"Parked" in this ADR always means tenant soft-cap parking** — a group moved out of the ready zset into a per-tenant parked set because its tenant is at its in-flight cap ([specs/event-sourcing/tenant-soft-cap.feature](../../../specs/event-sourcing/tenant-soft-cap.feature)). The GroupQueue has a second, unrelated "park": the poison-group guard parks a crash-looping group *into the blocked set* ([specs/event-sourcing/poison-group-park-guard.feature](../../../specs/event-sourcing/poison-group-park-guard.feature)), where it counts toward Blocked and surfaces through `getBlockedSummary`. The two never mix on the dashboard, and the Parked panel this ADR adds shows only the first kind. Both documents keep their own vocabulary; this ADR does not rename either.

**A count with no explanation.** Parked groups — groups a tenant's in-flight soft-cap moved out of the ready scan — are `ZCARD`ed for the tile and never enumerated anywhere. An operator seeing "Parked: 60" in warning orange scans the rest of the page for the cause and finds nothing: no errors (parked is not an error), no anomaly (a tenant can sit at cap with a flat enqueue rate), no blocked rows. The count was added so parking would be "visible instead of invisible backlog"; visibility stops at the integer.

**Sibling panels that disagree on method.** Top Errors is computed from the sample; the Blocked card SSCANs exhaustively. With a blocked set larger than the sample, the tile and the Blocked card say N while Top Errors misses clusters entirely — on the same screen.

**No two viewers see the same dashboard.** Each pod's collector has its own snapshot, its own 900-point throughput history, and its own recorded peaks. Two browser tabs whose SSE streams landed on different pods render different charts of the same queue. The per-viewer card queries (`getBlockedSummary` SSCANs the whole blocked set once per viewer per mount) add load that scales with open tabs.

```text
                       today: N pods × own scan × own truth

     ┌───────────── pod 1 ─────────────┐
     │ collector: sampled scan @2s     │──SSE──► tabs on pod 1 (history A)
     │ own peaks, own 30min history    │
     └─────────────────────────────────┘
Redis◄──── … ×14 identical scan loops …
     ┌───────────── pod N ─────────────┐
     │ collector: sampled scan @2s     │──SSE──► tabs on pod N (history B)
     └─────────────────────────────────┘
       ▲
       └── per-viewer card queries (Blocked SSCAN per tab, listQueues @10s/tab)
```

The sampling is not a presentation choice; it is a consequence of the topology. Work done per-pod-per-2s must be cheap, so it cannot be exhaustive. Fix the topology and the sampling has no reason to exist.

Two in-repo precedents frame the solution space. The trace facet cache already uses a Redis `SET NX EX` leadership lease (`DISCOVER_REFRESH_LOCK_CACHE.claim()`) so "only one pod in the fleet pays the compute cost per refresh window" while every pod reads the shared result. The scheduler, by contrast, deliberately rejects leader election in favour of idempotent per-row claims — but its reasoning cuts the other way here: the scheduler coordinates *mutations*, where a missed or doubled fire matters, and idempotent claims make coordination unnecessary. The ops scan is *read-side*: running it twice is merely wasteful, running it zero times for a lease-TTL window is merely stale. Those are exactly the failure modes a crash-expiring lease handles well, and none of the ones it handles badly.

## Decision

**One elected writer produces the dashboard; every pod serves it.** All pods that today start a collector instead compete for a Redis lease (`SET ops:snapshot:lease <token> NX EX 10`, renewed each cycle, released on graceful shutdown). The holder runs the scans and persists the result to Redis; every pod — holder included — reads that persisted snapshot to feed its SSE subscribers and tRPC procedures. The pod-local scan path is deleted, not kept as a fallback: with any pod alive the lease is won within a cycle or two of boot, and with Redis down there is no dashboard to feed anyway.

```text
                    target: one writer, one truth, N servers

      every pod, every 2s: try/renew lease ──► loser: read-only
                                 │
                          winner (any role)
                 ┌───────────────┴────────────────┐
                 │  live cycle @2s   (cheap)      │
                 │  detail cycle @15s (exhaustive)│
                 └───────────────┬────────────────┘
                                 ▼
              Redis  ops:snapshot:live    (EX 60)
                     ops:snapshot:detail  (EX 300)
                                 ▲ GET @2s
                 ┌───────────────┼────────────────┐
               pod 1           pod 2     …      pod N
                 │SSE            │SSE             │SSE
                 ▼               ▼                ▼
              every tab renders the SAME snapshot, same history,
              same peaks, stamped with computedAt + writerId
```

**Two artifacts on two cadences.** The tiles' liveness and the detail's exhaustiveness have different costs, so they are separate keys written on separate cycles by the same holder:

- `ops:snapshot:live`, every 2s — exact per-queue counts (`ZCARD` ready, `SCARD` blocked/dlq, parked per-tenant `ZCARD` sum), the total-pending counter, throughput rates derived from the stats counters, latency percentiles, Redis `INFO` stats, recorded peaks, and the rolling 30-minute throughput history. Small — O(queues) plus the history array.
- `ops:snapshot:detail`, every 15s — the exhaustive material the per-pod topology could never afford: a full `SSCAN` of every blocked set with error-hash clustering (the existing `getBlockedSummary` logic, now run once per interval fleet-wide instead of once per viewer), **parked enumeration** (one row per over-cap tenant: tenant, queue, group count, oldest-parked age, cap), the top-N group rows, and the pipeline tree. Top Errors is computed from the exhaustive blocked clusters — the tile, the Top Errors panel, and the Blocked card now derive from one artifact and cannot disagree.

Both artifacts carry `version`, `computedAt`, `writerId`, and `leaseEpoch`. Readers validate with Zod; an unknown `version` is treated as an absent snapshot (the reader waits rather than misrenders). The detail cycle runs from the holder's 2s loop when `lastDetailAt` is 15s old, asynchronously, so a slow exhaustive scan can never starve lease renewal; it can only make the detail artifact stale, which `computedAt` makes visible.

**Parked gets a drill-down, bounded by design.** The snapshot carries tenant rows — the naturally small set (one per over-cap tenant) — and the UI's new Parked card expands a tenant through a live tRPC query (`listParkedGroups`) that pages that tenant's parked zset on demand. Group-level detail is one click away without ever shipping unbounded group rows in the snapshot.

**Read panels serve the snapshot; actions and drill-ins stay live.** Tiles, chart, pipeline tree, Top Errors, the Blocked/DLQ/Groups summaries, parked tenant rows, and the nav badge all read the shared snapshot (the per-viewer SSCAN in `getBlockedSummary` becomes a snapshot read). Mutations — unblock, redrive, move-to-DLQ — and pagination drill-ins (job browsing, group jobs, parked groups) keep hitting live Redis, so an operator always acts on current state, never on a 15-second-old row.

**Every cap is labelled.** Where the detail artifact bounds anything (cluster rows, tenant rows, group rows, a serialized-size guard), it records `truncated` / `sampled` counts and the UI renders "showing N of M" — the honest-trade convention the blob-store ops pages already follow. Silent truncation is what this ADR exists to remove; reintroducing it quietly inside the snapshot would be the same bug with better plumbing.

**Peaks and chart history move into the snapshot; the reconcile is left alone.** `ops:metrics:state` is subsumed — peaks and the rolling history live in the snapshot itself, so they survive writer failover and, for the first time, are the same in every browser tab. On first write the holder seeds them from the legacy key if present; the key then ages out through its existing 1-hour TTL.

The pending-counter reconcile is deliberately **out of scope**. It looks like fleet-duplicated work — every pod runs the loop every 60s — but it is already coordinated: [specs/ops/pending-counter-reconcile.feature](../../../specs/ops/pending-counter-reconcile.feature) specifies a cross-instance single-flight marker, down to what a pass that loses the marker mid-run may publish (nothing) and what the write does without the marker (refuses). Every pod *attempts*; one *runs*. Gating it on the snapshot lease as well would stack two coordination mechanisms over one loop, and would make several of that spec's scenarios unreachable — a pod that never attempts can never decline, and can never lose a marker it never held. The reconcile keeps its marker and its interval, on every pod, unchanged by this ADR.

## Rationale / Trade-offs

**Why a lease, when the scheduler said no to one.** The scheduler's no-leader design exists because its work is effectful and must fire exactly-once-ish; idempotent claims give that without coordination. Snapshot production is idempotent by nature — it writes derived truth, so a brief double-writer after a lease expiry means two pods wrote the same facts and last-write-wins is harmless, and a brief zero-writer window means the dashboard is a few seconds stale, which `computedAt` surfaces. The lease is doing the only job it is good at: cost deduplication, not correctness.

**Why a Redis lock at all, when ADR-052 deleted the last one.** This needs answering directly, because the repo moved the other way once already. ADR-052 deleted the outbox heartbeat's Redis leader lock and replaced it with process-manager revision fencing, "so racing wake workers stand down instead of racing for a lock" — and the failure it was fixing was real: pending settlement vanished on a Redis flush while a Postgres audit table went on implying durability.

Revision fencing works by making the *durable* record of the work the arbiter — a wake carries a revision, and a worker whose revision is stale stands down without needing mutual exclusion. That mechanism needs something durable to fence on. Snapshot production has nothing of the kind and should not acquire one: it derives a cache from Redis, on a 2-second cadence, and nothing downstream is owed a durable record that a particular refresh happened. Putting it on the process-manager substrate would mean minting durable wakes at 2s for work whose entire output is disposable — the inverse of the trade 052 made, which moved *durable* concerns off an ephemeral mechanism.

The distinction that matters is what the coordination is protecting. ADR-052's lock guarded an effect that had to happen and had to happen once; losing the lock's guarantees lost work. Here the lease guards *cost*: both of its failure modes — two writers briefly writing identical derived facts, or no writer for a lease TTL — are visible and self-correcting, and neither loses anything that existed. A Redis flush is likewise not the 052 failure in miniature: nothing here implies durability that Redis is not providing, because the queue state being described lives in that same Redis. What a flush does cost is peaks and chart history, which is called out in Consequences rather than hidden.

This is therefore a scoped exception to 052's direction, not a reversal of it: durable, effectful coordination continues to use revision fencing; a disposable read-side cache refresh uses a lease.

**Why not pin the writer to a role.** Pinning to workers makes dashboard freshness depend on the workers deployment being healthy — which is exactly what the operator is often using the dashboard to diagnose. Pinning to web lands the exhaustive scan on customer-serving pods by *requirement* rather than by chance. Letting every collector-running pod compete means the dashboard degrades only when the whole fleet does.

**Why polling GETs instead of pub/sub push.** Each pod GETs two keys every 2 seconds — tens of commands per second fleet-wide, noise next to the scan traffic being deleted. Pub/sub would add a subscription lifecycle, reconnect handling, and a second delivery path to test, to shave at most one 2-second beat of latency off a dashboard.

**Why delete the local-scan fallback instead of keeping it as degraded mode.** Keeping it means maintaining the sampled path forever — the very code this replaces — and testing a mode that only manifests during the exact incidents when surprises are least affordable. The failure it would cover (no pod can win the lease, but pods are otherwise healthy and Redis is up) is not a real state: lease acquisition is one `SET NX` against the same Redis the fallback would scan.

**What is accepted.** Detail panels are up to ~15s + one GET cycle stale, stamped and visible. On writer failover, rate derivation loses one baseline cycle (rates need the holder's previous counter reading; the new holder's first cycle emits carried-forward values) — the same gap a pod restart causes today, now at most once per failover instead of once per pod. During a rolling deploy that changes the snapshot `version`, new-version readers wait until a new-version pod holds the lease; graceful-shutdown lease release bounds that to one pod-termination cycle.

## Consequences

- The fleet runs **one** scan loop instead of ~14, and the scan can therefore afford to be exhaustive: full blocked clustering, full parked enumeration. `SUMMARY_TOP_N` sampling survives only where it is honest and labelled (group rows), not as the hidden basis of Top Errors.
- Every viewer sees the same numbers, the same chart history, and the same peaks, with an explicit `computedAt` (surfaced through `ConnectionStatusIndicator`) instead of an implicit per-pod truth.
- "Parked: 60" is now clickable down to tenant and group — the count finally explains itself. Parked ≠ broken is legible on the page: a parked tenant row shows cap and drain state, not an error.
- Per-viewer read load stops scaling with open tabs; `getBlockedSummary`'s per-mount full SSCAN disappears.
- New moving part: the lease. Its failure modes are bounded and visible (stale `computedAt`, writer churn in logs via lease acquire/release lines), but it is one more thing to reason about during incidents; `writerId` in the snapshot says who to look at.
- `OpsMetricsCollector` splits into a writer (scan + persist, lease-gated) and a reader (GET + merge + emit); the router-facing surface (`getDashboardData`, `getBadgeCounts`, the SSE emitter) keeps its shape so `ops.ts` and the frontend change minimally. The `DashboardData` wire shape gains staleness fields and parked tenant rows.
- Local dev is unchanged in behaviour: a single `pnpm dev` process wins the lease trivially and is both writer and reader.
- This is an internal, admin-gated surface; no new customer-facing error codes are introduced. Absence of a snapshot renders the existing loading state; staleness renders as status, not as a toast.
- **A Redis flush now costs peaks and chart history.** Counts, clusters and parked rows rebuild within a cycle — they are derived from the same Redis that was flushed, so there is nothing to lose. Peaks and the 30-minute history are different: they are accumulated, not derived, and today survive a process restart in `ops:metrics:state`. Folding them into the snapshot keeps that property against restarts and failover but not against a flush. Accepted deliberately — the alternative is a durable store for a number whose only consumer is a dashboard tile, which is the shape ADR-052 spent a release removing. The tiles reset and re-accumulate; nothing else notices.
- **Rollback is a redeploy.** The per-pod scan path is deleted, so reverting means shipping the previous image; there is no flag that restores local scanning. This is deliberate — a flag would keep the sampled path alive to be maintained and tested — but it means a regression here cannot be mitigated in-place, only rolled back.
- [specs/ops/dashboard-latency.feature](../../../specs/ops/dashboard-latency.feature) needs updating in the same change: it frames peaks per-process ("since the last process restart", "across collections"), which describes the topology this ADR ends. Its assertions still hold; its framing does not.

## References

- Behavioural contract: [specs/ops/shared-ops-snapshot.feature](../../../specs/ops/shared-ops-snapshot.feature)
- Prior art in-repo: trace facet discover cache leadership lease (`trace-list.service.ts`); `AnomalyStateStore` (persisted, shared, all-frontends-read — the model this generalises); blob-store ops honest-sampling convention (`OPS_BLOB_SORTS` doc comment)
- Counter-precedents addressed: scheduler no-leader design (`scheduler.service.ts`); [ADR-052](./052-automations-on-process-manager-substrate.md) §"Deletion and cutover", which deleted the Redis leader lock that [ADR-039](./039-outbox-heartbeat.md) introduced
- Out of scope, and why: [specs/ops/pending-counter-reconcile.feature](../../../specs/ops/pending-counter-reconcile.feature) (single-flight marker, #4683)
- Vocabulary: [specs/event-sourcing/tenant-soft-cap.feature](../../../specs/event-sourcing/tenant-soft-cap.feature) (parked = over cap) vs [specs/event-sourcing/poison-group-park-guard.feature](../../../specs/event-sourcing/poison-group-park-guard.feature) (parked = into the blocked set)

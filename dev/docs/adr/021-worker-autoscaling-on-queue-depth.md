# ADR-021: Autoscale event-sourcing workers on queue depth

**Date:** 2026-05-28

**Status:** Proposed

## Context

The `langwatch-workers` deployment runs the event-sourcing dispatch and job
processing loops. Each pod runs up to `GLOBAL_QUEUE_CONCURRENCY` (default 100)
concurrent jobs, and the binding throughput limiter for dispatch is the
single-threaded Redis instance that backs the GroupQueue, not pod CPU.

The deployment autoscales on a single signal: CPU utilization at a 70 percent
target (HorizontalPodAutoscaler, min 4, max 20). That signal does not track the
work the pool actually has to do. Workers spend most of their time blocked on
Redis (waiting on `brpop`, running dispatch Lua, reading and writing job state),
so per-pod CPU stays low even when the queue is deep. Under a large backlog the
pods sit around 25 to 30 percent CPU with thousands of jobs pending, well under
the 70 percent target, so the HPA never scales out and the pool stays pinned at
its minimum. Capacity cannot grow in response to backlog pressure, which is the
exact condition under which more capacity would help.

The cluster today has `metrics-server` (CPU and memory only) and a
`prometheus-server`, but Prometheus is not wired into the Kubernetes
custom-metrics or external-metrics API, and KEDA is not installed. So there is
currently no path for an HPA to scale on a queue-length signal.

Two adjacent constraints shape the decision:

- The single-threaded Redis dispatch path puts a ceiling on how many pods are
  useful. Past a point, additional pods add dispatch loops that contend for the
  one Redis thread without improving throughput, so the maximum replica count
  must stay bounded rather than scaling unboundedly with backlog.
- This lever only becomes binding once per-tenant fair dispatch
  (see `specs/event-sourcing/work-conserving-fair-dispatch.feature`) removes the
  fixed per-tenant cap. While a fixed cap is in force, idle slots can coexist
  with a deep backlog because capped tenants cannot reach the free slots, so pod
  count is not the limiter. Once dispatch is work-conserving, a sustained
  backlog with all slots full is a true signal that more pods would drain
  faster.

## Decision

We will scale `langwatch-workers` on GroupQueue depth, using KEDA with its Redis
scaler reading the queue length directly from Redis. KEDA owns the underlying
HPA and polls the queue-depth trigger; the deployment scales out when
backlog-per-pod exceeds a target and scales back in as it clears. CPU stays as a
secondary trigger so a CPU-bound workload still scales, but queue depth becomes
the primary signal.

The maximum replica count stays bounded at a value tuned to where additional
pods stop improving dispatch throughput against single-threaded Redis, rather
than scaling unboundedly with backlog. Scale-down uses a stabilization window so
a draining backlog does not thrash the pool. Pod churn during scale events is
safe because the in-flight accounting self-heals: a slot held by a terminated
pod lapses out of the live count by score expiry (see ADR and the tenant
in-flight ZSET introduced for self-healing on ungraceful worker death), so
scaling in does not strand work.

## Rationale / Trade-offs

KEDA is chosen over a Prometheus-adapter custom metric because the signal we
need (queue length) lives in Redis and KEDA reads it directly with a
purpose-built trigger. The Prometheus-adapter path would require instrumenting
the worker to export a queue-depth gauge, scraping it, and standing up
prometheus-adapter to bridge Prometheus into the custom-metrics API. That is
more moving parts for a value KEDA can read at the source. The trade-off
accepted is a new cluster component (KEDA) and its operator, against avoiding
app-side metric instrumentation and a metrics-adapter deployment.

Raising `minReplicas` was rejected as a blunt alternative: it pays for capacity
at idle to cover bursts, and still does not respond to backlog beyond the new
floor.

The depth signal should reflect dispatchable work. With work-conserving
dispatch the natural measure is the total queued-but-not-in-flight job count
across the per-tenant ready lanes; the exact key and the backlog-per-pod target
are implementation details for the rollout, sized so the pool scales toward
`maxReplicas` only under a backlog the current pods cannot drain.

## Consequences

- KEDA is added to the cluster and a `ScaledObject` replaces the CPU-only HPA
  for `langwatch-workers`, configured in the infrastructure repository.
- The pool grows under sustained backlog and shrinks as it clears, within a
  bounded replica range, instead of staying pinned at the minimum while a deep
  queue waits.
- The maximum replica count remains a deliberate ceiling tied to single-threaded
  Redis dispatch capacity, not an open-ended function of backlog.
- This change is sequenced after work-conserving fair dispatch lands, since pod
  count is not the binding limiter while a fixed per-tenant cap can leave slots
  idle behind capped tenants.

## References

- Related specs: `specs/event-sourcing/work-conserving-fair-dispatch.feature`,
  `specs/event-sourcing/tenant-soft-cap.feature`
- Related ADRs: 006-worker-architecture, 007-event-sourcing-architecture
- `GLOBAL_QUEUE_CONCURRENCY` default and the single-thread Redis dispatch note:
  `langwatch/src/server/event-sourcing/queues/groupQueue/groupQueue.ts`,
  `langwatch/src/server/event-sourcing/queues/groupQueue/scripts.ts`

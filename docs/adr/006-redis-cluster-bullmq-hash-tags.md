# ADR-006: Redis Cluster Hash Tags for BullMQ Queue Names

**Date:** 2026-02-09

**Status:** Accepted

## Context

LangWatch uses BullMQ for background job processing. BullMQ creates multiple Redis keys per queue (`bull:<name>:wait`, `bull:<name>:active`, `bull:<name>:completed`, etc.) and uses Lua scripts that touch them atomically.

When deployed with Redis Cluster (e.g., AWS ElastiCache), Redis distributes keys across slots by hashing the full key name. This means the keys for a single queue land on different slots, causing Lua scripts to fail with `CROSSSLOT Keys in request don't hash to the same slot`.

Redis Cluster provides [hash tags](https://redis.io/docs/reference/cluster-spec/#hash-tags) — when a key contains `{braces}`, only the content inside the first pair of braces is hashed. This guarantees all keys sharing the same hash tag land on the same slot.

LangWatch has queue names defined across several domains:
- Background worker queues (collector, evaluations, topic_clustering, etc.)
- Event sourcing maintenance worker
- Event sourcing pipeline queues (dynamically created per handler/projection/command)
- Scenario execution queue

All of these must work correctly on Redis Cluster.

## Decision

We wrap all BullMQ queue names in Redis Cluster hash tags using a single shared utility:

```typescript
// src/server/background/queues/makeQueueName.ts
export function makeQueueName(name: string): string {
  if (name.startsWith("{") && name.endsWith("}")) {
    throw new Error(`Queue name "${name}" is already wrapped in hash tags`);
  }
  return `{${name}}`;
}
```

All queue name construction sites use this function:
- Static queue constants in `background/queues/constants.ts`
- Event sourcing worker queue in `background/workers/eventSourcingWorker.ts`
- Scenario queue in `scenarios/scenario.constants.ts`
- Dynamic pipeline queues via `QueueProcessorManager.makePipelineQueueName()`

We use **per-queue hash tags** (each queue has its own tag) rather than a shared tag like `{bull}`. This distributes load across Redis Cluster slots instead of concentrating all queues on a single slot.

### Deployment Strategy

This is a queue name rename. Deploying requires care to avoid job loss:

1. **Drain queues** — Wait for in-flight jobs under old names to complete. Monitor via BullBoard or the migration script's dry-run mode.
2. **Deploy atomically** — Workers and producers must be deployed together. In containerized deployments (ECS, Kubernetes), this happens naturally when both run in the same service. If separate, deploy workers first.
3. **Clean up** — Run `scripts/migrate-queue-names.ts --cleanup` to remove orphaned keys under old names.

For environments where zero-downtime is critical, a staged migration is possible:
1. Deploy workers that listen on both old and new queue names
2. Switch producers to write to new names
3. Wait for old queues to drain
4. Remove old queue listeners

### Enforcement

- `makeQueueName` throws if called with an already-wrapped name (prevents double-wrapping)
- Integration tests verify every queue constant contains a hash tag
- Tests against a real Redis Cluster prove CROSSSLOT fails without tags and succeeds with them

## Rationale / Trade-offs

**Why per-queue tags instead of a shared `{bull}` prefix:**
A shared tag forces all queues onto one Redis Cluster slot, defeating the purpose of sharding. Per-queue tags (`{collector}`, `{evaluations}`, etc.) distribute across slots via CRC16 hashing. The trade-off is that slot distribution depends on the hash of each tag — some nodes may get more queues than others. This is acceptable because queue-level load is already uneven (collector handles far more throughput than usage_stats).

**Why a simple wrapper function instead of a branded type:**
A branded `QueueName` type would provide compile-time enforcement but adds complexity for minimal gain. The idempotency guard catches the most likely mistake (double-wrapping), and integration tests catch any missing hash tags. If future refactoring introduces more queue name sources, a branded type can be added later.

**Why queue constants remain in their domain files:**
The event sourcing queue name belongs with `eventSourcingWorker.ts`. The scenario queue belongs with `scenario.constants.ts`. Pipeline queues are inherently dynamic. Forcing all names into one file would create coupling between unrelated domains. The unifying pattern is `makeQueueName()`, not file co-location.

**Observability impact:**
Queue names now include braces in logs, metrics, and span attributes (`{collector}` instead of `collector`). Dashboards and alerts that filter on queue names need updating after deployment.

## Consequences

**Positive:**
- BullMQ works correctly on Redis Cluster (eliminates CROSSSLOT errors)
- Single utility function prevents accidental regressions
- Per-queue tags distribute load across cluster slots
- Integration tests with real Redis Cluster provide confidence

**Negative:**
- Queue name rename orphans in-flight jobs under old names (mitigated by migration script)
- Braces appear in all observability output (logs, metrics, traces)
- Deployment requires coordination or draining (documented above)

**Neutral:**
- No performance impact — hash tag parsing is done by Redis, not application code
- Standalone Redis deployments are unaffected (hash tags are ignored)

## References

- Redis Cluster hash tags: https://redis.io/docs/reference/cluster-spec/#hash-tags
- BullMQ Redis Cluster guide: https://docs.bullmq.io/guide/going-to-production#redis-cluster
- GitHub issue: https://github.com/langwatch/langwatch/issues/1419
- Migration script: `langwatch/scripts/migrate-queue-names.ts`

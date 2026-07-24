# ADR-021: Lean Fold Cache — cache the read-set, persist the write-set

**Date:** 2026-05-27

**Status:** Superseded — split between [ADR-066](./066-projection-clickhouse-cached-store.md) and [ADR-022](./022-event-log-source-of-truth.md)

## Superseded

This ADR explored keeping the Redis fold cache lean while the projection store, the cache, and the heavy trace IO were still one tangled concern. Its decisions now live in two places, and you should read those instead of the history here:

- **Fold-store & cache mechanics** — how a projection reads and writes its state, why the store reads its own last committed state instead of refolding from `event_log`, and why caching is part of the storage design rather than an opt-in accelerator — are owned by [**ADR-066: Projection state storage — the ClickHouse-cached store**](./066-projection-clickhouse-cached-store.md).
- **Heavy-content leanness** — keeping large IO out of the cache, the event log as the single source of truth, and S3 as a transient spool — is owned by [**ADR-022: event_log as single source of truth**](./022-event-log-source-of-truth.md), which restates the rules that remain in force so you don't need this document.

The original exploration (edge offload, the `toCacheable` secondary defence, the rejected `accumulateIO` refactor, and the read-time-recompute fork) is preserved in git history for anyone tracing *why* the current shape was chosen. It is intentionally not reproduced here — the two ADRs above are the current, self-contained record.

# ADR-014: Remove BullMQ dependency and queue browser from Skynet

**Date:** 2026-03-28

**Status:** Accepted

## Context

Skynet originally served two purposes: (1) group queue monitoring — real-time observability for the custom Redis-based group queue system, and (2) BullMQ queue browsing — a generic job inspector for BullMQ queues (view jobs by state, retry failed jobs, browse queue contents).

The BullMQ queue browser added significant code surface: a service layer (`bullmqService.ts`), API routes (`bullmq.ts`), and 5 UI pages/components (`QueueListPage`, `QueueDetailPage`, `ErrorInspectorPage`, `FailedJobsList`, `QueueOverview`). It also pulled in `bullmq` as a runtime dependency.

With the migration away from BullMQ to the custom group queue system, all BullMQ queue types have been removed from the application. The BullMQ code in Skynet became dead — no queues to browse, no jobs to inspect.

## Decision

We will remove all BullMQ-related code from Skynet: the runtime dependency, service layer, API routes, UI pages, and shared type definitions. Skynet focuses exclusively on group queue monitoring.

## Rationale / Trade-offs

The queue browser feature was useful when BullMQ queues existed, but maintaining dead code increases cognitive load, dependency surface, and bundle size for zero value. Removing it now (rather than leaving it dormant) avoids the risk of it bit-rotting further and confusing future contributors.

If a generic job queue browser is needed again in the future, it should be built as a separate tool or re-added with the appropriate queue backend — not resurrected from this removed code.

## Consequences

- **Reduced attack surface:** `bullmq` runtime dependency removed from `package.json`.
- **Smaller codebase:** ~2,000 lines of dead code removed (8 files deleted, types purged).
- **Clearer purpose:** Skynet's scope is now unambiguous — it monitors group queues only.
- **Lost capability:** No generic BullMQ job browser exists anymore. This is acceptable because no BullMQ queues exist in the system.

## References

- PR: feat/skynet-overhaul (removes BullMQ alongside terminology, accuracy, and filter improvements)

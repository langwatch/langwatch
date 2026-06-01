# ADR-024: `.withOutbox` as a pipeline-builder primitive

**Date:** 2026-05-28 (revised 2026-06-01 alongside [ADR-021](./021-transactional-outbox-for-stake-sensitive-dispatch.md))

**Status:** Accepted (revised)

## Context

The existing pipeline builder (`StaticPipelineBuilder` in `event-sourcing/pipeline/staticBuilder.ts`) exposes `.withReactor(projectionName, reactorName, definition)` for registering post-projection side-effect handlers. Every reactor in the system runs through this single API. Whether a reactor is **best-effort** (UI broadcast, fold sync, cache invalidation — dropping one invocation is fine) or **stake-sensitive** (customer email, dataset write — dropping one invocation is a real problem) is entirely implicit: nothing in the type system, nothing in the registration call, nothing in the reactor's handler signature distinguishes the two.

The default execution model is "best-effort with silent failure" — fine for broadcasts, wrong for emails. The risk is that an author writes a new auditable reactor, uses `.withReactor` because it's the only option, and the system silently drops invocations on the first transient failure.

[ADR-021](./021-transactional-outbox-for-stake-sensitive-dispatch.md) introduces the transactional outbox as the framework substrate for stake-sensitive dispatch. This ADR records how that substrate is exposed to reactor authors.

## Decision

Add `.withOutbox(projectionName, reactorName, definition)` to `StaticPipelineBuilder` as a sibling to `.withReactor`. The choice between the two is required at registration time. There is no flag, no default that "promotes" a reactor between modes.

The two definition types have distinct shapes:

```ts
// Existing — extended with isReplay
type ReactorContext<FoldState> = {
  // ...existing fields...
  isReplay: boolean;   // true when the event was produced by a stream replay
};

type ReactorDefinition<Event, FoldState> = {
  handle: (event: Event, context: ReactorContext<FoldState>, deps: Deps) => Promise<void>;
  options?: { makeJobId, ttl, delay };
};

// New
type OutboxReactorDefinition<Event, FoldState> = {
  match: (event: Event, context: ReactorContext<FoldState>, deps: Deps) => Promise<OutboxEntry[] | null>;
  dispatch: (payloads: unknown[], ctx: DispatchContext, deps: Deps) => Promise<void>;
  groupKey: (entry: OutboxEntry) => string;
  cadenceWindowMs: (entry: OutboxEntry) => number;
  retryPolicy?: { maxAttempts: number; backoffMs: (attempt: number) => number };
};
```

`match` runs in the event-sourcing queue with the existing `_originGuardedReactor` guards (loop prevention, stale-event filter, 24h trace-age cap). It returns the outbox entries to persist; it does NOT perform side effects.

**Replay safety for `.withOutbox`**: the framework wrapper short-circuits `match` when `context.isReplay === true` — no outbox row is inserted, no wakeup is scheduled. Without this, replaying historical events (after the outbox row's 30/90-day retention has pruned the original dispatch record) would insert fresh `queued` rows and re-fire customer-visible side effects. `match` may still inspect `context.isReplay` directly for reactor-specific replay handling, but the safe default is on by construction. `.withReactor` handlers receive the same flag and are expected to make their own call — best-effort reactors generally don't need it, but having the field present at registration time costs nothing and avoids a coordinated context-shape migration later.

`dispatch` runs in the outbox dispatch worker. It receives the batched payloads for a triggered wakeup, performs the actual side effect, and throws `DispatchError` ([ADR-027](./027-typed-dispatcherror-contract.md)) on failure.

**Folder layout** (framework code; domain code stays adjacent to other reactors):

```text
src/server/event-sourcing/
  outbox/                              -- framework primitive
    outbox.types.ts                   -- OutboxReactorDefinition, OutboxEntry, DispatchError
    outboxDispatchQueue.ts            -- GroupQueue registration + processor
    outbox.service.ts                 -- dispatchOnce, drainNow, listRecentDispatches
    repositories/
      outbox.repository.ts
      outbox.prisma.repository.ts
    __tests__/
  pipeline/
    staticBuilder.ts                  -- modified to add .withOutbox
  pipelines/<pipeline>/reactors/
    alertTrigger.outboxReactor.ts     -- domain-specific match + dispatch
```

The framework wrapper invoked by `.withOutbox` is responsible for:

1. Wrapping `match` in `_originGuardedReactor` guards.
2. Gating queue enqueue on `TriggerSent.claimSend` (or equivalent reactor-defined claim).
3. Calling `outboxDispatchQueue.send(payload, { delay: cadenceWindowMs, deduplication: { makeId: dedupKey, extend: false, replace: false } })`.

   The queue's `PgOutboxAuditAdapter` writes the `ReactorOutbox` row via its `onEnqueue` hook ([ADR-021](./021-transactional-outbox-for-stake-sensitive-dispatch.md) revision). There is **no** separate `createMany skipDuplicates` step in the wrapper — the queue's dedup config is the replay-safety mechanism, and the adapter mirrors the resulting transition to PG.

The reactor author writes `match` and `dispatch`; everything else is provided.

The wrapper itself is unchanged at the call-site level (reactor authors don't care which side of the queue/PG boundary writes the audit row), but the implementation behind it is queue-driven post-revision rather than PG-polled.

## Rationale

### Why a distinct API, not a flag

The two reactor classes have genuinely different shapes:

- `.withReactor` reactors do everything in one handler; they have no concept of "match phase" vs "dispatch phase."
- `.withOutbox` reactors must split because the match runs synchronously with the event stream (for loop-prevention guards) and the dispatch runs asynchronously (for retry, cadence, durability).

A single `.withReactor(..., { durable: true })` flag would force the API to accept both shapes through one entry point, awkwardly. A separate builder method makes the intent explicit and the type errors helpful when an author tries to do the wrong thing.

### Why framework code lives in `event-sourcing/outbox/`, not `app-layer/`

The outbox is sibling-level infrastructure to `event-sourcing/queues/`, `event-sourcing/reactors/`, `event-sourcing/commands/`, `event-sourcing/projections/`. It is not domain-specific — it will eventually serve every stake-sensitive reactor in the codebase, not just triggers.

App-layer code (the trigger-specific match/dispatch logic) stays in `app-layer/triggers/` and `event-sourcing/pipelines/<pipeline>/reactors/`. Framework vs domain separation matches the rest of the event-sourcing module.

### Why `evaluationTrigger` stays on `.withReactor`

`evaluationTrigger.reactor` does not dispatch side effects — it issues commands (`scheduleEvaluation`) that the event-sourcing system processes in-band. Its outputs are events, not API calls to external systems. Outbox is for **out-of-band side effects** (HTTP calls, DB writes the framework doesn't own). `evaluationTrigger` is firmly in-band and stays on `.withReactor`.

## Consequences

- **Two reactor builder methods.** Authors must decide at registration time. Reviewers can see the choice in the pipeline registration without reading the handler.
- **Type-level distinction.** `.withReactor` accepts `ReactorDefinition`; `.withOutbox` accepts `OutboxReactorDefinition`. The TypeScript compiler enforces the right shape per method.
- **New framework module.** `src/server/event-sourcing/outbox/` lives alongside `queues/`, `reactors/`, `commands/`. Adds modest top-level surface but matches the existing organization.
- **Backwards-compatible.** Every existing `.withReactor` call is unchanged. Migration to `.withOutbox` is opt-in, one reactor at a time.
- **Future framework additions** (e.g., new dispatch handler types, per-reactor retention overrides) extend `OutboxReactorDefinition` without touching `ReactorDefinition`.
- **The default for new reactors should be `.withReactor`** unless the side effect is auditable. Reactors-that-might-need-retry can always be promoted later.
- **Customer-supplied destinations are out of scope for v1, but the `dispatch` handler is endpoint-agnostic by design.** Today's Slack/email targets are fixed providers (Slack incoming webhooks the customer enters, but the request shape and TLS endpoint are Slack's; SES/SendGrid for email). The moment a customer-defined webhook URL lands as a trigger destination, the framework needs: SSRF blocking (deny private IP ranges, link-local, cloud-metadata endpoints like `169.254.169.254`); HMAC request signing so receivers can verify origin; payload size caps; per-destination secret encryption at rest. These are framework concerns, not per-endpoint concerns — every future customer-webhook-like dispatch should share one outbound utility rather than each `dispatch` reinventing them. Captured here so the next reactor author knows to extend the shared utility, not roll their own `fetch`.

## References

- [ADR-021](./021-transactional-outbox-for-stake-sensitive-dispatch.md) — the outbox pattern this API exposes
- [ADR-023](./023-groupqueue-wakeup-pattern-for-outbox.md) — how the framework wrapper schedules dispatch
- [ADR-027](./027-typed-dispatcherror-contract.md) — error contract `dispatch` must satisfy
- ADR-007 — event-sourcing pipeline-builder pattern this extends
- `src/server/event-sourcing/pipeline/staticBuilder.ts` — file to modify
- `src/server/event-sourcing/reactors/reactor.types.ts` — sibling type definitions

# ADR-027: Typed `DispatchError` contract for dispatch endpoints

**Date:** 2026-05-28

**Status:** Accepted

## Context

Today's `sendSlackWebhook` (`src/server/triggers/sendSlackWebhook.ts`) wraps `webhook.send(...)` in `try { ... } catch (err) { captureException(err); }` and **never rethrows**. Errors are logged and surfaced to PostHog, but the calling reactor sees no signal — control flow continues as if dispatch succeeded.

This is fine for today's in-line reactor model (we accept silent failures as the operational baseline). It becomes broken when [ADR-021](./021-transactional-outbox-for-stake-sensitive-dispatch.md)'s outbox worker enters the picture, because the worker decides what to do with a row based on **whether dispatch threw**:

- Throw → some retry/dead categorization.
- Return cleanly → row transitions to `dispatched`.

If `sendSlackWebhook` continues to swallow errors, the outbox marks every Slack failure as `dispatched`, no retry, no operator visibility. The exact gap the outbox exists to close is silently preserved.

The worker also needs to **distinguish retryable from terminal** failures so it can pick a sensible action:

- HTTP 429 (rate limit), 5xx (server error), network timeout, connection refused → **retryable**: try again with backoff.
- HTTP 404 (webhook revoked), 410 (gone), 4xx auth failure → **terminal**: surface to operator as `dead`, do not retry.

The dispatch endpoints know which is which (they see the response). The worker doesn't, unless the endpoint tells it.

## Decision

Define a typed error class in the outbox framework:

```ts
// src/server/event-sourcing/outbox/outbox.types.ts
export class DispatchError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DispatchError";
  }
}
```

All dispatch endpoints invoked by `.withOutbox` reactors must throw `DispatchError` on failure:

- `sendSlackWebhook`, `sendTriggerEmail` (existing — refactored in Phase 2 of the plan).
- `addToDataset`, `addToAnnotationQueue` (when migrated to outbox in Phase 7).
- Future dispatch endpoints follow the same contract.

The `retryable` flag is derived from the underlying error:

| Source | `retryable` |
|---|---|
| HTTP 429, 5xx, timeout, connection refused | `true` |
| HTTP 4xx (other than 429) | `false` |
| Unknown/unexpected error | `true` (conservative default — log it, try again) |
| Validation error (malformed payload) | `false` |

Outbox worker catch logic:

```ts
try {
  await definition.dispatch(payloads, ctx, deps);
  await outbox.repo.markDispatched(rowIds);
} catch (err) {
  if (err instanceof DispatchError && !err.retryable) {
    await outbox.repo.markDead(rowIds, err.message);
  } else {
    // DispatchError({ retryable: true }) OR any non-DispatchError throw
    await outbox.repo.markFailedRetryable(rowIds, String(err), retryPolicy);
    throw err;  // signal GroupQueue to apply its retry policy
  }
}
```

The in-line callers (today's `dispatchTriggerAction`, used by reactors that haven't migrated to `.withOutbox`) keep working — the existing catch block logs + captures `DispatchError` the same way it logs + captures any other `Error`. No behavior change for the in-line path.

Email dispatches also pass `Idempotency-Key: ${outboxRowId}` (Resend supports this) so a retry after the dispatch succeeded but our status update didn't doesn't double-send.

## Rationale

### Why a boolean discriminator and not a sum type

A sum type (`DispatchRetryableError | DispatchDeadError`) would be slightly more idiomatic in TypeScript, but the worker only branches on two paths. A single class with a flag is simpler at the call site (one `throw`, no class proliferation) and the branching code reads cleanly.

### Why throw, not return a `Result`

A `Promise<Ok | RetryableErr | DeadErr>` result type would force every existing call site (in-line dispatcher, future call sites) to switch on the result. That's a much larger refactor with little upside — exception flow is what the surrounding code already uses, and exceptions integrate naturally with the worker's try/catch.

The only path where the result type would help is if we wanted to compose retry logic at the call site without exception unwinding. We don't — retry logic is centralized in the worker.

### Why HTTP-status-based classification

It's well-understood, vendor-documented, and uniform across providers. Slack, Resend, internal services all use HTTP semantics. A more sophisticated classification (e.g., per-provider error codes) would be premature optimization until we see real failure-mode distributions.

### Why default unknown errors to `retryable: true`

The conservative default for "we don't know what happened" is to assume transience. The cost of a few wasted retries on a deterministic error is low; the cost of marking a recoverable error as `dead` is operator inbox spam.

### Why pass `Idempotency-Key` to Resend specifically

Resend supports it; Slack webhooks don't. We accept the rare double-send risk on Slack — surfaced in operator activity tab — but eliminate it for email where the primitive exists.

## Consequences

- **`sendSlackWebhook` and `sendTriggerEmail` must be refactored** to throw `DispatchError` before any `.withOutbox` reactor can safely migrate. This is Phase 2 of the implementation plan; a prerequisite, not a follow-up.
- **Existing in-line callers see no behavior change.** They already catch all `Error` subclasses; `DispatchError` inherits from `Error` and logs the same way.
- **New testing convention.** Dispatch-endpoint tests must assert thrown error type *and* `retryable` flag: `expect(err).toBeInstanceOf(DispatchError); expect(err.retryable).toBe(false);`.
- **Worker retry policy is per-error-type.** `DispatchError({ retryable: false })` transitions immediately to `dead`. `DispatchError({ retryable: true })` and unknown errors use the registered `retryPolicy.backoffMs(attempt)` until `maxAttempts`.
- **Slack double-send risk** in the rare "dispatch succeeded but status update failed" case is accepted. Surfaced in operator activity tab as a "possibly-duplicate-dispatched" badge if the row has `attemptCount > 1` AND `status='dispatched'`. Cheap to detect; cheap to surface.
- **Future dispatch endpoints** added for new outbox reactors (e.g., `customerIoTraceSync`, `addToDataset` after migration) must follow the same contract. A unit-test convention enforces it.

## References

- [ADR-021](./021-transactional-outbox-for-stake-sensitive-dispatch.md) — outbox worker that consumes this contract
- [ADR-024](./024-withoutbox-pipeline-builder-primitive.md) — `dispatch` handler signature
- `src/server/triggers/sendSlackWebhook.ts` — endpoint to refactor first
- `src/server/mailer/triggerEmail.ts` — endpoint to refactor second

# ADR-027: Dispatch endpoints expose typed retryability

**Date:** 2026-05-28

**Status:** Accepted

**Behavioural contract:**
[dispatch error contract](../../../specs/automations/dispatch-error-contract.feature)

**Related:**
[automation process managers](./052-automations-on-process-manager-substrate.md)
and the [Eventing framework boundary](../../../packages/eventing/adrs/20260820-eventing-framework-boundary.md).

## Context

An intent dispatcher must distinguish a successful external effect from a
failure, and a retryable failure from a terminal one. Logging an error and
returning would acknowledge work that did not happen. Retrying a revoked
webhook forever is equally wrong.

The delivery adapter sees the provider response and is therefore the boundary
that can classify the failure accurately.

## Decision

Expected delivery failures are represented by `DispatchError`:

```ts
class DispatchError extends Error {
  readonly retryable: boolean;
  readonly cause?: unknown;
}
```

Automation delivery endpoints throw this error rather than swallowing a
failed effect. The classification is:

| Failure                                         | `retryable` |
| ----------------------------------------------- | ----------- |
| HTTP 429, HTTP 5xx, timeout, connection refusal | `true`      |
| HTTP 4xx other than 429                         | `false`     |
| Invalid persisted payload                       | `false`     |
| Unknown or unclassified failure                 | `true`      |

The process-manager intent dispatcher handles it as follows:

- a terminal `DispatchError` records a dead attempt and ends delivery;
- a retryable `DispatchError` records the safe diagnostic and schedules the
  leased outbox retry policy;
- an unknown thrown error follows the retryable path until the attempt cap;
- a clean return marks the intent dispatched.

Persisted diagnostics contain a closed error type and safe message. Raw
provider bodies, tokens, webhook secrets and recipient data are not stored.

### Idempotency is enforced locally

Provider calls remain at-least-once because a process can fail after the
provider accepts a request but before Postgres records success. The permanent
`TriggerSent` claim, deterministic effect identities and idempotent provider
contracts provide the actual duplicate protection.

Email delivery also carries a deterministic `X-Idempotency-Key` header:

- a digest uses its trigger and cadence-window identity;
- an immediate message uses its durable intent identity.

SES and SendGrid surface this header to delivery tooling, so it is useful for
diagnosis. It is not treated as provider-enforced idempotency. Slack does not
surface arbitrary request headers and therefore does not receive a diagnostic
idempotency header.

## Alternatives considered

Separate retryable and terminal subclasses add type surface without changing
the dispatcher's two-way branch. Returning a result union would force every
delivery call site to remember to inspect it; the intent executor already has
a single exception boundary. Defaulting unknown failures to terminal would
turn ambiguous infrastructure failures into silent loss.

## Consequences

- Delivery endpoints cannot report success after a failed side effect.
- Retry policy is driven by a stable error contract rather than message text.
- Tests assert both the error type and its `retryable` value.
- A duplicate external effect remains possible in the narrow
  effect-succeeded/status-write-failed window, so effect handlers and
  operator diagnostics retain deterministic identities.

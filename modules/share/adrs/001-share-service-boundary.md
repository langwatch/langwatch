# ADR-001: Share has one service boundary

**Status:** Accepted

**Behavioural contract:** [Share service](../specs/share.feature)

## Context

Trace sharing was split across application services, repositories, Redis
helpers and request callbacks. Data Retention also queried a Share repository,
creating a cycle between feature internals.

## Decision

The singular `share` feature owns link creation, resolution, audience checks,
expiry, view accounting, revocation, share-backed pin lifecycle and the
short-lived share-safe payload cache. Its portable contract exposes Zod 4 data,
errors and one abstract `ShareService`.

The process constructs one concrete service. Share receives its private
repositories and the complete Project, Data Retention and AuthZ services. The
grants-ledger repository receives the complete AuthZ Grants service. It does
not receive callback bags or partial service contracts.

Share owns the active-link refusal for manual unpinning, then delegates pin
persistence to Data Retention. Data Retention does not query Share.

## Public surfaces and transports

Existing tRPC procedures and the anonymous aggregate endpoint keep their URLs,
authorization and response shapes. They call the process-owned Share service
through application context. The package registers no transport.

## Dependencies

The contract is portable. The server depends on its contract plus Project,
Data Retention, AuthZ and AuthZ Grants service contracts. It does not import
application modules or construct process dependencies.

## Persistence

Private PostgreSQL repositories own `ShareLink`, grants-ledger routing and
durable view accounting. A private Redis repository owns view deduplication and
payload caching. Generated database types do not cross the public adapter.

## Runtime and registration

The application composition root supplies one database, Redis connection and
the full dependent services to `PostgresShareAdapter`. Requests reuse the
resulting `ShareService`; they do not construct repositories or services.

## Environment and configuration

Share reads no environment values. Database and Redis configuration are
resolved by process boot and injected into the adapter.

## Errors

Token, audience, expiry, exhaustion, kill-switch and unpin refusals are owned
by the Share contract. A disabled or unknown token remains deliberately
indistinguishable. Nullable private lookups use `try` names.

## Contracts and validation

Inputs and returned feature values use bare Zod 4 schemas from the contract.
The anonymous trace response remains the existing explicit share-safe DTO;
cache entries are separated by the viewer's protection fingerprint.

## Consequences

Share has one capability and one process lifecycle. The service graph is
acyclic, existing transports remain compatible, and persistence and cache
details no longer leak into callers.

Historical ADR-057 remains the design journey. This record states the current
boundary.

## References

- [Historical token-gated sharing decision](../../../../../dev/docs/adr/057-token-gated-trace-sharing.md)
- [Unified authorization engine](../../../../../dev/docs/adr/092-unified-authorization-engine.md)

# Rate limiting, response caching and deprecation are chain capabilities backed by app-supplied ports

**Date:** 2026-08-20

**Status:** Proposed

**Behavioural contract:**
[../specs/endpoint-capabilities.feature](../specs/endpoint-capabilities.feature)

**Related:**
[RPC-first fluent registration](./001-rpc-first-fluent-registration.md),
[the API framework boundary](./20260820-api-framework-boundary.md),
[Redis is an owned client](../../../dev/docs/adr/093-redis-is-an-owned-client.md).

## Context

The fluent chain ([001](./001-rpc-first-fluent-registration.md)) makes new
endpoint capabilities cheap to declare — `b.withRateLimit()`,
`b.withCache(tag, ttl)`, `b.withDeprecated(notice)`. Cheap to declare is not
cheap to honour: rate limiting and caching need a substrate (Redis in this
system), and the framework boundary forbids the package from owning
infrastructure clients. The capabilities that were never added to the old
config-object API all died on the same question — where does the backend come
from.

## Decision

### 1. The package owns the contracts, the app owns the substrate

The package defines two ports:

```ts
interface RateLimiter {
  check(key: string): Promise<{ allowed: boolean; retryAfterSeconds?: number }>;
}

interface ResponseCache {
  get(key: string): Promise<Uint8Array | null>;
  set(
    key: string,
    tag: string,
    body: Uint8Array,
    ttlSeconds: number,
  ): Promise<void>;
  invalidateTag(tag: string): Promise<void>;
}
```

The application supplies implementations on `createService({ rateLimiter,
cache })`. Declaring `.withRateLimit()` on a service without a rate limiter,
or `.withCache(...)` without a cache, **fails the build** — the same rule
`resourceLimit` already lives under, because a capability that silently does
nothing is worse than no capability.

### 2. The framework owns the keys

Substrate-neutral policy stays in the package:

- **Rate-limit key**: service name + endpoint name + version namespace +
  principal. The limiter never decides who is being limited.
- **Cache key**: endpoint name + version namespace + a hash of the validated
  input body. RPC endpoints put every argument in the body, which is what
  makes caching POST responses sound: the body is the complete call.
- **Tag invalidation**: `.withCache(tag, ttl)` stores under `tag`;
  `invalidateTag` drops every entry the family wrote. The tag is the family's
  own name for its data, so two families cannot collide by accident.

### 3. The pipeline positions are fixed

Rate limiting runs after auth and before validation — an over-limit caller
costs a key lookup, not a parse — and answers 429 with `Retry-After` when the
limiter supplies one. The cache read runs after validation and before the
handler, only when the endpoint declares `output`: the cached bytes were
validated when they were written, so a hit can be served without re-running
the handler or the output schema. A miss or a bypass runs the handler and
writes the validated response bytes. Cache failures degrade to a handler call;
limiter failures fail closed or open per the application's port
implementation, which the framework logs and propagates — the documented
fallback path
[Redis client ownership](../../../specs/server/redis-client-ownership.feature)
asks of every Redis consumer.

### 4. Deprecation needs no port

`.withDeprecated(notice)` marks the operation `deprecated: true` in the
OpenAPI document with the notice in its description — on every dated mount
the registration serves, so SDK generators surface it per version — and adds
`Deprecation` plus `X-API-Deprecation-Notice` response headers, set in the
same `finally` as the version headers so errors carry them too. It is the
soft counterpart of `withdraw()`: deprecated still answers and warns;
withdrawn answers 410.

### 5. Service-level defaults follow the chain's own rule

All three may be declared on the service builder as defaults, per
[001 §4](./001-rpc-first-fluent-registration.md): endpoint re-declaration
wins, `.withoutCache()` / `.withoutRateLimit()` opt out, and a service-level
`withDeprecated` covers every endpoint in the service.

## Alternatives considered

Framework-owned Redis clients were rejected: the boundary ADR forbids the
package owning infrastructure, and a hidden client makes the package
untestable without a Redis.

Generic middleware packages (`middleware: [rateLimit(...)]` everywhere) were
rejected: middleware is invisible to the document and to the mount report, so
a rate-limited endpoint would look identical to an unlimited one in every
artifact consumers read.

Caching at the HTTP layer (ETags, Cache-Control on GETs) was rejected for the
RPC surface: every call is a POST by design, and re-admitting GET for
cacheability reopens the split surface 101 closed.

Per-endpoint ad hoc caching inside handlers was rejected: the key derivation
is the part everyone gets wrong, and it is exactly the part the framework can
own once.

## Consequences

- The package gains two interfaces and no runtime dependencies; tests use
  in-memory ports, the app ships the Redis adapters once.
- A capability's presence is visible in the chain, the mount report and —
  for deprecation — the published document.
- Build-time failure on a missing port keeps "declared but not wired" out of
  production.
- Future capabilities follow the same shape: chain call, port if a substrate
  is needed, fail at build when the port is missing.

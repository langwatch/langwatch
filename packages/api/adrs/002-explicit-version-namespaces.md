# Every API URL carries an explicit version namespace; the bare alias is removed

**Date:** 2026-08-20

**Status:** Proposed

**Behavioural contract:**
[../specs/versioned-routing.feature](../specs/versioned-routing.feature)

**Related:**
[RPC-first fluent registration](./001-rpc-first-fluent-registration.md),
[the API framework boundary](./20260820-api-framework-boundary.md).

## Context

The framework served every endpoint under four mounts: a dated version,
`latest`, `preview`, and a bare alias — `/api/things/` — that silently
resolved to the latest dated version. The OpenAPI document then documented
exactly one of those: the bare alias. So the one URL the documentation pointed
at was the one URL no client should call — a client that pins nothing gets
whatever "latest" means on the day its code runs again — and the URLs a client
should call were nowhere in the document. "Omit the date, get latest" is
convenient exactly once, in the first demo, and misleading for the rest of the
API's life.

Date-based versioning itself is unchanged and not re-litigated here: versions
are real `YYYY-MM-DD` calendar dates, invalid or duplicate versions fail at
registration, and later versions inherit earlier endpoints.

## Decision

### 1. The version namespace is part of the URL, always

Every API URL is:

```text
/api/{service}/{version}/{name}
  version = YYYY-MM-DD | latest | preview
  name    = things.create            (RPC)
            things.watch             (SSE)
            some/rest/path           (registerRoute families)
```

There is no bare alias. `/api/things/` and anything under it answers 404,
produced by the same namespace guards that already reject unknown versions —
a request without a version segment is an unknown namespace.

### 2. The document carries every dated version

The OpenAPI document publishes every dated version of every documented
endpoint, plus `latest` — so a client pinned to `2026-08-07` sees the schemas
that version actually serves, and a client that wants the moving target gets
it under its own honest name. `preview` is never documented: preview is where
an endpoint may change without notice, and documenting it would promise
stability it does not have.

The declared OpenAPI `operationId` belongs to the `latest` mount. Each dated
mount appends its version, for example `createThing_2026_08_07`, because an
OpenAPI document requires operation ids to be globally unique even when one
logical endpoint is inherited across several version namespaces.

The document growing with each version is bounded by withdrawal: a withdrawn
endpoint leaves the document at the version it was withdrawn from.

### 3. Inheritance falls out of the registrations

With `.version()` blocks gone ([001](./001-rpc-first-fluent-registration.md)),
an endpoint serves at version V its latest registration dated on or before V.
Overriding an endpoint is registering it again at a later date; removing one
is `service.withdraw(name, version)`, which answers 410 from that version
onward, on every mount, with the withdrawn endpoint's config still attached to
the mount report.

### 4. Headers are unchanged

Every response carries `X-API-Version-Status` (`stable`, `latest`, `preview`)
and versioned mounts additionally carry `X-API-Version` with the namespace
that answered. Both are set in a `finally`, so validation errors and 410
withdrawals carry them too. `unversioned` disappears with the bare alias.

### 5. The break is deliberate and enumerated

This breaks the four resource-REST management families (roles, role-bindings,
scim-tokens, organization) and every spec and client that pins a bare path —
the TypeScript SDK's management services and the CLI's request tests among
them. They migrate to explicit namespaces when the rework lands; the
route-coverage gate's "counted once at its bare alias path" scenario is
amended to the dated mounts at the same time.

Two casualties are worth naming rather than discovering. The version-gated
error envelope — the union format carrying the legacy `error` field for
unversioned requests — loses its reason to exist with the alias: the clean
format becomes the only format, and the MCP client's special case for the
unversioned envelope goes with it. And webhooks: it is not on the framework
today, and its `v1` namespace (pinned in `specs/ai-gateway/idempotency.feature`)
has no form in this grammar. Its migration is separate work, and when it
lands, `v1` becomes a dated namespace like every other family.

## Alternatives considered

Keeping the bare alias but undocumented was rejected: one operation with two
addresses, where the undocumented one is the address every existing client
uses. The alias would never die.

Documenting only `latest` was rejected: a pinned client cannot see its own
contract, and `latest` changes meaning on every release, so SDK diffs would
show changes no version made.

Version negotiation by header was rejected: invisible in the document,
uninspectable in logs and dashboards without joining on headers, and a trap
for any intermediary that keys on URLs.

A redirect from bare to `latest` was rejected: a 308 makes the wrong URL
permanent in client code, and a 302 trains clients to keep calling it.

## Consequences

- The published document and the served surface describe the same URLs for
  the first time; the coverage gate's claim becomes true end to end.
- The request-time `resolveRequestVersion` resolution path is dead code and
  is removed; mounting stays eager.
- Every dated mount is a real route the coverage gate counts; withdrawn
  endpoints remain accounted for without exclusion entries.
- Clients that pinned nothing break loudly (404) rather than silently shifting
  to a new latest — the failure mode this decision prefers everywhere.

# RPC and compatibility URLs carry an explicit version namespace

**Date:** 2026-08-20

**Status:** Accepted, amended 2026-09-04 (section 1)

**Behavioural contract:**
[../specs/versioned-routing.feature](../specs/versioned-routing.feature)

**Related:**
[the fluent handler contract](./001-rpc-first-fluent-registration.md),
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

This decision remains the contract for `createService`, RPC, SSE and
compatibility `registerRoute`. The additive public REST surface has a static
`v1` generation and an optional date/header version as decided in
[004](./004-public-rest-v1-and-date-negotiation.md).

## Decision

### 1. `/api/v1` is the canonical prefix; the bare alias and the version namespaces all answer

**Amended 2026-09-04.** The original ruling deleted the bare alias. That broke
twenty-three operations the published, frozen OpenAPI document names at their
bare paths, and every client generated from it. The amendment keeps the
explicit namespaces and restores the alias, under one canonical prefix:

```text
/api/v1/{service}/{name}              canonical — what documents, SDKs,
                                      the CLI and MCP tools call
/api/{service}/{name}                 the bare alias, serving `latest`
/api/v1/{service}/{version}/{name}    the version namespaces, under both
/api/{service}/{version}/{name}       prefixes
  version = YYYY-MM-DD | latest | preview
  name    = things.create            (RPC)
            things.watch             (SSE)
            some/rest/path           (registerRoute families)
```

Every REST family answers at `/api/v1/{thing}` as well as at `/api/{thing}`.
The two are ONE logical route: the same handler, the same declared access
policy, one entry in the route-policy registry, and one operation in the
document — the mount reports the v1 form as its `canonicalPath` rather than
reporting a second route, so an authorization audit and the document's drift
guard count it once.

A family whose path already names a generation of its own — `/api/v1/agents`,
`/api/v1/run-plans`, `/api/v1/test-suites`, `/api/v1/secret`,
`/api/otel/v1/*`, `/api/scim/v2/*` — is mounted once. Two generation segments
in one URL would be two version axes, which is the thing this decision exists
to prevent.

Two surfaces are deliberately outside the canonical prefix: the Better Auth
sign-in door (`/api/auth/*`), which builds its own callback, cookie and
redirect URLs from one configured base, and the deployment's health probes
(`/api/health`), which are operator configuration rather than product API.
The tRPC (`/api/trpc`) and SSE (`/api/sse`) mounts are not REST families and
carry their own contracts.

The namespace guards stay exactly as they were, under both prefixes: an
unknown version segment still answers 404 rather than falling through.

### 2. The document carries every dated version

The OpenAPI document publishes every dated version of every documented
endpoint, plus `latest` — so a client pinned to `2026-08-07` sees the schemas
that version actually serves, and a client that wants the moving target gets
it under its own honest name. `preview` is never documented: preview is where
an endpoint may change without notice, and documenting it would promise
stability it does not have.

The declared OpenAPI `operationId` belongs to the address a client is told to
call — the bare alias since the 2026-09-04 amendment, and `latest` where a
family has no alias. Every other mount appends its namespace, for example
`createThing_2026_08_07` and `createThing_latest`, because an OpenAPI document
requires operation ids to be globally unique even when one logical endpoint is
inherited across several version namespaces. The `/api/v1` twin adds no
operation at all: it is the same route at its canonical address.

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

### 5. Nothing that answered stops answering

**Amended 2026-09-04.** The original section enumerated a deliberate break of
the four resource-REST management families (roles, role-bindings, scim-tokens,
organization) and every client pinning a bare path. The amendment withdraws
that break: those families answer at their bare paths again, and at
`/api/v1/{thing}` besides. Documents, SDKs, the CLI and MCP tools move to the
canonical `/api/v1` form; nothing has to move to keep working.

One casualty is worth naming rather than discovering. The version-gated
error envelope — the union format carrying the legacy `error` field for
unversioned requests — loses its reason to exist with the alias: the clean
format becomes the only format, and the MCP client's special case for the
unversioned envelope goes with it. And webhooks: it is not on the framework
today, and its `v1` namespace (pinned in `specs/ai-gateway/idempotency.feature`)
has no form in this grammar. Its migration is separate work, and when it
lands, `v1` becomes a dated namespace like every other family.

## Alternatives considered

Keeping the bare alias but undocumented was rejected, and the 2026-09-04
amendment settles it the other way round: the alias stays, and the DOCUMENTED
address is the canonical `/api/v1` one. One operation with two addresses is
the deliberate shape, because the alias is what every existing client already
calls.

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
- A client that pins nothing gets `latest`, at the bare alias, as it always
  did. The published document names the canonical `/api/v1` form, so a client
  generated from it pins the generation without pinning a date.

# The API package is a contract-sealed service framework

**Date:** 2026-08-20

**Status:** Proposed

**Behavioural contract:**
[../specs/api-framework.feature](../specs/api-framework.feature)

**Related:**
[the fluent handler contract](./001-rpc-first-fluent-registration.md),
[explicit version namespaces](./002-explicit-version-namespaces.md),
[endpoint capabilities are ports](./003-endpoint-capabilities-are-ports.md),
[the domain errors handled boundary](../../../dev/docs/adr/045-domain-errors-handled-boundary.md),
[the unified authorization engine](../../../dev/docs/adr/092-unified-authorization-engine.md),
[the Eventing framework boundary](../../eventing/adrs/20260820-eventing-framework-boundary.md),
[the Group Queue framework boundary](../../group-queue/adrs/20260820-group-queue-framework-boundary.md),
and [the modular package architecture](../../../dev/docs/adr/070-modular-package-architecture.md).

## Context

The API surface has two distinct layers:

1. a reusable framework for declaring endpoints, validating input and output,
   versioning, streaming, formatting errors and publishing OpenAPI; and
2. the LangWatch composition root: the forty-odd API families, their auth and
   organization middleware, Prisma-backed services, discovery routes and the
   spec generation pipeline.

The package boundary separates these layers. The framework stays small,
explicit and difficult to misuse, while product families remain in the
application with the feature that owns them.

The package started life as a builder extracted from the application's API
router, and its README grew into the only record of several lasting decisions.
This ADR seals the boundary; the numbered ADRs beside it carry the decisions
the README used to hold.

## Decision

### 1. Package boundary and dependency direction

`@langwatch/api` owns:

- the service builder and the fluent endpoint registration chain;
- version resolution, forward inheritance and withdrawal;
- the per-endpoint pipeline: authentication placement, access-policy mount
  reporting, validation, documentation, capabilities and error handling;
- SSE streaming with typed events;
- the route-mounting contract (`MountedRoute`, `onRouteMounted`) hosts use to
  register route policies;
- the RPC name grammar (`isRpcPath`) that both registration and discovery
  consumers ask;
- framework errors, tracing and logging ports.

It depends on `@langwatch/handled-error` and `@langwatch/observability`. It
does not import the platform app, product features, enterprise code or Prisma.
Authentication, authorization, entitlement, rate limiting and caching
substrates are application-owned ports or middleware; the package declares
the transport seams and never the clients (see
[003](./003-endpoint-capabilities-are-ports.md)). Error formatting is shared
ground: the framework serializes `HandledError` on the routes it mounts, while
legacy routes keep the application-wired boundary of
[045](../../../dev/docs/adr/045-domain-errors-handled-boundary.md) — a route
gets exactly one error format, decided by who mounted it.

Endpoints do not maintain an error catalogue. Framework middleware maps
validation, handled and unknown errors consistently, including status and
retryability, without another declaration that can drift from thrown errors.

### 2. The app is the composition root

API families live in `platform/app/src/app/api/{name}/[[...route]]/app.ts`,
one file per family, exporting a built Hono app. The application's API router
mounts them; the framework never enumerates them. Discovery routes, the spec
generation pipeline and the route-coverage gate are application concerns that
read the framework's contracts, not framework code.

The app's tRPC router remains a separate transport. It may call the same
application services and authorization engine, but it is not mounted, routed
or documented by `@langwatch/api`.

### 3. Access classification is mandatory and authorization is app-owned

Every mounted LangWatch route has exactly one access policy: either a required
permission or an explicit public classification with a written reason. A
missing policy is a build error. REST, URL-addressed RPC and SSE routes follow
the same rule; choosing an endpoint style never chooses an auth model.

The framework stays transport-generic by carrying endpoint metadata on its
mount report. The application composition root turns one `guard(permission)`
declaration into both halves that must agree:

- the policy registered for route-coverage and authorization audits; and
- the enforcement middleware that calls the application-owned authz runtime
  after credential resolution.

`withAuth("none")` only disables credential middleware for an endpoint. It
does not classify the endpoint as public; public access still has to be
declared and registered deliberately. Authentication, authorization and plan
or entitlement checks remain distinct pipeline stages even when an
application helper bundles their declarations.

`@langwatch/api` does not import `AuthzService`, the grants service, the grants
ledger or Prisma. A handler that changes authorization facts calls an
application service with the authenticated request actor. ADR-092's
per-organization write gate then chooses ledger or compatibility storage, and
the ledger's insert-only subscriber owns audit emission. The HTTP framework
must not duplicate that audit row or learn which writer handled the command.

### 4. Endpoints are declared once

An endpoint is one `register` call carrying its name, its version, its handler
and its definition chain — never a version block the endpoint shares with its
siblings. The full authoring contract is
[001](./001-rpc-first-fluent-registration.md).

### 5. URLs carry explicit version namespaces

Every API URL names its version namespace; there is no bare alias that
silently means latest. The full routing and documentation contract is
[002](./002-explicit-version-namespaces.md).

### 6. The public API is sealed

Consumers import from the package root only. Implementation files — pipeline,
versioning, route mounting internals — are not public surface. Rules that can
be machine-checked are checked twice: in the editor by the types, and at
startup by asserts, so a JavaScript caller or an `any`-widened config cannot
bypass them.

### 7. Documentation is part of the package boundary

The package owns:

```text
README.md          # entry points, short usage and support policy
adrs/              # lasting package design decisions
specs/             # package behavioral contracts
src/               # implementation and colocated tests
```

Framework documents live here. Documents that describe the framework's
published contract but are exercised from the application — API discovery, the
route-coverage gate — live here too, so the contract and its rationale have one
home. Product family scenarios live with the feature that owns them.

Comments in source explain contracts, correctness invariants and surprising
failure behavior.

## Alternatives considered

Keeping the framework inside `platform/app` was rejected: the builder had
already outgrown one app — the discovery catalogue, coverage gate and SDK
generators all read its contracts — and an in-app framework invites product
code to reach into its internals.

Leaving the decisions in the README was rejected: a usage document cannot
carry rationale, and the RPC pilot had already lost its ADR number to sibling
work, leaving the decision unrecorded anywhere.

Letting the framework own its Redis clients for rate limiting and caching was
rejected: that inverts the dependency boundary the same way framework-owned
Prisma repositories would. The package owns contracts; the app owns substrate.

## Consequences

- The package can be tested, type-checked and documented without the
  application.
- Every authoring rule that matters is enforced in the editor and again at
  startup; specs in `specs/` pin both halves.
- Application consumers read framework behavior through public exports and
  published documents, never through implementation files.
- Route style cannot bypass access classification, and the framework cannot
  grow a second authorization engine or grants writer by convenience.
- The README shrinks back to usage; rationale lives here and cannot rot
  silently when the code moves.

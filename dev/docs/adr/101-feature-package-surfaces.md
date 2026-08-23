# ADR-101: Feature packages expose capability-specific surfaces

**Date:** 2026-08-21

**Status:** Accepted

**Related:** [ADR-070: modular package architecture](./070-modular-package-architecture.md),
[ADR-102: runtime composition roots](./102-runtime-composition-roots.md), and
[ADR-104: runtime environment configuration](./104-runtime-environment-configuration.md).

**Concrete boundaries:**
[Agents](../../../packages/features/agents/adrs/001-package-boundary.md),
[Entitlements](../../../packages/features/entitlements/adrs/001-provider-neutral-plan-resolution.md),
[Stored Objects](../../../packages/features/stored-objects/adrs/001-package-boundary.md),
[the design system](../../../packages/design-system/adrs/001-design-system-boundary.md),
[shared JavaScript configuration](../../../packages/config/adrs/001-shared-runtime-configuration.md),
and [package-boundary enforcement](../../../packages/architecture-lint/adrs/001-feature-package-boundaries.md).

## Context

LangWatch's product concepts currently live across several overlapping module
graphs. A single feature may be represented by browser components, tRPC
procedures, public API handlers, service logic, repositories, event-sourcing
pipelines and enterprise extensions, without one boundary that identifies
which of those pieces belong together. Conversely, shared application folders
often contain code for many unrelated concepts simply because the code runs in
the same process.

This makes deployment concerns look like domain boundaries. The frontend and
backend need different dependency graphs: browser code must not acquire
Prisma, Node-only frameworks or server infrastructure, while backend code must
not load React, Chakra or browser state. A directory convention inside the
current application cannot guarantee either property because any file can
still import any sibling implementation.

Each feature also has more than one interface. The internal application API is
primarily tRPC. The public API is described through the LangWatch API package
and OpenAPI and may expose REST or RPC-shaped operations. Background work may
enter through Eventing and Group Queue without an HTTP API at all. These are
transports over feature behaviour; they are not separate implementations of
the behaviour.

The common shape is therefore optional rather than uniform. A feature may need
a shared contract, server behaviour and browser presentation, or only one or
two of those surfaces. Forcing every feature to contain empty web, API,
repository or eventing layers would replace today's accidental structure with
ceremonial boilerplate.

Cross-feature collaboration needs an explicit rule as well. Services sometimes
need capabilities owned by another feature, but allowing one feature to import
another feature's repositories or concrete implementation recreates the
monolith inside `packages/`. Contracts have to be stable enough for both local
method calls and transport adapters without exposing persistence records.

Prisma is the sharpest version of this problem. LangWatch has one connected
relational model, so splitting the Prisma schema or generator per feature would
create operational complexity without independent data ownership. At the same
time, importing the generated client or returning generated records across a
feature boundary pulls the entire database model into consumers and makes the
database shape part of the feature's public API.

Enterprise code adds a second dependency axis. Core features need extension
points that an enterprise installation can satisfy, but core packages must
remain buildable and runnable without importing enterprise implementations.
Enterprise features still need the same browser/server and repository
boundaries; licensing is a composition concern, not permission to reach into
core internals.

The physical unit has to enforce these constraints rather than merely describe
them. The main alternatives are one workspace package per feature with sealed
subpath exports, or separate workspace packages for the feature's contract,
server and web surfaces. The choice affects dependency installation,
declaration emit, public naming, boundary linting and how optional surfaces are
represented.

This ADR will decide that physical feature-package model, its dependency
direction, its public exports, its relationship to Prisma and enterprise code,
and the allowed forms of cross-feature collaboration. It will not assign every
existing directory to a feature or prescribe a migration sequence.

## Decision

### Each feature surface is a physical workspace package

A feature is a namespace that groups up to three independently installable and
typechecked packages:

```text
packages/features/<feature>/
  contract/              # @langwatch/<feature>-contract
    package.json
    src/
  server/                # @langwatch/<feature>-server
    package.json
    src/
  web/                   # @langwatch/<feature>-web
    package.json
    src/
  adrs/                  # decisions spanning the feature's surfaces
  specs/                 # behaviour owned by the feature
```

The feature directory is an ownership boundary, not itself a package. Each
surface that exists has its own `package.json`, TypeScript configuration,
dependency list, tests and sealed export map. A surface that has no behaviour
does not exist: a background-only feature may consist only of `server`, and a
browser-only feature may consist only of `web`.

The workspace configuration will explicitly discover these nested packages.
Package names remain flat within the `@langwatch` npm scope because npm does
not support another package-name hierarchy below the scope.

### Canonical example: evaluations

Evaluations exercises all three surfaces and both API transports, so it is a
useful full example. The names below describe ownership, not mandatory
boilerplate: a smaller feature contains only the files and packages it needs.

```text
packages/
├── features/
│   └── evaluations/                         # feature ownership boundary
│       ├── contract/                        # physical workspace package
│       │   ├── package.json                 # @langwatch/evaluations-contract
│       │   ├── tsconfig.json
│       │   ├── src/
│       │   │   ├── domain/
│       │   │   │   ├── evaluation.ts       # domain values and status
│       │   │   │   └── evaluationId.ts
│       │   │   ├── schemas/
│       │   │   │   └── evaluationInput.ts  # portable validation schemas
│       │   │   ├── events/
│       │   │   │   └── evaluationEvents.ts # product event definitions
│       │   │   ├── services/
│       │   │   │   └── evaluationService.ts # interface + request/result DTOs
│       │   │   ├── errors.ts               # portable domain failures
│       │   │   └── index.ts                # the complete public surface
│       │   └── tests/
│       │       └── public-contract.test-d.ts
│       │
│       ├── server/                          # physical workspace package
│       │   ├── package.json                 # @langwatch/evaluations-server
│       │   ├── tsconfig.json
│       │   ├── src/
│       │   │   ├── services/
│       │   │   │   ├── evaluationService.ts
│       │   │   │   └── evaluationService.test.ts
│       │   │   ├── repositories/           # package-private persistence
│       │   │   │   ├── evaluationRepository.ts
│       │   │   │   └── prisma/
│       │   │   │       ├── evaluationMapper.ts
│       │   │   │       └── prismaEvaluationRepository.ts
│       │   │   ├── api/                    # thin transport adapters
│       │   │   │   ├── internal/
│       │   │   │   │   └── evaluationRouter.ts      # tRPC fragment
│       │   │   │   └── public/
│       │   │   │       └── evaluationHandlers.ts    # OpenAPI REST/RPC
│       │   │   ├── eventing/               # product Eventing definitions
│       │   │   │   ├── evaluationPipeline.ts
│       │   │   │   ├── projections/
│       │   │   │   ├── subscribers/
│       │   │   │   └── processManagers/
│       │   │   ├── registration/           # imported only by app roots
│       │   │   │   ├── internalApi.ts
│       │   │   │   ├── publicApi.ts
│       │   │   │   └── worker.ts
│       │   │   └── index.ts                # deliberate supported exports
│       │   └── tests/
│       │       ├── integration/
│       │       └── public-boundary.test-d.ts
│       │
│       ├── web/                             # physical workspace package
│       │   ├── package.json                 # @langwatch/evaluations-web
│       │   ├── tsconfig.json
│       │   ├── src/
│       │   │   ├── client/
│       │   │   │   └── evaluationsClient.ts # typed browser API adapter
│       │   │   ├── hooks/
│       │   │   ├── components/
│       │   │   ├── screens/
│       │   │   └── index.ts
│       │   └── tests/
│       │
│       ├── adrs/                            # decisions for this feature
│       │   ├── README.md
│       │   └── NNN-evaluation-lifecycle.md
│       └── specs/                           # behaviour across its surfaces
│           ├── evaluation-lifecycle.feature
│           └── evaluation-triggering.feature
│
├── eventing/                                # reusable framework package
└── group-queue/                             # reusable transport package
```

The three `package.json` files are the load-bearing boundaries. In this
example:

- `evaluations-contract` has only runtime-portable dependencies;
- `evaluations-server` depends on `evaluations-contract`, server-safe
  infrastructure and frameworks such as Eventing;
- `evaluations-web` depends on `evaluations-contract`, the browser API client,
  React and Chakra; and
- neither the contract nor web package depends on `evaluations-server`.

The `registration` files do not register themselves globally as an import side
effect. They export explicit installation functions. The app API composition
root may install `internalApi` and `publicApi`; the worker composition root may
install `worker`. A process therefore loads only the evaluation capabilities
it actually runs.

The internal and public API adapters both call the same evaluation service.
The tRPC fragment supplies the internal application interface and the public
adapter implements the separately versioned OpenAPI contract. Neither owns a
second copy of evaluation behaviour. Likewise, the Eventing directory owns
evaluation pipelines and handlers, while `@langwatch/eventing` remains only
the reusable framework.

ADRs and feature specs live at the `evaluations` ownership root because they
may describe behaviour spanning contract, server and web packages. Unit and
type-boundary tests live with the physical package they exercise.

### The package roles are strict

The contract package owns the feature's portable vocabulary: identifiers,
domain values, input and output DTOs, validation schemas, domain errors, event
definitions and structural service capabilities. Zod schemas are the source of
truth where a value crosses a process, persistence or trust boundary;
TypeScript types are inferred from those schemas. Contract packages compile
and emit declarations independently so internal RPC validation, public OpenAPI
schemas and server implementations consume the same vocabulary. A contract is
safe to load in a browser and does not depend on React, Prisma, Node-only
infrastructure, API router implementations or the feature's server and web
packages.

Zod 3 is the contract authoring library, not an API-framework coupling.
Contracts import it from `zod`, never the separate `zod/v4` compatibility
entry point. Hono adapters consume those schemas through Standard Schema and
the root `hono-openapi` API. Feature packages do not import
`hono-openapi/zod` or `@hono/zod-validator`. OpenAPI is a compiled view of the
same Zod 3 contract schemas used by RPC and service validation, as decided in
[ADR-103](./103-standard-schema-api-boundary.md).

The server package implements the contract. It owns services, repository
interfaces and adapters, internal tRPC procedures, public API adapters,
product Eventing pipelines, subscribers and process managers. API handlers and
queue consumers translate a transport into a service call; they do not become
an alternative home for product behaviour. A feature need not expose either
API transport.

Service implementations are classes. A service exposes a static `create`
method; it is not wrapped by a standalone `createXService` function. Service
behaviour stays on the class rather than in neighbouring factory or helper
functions. The contract may describe the service structurally so consumers can
inject a fake without importing its implementation. Server code uses explicit
control flow instead of nested ternaries and conditional object spreads.

A singular service lookup either returns the requested contract value or
throws a concrete domain error containing useful identifiers. It does not
return `null`, publish a generic error-code bag or hide construction behind a
`notFound()` helper. A repository may return `null` internally to describe a
database lookup, but the service converts that absence before it crosses the
feature boundary. Each transport maps the concrete error once at its boundary.

The web package owns React components, hooks, browser state and browser client
adapters. It consumes browser-safe contracts and composed API client types. It
does not import a server package, including through a type-only import.

Each package exposes deliberate public entry points. Repositories, generated
database records, router implementations, registries and internal wiring are
not available through deep imports.

Feature packages do not read `process.env`, `import.meta.env` or an app-owned
T3 environment module. The app and worker composition roots validate their own
environment once and pass narrow typed configuration or capabilities into the
service class. Browser configuration is an allowlisted semantic contract
served by the app, never a raw environment-variable relay.

### Cross-feature calls use contracts and injected instances

When one feature needs another feature's capability, its server package
depends on the owning feature's contract package and accepts that service
interface as a dependency. An application composition root imports both
server packages and connects their concrete instances.

```text
@langwatch/evaluations-server
          │
          │ depends on interface and values
          ▼
@langwatch/agents-contract

app or worker composition root
          │ creates and connects concrete implementations
          ├── @langwatch/evaluations-server
          └── @langwatch/agents-server
```

A feature never imports another feature's server package, repository,
registry or wiring factory. This rule applies even while both implementations
run in the same process; an in-process call does not require a network service.
Contract-to-contract dependencies are permitted only when one contract uses
vocabulary owned by the other, and the resulting package graph must remain
acyclic.

### Prisma stays behind server repository adapters

LangWatch keeps one Prisma schema and generated client. Only concrete Prisma
repository adapters import generated Prisma code. Repository interfaces use
feature-contract types, and adapters translate database records and enums
before returning. Prisma types never appear in a contract package, web package,
service interface or package export.

This is type-graph isolation, not a claim that each feature owns an independent
database. Features may share the same physical database while being unable to
couple themselves to one another's persistence implementation.

Service operations remain retry-safe and idempotent where practical; this
package structure does not require wrapping routine work in database
transactions. When an invariant genuinely requires atomic persistence, the
transaction is contained inside the repository adapter and still returns only
contract-owned values.

### Enterprise packages follow the same surface model

Enterprise features mirror the same physical structure:

```text
packages/enterprise/features/<feature>/
  contract/
  server/
  web/
  adrs/
  specs/
```

Each surface remains optional and is a separate workspace package when it
exists. Core packages may define extension contracts, but do not import
enterprise implementations. Application composition roots are the only place
where an enterprise implementation is selected and connected to a core
extension point.

The exact grouping of enterprise features can evolve independently; enterprise
status does not weaken the browser/server, contract or repository boundaries.

### Tooling enforces the shape

Repository checks will derive the allowed dependency graph from package role
and feature name. At minimum they reject:

- `contract` importing `server`, `web`, React, Prisma or Node-only runtime code;
- `web` importing any `server` package or generated Prisma code;
- one feature importing another feature's `server`, repository or internals;
- core packages importing enterprise implementations;
- deep imports that bypass a package export map; and
- exported server declarations containing Prisma-generated types;
- feature source reading environment variables directly;
- service factory functions, service classes without static `create`, nested
  ternaries and conditional object spreads; and
- a feature ownership root without an indexed boundary ADR and linked Gherkin
  spec covering public surfaces, dependencies, persistence, runtime,
  environment, errors and contract validation.

Oxlint handles source and import rules in the ordinary fast lint path. The
workspace checker handles manifests, cycles, emitted declarations and the
structural completeness of ADRs/specs. A relative path, TypeScript path alias
or `import type` cannot be used to bypass them.

## Alternatives considered

One package per feature with `contract`, `server` and `web` subpath exports
would reduce manifest count, but all three surfaces would still share one
dependency list and one declaration graph. Installing the contract could
therefore install React and Prisma even when export maps prevented a direct
source import. That fails the runtime-footprint and type-isolation goals that
forced this decision.

Flat packages such as `packages/<feature>-server` would provide the same
technical isolation, but would scatter one feature's packages, ADRs and specs
through a growing global list. The additional feature directory is an
ownership and discoverability boundary without becoming another package.

Repository-wide `contracts`, `server` and `web` packages would separate runtime
layers while coupling unrelated product concepts into three new monoliths.

## Consequences

- A consumer installs and typechecks only the feature surface it uses.
- Browser and server dependency graphs are separated by package manifests, not
  bundler convention.
- Backend-only and frontend-only features remain natural and require no empty
  packages.
- Cross-feature dependencies become visible as contract edges, while concrete
  instances can still call each other in process.
- Feature ADRs and behavioural specs have a stable home beside all of the
  feature's surfaces.
- The workspace gains more `package.json` files, TypeScript build units,
  export maps and dependency declarations to maintain.
- Moving behaviour between contract, server and web becomes an explicit API
  change rather than a relative-path refactor.
- A feature boundary can move to another process later without changing the
  contract/server/web ownership model.

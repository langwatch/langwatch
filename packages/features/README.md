# Feature packages

Feature packages are the default home for reusable product behaviour. They keep
portable contracts, server implementation, and optional web UI behind explicit
package boundaries instead of spreading a feature through the application.

The rules in this document are enforced by architecture lint. The architectural
decisions remain the source of truth:

- [Feature package boundaries](../architecture-lint/adrs/001-feature-package-boundaries.md)
- [Strict versioned source layout](../architecture-lint/adrs/002-versioned-strict-feature-layout.md)
- [Singular feature ownership](../../dev/docs/adr/112-singular-feature-ownership.md)
- `agent` is the target strict-layout reference feature; existing plural roots
  are migration paths, not naming precedents.

## Start a feature

Every feature has one ownership root and a `feature.json`:

```text
packages/features/<feature>/
├── feature.json
├── contract/
├── server/
├── web/          # optional
├── adrs/
└── specs/
```

```json
{
  "layoutVersion": 0
}
```

Every feature uses strict layout version 0. There is no legacy or migration
layout: these packages are still in progress, so the first enforced format is
version 0.

The ownership root is the singular identifier registered in the planned
`packages/features/catalogue.json`. That repository-wide catalogue maps every
core and Enterprise subject to exactly one feature; `feature.json` selects only
the strict source-layout version and cannot broaden ownership locally.
Production contract and server filenames must match an owned catalogue
subject. Adding a feature or subject changes the central catalogue, the owning
feature ADR, and its behavioural spec together.

Do not create a package per endpoint or table. A subordinate behaviour stays
with its product owner: avatar belongs to `user`, teams and invites to
`organization`, records to `dataset`, tags and versions to `prompt`, and spans
to `trace`. Independently useful durable domains such as `project`, `api-key`,
`model-provider`, `prompt`, and `dataset` remain separate features even when a
single use case combines them.

Each code directory is a separate workspace package:

| Directory  | Package name                    | Responsibility                                                              |
| ---------- | ------------------------------- | --------------------------------------------------------------------------- |
| `contract` | `@langwatch/<feature>-contract` | Portable values, schemas, commands, queries, errors, and service capability |
| `server`   | `@langwatch/<feature>-server`   | Services, private persistence, adapters, APIs, projections, and migrations  |
| `web`      | `@langwatch/<feature>-web`      | Optional browser-safe components and feature UI                             |

The feature root is an ownership directory, not a package. Do not put a
`package.json` there.

Enterprise code is grouped beneath one deliberate root:

```text
packages/enterprise/
├── LICENSE.md                # governs every enterprise descendant
├── README.md                 # enterprise catalogue + open-core explanation
├── package.json              # @langwatch/enterprise: portable catalogue
├── src/
├── composition/api/          # @langwatch/enterprise-api
├── composition/worker/       # @langwatch/enterprise-worker
├── composition/web/          # @langwatch/enterprise-web
└── features/<feature>/       # strict contract/server/web packages
```

Enterprise feature packages use names such as
`@langwatch/enterprise-<feature>-contract`. Each application imports its one
runtime-compatible enterprise composition package; those aggregate packages
contain only composition classes and never product implementation. The root
legal license and README move before any enterprise source so their
directory-and-descendants scope remains intact. Product licensing uses the same
strict `features/licensing/{contract,server,web}` layout as other features.
Signed-license state feeds the provider-neutral
[Entitlements capability](./entitlements/adrs/001-provider-neutral-plan-resolution.md)
rather than replacing it.

Enterprise is a composition and legal grouping, not a catch-all feature.
`ops` and `saas` are core feature roots. The Enterprise catalogue contains the
singular `audit-log`, `billing`, `governance`, `licensing`, `managed-provider`,
`scim`, `sso`, and `webhook` features.

During the physical application split in
[ADR-111](../../dev/docs/adr/111-physical-application-workspaces.md), reusable
source from `platform/app/ee` moves feature by feature into those ownership
roots. Do not rename the old tree wholesale or create an enterprise legacy
package: move reusable code into a strict enterprise feature, register it once
in the matching composition package and remove the `@ee/*` alias with its last
caller.

## Version-0 source layout

```text
contract/src/
├── index.ts
├── <subject>.service.ts
├── <subject>.commands.ts
├── <subject>.queries.ts
├── <subject>.events.ts
├── <subject>.errors.ts
└── <domain files or domain directories>

server/src/
├── index.ts
├── testing.ts
├── fixtures/<subject>.fixture.ts
├── services/<subject>.service.ts
├── repositories/<subject>.repository.ts
├── repositories/<adapter>/<adapter>.<subject>.repository.ts
├── repositories/<adapter>/<adapter>.<subject>.mapper.ts
├── stores/<subject>.store.ts
├── stores/<adapter>/<adapter>.<subject>.store.ts
├── projections/<subject>.projection.ts
├── ports/<subject>.port.ts
├── adapters/<adapter>.<subject>.adapter.ts
├── api/<surface>/<subject>.api.ts
└── migrations/<source>-import.<subject>.migration.ts
```

`<subject>`, `<adapter>`, `<surface>`, and `<source>` use lower-case kebab case.
Dots separate architectural qualifiers; hyphens remain part of a name.

Good:

```text
agent.service.ts
stored-object.repository.ts
prisma.agent.repository.ts
clickhouse.stored-object.store.ts
clickhouse-import.stored-object.migration.ts
api/legacy-rest/agent.api.ts
```

Avoid:

```text
service.ts
prisma-agent.repository.ts
storedObjectService.ts
clickhouse-import.migration.ts
api/internal/index.ts
```

## What goes where

### Contract

The contract is portable. It owns:

- domain values and identifiers;
- Zod 4 schemas and inferred transport-safe types;
- commands, queries, events, and concrete domain errors; and
- an abstract `<Subject>Service` capability.

It must not import Node runtime APIs, Prisma, Hono, tRPC server code, React,
Eventing, application aliases, or its server and web implementations. It must
not contain repositories, stores, adapters, projections, migrations, or API
implementations.

The contract root export is the supported vocabulary other packages consume.
Cross-feature collaboration always uses the owning feature's abstract service
from its contract. Consumers do not create caller-specific versions of that
service or import its repository, store, projection, or concrete server
implementation.

### Service

`server/src/services/<subject>.service.ts` contains the concrete service class.
The service implements or extends the contract capability and owns the feature's
validation, orchestration, and state transitions.

A service:

- receives repository, store, and external capability ports;
- never imports an API, migration, or concrete infrastructure adapter;
- exposes construction through `static create`; and
- keeps behaviour on the class instead of using standalone service factories.

Private, pure module-local helpers may support the class. They are implementation
details, not an alternative public behaviour surface.

Do not create a thin service that forwards most behaviour to parallel
`lifecycle`, `manager`, or `composition` objects. Those responsibilities belong
on the service or on one of the specific artifact types below.

### Repository and store

Use a repository for ordinary domain persistence. Its private port lives at
`repositories/<subject>.repository.ts`; a technology adapter lives below its
technology directory, for example
`repositories/prisma/prisma.agent.repository.ts`.

Use a store only when the abstraction is genuinely a store, such as a generic
state or byte store. Do not create both a repository and a store around the same
table merely to split methods. Repository and store ports are abstract classes;
technology-specific implementations are concrete classes with `static create`.

Only files inside `repositories/prisma` may import the generated Prisma client.
They map persistence rows into contract or server-domain values before
returning. Prisma types never cross a public package boundary.

### Port and adapter

A port describes a non-persistence capability the feature needs from its host
or another system. Put it in `ports/<subject>.port.ts` and keep it narrow.

An adapter binds a concrete technology or a set of private ports without moving
business behaviour out of the service. For example,
`adapters/prisma.agent.adapter.ts` binds a private Prisma repository to
`AgentService`. Adapters are classes with `static create`.

### Testing fixtures

Reusable, inert test data lives in `server/src/fixtures/<subject>.fixture.ts`
and is exposed only through the deliberate `./testing` package subpath. Fixture
modules may export pure values and builders; production source must not import
that subpath. A fixture is not an adapter and must not be placed under
`adapters/` merely to make it reachable from tests.

### API

An API class lives at `api/<surface>/<subject>.api.ts`. A surface can be
`public`, `internal`, `legacy-rest`, or another deliberately named transport
surface.

API classes are thin adapters. They receive the contract service capability,
validate transport input using contract schemas, delegate exactly once, and map
handled errors. They do not import repositories, stores, projections,
migrations, or infrastructure adapters.

REST and RPC are implementation choices at this layer. Existing app tRPC can
remain a compatibility adapter over the same composed service; it is not a
second feature implementation.

### Projection

Use `projections/<subject>.projection.ts` only when state is actually derived
from an event or log. A projection is a class with `static create`. Ordinary
mutable table state does not need a projection merely because it is read often.

### Migration

A source import is one class named
`migrations/<source>-import.<subject>.migration.ts`, such as
`clickhouse-import.stored-object.migration.ts`. It uses the repository, store,
or service boundary needed for the import; it does not introduce a second
service or persistence model.

### Runtime composition

Feature packages expose classes and deliberate entry points without registering
anything on import. Application and worker composition belongs under:

```text
platform/app/src/runtime/app/
platform/app/src/runtime/worker/
```

Those runtime roots construct concrete adapters and services, then mount API or
worker surfaces. A version-0 feature has no catch-all `composition`,
`registration`, `lifecycle`, or `eventing` source directory.

Each process constructs one canonical LangWatch App service graph. Hono reads
it from `c.var.langwatchApp`, tRPC from `ctx.app`, and worker handlers from their
composed runtime. A request handler never constructs a feature service or
repository, and a feature service never uses a global Prisma client to recover
its dependencies.

## Classes and functions

Exported services, repositories, stores, adapters, projections, APIs, and
migrations are classes. Concrete runtime classes expose `static create`;
repository and store ports are abstract classes. Exported free functions must
not act as behaviour objects or factories for these roles.

Pure value transformations, schemas, mappers, test builders, and private
module-local helpers may be functions. A function should not act as a hidden
service, store, projection, or registration system.

## Exports and dependencies

Every package has an explicit `exports` map. Wildcard exports, source-directory
exports, and public repository or Prisma subpaths are forbidden. Add a named
server entry point only when the feature ADR identifies it as a supported
composition surface.

Dependency direction is:

```text
contract <- service <- API
                 ^
                 |
          port <- concrete adapter
```

Additional rules:

- contract packages depend only on portable contracts and libraries;
- server and web depend on their own contract;
- web never depends on server;
- one feature reaches another feature only through its contract;
- core packages never depend on enterprise implementations; and
- feature packages receive validated configuration instead of reading
  `process.env` or `import.meta.env`.

## ADRs, specifications, and tests

Each feature owns:

- `adrs/README.md`;
- at least one boundary ADR linked from that index; and
- at least one linked Gherkin feature under `specs/`.

The boundary ADR records public surfaces, dependencies, persistence, runtime
registration, configuration, errors, and validation. Tests live inside the
physical package they exercise and may reach that package's private modules;
they may not reach another package's internals.

## Linting

Run the repository architecture gate with:

```bash
pnpm lint:architecture
```

The gate combines Oxlint source rules with the graph-aware architecture CLI. It
checks:

- singular feature registration and unique subject ownership in the central
  catalogue;
- layout versions, directories, and filenames;
- required classes and `static create` methods;
- internal and cross-package dependency direction;
- package names, dependencies, cycles, and explicit exports;
- Prisma containment and public declaration leaks;
- direct environment access and hidden server control flow; and
- required ADR and specification structure.

For focused architecture-lint development:

```bash
pnpm --filter @langwatch/architecture-lint typecheck
pnpm --filter @langwatch/architecture-lint test
pnpm --filter @langwatch/architecture-lint lint
```

Also typecheck and test each changed physical feature package.

## Changing the format

Do not suppress a layout failure with a local exception or invent a feature-only
directory. If the shared format no longer fits, change it deliberately:

1. Write an architecture decision explaining the new shape.
2. Add or update the Gherkin scenarios and architecture-lint fixtures.
3. Implement layout version 1 rather than changing version 0 underneath
   existing features.
4. Migrate a feature by changing its source, tests, ADR, and `feature.json` in
   the same review.

Until such a decision lands, version 0 is the only accepted layout.

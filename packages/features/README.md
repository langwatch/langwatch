# Feature packages

Feature packages are the default home for reusable product behaviour. They keep
portable contracts, server implementation, and optional web UI behind explicit
package boundaries instead of spreading a feature through the application.

The rules in this document are enforced by architecture lint. The architectural
decisions remain the source of truth:

- [Feature package boundaries](../architecture-lint/adrs/001-feature-package-boundaries.md)
- [Strict versioned source layout](../architecture-lint/adrs/002-versioned-strict-feature-layout.md)
- [Agents](./agents/) is a strict-layout reference feature.

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

Each code directory is a separate workspace package:

| Directory  | Package name                    | Responsibility                                                              |
| ---------- | ------------------------------- | --------------------------------------------------------------------------- |
| `contract` | `@langwatch/<feature>-contract` | Portable values, schemas, commands, queries, errors, and service capability |
| `server`   | `@langwatch/<feature>-server`   | Services, private persistence, adapters, APIs, projections, and migrations  |
| `web`      | `@langwatch/<feature>-web`      | Optional browser-safe components and feature UI                             |

The feature root is an ownership directory, not a package. Do not put a
`package.json` there.

Enterprise features mirror the same structure under
`packages/enterprise/features/<feature>` and use package names such as
`@langwatch/enterprise-<feature>-contract`.

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
Cross-feature collaboration always uses the owning feature's contract.

### Service

`server/src/services/<subject>.service.ts` contains the concrete service class.
The service implements or extends the contract capability and owns the feature's
validation, orchestration, and state transitions.

A service:

- receives repository, store, and external capability ports;
- never imports an API, migration, or concrete infrastructure adapter;
- exposes construction through `static create`; and
- keeps behaviour on the class instead of using standalone service factories.

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

## Classes and functions

Services, repositories, stores, adapters, projections, APIs, and migrations are
classes. Concrete runtime classes expose `static create`; repository and store
ports are abstract classes.

Pure value transformations, schemas, mappers, and test builders may be
functions. A function should not act as a hidden service, store, projection, or
registration system.

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

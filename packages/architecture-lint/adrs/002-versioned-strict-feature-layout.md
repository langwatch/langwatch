# ADR-002: Feature source layout is strict and versioned

**Date:** 2026-08-22

**Status:** Accepted

**Behavioural contract:**
[Strict feature source layout](../specs/strict-feature-layout.feature)

**Related:**
[ADR-001: feature package boundaries](./001-feature-package-boundaries.md),
[ADR-101: feature package surfaces](../../../dev/docs/adr/101-feature-package-surfaces.md),
[ADR-112: singular feature ownership](../../../dev/docs/adr/112-singular-feature-ownership.md),
and [ADR-102: runtime composition roots](../../../dev/docs/adr/102-runtime-composition-roots.md).

## Context

Package dependency rules stop a feature escaping into the application, but they
do not make the inside of a server package predictable. A service can still be
split across `composition`, `registration`, `lifecycle`, and transport folders;
repositories and migrations can acquire one-off names; and a thin class can
hide most behaviour in free functions or parallel orchestration objects.

The Agent feature provides the useful shape: portable contract, concrete
service, private repository port and adapter, and thin API classes. That shape
needs mechanical enforcement. It also needs an explicit evolution mechanism so
that improving the convention later does not silently reinterpret every old
package or create permanent per-file exceptions.

## Decision

Every feature ownership root contains `feature.json` with
`"layoutVersion": 0`. Version 0 is the initial strict layout defined here;
there is no legacy or migration layout because every governed feature is still
under active development.

Changing the meaning of version 0 is forbidden. A materially different layout
becomes version 1; a feature migrates in one review by changing its files,
tests, ADR, and declared version together. There are no file comments, globs,
legacy modes, or package-specific exceptions that suppress a versioned rule.

```text
packages/features/<feature>/
├── feature.json
├── contract/
│   └── src/
│       ├── index.ts
│       ├── <subject>.service.ts
│       ├── <subject>.commands.ts
│       ├── <subject>.queries.ts
│       ├── <subject>.errors.ts
│       └── <domain files or domain directories>
├── server/
│   └── src/
│       ├── index.ts
│       ├── testing.ts
│       ├── services/<subject>.service.ts
│       ├── repositories/<subject>.repository.ts
│       ├── repositories/<adapter>/<adapter>.<subject>.repository.ts
│       ├── repositories/<adapter>/<adapter>.<subject>.mapper.ts
│       ├── stores/<subject>.store.ts
│       ├── stores/<adapter>/<adapter>.<subject>.store.ts
│       ├── projections/<subject>.projection.ts
│       ├── ports/<subject>.port.ts
│       ├── adapters/<adapter>.<subject>.adapter.ts
│       ├── api/<surface>/<subject>.api.ts
│       └── migrations/<source>-import.<subject>.migration.ts
├── web/                                  # optional
├── adrs/
└── specs/
```

Names are lower-case kebab case. Dots separate architectural qualifiers;
hyphens remain part of a qualifier or domain name. Thus
`prisma.agent.repository.ts`, `clickhouse.stored-object.repository.ts`, and
`clickhouse-import.stored-object.migration.ts` are valid and
`prisma-agent.repository.ts` is not.

Contract domain directories may organize portable values and schemas. They may
not contain server artifact suffixes such as `repository`, `store`, `adapter`,
`projection`, `migration`, or `api`. A contract service module exports the
abstract service capability. Commands, queries, errors, and schemas remain
transport-neutral.

Server source has no catch-all architecture folders. `composition`,
`registration`, `lifecycle`, and `eventing` are not version-0 layers. Their
behaviour belongs to a service, projection, migration, adapter, or the app or
worker composition root. A feature that truly needs a new reusable layer must
change the shared layout decision rather than inventing a local directory.

Files ending in `.service.ts`, `.store.ts`, `.projection.ts`, `.api.ts`, and
`.migration.ts` export the correspondingly named class. Concrete runtime
classes expose `static create`. Repository and store ports are abstract classes;
technology-specific implementations are concrete classes. Pure schemas, value
objects, mapper functions, and test builders do not need artificial classes.

API classes only translate authentication-authorized transport input into the
contract service and map its result or handled errors. They do not import a
repository, store, projection, migration, or infrastructure adapter. Services
do not import API, migration, or concrete adapter modules. A canonical adapter
class binds private concrete persistence to the service at composition.

### Public surfaces and transports

The strict layout changes no product protocol. Contract root exports and
deliberate server API subpaths remain the supported doors. An API surface is a
class under `server/src/api/<surface>` and delegates to the same service whether
the host mounts it as REST, RPC, tRPC compatibility, or a worker command.

### Dependencies

ADR-001 package-role dependency rules still apply. Version 0 adds internal
server direction: API depends on service capability, service depends on
portable contracts and private ports, and concrete persistence depends on its
port. Reverse imports are lint failures.

### Persistence

Domain persistence uses a private repository or store port and a named concrete
adapter. Technology is visible only in the adapter filename and directory. A
ClickHouse import is a migration class, not a second service or composition
tree.

### Runtime and registration

Feature packages expose classes and deliberate entry points without registering
on import. App and worker runtime roots construct concrete adapters and services
and mount API classes. Version 0 therefore has no package-local `composition`
or `registration` directory.

### Environment and configuration

The layout adds no environment access. Runtime roots validate environment and
inject typed configuration into class construction as required by ADR-001.

### Errors

Layout violations report the declared version, offending path, expected
pattern, and owning layer. Behavioural errors remain concrete contract errors
and are mapped only at API boundaries.

### Contracts and validation

`feature.json` is parsed by architecture lint. Unknown versions, missing files,
invalid JSON, disallowed directories, misplaced artifact suffixes, malformed
filenames, wrong module shapes, and forbidden internal imports fail ordinary
repository lint. Fixtures cover the strict version-0 layout.

## Alternatives considered

One timeless convention would make harmless improvements unexpectedly break
packages. Per-package glob configuration would turn the linter into a list of
exceptions. Inferring singular domain names from feature directory names would
fail for multi-aggregate features. Versioned structural rules keep the standard
shared while allowing deliberate future migrations.

## Consequences

- New feature source has one predictable place and name for each artifact.
- A layout rule cannot change underneath a package without a version change.
- Agent, Entitlement, and Stored Object use the same version-0 layout after
  their singular ownership-root migrations.
- Architecture lint gains filesystem checks as well as AST import and class
  checks.

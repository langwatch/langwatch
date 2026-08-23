# ADR-111: Physical application workspaces preserve deployment topology

**Date:** 2026-08-24

**Status:** Proposed

**Related:** [ADR-070: modular package architecture](./070-modular-package-architecture.md),
[ADR-076: single pnpm workspace](./076-single-pnpm-workspace.md),
[ADR-101: feature package surfaces](./101-feature-package-surfaces.md),
[ADR-102: runtime composition roots](./102-runtime-composition-roots.md), and
[ADR-104: runtime environment configuration](./104-runtime-environment-configuration.md).

## Context

`platform/app` is one physical `@langwatch/web` workspace containing the React
browser build, the HTTP API, tRPC, realtime transports, background workers,
one-shot tasks, the Prisma schema and generated client, and both runtime
composition roots. ADR-102 first separated the app and worker logically inside
that package and deliberately deferred physical extraction until their graphs
were easier to distinguish.

Feature contracts, server implementations, web surfaces, and runtime adapters
now have enforceable package boundaries. Keeping every executable in one
workspace has become the remaining exception: the browser can infer types from
server implementation source, the worker package manifest necessarily includes
interactive HTTP and React dependencies, and a package-level check cannot prove
that one runtime avoids another runtime's graph.

The name `packages/server` adds a different ambiguity. It is not the HTTP
server or a reusable backend package. It contains the CLI that installs and
supervises the self-host stack published from the repository root as
`@langwatch/server`.

There is no operational forcing function for new images or services. The API
must continue to serve the browser artifact in production, the API and worker
must continue to ship in the same image with separate commands, and
`npx @langwatch/server` must remain compatible. This decision separates source
and dependency graphs without changing that deployment topology.

This ADR supersedes only ADR-102's decision to defer physical application
extraction. ADR-102's closed runtime graphs, explicit lifecycle ownership,
feature installation, and combined-development rules remain in force.

## Decision

### Executable composition roots live under `apps`

Create four physical workspace packages:

```text
apps/
├── ui/       # @langwatch/ui
├── api/      # @langwatch/platform-api
├── worker/   # @langwatch/worker
└── server/   # @langwatch/server
```

An app is an executable composition root. Reusable contracts, feature
implementations, frameworks, infrastructure clients, and browser components
remain under `packages`. There is no `apps/shared` package and no shared
backend app: code required by more than one process moves to its owning feature
package or to a deliberately named reusable infrastructure package.

`apps/ui` owns the Vite/React application, browser routing and browser runtime
composition. It may import feature contracts, feature web packages, the Design
System, and browser-safe API client contracts. It does not import API or worker
implementation source, including through a type-only `AppRouter` import.

`apps/api` owns the interactive Node process: Hono API composition, the
application's existing tRPC surface, authentication, authorization at the
transport boundary, realtime transports, observability bootstrap, and static
asset delivery. `packages/api` remains the reusable `@langwatch/api` Hono
framework; the executable is named `@langwatch/platform-api` to keep those two
responsibilities distinct.

`apps/worker` owns background process composition, Eventing and Group Queue
consumers, process managers, schedulers, and one-shot product tasks. It imports
no React source, browser state, Hono route composition, tRPC router, or static
asset server.

`apps/server` owns the published `@langwatch/server` CLI and self-host
distribution. Its role is installation, local dependency management,
packaging, process supervision and stack health. It may invoke the built API,
worker and task entry points, but it does not implement product APIs, jobs,
repositories or migrations. The existing public package and command name are
kept for compatibility even though "server" describes the distribution rather
than the HTTP process. The repository-root manifest becomes private and acts
only as a workspace and contributor-command facade.

Application packages do not import one another's source. Runtime collaboration
happens through injected feature contracts within a process or through an
existing network boundary between processes. Packaging one app's artifact
beside another does not create a source dependency.

### The API serves the UI artifact without owning UI source

`apps/ui` produces a static build artifact. Development continues to run Vite
separately and proxy API traffic to the API process. Production image assembly
places the UI artifact where `apps/api` can serve it, including the existing
single-page fallback and security headers.

The API receives the asset location as runtime/build composition input; it does
not import UI modules or build the UI through a JavaScript dependency. This
preserves today's origin, ingress, cookies and image topology while leaving a
future CDN or independently deployed UI as an artifact-routing change.

The UI also stops importing the server router to infer the complete tRPC
surface. Browser-facing inputs, outputs and client capabilities must be
portable contracts rather than declarations that pull the API implementation
graph into the UI. Existing whole-router inference is a migration seam, not an
accepted cross-app boundary, and must be removed before `platform/app` is
deleted.

### Prisma becomes an owned infrastructure client package

Create `packages/prisma-client`, named `@langwatch/prisma-client`, alongside
`@langwatch/clickhouse-client` and `@langwatch/redis-client`. It owns:

- the canonical Prisma schema and PostgreSQL migrations;
- generated Prisma client output and the PostgreSQL driver adapter;
- explicit client construction, readiness and shutdown;
- database migration and seed mechanics; and
- the generated Prisma errors and types required by concrete repositories.

The package reads no ambient environment and creates no client on import. A
composition root supplies validated configuration and owns the returned
client's lifecycle. Standalone API and worker processes each construct and
close their own client. Combined development may deliberately share one client
through the shared `ResourceScope`, which closes it exactly once.

`@langwatch/prisma-client` is infrastructure, not a home for product queries,
repositories or business rules. In strict feature packages, only concrete
`repositories/prisma` adapters may depend on its generated surface. Services
continue to depend on narrow repository capabilities, and contract and web
packages never import it.

### Physical packages do not imply new deployments

The production image continues to contain the UI, API and worker artifacts.
Its default API command and separate worker command retain their current
networking, environment, probes, scaling controls and shutdown budgets. Helm,
Docker Compose and the self-host launcher continue to select a command from the
same image.

Each physical app owns a separate manifest, typecheck, tests, build and runtime
environment schema. A filtered install or build can select the UI, API, worker
or server graph independently. Combined local development remains an explicit
parent composition and may share infrastructure; it is not a reason to restore
one universal package or service locator.

### Migration proceeds through runnable boundaries

The repository migrates in dependency order:

1. establish the app workspace and dependency-direction lint rules;
2. extract `@langwatch/prisma-client` so API and worker have a neutral owner for
   their shared PostgreSQL client;
3. extract the browser build to `apps/ui` and make static assets an explicit
   build artifact;
4. extract HTTP and interactive runtime composition to `apps/api`;
5. extract background composition and task execution to `apps/worker`;
6. move the self-host CLI from `packages/server` to `apps/server`;
7. update workspace filters, root scripts, generated-file checks, Docker,
   Helm, CI and npm staging; and
8. remove `platform/app` after no compatibility source edge remains.

Every stage keeps the current application, worker and self-host commands
runnable. Transitional aliases or forwarding entry points are removed with the
stage that replaces their last caller; they do not become another permanent
application layer.

## Alternatives considered

Keeping only the logical split from ADR-102 was rejected because one workspace
manifest and source root cannot enforce the browser/API/worker dependency
boundaries now expected from feature packages.

Splitting images, ingress or deployments at the same time was rejected because
there is no operational requirement for it. Combining source extraction with
an operational topology change would make compatibility failures harder to
isolate and roll back.

Making `apps/server` a shared backend library was rejected because applications
are composition roots, not dependency containers. Shared product behavior
belongs to feature packages and shared infrastructure belongs to specifically
named packages.

Creating a generic `packages/database` was rejected in favor of
`@langwatch/prisma-client`, which states the technology and responsibility as
clearly as the existing Redis and ClickHouse client packages and does not
invite unrelated persistence abstractions.

Renaming `@langwatch/server` to `@langwatch/self-host` was considered more
descriptive, but rejected for this change because the existing npm command is a
public compatibility surface. Moving its source to `apps/server` and
documenting its launcher role resolves the repository ambiguity without a
customer migration.

Serving the UI independently now was deferred. Keeping the artifact boundary
clean makes that future deployment change possible without another source
split.

## Consequences

- UI, API, worker and self-host tooling gain independently enforceable
  dependency graphs, builds, tests and configuration.
- The API and worker can install only the feature and infrastructure surfaces
  they execute, while combined development remains available explicitly.
- Prisma schema generation and connection ownership have one reusable home
  instead of being implicitly owned by the interactive app.
- The UI artifact can move to independent hosting later without changing API
  or feature source boundaries.
- Existing images, commands, ingress, cookies and scaling topology remain
  unchanged during the source migration.
- The split requires broad path, manifest, build, generated-file, CI, Docker,
  Helm and npm-packaging changes even though production topology does not
  change.
- Legacy whole-router tRPC inference and other browser-to-server source edges
  must be converted to portable client contracts; moving directories alone is
  insufficient.
- API and worker processes each hold their own Prisma pool in production, so
  pool sizing remains fleet-aware and must account for both process classes.
- `@langwatch/server` remains a semantically imperfect public name. Its
  launcher role must stay explicit in documentation so it is not reused as a
  backend library.

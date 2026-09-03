# ADR-111: Physical application workspaces preserve deployment topology

**Date:** 2026-08-24

**Status:** Accepted

**Behavioural contract:**
[Application workspace boundaries](../../../specs/dependencies/application-workspace-boundaries.feature)

**Related:** [ADR-004: development environment](./004-docker-dev-environment.md),
[ADR-070: modular package architecture](./070-modular-package-architecture.md),
[ADR-076: single pnpm workspace](./076-single-pnpm-workspace.md),
[ADR-086: runtime-configurable CDN assets](./086-cdn-asset-base.md),
[ADR-093: Redis client ownership](./093-redis-is-an-owned-client.md),
[ADR-101: feature package surfaces](./101-feature-package-surfaces.md),
[ADR-102: runtime composition roots](./102-runtime-composition-roots.md), and
[ADR-104: runtime environment configuration](./104-runtime-environment-configuration.md),
with product ownership and singular feature names defined by
[ADR-112](./112-singular-feature-ownership.md).
The physical move of SSO also preserves the licensing boundary fixed by
[ADR-027](./027-license-gated-sso.md), while repository-wide lint and format
cutover is owned by
[architecture-lint ADR-003](../../../packages/architecture-lint/adrs/003-unified-oxc-toolchain.md).

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

This ADR supersedes ADR-102's decision to defer physical application
extraction. ADR-102's closed runtime graphs, explicit lifecycle ownership,
feature installation, and combined-development rules remain in force. It also
partially supersedes the physical details fixed by ADR-076: the application is
no longer one `@langwatch/web` package, the publishable manifest moves from the
repository root to `apps/server`, and npm staging installs the
`@langwatch/server...` workspace closure rather than `@langwatch/web...`.
ADR-076's single workspace, one lockfile, frozen install and nested staging
decisions remain in force.

This ADR narrows two earlier containment rules without weakening them. It gives
ADR-101 one explicit infrastructure-only exception for the generated Prisma
surface, while keeping Prisma out of product package exports and service
interfaces. It also clarifies ADR-104: the three Node applications validate
process environments, while the static UI receives the existing allow-listed
public runtime contract and owns no deployment environment schema.

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

The physical split therefore does not copy the monolith into four smaller
directories. Before an application root is cut over, reusable product behaviour
in its slice moves vertically: portable schemas and capabilities to a feature
contract, backend services and adapters to its feature server package, and
browser behaviour to its feature web package. The application retains only
process bootstrap, runtime configuration, routing or task composition, and
lifecycle. During migration the existing application may consume the extracted
packages, so each feature move can land independently without creating a second
runtime.

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

The API constructs one canonical LangWatch App service graph for the process.
Hono handlers receive it through `c.var.langwatchApp`, and tRPC handlers receive
that same object through `ctx.app`. Routes do not construct feature services or
repositories per request, and feature services do not recover application
dependencies through a global Prisma client.

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

### Documentation moves with ownership

A vertical feature move includes its feature-specific ADRs, Gherkin specs and
developer documentation. They move to the feature root, are corrected after
the code boundary is real, and are edited down to current behaviour, durable
decisions and useful history explaining why the boundary exists. They are not
live implementation diaries and do not repeat repository-wide policy already
owned by an architecture ADR or the feature-format README.

`dev/docs` keeps only cross-cutting repository, deployment and application
decisions. A document spanning several features may stay in the top-level
corpus, but a document owned by one feature may not remain there as a second
source of truth. The same rule applies when `platform/app` is split: UI-, API-
and worker-specific boot documentation follows its application, while shared
product behaviour follows the feature package.

Combined local development is the sole composition exception and does not live
in an application package. `tools/dev-runtime` is a private contributor
workspace package. It may import intentional `./runtime` construction entry
points exported by `@langwatch/platform-api` and `@langwatch/worker`, construct
one shared `ResourceScope`, and return the two closed child runtimes. Neither
application depends on the other, and architecture lint permits only this
contributor tool to import both runtime entry points. It is not shipped or
deployed and contains no product service, repository, route, consumer or job
implementation.

### Enterprise source moves out of the application tree

The unstructured `platform/app/ee` tree is removed as part of the application
extraction. Enterprise code gains one deliberate ownership and composition
root, while product behaviour moves feature by feature into the strict layout
already defined by ADR-101 and the
[feature-package boundary](../../../packages/architecture-lint/adrs/001-feature-package-boundaries.md):

```text
packages/enterprise/
├── LICENSE.md                # governs this tree and every descendant
├── README.md                 # catalogue and licensing explanation
├── package.json              # @langwatch/enterprise
├── src/                      # portable enterprise catalogue
├── composition/
│   ├── api/                  # @langwatch/enterprise-api
│   └── worker/               # @langwatch/enterprise-worker
└── features/<feature>/
    ├── feature.json
    ├── contract/
    ├── server/
    ├── web/                  # optional
    ├── adrs/
    └── specs/
```

The existing Enterprise `LICENSE.md` moves to this root before any enterprise
source moves. Its directory-and-descendants scope therefore continues to cover
every enterprise contract, implementation, composition package and test. The
root README explains the open-core split and catalogues the feature packages.
Package metadata, repository documentation, source archives and the staged
self-host distribution retain the notice; no enterprise source may live beside
or above it under an Apache-only path.

The root `@langwatch/enterprise` package is portable. It owns enterprise feature
identity and catalogue declarations. It imports no feature implementation,
React, Node built-in, transport or persistence adapter. Product licensing is
not confused with the legal source license: signed-license schemas, validation,
issuance, activation, persistence and UI move into the ordinary strict
`packages/enterprise/features/licensing/{contract,server,web}` surfaces.
Licensing remains a source of entitlement information as decided by the
[Entitlements feature](../../../packages/features/entitlement/adrs/001-provider-neutral-plan-resolution.md);
it does not replace the provider-neutral plan decision or make SaaS depend on a
signed self-host license.

Each backend application gets one convenient enterprise composition import
without collapsing runtime graphs. `@langwatch/enterprise-api` composes
enterprise API installers and `@langwatch/enterprise-worker` composes
background installers. Each is a physical workspace package, exports a
composition class with static `create`, and may depend only on enterprise
feature surfaces valid for that runtime. The API composition package cannot
import enterprise worker implementations, and worker cannot import API's.
Applications import their one matching composition package rather than
maintaining independent lists of every enterprise feature. Browser enterprise
screens have no composition package of their own: `apps/ui`'s own feature
folders mount them directly, the same way every other feature is mounted.

Enterprise feature packages use names such as
`@langwatch/enterprise-<feature>-contract` and obey the same version-0
contract/server/web, class, filename, public-export and repository rules as core
feature packages. Enterprise status changes optional composition and
distribution, not package quality or dependency direction. Core packages may
define extension contracts but never import enterprise implementations.

Enterprise is a legal and composition group, not a broad product feature.
ADR-112's singular ownership catalogue applies inside it. The Enterprise
catalogue contains `audit-log`, `billing`, `governance`, `licensing`,
`managed-provider`, `saas`, `scim`, `sso`, and `webhook`. SaaS deployment
integrations remain under `packages/enterprise/features/saas` because their
source is covered by the Enterprise license, even though SaaS activation is
not itself an Enterprise entitlement check. Platform administration moves
with operational tooling to core `packages/features/ops` and is not listed by
the portable Enterprise catalogue.

There is no replacement `ee` alias, `apps/*/ee` tree, catch-all enterprise
implementation package or permanent enterprise legacy root. The portable root
and three composition packages contain no product services, repositories,
routes, jobs or UI components. Every reusable implementation, including product
licensing, moves to its enterprise feature. Tests, ADRs and specifications move
with the owning feature, while cross-feature behavioural specifications remain
in the top-level `specs` corpus. The existing image and self-host staging
continue to include the selected enterprise packages and the root Enterprise
license, so this source move does not change licensing or deployment topology.

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
graph into the UI. Feature-owned procedures expose these schemas and types from
their feature contract. The temporary `@langwatch/platform-api-contract`
package was deleted on 2026-09-03 after its last legacy procedure moved; the
browser types its client from `@langwatch/platform-api/app-trpc/types`, which
supersedes the "whole-router inference is a migration seam" clause.

### Prisma becomes an owned infrastructure client package

Create `packages/prisma-client`, named `@langwatch/prisma-client`, alongside
`@langwatch/clickhouse-client` and `@langwatch/redis-client`. It owns:

- the canonical Prisma schema and PostgreSQL migrations;
- generated Prisma client output and the PostgreSQL driver adapter;
- explicit client construction, readiness and shutdown;
- database migration and seed mechanics; and
- the generated Prisma errors and types required by concrete repositories.

The package exposes service classes for configuration, connection construction,
readiness, migrations and seeds. It exports no ready-made client, lazy proxy or
module singleton. The package reads no ambient environment and creates no
client on import. A composition root supplies validated configuration, calls
the connection service explicitly and owns the returned client's lifecycle.
Standalone API and worker processes each construct and close their own client.
`tools/dev-runtime` may deliberately share one client through its parent
`ResourceScope`, which closes it exactly once.

`@langwatch/prisma-client` is infrastructure, not a home for product queries,
repositories or business rules. In strict feature packages, only concrete
`repositories/prisma` adapters may depend on its generated surface. Services
continue to depend on narrow repository capabilities, and contract and web
packages never import it.

The package has two deliberate public surfaces. Its root exports construction
and lifecycle services. `@langwatch/prisma-client/generated` exports generated
Prisma types, enums, errors and query utilities, and architecture lint permits
that subpath only from concrete `server/src/repositories/prisma` adapters and
the Prisma client package itself. No product package re-exports those values.

### Environment files remain contributor inputs, not application ownership

The repository-root `.env` is the contributor source of truth after
`platform/app` is removed. Quickstart and Haven write the generated development
overlay to root `.env.dev-up`. Root contributor commands load those files and
pass the resulting source into the selected composition roots; API, worker and
server independently validate only the subset they own. Neither application
imports another application's environment schema.

`apps/ui` owns no process environment schema and reads no deployment secrets.
It obtains deployment-time public configuration through ADR-104's browser-safe
RPC contract. Deliberate non-secret Vite build inputs, if any remain, are build
tool configuration rather than a second runtime configuration source.

### Physical packages do not imply new deployments

The production image continues to contain the UI, API and worker artifacts.
Its default API command and separate worker command retain their current
networking, environment, probes, scaling controls and shutdown budgets. Helm,
Docker Compose and the self-host launcher continue to select a command from the
same image.

Each physical app owns a separate manifest, typecheck, tests and build. The API,
worker and server process applications each own a runtime environment schema;
the UI consumes the allow-listed browser runtime contract described above. A
filtered install or build can select the UI, API, worker or server graph
independently. Combined local development remains an explicit contributor-tool
parent composition and may share infrastructure; it is not a reason to restore
one universal package or service locator.

### Migration proceeds through runnable boundaries

The repository migrates in dependency order:

1. establish application classifications, target-ownership tests and
   dependency-direction lint rules. Existing `platform/app` debt is captured in
   a deterministic checked-in migration baseline that may only shrink; new
   cross-application edges, `apps/shared` and new `@ee/*` uses fail immediately.
   The baseline is not an accepted architecture surface and is deleted with the
   monolith;
2. extract the portable runtime-composition primitives and
   `@langwatch/prisma-client`, move contributor environment ownership to the
   repository root, and define the UI artifact-location and temporary portable
   API-contract seams before either side of those seams moves;
3. move the Enterprise `LICENSE.md` and README first; establish
   `@langwatch/enterprise` and its separate API, worker and web composition
   packages; update workspace discovery and staging for those paths in the same
   stage; then extract `platform/app/ee` feature by feature into
   `packages/enterprise/features`, replacing `@ee/*` imports with package
   exports. Keep SaaS beneath the Enterprise legal root while treating its
   runtime activation separately from Enterprise entitlement, and merge
   platform Admin into core Ops rather than carrying that temporary Enterprise
   location forward;
4. establish ADR-112's singular ownership catalogue and lint before further
   product extraction. Correct existing plural roots, then extract the identity
   spine and remaining core product behaviour feature by feature. Each vertical
   move includes its contract, server and optional web surfaces plus route,
   consumer or task installers, while the still-runnable monolith switches to
   those package exports;
5. extract the browser bootstrap, router, application shell and static build to
   `apps/ui`; product screens come from feature web packages and static assets
   remain an explicit build artifact;
6. extract HTTP and interactive runtime composition to `apps/api`, replace
   whole-router browser inference with feature contracts and the temporary
   legacy API contract;
7. extract background composition and the task registry to `apps/worker`, then
   establish the contributor-only `tools/dev-runtime` parent composition;
8. move the self-host CLI from `packages/server` to `apps/server` and make the
   repository root private only after the new package can assemble and verify
   its complete staged workspace closure;
9. complete remaining workspace filters, root scripts, generated-file checks,
   Docker, Helm, CI, npm staging and the detailed runtime, Prisma,
   static-delivery and self-host contracts;
10. remove `platform/app`, its aliases, the migration baseline and temporary
    forwarding paths after no compatibility source edge remains; and
11. perform the repository-wide Oxlint/Oxfmt cutover as an isolated final
    series. The formatting-only rewrite lands separately from source moves so
    rename history, review and rebases remain intelligible.

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

Renaming `platform/app/ee` wholesale to another legacy directory was rejected.
It would preserve the same mixed browser, transport, service and persistence
graph under a longer name and create a second architecture beside strict
features. Moving enterprise implementation beneath each `apps/*` directory was
also rejected because it would duplicate feature ownership across composition
roots.

One aggregate package importing API, worker and web implementations was
rejected even though it would offer one identical import everywhere. A package
has one dependency manifest, so that shape would put React in backend closures
and Node, queues and transports in the UI closure. The portable root plus three
runtime-specific composition packages keeps the grouping convenience while
retaining independently checkable graphs.

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
- Enterprise implementation gains the same enforceable feature surfaces as
  core code, and the ambiguous `ee` directory and alias disappear.
- Each application has one enterprise composition import, while the portable
  root makes catalogue vocabulary discoverable without leaking a different
  runtime's dependencies.
- The Enterprise license once again governs one physical tree, and packaging
  must preserve that notice wherever the tree is copied or staged.
- The convenience costs four aggregate manifests: the portable root and three
  runtime-specific composition packages. Architecture lint must keep those
  exceptional roles narrow so `@langwatch/enterprise` does not become another
  universal service bag.
- API and worker processes each hold their own Prisma pool in production, so
  pool sizing remains fleet-aware and must account for both process classes.
- `@langwatch/server` remains a semantically imperfect public name. Its
  launcher role must stay explicit in documentation so it is not reused as a
  backend library.

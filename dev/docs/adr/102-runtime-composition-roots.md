# ADR-102: One application package contains separate app and worker runtimes

**Date:** 2026-08-21

**Status:** Accepted; physical application extraction superseded by
[ADR-111](./111-physical-application-workspaces.md)

**Behavioural contract:**
[App and worker runtime encapsulation](../../../specs/dependencies/runtime-composition.feature)

**Related:** [ADR-070: modular package architecture](./070-modular-package-architecture.md),
[ADR-101: feature package surfaces](./101-feature-package-surfaces.md),
[ADR-111: physical application workspaces](./111-physical-application-workspaces.md),
[ADR-104: runtime environment configuration](./104-runtime-environment-configuration.md),
[Eventing framework boundary](../../../packages/eventing/adrs/20260820-eventing-framework-boundary.md),
and [Group Queue framework boundary](../../../packages/group-queue/adrs/20260820-group-queue-framework-boundary.md).

## Context

The current `platform/app` workspace package already has two runtime entry
points. `start.ts` serves the interactive application and HTTP transports;
`workers.ts` starts background processors. Production can run them as separate
deployments, while development may host both in one process.

They do not yet have separate application graphs. `initializeWebApp()` and
`initializeWorkerApp()` both call the same roughly monolithic preset with a
different `processRole`. That preset constructs nearly every service,
repository, transport and enterprise implementation, then returns a single
global `App` service bag. The role flag decides whether some consumers start,
but it does not stop the worker from loading interactive API dependencies or
stop the web process from constructing worker-only capabilities.

The service bag has also become the implicit dependency injection mechanism.
Feature code reaches `getApp()` from arbitrary locations, service construction
depends on initialization order, tests need a giant null implementation, and
shutdown ownership is shared between `startWorkers`, Eventing and `App.close`.
Adding feature packages without changing this composition would preserve the
same coupling behind cleaner import names.

There is no need to create several new physical applications yet. The
interactive server, browser delivery, internal tRPC, legacy REST and background
worker can remain one workspace package and one image. The immediate need is
logical encapsulation: independently closed dependency graphs and lifecycles
for the app and worker. A future physical split should be a move of an existing
composition root, not a redesign.

This ADR decides how `platform/app` contains those two runtimes, how feature
services are installed, how resources are owned and how the combined
development mode works. It does not create an `apps/` directory, add network
calls between feature services, split Prisma or require independent deployment.

## Decision

Keep one physical `@langwatch/web` workspace package at `platform/app`, with
two explicit runtime compositions inside it:

```text
platform/app/
├── package.json                         # still one workspace package
├── src/
│   ├── runtime/
│   │   ├── shared/
│   │   │   ├── capabilities.ts          # typed service tokens and registry
│   │   │   ├── feature.ts               # defineFeature/install contracts
│   │   │   ├── infrastructure.ts        # process-owned DB/Redis/CH clients
│   │   │   └── resource-scope.ts        # ordered lifecycle ownership
│   │   │
│   │   ├── app/
│   │   │   ├── appRuntime.ts            # AppRuntime.create(...)
│   │   │   ├── features.ts              # explicit app feature catalogue
│   │   │   ├── internal-rpc.ts           # composed tRPC surface
│   │   │   ├── legacy-rest.ts            # current public/compat routes
│   │   │   ├── realtime.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── worker/
│   │   │   ├── workerRuntime.ts         # WorkerRuntime.create(...)
│   │   │   ├── features.ts              # explicit worker feature catalogue
│   │   │   ├── eventing.ts
│   │   │   ├── group-queue.ts
│   │   │   ├── schedulers.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── combined/
│   │   │   └── combinedRuntime.ts       # CombinedRuntime.create(...)
│   │   └── testing/
│   │       └── createTestRuntime.ts
│   │
│   ├── start.ts                          # create app, start HTTP, close app
│   └── workers.ts                        # create worker, start it, close it
├── adrs/
└── specs/
```

The browser source remains in this package for now. “App runtime” in this ADR
means the server-side composition that serves the product, internal RPC,
legacy/public HTTP and realtime connections; it may also serve the built
browser artifact. “Worker runtime” means the Redis/Eventing/scheduled
background composition.

### A runtime is a closed object with an owned lifecycle

The two runtime classes expose different closed types:

```text
AppRuntime
├── services          only capabilities installed for interactive requests
├── internalRpc       composed feature RPC adapters
├── legacyRest        supported compatibility/public adapters
├── realtime
├── start()
└── close()

WorkerRuntime
├── services          only capabilities installed for background work
├── eventing
├── groupQueue
├── schedulers
├── start()
└── close()
```

Neither type is a universal service locator. A feature installer declares the
capabilities it requires and provides. The builder installs features in an
explicit catalogue, rejects missing requirements and duplicate capability keys,
then seals the registry before exposing the runtime. Code cannot add services
after start or ask for an undeclared optional dependency by string.

The type system carries the installed capability set where practical; runtime
validation remains mandatory because enterprise and environment-dependent
installers are selected dynamically.

The authoring API is intentionally small. In illustrative TypeScript, a feature
definition looks like this:

```ts
const agents = capability<AgentService>("agents");
const workflows = capability<WorkflowCapability>("workflows");

export const agentsFeature = defineFeature({
  name: "agents",
  requires: [workflows],
  provides: [agents],

  services({ require, provide, infrastructure }) {
    const service = AgentService.create({
      database: infrastructure.prisma,
      workflows: require(workflows),
    });
    provide(agents, service);
  },

  app: {
    rpc({ require, rpc }) {
      rpc.mount("agents", AgentsRpcApi.create(require(agents)));
    },
    legacyRest({ require, rest }) {
      rest.mount(LegacyAgentsRestApi.create(require(agents)));
    },
  },
});
```

`AppRuntime.create()` runs the selected features' `services` and `app` hooks.
`WorkerRuntime.create()` runs `services` and `worker` hooks. The Agents definition has
no worker hook, so selecting it for the app cannot start background behaviour.
A background-only feature can make the opposite choice. The actual API may use
builder methods rather than this exact object syntax, but it preserves these
properties: typed capabilities, explicit requirements, optional runtime hooks,
no import side effects and one sealed build phase.

### Features contribute services and runtime-specific adapters

A feature server package may export separate, side-effect-free contributions:

```text
@langwatch/agent-server
├── AgentService.create(...)
├── AgentsRpcApi.create(...)
└── LegacyAgentsRestApi.create(...)

@langwatch/some-background-feature-server
├── SomeFeatureService.create(...)
└── SomeFeatureWorker.create(...)
```

The app catalogue chooses service, RPC, REST and realtime contributions. The
worker catalogue chooses service, pipeline, subscriber, consumer and scheduler
contributions. Importing an installer registers nothing. A feature with no
worker behaviour contributes nothing to the worker; a background-only feature
need not exist in the app runtime.

Services collaborate through contract capabilities injected during build.
They do not call `getApp()`, import another feature's server or find a service
in a global registry at request time. The composition catalogue is the one
place allowed to import multiple feature server packages and connect their
instances.

Request transports do not repeat that composition. The tRPC context contains a
request-scoped `app` object whose properties are already-instantiated service
capabilities. An Agents procedure calls `ctx.app.agents.create(input)`, not a
nested `AgentsRpcApi.create(AgentsFeature.create(ctx))` expression. Request
context construction is the only request-scoped composition point, and tests
can pass a small fake `app` containing only the services they exercise.

### Infrastructure is explicit and independently ownable

`ProcessInfrastructure.create()` constructs the Prisma client, Redis
connection, ClickHouse resolver, telemetry and other process-level resources
requested by a runtime. A `ResourceScope` records ownership as resources are created and closes
them in reverse order after runtime-specific drains finish.

A standalone app process and standalone worker process each own their own
infrastructure. The development-only combined mode constructs one shared
infrastructure scope, creates an `AppRuntime` and a `WorkerRuntime` over it, and
returns a parent object:

```text
CombinedRuntime
├── app
├── worker
└── close()
    ├── stop accepting HTTP
    ├── drain and close worker activity
    ├── close app transports
    └── close shared infrastructure once
```

The current `processRole: "all"` behaviour becomes this explicit parent rather
than one graph with conditional consumers. Production still uses the two
existing entry points and can still deploy them independently.

### Global App access is a compatibility seam, not the feature API

The current `App`, `AppDependencies`, `initializeDefaultApp()` and `getApp()`
remain only while legacy app code migrates. New feature packages and new runtime
composition code may not use them. During transition an entry point may bind a
compatibility view of its own runtime for unchanged callers, but the worker and
app never share one ambient singleton as their architectural boundary.

The compatibility view is not part of a feature package's supported surface.
Tests construct only the feature capabilities they exercise instead of a giant
null App.

### RPC is the new product API standard; legacy REST remains explicit

New product-web feature operations are exposed through the internal RPC
composition, currently tRPC. Feature contract schemas and server handlers own
the operation shapes; the app runtime supplies authentication, authorization,
request context and the final router composition.

An existing REST API may remain as a compatibility adapter. For Agents,
`/api/agents` stays operational and present in OpenAPI but is marked
`deprecated: true` and labelled Legacy. It forwards to the same service
handlers as RPC, emits a deprecation signal suitable for generated clients, and
does not gain new product-only operations. No sunset date is advertised until a
separate decision commits to one.

Documenting a deprecated route is preferable to hiding it: current SDK and CLI
users can discover that it is legacy and how to migrate. Deprecation does not
weaken its authentication, authorization, validation or compatibility tests.

This policy does not declare every public LangWatch REST endpoint deprecated.
It applies to feature-specific compatibility surfaces that have an identified
RPC successor, beginning with Agents.

### Physical application extraction is deferred

> Superseded by [ADR-111](./111-physical-application-workspaces.md). The
> runtime-graph and lifecycle decisions in this ADR remain accepted; only the
> decision to keep them in one physical workspace package is superseded.

No new `apps/app`, `apps/server`, `apps/api` or `apps/worker` workspace packages
are created by this decision. Once the two compositions have closed graphs and
independent tests, moving one entry point to its own physical package may be
considered for deployment, scaling or language reasons. Until then, directory
separation inside `platform/app` is sufficient and cheaper.

## Alternatives considered

Creating several new apps immediately would combine dependency-graph cleanup,
build-system changes, deployment changes and feature extraction in one move.
The current service graph is not yet closed enough for those directories to be
truthful.

Keeping one `App` with a role flag starts fewer consumers but still constructs
and imports the universal graph. It cannot prove that the worker is independent
of interactive transports.

Using a general-purpose runtime dependency-injection container would move
service lookup from TypeScript properties to strings or reflection and make
missing capabilities a late failure. The small typed feature-installer protocol
expresses the rules the repository actually needs.

Making legacy REST call internal RPC over HTTP would add a loopback network
dependency and duplicate auth translation. Both transports adapt the same
in-process service handlers instead.

## Consequences

- The app and worker become real composition boundaries without new workspace
  packages or deployments.
- Worker boot no longer requires every interactive service and router.
- Feature installers replace the expanding central `AppDependencies` object.
- Combined development mode shares resources deliberately and closes them once.
- New feature code receives dependencies directly rather than calling a global
  App singleton.
- Agents offers standard RPC and maintained, documented deprecated REST.
- Runtime shutdown preserves careful worker drain and resource ownership
  ordering.
- Physical app extraction remains available later without being required now.

## Amendment 2026-09-03

`Capability`, `CapabilityRegistry`, `FeatureDefinition`, `FeatureRuntimeBuilder`
and `RuntimeBoot` were never adopted: both `apps/api` and `apps/worker` compose
by hand in their `*-production.composition.ts` roots, not through the typed
feature-installer graph this ADR describes. They were deleted from
`@langwatch/runtime-composition`, which now holds only `ResourceScope`.

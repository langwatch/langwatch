# Installing a feature into an app

A feature package owns its behaviour — services, repositories, adapters,
transports (see `service-repository-adapter-port.md`). This doc covers the
other half: how a process comes to SERVE that feature. The rule is one
mechanism per transport, one enumeration per process, and zero per-feature
wiring inside the serving app beyond a single entry in that enumeration.

```
  packages/features/<x>/server          the feature: behaviour + transports
        │
        │  create<X>RestApp / <X>TrpcApi.create / <X>WorkerFeatureInstaller
        ▼
  ┌─────────────────────────────────────────────────────────┐
  │  THE ONE LIST (per process, per transport)              │
  │                                                         │
  │  REST    createAppRestFeatures({security, services,     │
  │          ports})            → MountableRestApp[]        │
  │  tRPC    createAppTrpcFeatures({mount, ports})          │
  │          → record keyed by namespace                    │
  │  Worker  WorkerFeatureInstallerPort.install()           │
  │          → WorkerFeatureHandlePort                      │
  └─────────────────────────────────────────────────────────┘
        │
        │  one loop / one spread / one install pass
        ▼
  the serving process (apps/api, apps/worker, platform/app while it lives)
```

## Why one list

Every audit that keeps a surface honest reads what MOUNTING registered: the
route-policy registry, the tRPC declaration sweep, the public-surface
tripwire, the Langy permission suites. A family mounted from a second
enumeration can serve traffic while being invisible to all of them. So the
list is not a convenience — it is the property the audits rely on. A surface
is either in the list and visible, or it does not exist.

## REST — `createAppRestFeatures`

`apps/api/src/app-rest/app-rest.features.ts`. The process builds ONE
`AppRestSecurity` (via `createAppRestSecurity`, or `ApiRestSecurity.create`
in the standalone API) and hands it in with two records: `services` (lazy
`() => Service` factories, so building the list never forces construction —
the OpenAPI generator builds it with none) and `ports` (capabilities only the
process owns: plan gates, audit sinks, platform URLs). Mount by iterating:

```ts
for (const packagedRestApp of createAppRestFeatures({ security, services, ports })) {
  api.route("/", packagedRestApp);
}
```

Off the request path (spec generation, route audits), pass
`servicesUnavailableOffRequestPath(reason)` / `portsUnavailableOffRequestPath`
— reaching one of those is a bug in the caller, never a missing wire.

## tRPC — `createAppTrpcFeatures`

`apps/api/src/app-trpc/app-trpc.features.ts`. The process supplies its mount
ONCE — root, authenticated + public procedures, and the concrete policy-chain
middlewares — plus a ports record with one entry per feature that needs any.
The result is keyed by namespace and spread into the router record:

```ts
const appTrpcFeatures = createAppTrpcFeatures({ mount, ports });
const appRouter = createTRPCRouter({ ...appTrpcFeatures, /* unmigrated */ });
```

The policy chain (tracer → logger → handled-error → scope-lineage guard →
declared check → fail-closed backstop → audit) exists once in the process and
reaches every feature through the mount. A restated copy of that chain per
feature could drift; one cannot.

## Worker — `WorkerFeatureInstallerPort`

`apps/worker/src/features/worker-feature.installer.ts`. Each feature ships one
installer class (`<X>WorkerFeatureInstaller`) whose `install()` starts its
consumers/process managers and returns a `WorkerFeatureHandlePort` whose
`close()` drains them. The composition holds the list of installers; adding a
feature is adding one installer to that list. The installer file — not the
composition — owns the feature's dependency assembly.

## Enterprise features

A core package may never depend on an Enterprise one, so Enterprise surfaces
mount through `packages/enterprise/composition/api` (e.g.
`EnterpriseGovernanceTrpcComposition.create`), which the process calls beside
the core list. Plan gates cross the boundary as a `planGate:
ProcedureDecorator` the composition supplies — a feature package never
imports `@langwatch/enterprise-plan-gate`.

## What not to do

- **A second registration of the same family.** If a packaged
  `create<X>RestApp` exists, the process mounts it from the list — never a
  local reimplementation of the same routes (that is how two API-key
  ceilings ended up serving traffic; see F-APIKEY-01 in the extraction
  plan).
- **A per-feature mount file in the serving app.** The per-feature generic
  wrapper lives beside the list in `apps/api/src/features/*-trpc.mount.ts`;
  the serving app contributes only its entry in the one call's `ports`.
- **Hand-rolled route registration.** Every REST family is built by
  `@langwatch/api/rest` (`AppRestSecurity.create*App` or `createRestService`);
  every tRPC surface by `@langwatch/api/trpc`. A route with no declared
  access policy must be impossible to construct, and only those builders
  guarantee it.
- **Constructing services eagerly in the list call.** REST service entries
  are factories on purpose. Passing a constructed service defeats the
  spec-generation and audit callers that build the list with none.

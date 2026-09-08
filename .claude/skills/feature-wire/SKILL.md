---
name: feature-wire
description: "Wire a LangWatch feature package into the processes: boot its installer in apps/api (createApp … withFeature, the tRPC and REST mounts, the namespace), install it in apps/worker (the capability root that boots it, the catalogue, the frozen job registry), add a task to apps/tasks, and install its screens in apps/ui (catalogue.json, the private feature folder, the WebInstallation, installed-ui-features, feature-map.json). Use whenever a package exists but nothing mounts it, a screen exists but no page shows it, a tRPC procedure or REST route answers 404, a worker job is 'unroutable', boot fails with MissingProviderError, or someone says 'hook it up', 'register', 'mount', 'install the feature', 'wire the worker'."
user-invocable: true
argument-hint: "<feature> [api|worker|tasks|ui|all]"
---

# Wire a feature into the processes

Read `.claude/skills/architecture-guide/references/config-composition.md` and
`install.md` first. The reference wiring is annotation's:
`apps/api/src/features/annotation/`, `apps/worker/src/app/worker-observability-apps.composition.ts`
and `apps/ui/src/features/annotation/`.

## Find out what is missing

```bash
grep -rln "@langwatch/<f>-server" apps/api/src apps/worker/src apps/tasks/src
grep -rn "<f>" apps/api/src/app-trpc/app-trpc.features.ts apps/api/src/app-trpc/app-trpc.composed.ts apps/api/src/app/api-production.composition.ts
grep -rn "<f>" apps/ui/src/features/installed-ui-features.ts apps/ui/src/features/catalogue.json
grep -rn "<f>" apps/worker/src/features/catalogue.json apps/worker/src/features/job-registry.json apps/worker/src/app/worker-*.composition.ts
grep -rn "<f>" apps/tasks/src/tasks.catalogue.ts
```

A boot error names the gap exactly: `MissingProviderError` says which token no one
provided for which feature, `DuplicateProviderError` and `DependencyCycleError` likewise.
A tRPC 404 with a booted app is a namespace never named; a REST 404 is a declaration never
mounted.

## apps/api

1. **The feature composition** `apps/api/src/features/<f>/<f>.composition.ts`, modelled
   on `annotation.composition.ts`: `installApi<F>({ infrastructure, peers })` builds
   `createApp({ name: "langwatch-api" }).withPersistence("postgres", { prisma }).withInfrastructure({…}).withProvided(PeerApi, peer)….withFeature(<f>Server).boot({ role: "api" })`,
   reads `runtime.feature(<f>Server).provided`, and returns the `Composed<F>Feature`
   declared in `<f>.composition.types.ts` (`routers(mount)`, `app`, `restServices`). Every
   token the app's `static dependencies` names is provided here, or boot fails by name.
   Do not invent a `refusing*` twin for new work; the root either installs the feature or
   does not.
2. **tRPC**: `apps/api/src/features/<f>/<f>-trpc.mount.ts` binds the process context
   (`createTrpcHandlerBinding` → `createTrpcApiService` → `createTrpcService`) and calls
   `<f>TrpcTransport.router(service)` per declaration; the namespaces are named in
   `apps/api/src/app-trpc/app-trpc.features.ts` and the composed slot declared on
   `ComposedApiFeatures` in `app-trpc.composed.ts`. Details: the `api-trpc-procedure` skill.
3. **REST**: `apps/api/src/features/<f>/<f>-rest.mount.ts` builds the family with
   `security.createServiceVersionedApp({...})` and `mountProjectTransport({ family, transport: <f>Rest.router(), app, credential, authenticate, authorize, afterSuccess })`;
   the root registers it in its REST list. Details: the `api-rest-route` skill.
4. **The root**: `apps/api/src/app/api-production.composition.ts` calls `installApi<F>`
   with the peers it holds (`this.composedProject.app`, `this.composedAuthz.app`, …) and
   wires the returned routers and REST services.
5. **Config**: a feature's config is a `Config.group`/`Config.value` definition in its
   contract (`<f>.config.ts`), spread into `apps/api/src/platform/config/api.config.ts`,
   threaded from the root into `.withFeature(<f>Server, { config })`, documented in
   `.env.example`. Never `process.env` below the entrypoint.
6. **Tests**: `apps/api/src/features/<f>/__tests__/<f>.composition.integration.test.ts`
   drives `installApi<F>` with `createApiFixture` peers and a recording Prisma client
   through the real mounts (annotation's is the idiom).

## apps/worker

1. **The capability root** that owns the feature's jobs
   (`apps/worker/src/app/worker-<capability>.composition.ts`) adds `.withFeature(<f>Server[, { infrastructure }])`
   to its `createApp(...)` chain and provides any new peer token; the app is read back with
   `runtime.feature(<f>Server).provided`. The worker boots one graph for several features
   (`worker-observability-apps.composition.ts` boots trace, annotation, data-privacy, log
   and evaluation together). Mounted from `apps/worker/src/app/worker-production.composition.ts`.
2. **Catalogue**: `apps/worker/src/features/catalogue.json`.
   `apps/worker/src/features/__tests__/worker-feature-catalogue.unit.test.ts` requires
   every catalogue feature to own at least one registry pipeline.
3. **Jobs**: a queue-routed command or subscriber needs its `pipeline` entry in
   `apps/worker/src/features/job-registry.json`. That file is byte-frozen on purpose and
   tests read it as the oracle, so changing it is a deliberate, reviewed act: say so in
   the report. The worker is the only appender; the API only produces.
4. **Tests**: `apps/worker/src/app/__tests__/worker-<capability>.composition.unit.test.ts`
   and `apps/worker/src/app/__tests__/worker-capability-mount.composition.unit.test.ts`,
   which checks every job is routable.

## apps/tasks

A one-shot program is a `tasks/<name>.task.ts` in the feature's server package, exported
from its `index.ts` and listed in `apps/tasks/src/tasks.catalogue.ts`, composed over
`TasksHost` (and `TasksEventingInfrastructure` when it dispatches). Run it with
`pnpm --filter @langwatch/tasks task <name>`. A task that needs the API's own REST boot
graph stays in `apps/api/src/tasks/` instead.

## apps/ui

1. `apps/ui/src/features/catalogue.json`: `governedWebPackages` gets the package,
   `features[]` gets `{ id, root, uses: { screens: ["@langwatch/<f>-web/<entry>"], surfaces: [...] } }`,
   each an exact exported entry (flat `./<entry>`, or the older `./screens/<id>` /
   `./surfaces/<id>`).
2. Private folder `apps/ui/src/features/<root>/`: `index.ts` at the root only, then
   `behavior/`, `ui/sections/<f>-host.tsx` (implements the package's `*HostPort` from
   `useUiCapabilities()`), `ui/sections/<f>-routes.tsx` (`uiPage({ screen, host, permission })`
   + `lazyRoute`, `handle: { page }` keys).
3. `index.ts` exports one `WebInstallation` — `{ name, install(ui) { ui.routes("project", routes); ui.api(uiApiBinding("@langwatch/<f>-web", <f>Api)); } }`
   — added to the `features` list in `apps/ui/src/features/installed-ui-features.ts`.
   Pin its page keys in `apps/ui/tests/installed-ui-features.unit.test.ts`. Drawers the
   feature owns register from the same file.
4. Retired addresses become `UiRedirectDescriptor` entries in
   `apps/ui/src/model/ui-route-table.ts`.
5. Root `feature-map.json`: routes, MCP tools, CLI commands (see the `feature-map` skill).

## Gates

`.claude/skills/architecture-guide/references/gates.md`, including the registry tests.
Never verify by booting `pnpm dev`; the composition and installation tests are the proof.
If a boot-time behaviour is the thing in question, write the composition test that
exercises it.

## Report

Which compositions, namespaces, families, roots, registries and tables changed; every
token provided and by whom; whether `job-registry.json` changed; gate numbers.

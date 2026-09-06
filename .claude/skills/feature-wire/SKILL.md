---
name: feature-wire
description: "Wire a LangWatch feature package into the processes: compose its services in apps/api (the feature composition, the tRPC namespace, a public REST family, named absences), install it in apps/worker (installer, catalogue, the frozen job registry), add a task to apps/tasks, and install its screens and drawers in apps/ui (catalogue.json, the private feature adapter, uiFeature, installed-ui-features, the route table, feature-map.json). Use whenever a package exists but nothing mounts it, a screen exists but no page shows it, a tRPC procedure or REST route answers 404, a worker job is 'unroutable', a composition root logs an absence you want filled, or someone says 'hook it up', 'register', 'mount', 'install the feature', 'wire the worker'."
user-invocable: true
argument-hint: "<feature> [api|worker|tasks|ui|all]"
---

# Wire a feature into the processes

Read `.claude/skills/architecture-guide/references/config-composition.md` and
`install.md` first. Wiring is where a finished package either becomes a working surface
or a silent absence, and every process is explicit about which.

## Find out what is missing

```bash
grep -rln "@langwatch/<f>-server" apps/api/src apps/worker/src apps/tasks/src
grep -rn "<f>" apps/api/src/app-trpc/app-trpc.features.ts apps/api/src/app-trpc/app-trpc.composed.ts
grep -rn "<f>" apps/api/src/app-rest/app-rest.packaged-families.ts apps/api/src/app/api-production.composition.ts
grep -rn "<f>" apps/ui/src/features/installed-ui-features.ts apps/ui/src/features/catalogue.json apps/ui/src/model/ui-route-table.ts
grep -rn "<f>" apps/worker/src/features/catalogue.json apps/worker/src/features/job-registry.json
grep -rn "<f>" apps/tasks/src/tasks.catalogue.ts
```

Read the boot log vocabulary too: a line naming a composed absence or an unmounted
family tells you exactly which root to open.

## apps/api

1. **The feature composition** `apps/api/src/features/<f>/<f>.composition.ts`, modelled
   on `apps/api/src/features/topic/topic.composition.ts`. It takes
   `ApiTrpcInfrastructure` (or the handles it needs by name), builds the Postgres
   adapter, constructs the service, and returns the service plus its router. A missing
   collaborator gets the refusing variant — the namespace mounts and every call throws a
   `*UnavailableError` by name — never a stub that answers. The shape type goes in
   `<f>.composition.types.ts` so importing it pulls in no adapters.
2. **tRPC**: `apps/api/src/features/<f>/<f>-trpc.mount.ts` installs the package's
   fragment on this process's root; the namespace is named in
   `apps/api/src/app-trpc/app-trpc.features.ts`. Declare a slot on `ComposedApiFeatures`
   in `apps/api/src/app-trpc/app-trpc.composed.ts` only when the process must compose the
   feature before the mount exists. Details: the `api-trpc-procedure` skill.
3. **Public REST**: a family class `apps/api/src/api-<f>-rest.feature.ts`, mounted from
   `apps/api/src/app/api-production.composition.ts` only when its service was composed,
   and added to `apps/api/src/tasks/openapi-document/openapi-document.surface.ts`.
   A legacy `transport/api-rest` family instead gets a condition-gated entry in
   `apps/api/src/app-rest/app-rest.packaged-families.ts`. Details: the `api-rest-route`
   skill.
4. **Config**: a new variable is a leaf in `apps/api/src/platform/config/api.config.ts`
   (shared infrastructure shapes already have modules in `packages/config/src`), threaded
   from `apps/api/src/app/api-production.composition.ts`, documented in `.env.example`.
5. **Tests**: `apps/api/src/features/<f>/__tests__/<f>.composition.unit.test.ts` proves
   the composition builds the service with real collaborators and refuses by name
   without them; `apps/api/src/__tests__/api.application.secret-trpc.integration.test.ts`
   and `apps/api/src/__tests__/api-secret-rest.listener.integration.test.ts` show the
   idiom for a caller-level test.

## apps/worker

1. **Installer** `apps/worker/src/features/<area>/<f>-worker-feature.installer.ts`
   extending the port in `apps/worker/src/features/worker-feature.installer.ts`
   (`name`, `install(): Promise<handle>` whose `close()` stops it). Schedulers ride an
   existing installer of the same area.
2. **Catalogue**: `apps/worker/src/features/catalogue.json`.
   `apps/worker/src/features/__tests__/worker-feature-catalogue.unit.test.ts` requires
   every catalogue feature to own at least one registry pipeline.
3. **Jobs**: a queue-routed command or subscriber needs its `pipeline` entry in
   `apps/worker/src/features/job-registry.json`. That file is byte-frozen on purpose and
   tests read it as the oracle, so changing it is a deliberate, reviewed act: say so in
   the report.
4. **Composition**: a `apps/worker/src/app/worker-<capability>.composition.ts` root
   mounted from `apps/worker/src/app/worker-production.composition.ts`, with the same
   absence vocabulary. The worker is the only appender; the API only produces.
5. **Tests**: `apps/worker/src/app/__tests__/worker-<capability>.composition.unit.test.ts`
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
   `features[]` gets `{ id, root, uses: { screens: [...], surfaces: [...] } }`, each an
   exact exported entry.
2. Private adapter `apps/ui/src/features/<f>/`: `index.ts` at the root only, then
   `model/` (the host implementation), `behavior/`, `ui/sections/<f>-routes.tsx` with the
   page loaders: host provider outermost, chrome, guard innermost.
3. `apps/ui/src/features/<f>/index.ts` exports one
   `uiFeature({ name, api, loaders, drawers? })`; add it to the `features` list in
   `apps/ui/src/features/installed-ui-features.ts`.
4. `apps/ui/src/model/ui-route-table.ts`: the page key, and redirect descriptors for any
   address you retire.
5. Root `feature-map.json`: routes, MCP tools, CLI commands (see the `feature-map` skill).

## Gates

`.claude/skills/architecture-guide/references/gates.md`, including the registry tests.
Never verify by booting `pnpm dev`; the composition tests are the proof. If a boot-time
behaviour is the thing in question, write the composition test that exercises it.

## Report

Which compositions, namespaces, families, installers, registries and tables changed;
every absence still named at boot and why; whether `job-registry.json` changed; gate
numbers.

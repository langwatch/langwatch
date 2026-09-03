---
name: feature-wire
description: "Wire a LangWatch feature package into the processes: compose its services in apps/api (composition roots, tRPC collaborator groups, REST family registration, named absences), install it in apps/worker (installer, catalogue, the frozen job registry), and install its screens and drawers in apps/ui (catalogue.json, the private feature adapter, installed-ui-features, installed-ui-drawers, the route table, feature-map.json). Use this whenever a package exists but nothing mounts it, a screen exists but no page shows it, a tRPC procedure or REST route is called and answers 404, a worker job is 'unroutable', a composition root logs an absence you want filled, or someone says 'hook it up', 'register', 'mount', 'install the feature', 'wire the worker'."
user-invocable: true
argument-hint: "<feature> [api|worker|ui|all]"
---

# Wire a feature into the processes

Read `.claude/skills/architecture-guide/references/config-composition.md` and
`install.md` first. Wiring is where a finished package either becomes a working surface
or a silent absence, and both processes are explicit about which.

## Find out what is missing

```bash
grep -rln "@langwatch/<f>-server" apps/api/src apps/worker/src        # composed anywhere?
grep -rn "<f>" apps/api/src/app-rest/app-rest.packaged-families.ts     # REST family?
grep -rn "<f>" apps/api/src/app/api-trpc-collaborators.*.composition.ts
grep -rn "<f>" apps/ui/src/features/installed-ui-features.ts apps/ui/src/features/installed-ui-drawers.ts apps/ui/src/features/catalogue.json apps/ui/src/model/ui-route-table.ts
grep -rn "<f>" apps/worker/src/features/catalogue.json apps/worker/src/features/job-registry.json
```

Read the boot log vocabulary too: a line like `API composed no <thing>: … refuse by name`
or `family absent: <f>` tells you exactly which root to open.

## apps/api

1. **A composition root** `apps/api/src/app/api-<f>.composition.ts`, modelled on a
   sibling (`api-automation.composition.ts` is a good mid-size one). It takes the process
   handles it needs by name (`prisma: PrismaClient`, `redis`, a ClickHouse accessor, the
   encryption port, another feature's service), builds the Postgres adapter, constructs
   the service, and returns the service plus its transports. Missing collaborator: an
   `absent("no-…")` that logs once, or a `*UnavailableError` the transport throws; never
   a stub that answers.
2. **tRPC**: hand the router fragment to the right
   `api-trpc-collaborators.<group>.composition.ts` (`product`, `trace-group`,
   `org-group`, `gateway-group`, `agent-group`, `execution`, `identity`, `analytics`). The
   group decides the middleware and context the procedures see.
3. **REST**: add a condition-gated entry to
   `apps/api/src/app-rest/app-rest.packaged-families.ts`: the family mounts only when its
   service was built, and the absence report names it otherwise. The enumeration is also
   what the route-authorization audit reads. Do not regenerate the OpenAPI document.
4. **Config**: a new variable is a leaf in `apps/api/src/platform/config/api.config.ts`,
   threaded from `api-production.composition.ts`, documented in `.env.example`.
5. **Tests**: `apps/api/src/app/__tests__/api-<f>.composition.unit.test.ts` proves the
   root builds the service with real collaborators and names the absence without them;
   `apps/api/src/__tests__/api.application.*.integration.test.ts` shows the idiom for a
   caller-level test.

## apps/worker

1. **Installer** `apps/worker/src/features/<area>/<f>-worker-feature.installer.ts`
   extending `WorkerFeatureInstallerPort` (`name`, `install(): Promise<handle>` whose
   `close()` stops it). Schedulers ride an existing installer of the same area
   (`worker-feature-catalogue.unit.test.ts` requires every catalogue feature to own at
   least one registry pipeline).
2. **Catalogue**: `apps/worker/src/features/catalogue.json`.
3. **Jobs**: a queue-routed command or subscriber needs its `pipeline` entry in
   `apps/worker/src/features/job-registry.json`. That file is byte-frozen on purpose and
   tests read it as the oracle, so changing it is a deliberate, reviewed act: say so in
   the report.
4. **Composition**: a `worker-<capability>.composition.ts` root mounted from
   `worker-production.composition.ts`, with the same absence vocabulary. The worker is
   the only appender; the API only produces.
5. **Tests**: `apps/worker/src/app/__tests__/worker-<capability>.composition.unit.test.ts`
   and the capability-mount test that checks every job is routable.

## apps/ui

1. `apps/ui/src/features/catalogue.json`: `governedWebPackages` gets the package,
   `features[]` gets `{ id, root, uses: { screens: [...], surfaces: [...] } }`, each an
   exact exported entry.
2. Private adapter `apps/ui/src/features/<f>/`: `index.ts` at the root only, then
   `model/` (the host implementation), `behavior/`, `ui/sections/<f>-routes.tsx` with the
   page loaders: host provider outermost, chrome, guard innermost.
3. `apps/ui/src/features/installed-ui-features.ts`: spread `<f>PageLoaders` and
   `<f>ApiBinding` (`uiFeatureApi({ name, api })`).
4. `apps/ui/src/features/installed-ui-drawers.ts`: spread the feature's drawer map.
5. `apps/ui/src/model/ui-route-table.ts`: the page key, and redirect descriptors for any
   address you retire.
6. Root `feature-map.json`: routes, MCP tools, CLI commands (see the `feature-map` skill).

## Gates

```bash
pnpm --filter @langwatch/platform-api test run src/app/__tests__/api-<f>.composition.unit.test.ts
pnpm --filter @langwatch/platform-api exec tsc --noEmit -p tsconfig.json
pnpm --filter @langwatch/worker test run src/app/__tests__/worker-capability-mount.composition.unit.test.ts src/app/__tests__/worker-feature-catalogue.unit.test.ts
pnpm --filter @langwatch/ui test run tests/installed-ui-features.unit.test.ts tests/installed-ui-drawers.integration.test.tsx
pnpm --filter @langwatch/ui exec tsc --noEmit -p tsconfig.json
pnpm --filter @langwatch/architecture-lint lint
pnpm --filter @langwatch/architecture-lint test run tests/frontend-boundary.unit.test.ts
```

Never verify by booting `pnpm dev`; the composition tests are the proof. If a boot-time
behaviour is the thing in question, write the composition test that exercises it.

## Report

Which roots, groups, families, installers, registries and tables changed; every absence
still named at boot and why; whether `job-registry.json` changed; gate numbers.

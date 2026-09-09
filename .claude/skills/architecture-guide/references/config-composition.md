# Config and composition

## Config

One `.env` at the workspace root (haven injects its own resolved values straight into the
processes it starts; `haven env` prints them for a shell). Each process loads it through
its own start script (`--env-file-if-exists=../../.env`) and validates its own definition
once, at the entrypoint. **Module code never reads `process.env`**; it receives values
from the composition root. `process.env` is allowed only in a process boot file
(`*.process.ts`, `*.executable.ts`, `*.entrypoint.ts`), `packages/secrets`, a Vite config
and tests.

```ts
// modules/langy/contract/src/langy.config.ts: a module's own config, schema-driven
export const langyServerConfigDefinition = Config.group(
  {
    agentUrl: Config.value(z.string().optional(), { env: "LANGY_AGENT_URL" }),
    internalSecret: Config.optionalSecret({ env: "LANGY_INTERNAL_SECRET" }),
  },
  [
    (value) =>
      value.agentUrl?.trim() && !value.internalSecret?.trim()
        ? { path: "internalSecret", message: "The Langy agent manager's address needs its shared secret …" }
        : undefined,
  ],
);

// apps/api/src/platform/config/api.config.ts (shape)
const definition = RuntimeConfig.define({
  port: Config.value(portSchema.default(5560), { env: "API_PORT" }),
  langy: langyServerConfigDefinition,
});
const config = RuntimeConfig.create({ name: "api", definition, source });
config.value.langy.internalSecret; // typed, deep-frozen
```

- `Config.value / url / secret / optionalSecret / integer / enum` from `@langwatch/config`
  each return a leaf with a zod schema and an env binding. Bindings are claimed once; a
  duplicate throws at boot. A bad value raises `InvalidRuntimeConfigError` naming path,
  variable and zod code, so the process dies at boot, not on its first job.
- **Cross-field rules live in the schema**: `Config.group(definition, rules)` runs each
  rule in `superRefine` and reports `path (ENV, custom): message`. Never a post-parse
  `assert<Feature>Config()`.
- A module declares its config definition in its **contract** (`<f>.config.ts`) and the
  process spreads it into its own definition; the module receives the parsed value through
  `FeatureSetup`'s config parameter or `.withModule(x, { config })`.
- Definitions live in `apps/api/src/platform/config/api.config.ts`,
  `apps/worker/src/platform/config/worker.config.ts` and
  `apps/tasks/src/platform/config/tasks.config.ts`. Shared infrastructure shapes have
  their own modules in `packages/config/src` (`postgres.config.ts`, `redis.config.ts`,
  `clickhouse.config.ts`); reuse those rather than redeclaring a URL leaf.
- **Secrets are not config** (ADR-132): `packages/secrets/keys.json` classifies every
  credential key; the entrypoint resolves them through `@langwatch/secrets` (shell and
  `.env`, then 1Password when `LANGWATCH_SECRETS_VAULT` is set) into the `source` record
  before the zod parse. A module sees a plain value; it never reads
  `process.env.<SECRET>` (`langwatch/secrets-through-source`).
- Document a new variable in `.env.example`. Dev ports derive from `PORT` in
  `dev/scripts/dev-stack.sh` (api `PORT+1000`, gateway `PORT+3`, worker metrics
  `PORT-2561`); haven injects the same set.
- Public config reaches the browser as a base64url meta tag: `resolveUiPublicBootstrap`
  in `packages/config/src/public-app-config.projection.ts` on the server, injected by
  Vite in dev and by `apps/api/src/app-static` in production, read by
  `apps/ui/src/behavior/public-config.ts`.

## Booting modules: the container

A process does not construct services. It builds an application with
`createApp` from `@langwatch/runtime-composition`, chooses the persistence backend once,
provides the peer APIs the modules declare, installs module installers, and boots for
its role. Boot validates missing, duplicate and cyclic providers **before** constructing
anything, constructs each app once, binds peer tokens, and cleans up in reverse order if
anything fails.

```ts
// apps/api/src/features/annotation/annotation.composition.ts
export async function installApiAnnotation(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: AnnotationPeers; // projects, organizations, users, traces, permissions
}): Promise<ComposedAnnotationFeature> {
  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma: options.infrastructure.prisma })
    .withInfrastructure({})
    .withProvided(ProjectApi, options.peers.projects)
    .withProvided(OrganizationApi, options.peers.organizations)
    .withProvided(UserApi, options.peers.users)
    .withProvided(TraceApi, options.peers.traces)
    .withProvided(AuthzApi, options.peers.permissions)
    .withModule(annotationServer)
    .boot({ role: "api" });

  const app = runtime.module(annotationServer).provided; // the AnnotationApi
  return {
    routers: (mount) => ({ annotation: createAnnotationTrpcRouter(mount), annotationScore: createAnnotationScoreTrpcRouter(mount) }),
    app,
    restServices: { annotations: () => app },
  };
}
```

- `.withPersistence("postgres", { prisma })` or `"memory", {}` selects every installed
  module's repository bundle; a factory whose declared infrastructure is missing fails
  boot, never falls back to memory.
- `.withProvided(Token, implementation)` supplies a peer that this graph does not install
  (today most roots still hold the older composed apps and hand them in this way);
  `.withModule(installer)` installs a module so its app is provided under its own token.
  `.withModule(installer, { infrastructure, config })` passes the technical inputs an
  app's `FeatureSetup` declares.
- `.boot({ role: "api" | "worker" | "task", config? })` constructs only that role's
  contributions. `runtime.module(installer).provided` is the app; `runtime.service(Token)`
  reads any provided token. Shutdown drains hosts before closing modules.
- The worker boots one graph for several modules (`apps/worker/src/app/worker-observability-apps.composition.ts`:
  trace, annotation, data-privacy, log and evaluation over one `.withPersistence("postgres", …)`);
  the API still boots one graph per module during the migration. Both call the same
  installer.

## Mounting transports in apps/api

A module's `transport/*.rest.ts` and `*.trpc.ts` are inert declarations. The process
binds them to its own credential and context in `apps/api/src/features/<f>/`:

- `<f>.composition.ts`: the `installApi<F>` above. Its return type lives in
  `<f>.composition.types.ts` (`Composed<F>Feature`: `routers(mount)`, `app`,
  `restServices`), kept separate so importing the router type pulls in no runtime.
- `<f>-trpc.mount.ts`: calls `runtime.mount(<f>Trpc, (ctx) => ctx.app.<f>)` where
  `runtime: TrpcRuntime<HostContext>` from `@langwatch/api/trpc`. Each declaration
  becomes one namespace, named in `apps/api/src/app-trpc/app-trpc.features.ts`
  (`annotation: annotationRouters.annotation`), and the composed slot is declared on
  `ComposedApiFeatures` in `apps/api/src/app-trpc/app-trpc.composed.ts` because the REST
  family and `ctx.app.<f>` read the same app. The older
  `createTrpcHandlerBinding`/`createTrpcApiService`/`createTrpcService` chain is deleted;
  a mount file that still assembles one by hand is conversion debt.
- `<f>-rest.mount.ts`: builds `createRestRuntime({ identity: { authenticate } })` from
  `@langwatch/api/rest` and calls `runtime.mount(<f>Rest.router(), { app, credential, onError })`.
  Historical refusal bodies and 404 shapes are mapped in this file's `onError`, not in
  the module. `security.createServiceVersionedApp(...)` and `mountProjectTransport(...)`
  are deleted; a mount file that still names either is conversion debt
  (`legacy-transport-runtime`).
- `apps/api/src/app/api-production.composition.ts` calls `installApi<F>` with the peers it
  holds and registers the returned routers and REST services.

## Absences

Today the API root still answers a missing substrate with `refusing<F>Feature()`: the
namespace mounts and every call throws `Api<F>UnavailableError` (`service_unavailable`,
`fault: "platform"`) by name, and a REST family whose service is missing is not mounted
at all. ADR-133 retires this shape: a required provider missing at boot is a boot failure
(`MissingProviderError`), not a stub that answers 503. For new work, do not add a
`refusing*`, `Unavailable*` or `Logged*Absence`; either the module installs and its
dependencies are provided, or the process does not install it and says so at boot. An
optional dependency that production never passes is a wiring bug wearing a type: make it
required.

## Workers and tasks

**apps/worker/src/app/**: `worker-production.composition.ts` is the full graph, with one
root per capability (`worker-observability-apps`, `worker-automation-settlement`,
`worker-evaluation-processing`, …). Modules contribute through the same installer they
give the API, booted with `role: "worker"`. `apps/worker/src/features/catalogue.json`
lists the worker modules; `apps/worker/src/features/job-registry.json` is byte-frozen:
pipeline maps to the `command:*` and `subscriber:*` jobs it may route. The queue rejects an
unroutable job and tests read the file as the oracle.

**apps/tasks/src/**: `tasks.catalogue.ts` is the one list of one-shot programs, built
over `TasksHost` (`platform/tasks-host.composition.ts`) and, where a task dispatches
events, `TasksEventingInfrastructure`. A task that needs a database, ClickHouse or a
queue belongs here; one that needs the API's own REST boot graph stays in
`apps/api/src/tasks/`.

## Eventing roles

The API is a producer, only ever a producer: `consumersEnabled: false`,
`processManagerMode: "producer-only"`
(`apps/api/src/platform/infrastructure/api-eventing.infrastructure.ts`). The worker
claims the eventing jobs, runs handlers, appends events, folds projections. A service
on the API sends a command; it never appends.

## The frontend boundary

No value import chain from server code may reach a browser package (React, Chakra,
react-router, a `*-web` package, `apps/ui`).
`packages/architecture-lint/tests/frontend-boundary.unit.test.ts` walks the real import
graph from both backend entrypoints, every `*.composition.ts`, and every server package.
`import type` is always fine for a framework-free module, but not for a type whose
module drags a value graph behind it, which is the whole of ADR-130.
`@langwatch/mail` is the one exception because react-email renders server-side. Shared
values move into a framework-free module (usually the contract).

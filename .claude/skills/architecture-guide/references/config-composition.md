# Config and composition

## Config

One `.env` at the workspace root (plus haven's `.env.portless` overlay). Each process
loads it through its own start script (`--env-file-if-exists=../../.env`) and validates
its own definition at boot. Feature code never reads `process.env`; it receives values
from the composition root.

```ts
// apps/api/src/platform/config/api.config.ts (shape)
const definition = RuntimeConfig.define({
  port: Config.value(portSchema.default(5560), { env: "API_PORT" }),
  apiKey: Config.secret({ optional: true, env: "LANGWATCH_API_KEY" }),
  endpoint: Config.url({ optional: true, env: "LANGWATCH_ENDPOINT" }),
});
const config = RuntimeConfig.create({ name: "api", definition, source: process.env });
config.value.port; // typed, deep-frozen
```

- `Config.value / url / secret / integer / enum` from `@langwatch/config` each return a
  leaf with a zod schema and an env binding. Bindings are claimed once; a duplicate
  throws at boot. A bad value raises `InvalidRuntimeConfigError` naming path, variable
  and zod code.
- Definitions live in `apps/api/src/platform/config/api.config.ts`,
  `apps/worker/src/platform/config/worker.config.ts` and
  `apps/tasks/src/platform/config/tasks.config.ts`. Shared infrastructure shapes have
  their own modules in `packages/config/src` (`postgres.config.ts`, `redis.config.ts`,
  `clickhouse.config.ts` and friends) — reuse those rather than redeclaring a URL leaf.
- Add a leaf, then thread the value through the composition root to the adapter that
  needs it, and document the variable in `.env.example`.
- Dev ports derive from `PORT` in `dev/scripts/dev-stack.sh` (api `PORT+1000`, gateway
  `PORT+3`, worker metrics `PORT-2561`), exported so they beat the file.
- Public config reaches the browser as a base64url meta tag: `resolveUiPublicBootstrap`
  in `packages/config/src/public-app-config.projection.ts` on the server, injected by
  Vite in dev and by `apps/api/src/app-static` in production, read by
  `apps/ui/src/behavior/public-config.ts`. The browser-safe contract
  (`packages/config/src/public-app-config.ts`) and the projection are two modules on
  purpose; never join them.

## Composition roots

A composition root holds the process's real handles (Prisma, Redis, ClickHouse accessors,
observability), builds adapters over them, constructs services, hands services to
transports, and names what it could not build.

**apps/api/src/app/**: `api-production.composition.ts` is the full graph;
`api-standalone.composition.ts` + `.executable.ts` is the boot path; one root per
collaborator family (`api-auth`, `api-authz`, `api-mail`, `api-automation`,
`api-tenancy`, `api-gateway*`, `api-trace-read-stack`, …);
`api-trpc-features.composition.ts` composes the tRPC halves;
`api-packaged-rest.composition.ts` and `src/app-rest/app-rest.packaged-families.ts` say
which legacy REST families mount. Infrastructure is built in
`src/platform/infrastructure/api-{database,queue,eventing,clickhouse,metrics,rate-limit,secret-encryption,trpc}.infrastructure.ts`.

**apps/api/src/features/`<f>`/**: the API-side half of one feature — a
`<f>.composition.ts` that builds the service over `ApiTrpcInfrastructure`, a
`<f>.composition.types.ts` that names the `Composed<F>Feature` shape (kept separate so
importing the router type pulls in no adapters), and a `<f>-trpc.mount.ts` that installs
the package's router fragment on this process's root. The slot is declared in
`apps/api/src/app-trpc/app-trpc.composed.ts` (`ComposedApiFeatures`) and mounted in
`apps/api/src/app-trpc/app-trpc.features.ts`.

**apps/worker/src/app/**: `worker-production.composition.ts` is the full graph, with one
root per capability (`worker-automation-graph`, `worker-evaluation-processing`,
`worker-dataset-normalization`, …). Features contribute through installers in
`apps/worker/src/features/<area>/<feature>-worker-feature.installer.ts`, extending the
port in `apps/worker/src/features/worker-feature.installer.ts`:

```ts
export abstract class WorkerFeatureInstallerPort {
  abstract readonly name: string;
  abstract install(): Promise<WorkerFeatureHandlePort>; // handle.close() on shutdown
}
```

`apps/worker/src/features/catalogue.json` lists the worker features;
`apps/worker/src/features/job-registry.json` is byte-frozen: pipeline → the
`command:*` and `subscriber:*` jobs it may route. The queue rejects an unroutable job and
tests read the file as the oracle. A scheduler that owns no queue job needs no registry
entry and rides an existing installer.

**apps/tasks/src/**: `tasks.catalogue.ts` is the one list of one-shot programs, built
over `TasksHost` (`platform/tasks-host.composition.ts`) and, where a task dispatches
events, `TasksEventingInfrastructure`. A task that needs a database, ClickHouse or a
queue belongs here; one that needs the API's own REST boot graph stays in
`apps/api/src/tasks/`.

A root in miniature:

```ts
static create({ prisma, encryption }: { prisma: PrismaClient; encryption: SecretEncryptionPort | undefined }) {
  if (!encryption) return this.absent("no-secret-encryption");   // named, logged, no stub
  const adapter = PostgresSecretAdapter.create({ prisma });       // typed, no cast
  const secrets = SecretService.create({ repository: adapter.repository, encryption });
  return { secrets, trpc: createSecretTrpcRouter({ secrets }) };
}
```

## Adding a port and wiring it

1. `packages/features/<f>/server/src/ports/<name>.port.ts` — an abstract `*Port` class
   (`strict-port-module` rejects a type alias).
2. The service takes it in `create({ ... })`, required, not optional.
3. An adapter binds it: `adapters/<qualifier>.<name>.adapter.ts`, or another feature's
   concrete service passed straight in.
4. The process builds the substrate in
   `apps/api/src/platform/infrastructure/api-*.infrastructure.ts` and threads it from
   `api-production.composition.ts` into the feature's `*.composition.ts`.
5. When the substrate is absent, the root names the absence; it does not pass `undefined`
   into a service that will then throw an unreachable "not configured" error.
6. A composition unit test in `apps/api/src/app/__tests__/` (or
   `apps/api/src/features/<f>/__tests__/`) proves both legs: built with collaborators,
   named absent without them.

## Named absences

A missing collaborator is stated at boot, never stubbed. The vocabulary is uniform and
worth reusing verbatim:

- `absent(reason: "no-database" | "no-eventing")` on the composition class
- `withoutQueue()`, `withoutRateLimit()` for a degraded path taken on purpose
- `Unavailable*.create()` stand-ins, `Logged*Absence` reporters
- `*UnavailableError extends HandledError` for a capability that refuses by name at call
  time (`ApiTopicUnavailableError` in `apps/api/src/features/topic/topic.composition.ts`
  is the reference: the namespace still mounts and every call refuses by name)
- a REST family whose service is missing is not mounted at all; the absence report names
  it at boot. A route that exists and answers 500 is worse than one honestly absent.

An optional dependency that production never passes is a wiring bug wearing a type: make
it required, or name the absence.

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
`import type` is always fine for a framework-free module — but not for a type whose
module drags a value graph behind it, which is the whole of ADR-130.
`@langwatch/mail` is the one exception because react-email renders server-side. Shared
values move into a framework-free module (usually the contract).

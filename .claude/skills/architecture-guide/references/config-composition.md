# Config and composition

## Config

One `.env` at the workspace root (plus haven's `.env.portless` overlay). Each process loads
it through its own start script (`tsx --env-file-if-exists=../../.env …`) and validates
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
- Definitions live in `apps/api/src/platform/config/api.config.ts` and
  `apps/worker/src/platform/config/worker.config.ts`. Add a leaf there, then thread the
  value through the composition root to the adapter that needs it. Document the variable
  in `.env.example`.
- Dev ports derive from `PORT` in `dev/scripts/dev-stack.sh` (api `PORT+1000`, gateway
  `PORT+3`, worker metrics `PORT-2561`), exported so they beat the file.
- Public config reaches the browser as a base64url meta tag
  (`langwatch-public-config`): `resolveUiPublicBootstrap(env)` in
  `packages/config/src/public-app-config.projection.ts` on the server, injected by Vite
  in dev and by `apps/api/src/app-static` in production, read by
  `apps/ui/src/behavior/public-config.ts`. The browser-safe contract
  (`public-app-config.ts`) and the projection are two modules on purpose; never join them.

## Composition roots

A composition root holds the process's real handles (Prisma, Redis, ClickHouse accessors,
observability), builds adapters over them, constructs services, hands services to
transports, and names what it could not build.

**apps/api/src/app/**: `api-production.composition.ts` is the full graph;
`api-standalone.composition.ts` + `.executable.ts` is the boot path; one root per
collaborator family (`api-auth`, `api-authz`, `api-mail`, `api-automation`, `api-usage`,
`api-tenancy`, `api-gateway*`, `api-trace-ingest`, `api-trace-read-stack`, …);
`api-trpc-collaborators.<group>.composition.ts` says what each tRPC group is handed;
`api-packaged-rest.composition.ts` and `src/app-rest/app-rest.packaged-families.ts` say
which REST families mount. Infrastructure is built in
`src/platform/infrastructure/api-{database,queue,eventing,clickhouse,metrics,rate-limit,secret-encryption}.infrastructure.ts`.

**apps/worker/src/app/**: `worker-production.composition.ts` is the full graph, with one
root per capability (`worker-trace-processing-pipeline`, `worker-automation-graph`,
`worker-evaluation-processing`, `worker-report-schedule`, …). Features contribute through
installers in `apps/worker/src/features/<area>/<feature>-worker-feature.installer.ts`:

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

A root in miniature:

```ts
static create({ prisma, encryption }: { prisma: PrismaClient; encryption: SecretEncryptionPort | undefined }) {
  if (!encryption) return this.absent("no-secret-encryption");   // named, logged, no stub
  const adapter = PostgresSecretAdapter.create({ prisma });       // typed, no cast
  const secrets = SecretService.create({ repository: adapter.repository, encryption });
  return { secrets, trpc: createSecretTrpcRouter({ secrets }), rest: createSecretRestApp({ secrets }) };
}
```

## Named absences

A missing collaborator is stated at boot, never stubbed. The vocabulary is uniform and
worth reusing verbatim:

- `absent(reason: "no-database" | "no-eventing")` on the composition class
- `withoutQueue()`, `withoutWorkflowCopies()` for a degraded path taken on purpose
- `Unavailable*.create()` stand-ins, `Logged*Absence` reporters
- `*UnavailableError extends HandledError` for a capability that refuses by name at call
  time
- a REST family whose service is missing is not mounted at all; `ApiPackagedRestAbsenceReport`
  names it at boot. A route that exists and answers 500 is worse than one honestly absent.

An optional dependency that production never passes is a wiring bug wearing a type: make
it required, or name the absence.

## Eventing roles

The API is a producer, only ever a producer: `EventStoreProducerOnly`,
`consumersEnabled: false`, `processManagerMode: "producer-only"`
(`apps/api/src/platform/infrastructure/api-eventing.infrastructure.ts`). The worker
claims `event-sourcing/jobs`, runs handlers, appends events, folds projections. A service
on the API sends a command; it never appends.

## The frontend boundary

No value import chain from server code may reach a browser package (React, Chakra,
react-router, a `*-web` package, `apps/ui`). `packages/architecture-lint/tests/frontend-boundary.unit.test.ts`
walks the real import graph from both backend entrypoints, every `*.composition.ts`, and
every server package. `import type` is always fine. `@langwatch/mail` is the one exception
because react-email renders server-side. Shared values move into a framework-free
module (usually the contract).

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
  process spreads it into its own definition; the module receives the parsed value
  through its setup's `config` member, from the slice keyed by module name in
  `createApp`'s `config` record.
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

Worked examples of the root at four sizes - one module in a test, a module with
peers, a module reading a member, and the whole api - are in
`composition-by-size.md`. Read that when you need to see one assembled; this
section is what the pieces are.


The design is [ADR-144](../../../../dev/docs/adr/144-declarative-process-composition.md)
(declarative process composition), and it has landed: a module declares everything it
contributes on its own `<m>.server.ts`
(`defineServerModule("<m>").withRepositories(...).withApp(...).withTransports(...)`,
its App naming any process member it reads with `static readonly reads = reads(...)`),
and a process boots the generated module list directly, with no per-module composition
file. `installApi<F>`, `.withPersistence`, `.withInfrastructure` and `.withModule`
(singular) no longer exist; a document or branch still prescribing them is describing
the deleted shape.

```ts
// apps/api/src/app/api-production.composition.ts (the shape, abridged)
const members = createProcessMembers({ config: processConfig, members: options.members });

const runtime = await createApp<ProcessMembers>({
  role: "api",
  config: apiModuleConfig(config), // one slice per module name
  members,
})
  .withModules(serverModules)
  .withTransports((peers: TransportPeers) => ({
    rest: ApiRestHost.create({ peers, config: restHostConfig }),
    trpc: ApiTrpcHost.create({ peers, config: trpcHostConfig }),
  }))
  .boot();
```

- `createApp({ role, config, members })` from `@langwatch/runtime-composition` takes
  the role (`"api" | "worker" | "tasks"`), one config slice per module name and a
  member source. `createProcess(...)` from `@langwatch/infrastructure` is the
  real-process wrapper that builds the member record from a `ProcessConfig` first
  (`createProcessMembers`).
- `.withModules(serverModules)` installs the generated list
  (`modules/server-modules.generated.ts`, imported as
  `@langwatch/installed-modules/server`, written by `pnpm generate:modules` from
  `modules/catalogue.json`). **Installing a module edits the catalogue, never an
  app.** Peers resolve each other by `*Api` token; a cycle or a missing peer refuses
  at boot by name.
- `.withProvided(Token, implementation)` supplies a peer this graph does not install
  itself - the seam a test uses to hand in a double without booting the peer's whole
  module graph.
- `withMemoryRepositories(<m>Server)` swaps one module's repository registry onto its
  memory twin. There is no process-wide `"postgres" | "memory"` word: a store's
  presence is its address (`DATABASE_URL`, `CLICKHOUSE_URL`), and absence refuses at
  boot rather than downgrading.
- A member a module `reads(...)` that the process cannot supply is a boot refusal
  naming both module and member (`MissingMemberError` wrapping
  `MemberNotConfiguredError`), never a stub that answers 503.
- `.boot()` constructs exactly the union the installed modules declared, in the fixed
  `MEMBER_NAMES` order, and returns the runtime; `runtime.service(Token)` reads any
  provided token.
- The worker boots one graph per capability
  (`apps/worker/src/app/worker-observability-apps.composition.ts` installs trace,
  annotation, data-privacy, log and evaluation through one `.withModules([...])`);
  both roles install the same module declarations and each role reads only the
  contributions addressed to it.

## Mounting transports in apps/api

A module's `transport/*.rest.ts` and `*.trpc.ts` are inert declarations. The process's
transport hosts mount every declaration the installed modules contributed:
`ApiRestHost` (`apps/api/src/app-rest/api-rest.host.ts`) and `ApiTrpcHost`
(`apps/api/src/app-trpc/api-trpc.host.ts`), built over `createRestRuntime` and
`createTrpcRuntime` from `@langwatch/api` and handed their peers by
`.withTransports((peers) => …)` at boot.

- There is no per-module mount layer any more: no `installApi<F>`, no
  `apps/api/src/features/<f>/` composition or mount files, no `api-rest.doors.ts`.
  The directories still under `apps/api/src/features/` hold process-side adapters and
  mappings, not module installs. The older `createServiceApp`,
  `createServiceVersionedApp`, `createTrpcService`, `createProjectVersionedApp` and
  `mountProjectTransport` builders are deleted; a file still naming one is conversion
  debt (`legacy-transport-runtime`).
- A family whose wire error shape predates the house shape keeps its renderer in the
  module's own transport file, exported beside the declaration
  (`annotationRestErrors` beside `annotationRest`), so converting a module cannot
  silently rewrite a legacy family's error bodies.
- The wire is pinned: `apps/api/src/app-rest/api-rest.addresses.json` is generated
  from the mounted declarations - every method and path with its credential kind -
  and a snapshot test compares it with the checked-in file, so a conversion that
  moves a route or changes a door is a failing diff a reviewer reads in seconds.

## Absences

The older API root answered a missing substrate with `refusing<F>Feature()`: the
namespace mounted and every call threw `Api<F>UnavailableError` (`service_unavailable`,
`fault: "platform"`) by name. That shape is retired: a required provider missing at boot
is a boot failure (`MissingProviderError`), not a stub that answers 503. Do not add a
`refusing*`, `Unavailable*` or `Logged*Absence`; either the module installs and its
dependencies are provided, or the process does not install it and says so at boot. An
optional dependency that production never passes is a wiring bug wearing a type: make it
required. ADR-144 extends the same rule to a module's own process members: a member it
names with `reads(...)` that this process cannot supply is a named boot failure
(`{ module, member }`), never a member that quietly resolves to something emptier.

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
`packages/architecture-enforcer/tests/frontend-boundary.unit.test.ts` walks the real import
graph from both backend entrypoints, every `*.composition.ts`, and every server package.
`import type` is always fine for a framework-free module, but not for a type whose
module drags a value graph behind it, which is the whole of ADR-130.
`@langwatch/mail` is the one exception because react-email renders server-side. Shared
values move into a framework-free module (usually the contract).

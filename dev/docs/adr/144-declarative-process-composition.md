# ADR-144: Declarative process composition

**Date:** 2026-09-10

**Status:** Accepted; implementation in progress

**Behavioural contract:**
[Declarative process composition](../../../specs/server/declarative-process-composition.feature)

**Related:** [ADR-133: one feature installer, one construction path, explicit
lifecycle](./133-composition-spec.md) (**superseded by this ADR**),
[ADR-102: runtime composition roots](./102-runtime-composition-roots.md),
[ADR-128: public REST and internal tRPC](./128-public-rest-and-internal-trpc.md),
[ADR-045: domain errors at the handled boundary](./045-domain-errors-handled-boundary.md),
[ADR-132: secrets are not config](./132-secrets-are-not-config.md),
plan: [composition v2](../plans/composition-v2.md).

This ADR supersedes ADR-133 and the composition sections of the
`architecture-guide` skill (`SKILL.md`, `references/config-composition.md`),
which describe `defineModule` + `installApi<Name>` + a hand-written
`api-production.composition.ts`. Where the two disagree, this ADR wins and the
skill is rewritten from it.

## Context

ADR-133 gave every module one installer and one construction path. It worked:
`defineModule("api-key").withRepositories(...).withApp(ApiKeyApp).withTransports(...)`
is the shape of every converted module today, and `@langwatch/runtime-composition`
already orders modules topologically, refuses a cycle, refuses a missing peer,
selects a repository backend and owns the lifecycle.

What it did not do is remove the process. A module still has to be *installed*
by hand, once per application, and the hand-written half is now the whole cost:

| Measure (2026-09-10, `feat/strict-feature-layout-v0`) | Count |
| --- | --- |
| `apps/api/src/app/api-production.composition.ts` | 4,989 lines |
| `apps/worker/src/app/worker-production.composition.ts` | 2,530 lines |
| `apps/api/src/app-rest/api-rest.doors.ts` | 909 lines |
| `apps/api/src/features/**` (per-module `installApi*`, mounts, absence twins) | ~130 files |
| Process-side lines for `annotation` alone | 283 |
| Process-side lines for `api-key` alone | 345 |
| `<M>Infrastructure` interfaces across `modules/**` and `enterprise/modules/**` | 40 |
| Distinct member names those 40 interfaces name | 238 |
| Member names more than one module shares | 15 |

238 names for 40 modules is the number that decides the design. An
"infrastructure" that is 238 distinct members is not infrastructure: it is a
per-module options bag, and most of what is in it is either a port the process
implements (`WorkbenchAccessPort`, `EvaluationExecutionPort`, `DatasetUploadPort`)
or a value the module could derive for itself (`pepper`, `bindingIds`,
`generateId`, `diagnostics`). Fifteen names - `prisma`, `redis`, `clock`/`now`,
`logger`, `audit`, `encryption`, `storage` and their kin - are the ones a
process genuinely owns.

Adding a module edits between four and nine files that no module owns:
`api-production.composition.ts`, `app-trpc.features.ts`, `app-trpc.namespaces.ts`,
`api-rest.doors.ts`, the worker twin, and a new `apps/api/src/features/<m>/`
directory holding an `installApi<M>`, a REST mount, a tRPC mount, an absence
twin and a composition types file. Those files are the coordinator's, so every
lane queues behind them, and the queue is the reason a conversion wave takes
days rather than hours.

The three costs, named:

1. **A module's needs are discovered at the mount, not declared.** The mount
   file is where a lane finds out that a module wants an audit sink, a
   credential binding and a rate limiter, and it writes each of them by hand,
   differently, per module. `api-key-rest.mount.ts` is 101 lines of exactly
   this: a credential bound as a fact, and an audit row written by a Hono
   middleware that inspects `context.res.status`.
2. **Behaviour leaks into wiring.** An audit row, an idempotency key, a
   `no-store` header and a body limit are properties of a *route*, and today
   three of the four are properties of a *mount*. So the same route audits on
   one process and not on another, and no test can see the difference.
3. **The process is a merge conflict.** Two lanes converting two modules
   collide in `api-production.composition.ts` even though their modules share
   nothing.

Alex's ruling, 2026-09-10: *a process composition of about a hundred lines
instead of five thousand, purely declarative, where adding a module edits no
app.*

## Decision

**A process is a role, a config, an infrastructure pool and a generated module
list. Everything else is declared by the module.**

```ts
// apps/api/src/main.ts - the whole process
const config = parseConfig(apiConfig);
const infrastructure = createInfrastructure(config);

await createApp({ role: "api", config, infrastructure })
  .withModules(serverModules)
  .boot();
```

`apps/worker/src/main.ts` is the same file with `role: "worker"`, and
`apps/tasks/src/main.ts` with `role: "tasks"`. The three differ in one string.

### 1. The module declares everything it contributes

```ts
// modules/api-key/server/src/api-key.server.ts
export const apiKeyServer = defineServerModule("api-key")
  .needs<ApiKeyInfrastructure>()("prisma", "clock", "secrets")
  .withRepositories(apiKeyRepositories)
  .withApp(ApiKeyApp)
  .withTransports(apiKeyRest, apiKeyTrpc)
  .withWorkers(apiKeyReaper)
  .withTasks(apiKeyBackfill);
```

`defineModule` is renamed `defineServerModule`; the web half is
`defineWebModule`. `.build()` goes: the last `with*` call returns the
declaration, because a builder that must be told it has finished is a builder
that can be forgotten half-built.

| Call | Role that reads it |
| --- | --- |
| `.needs<I>()(...members)` | every role, at boot |
| `.withRepositories(registry)` | every role |
| `.withApp(App)` | every role |
| `.withTransports(...)` | `api` mounts every REST, tRPC and SSE declaration |
| `.withWorkers(...)` | `worker` starts every declared worker |
| `.withTasks(...)` | `tasks` exposes every declared task |

A role reads the declarations addressed to it and ignores the rest. There is no
per-role module list, no `contributesWorkerWork` flag and no second declaration
file: the api process holds the same `serverModules` array the worker does.

### 2. The infrastructure pool is one typed structural object

```ts
// packages/runtime-composition/src/infrastructure.ts
export interface Infrastructure {
  readonly prisma: PrismaClient;
  readonly clickhouse: ClickHouseClient;
  readonly redis: RedisClient;
  readonly eventing: EventBus;
  readonly clock: Clock;
  readonly encryption: Encryption;
  readonly secrets: SecretResolver;
  readonly objectStorage: ObjectStorage;
  readonly mail: Mail;
  readonly cache: Cache;
  readonly rateLimiter: RateLimiter;
  readonly idempotency: IdempotencyStore;
  readonly audit: AuditSink;
  readonly logger: Logger;
  readonly telemetry: Telemetry;
}

/** What a module names: a subset of the pool, by member name. */
export type Needs<Member extends keyof Infrastructure> = Pick<Infrastructure, Member>;
```

A module's `<M>Infrastructure` interface is a `Needs<...>` of the pool, so its
member *names* are the pool's member names:

```ts
export type ApiKeyInfrastructure = Needs<"prisma" | "clock" | "secrets">;
```

Three rules follow, and all three are binding.

**Compile.** `withModules` takes `readonly InstallableServerModule<Pool>[]`.
`install` is a property with a function type, not a method, so under
`strictFunctionTypes` its `infrastructure` parameter is contravariant: a module
whose `Infrastructure` names a member the pool lacks is *not assignable*, and
`withModules(serverModules)` fails to compile. This is the whole compile-time
guarantee and it needs no extra machinery.

**Boot.** `.needs<I>()(...members)` records the member *names*, which types
erase. At boot, before any `create` is called, the runtime reads each name off
the pool and refuses on `undefined` with one structured line:

```
fatal boot failure: module "api-key" needs infrastructure member "secrets",
which this process's pool supplies as undefined
```

`MissingInfrastructureError` carries `{ module, member }` as fields, not as
prose, and the boot log line is that record.

**Agreement.** `.needs<I>()` is curried so `I` is explicit while the member
tuple infers, and the tuple must be exhaustive over `keyof I`: an incomplete
tuple resolves to a type carrying the missing names, which has no further
builder methods, so the error reads
`Property 'withRepositories' does not exist on type '["missing infrastructure members", "clock"]'`.
One unit test pins both halves - a pool missing a member fails to compile
(`expectTypeOf`), and a pool supplying `undefined` fails to boot with that
line.

**Peer modules are never infrastructure.** A module that needs another
module's behaviour names its `*Api` token in the App's `static dependencies`.
`createApp` orders modules topologically, refuses a cycle by the names in it
and refuses a missing peer by name. Nothing about a peer passes through the
pool, and the pool holds no `*Api`.

**What is not a pool member.** Anything derived is derived inside the module
that derives it: `api-key`'s HMAC pepper is read from `secrets` in
`ApiKeyApp.create`, not handed over as `pepper`; an id deriver is a function
the module owns; a `diagnostics` object is the module's own use of `logger`.
The pool is closed, and it is closed on purpose: an open pool is the optional
port that production forgets to supply, which is the defect ADR-133 opened
with.

`createInfrastructure(config)` builds the pool once per process from parsed
config, owning each client's lifetime. `createTestInfrastructure(overrides?)`
builds the same shape from fakes: an in-memory clock, an in-memory event bus, a
recording audit sink, a `PrismaClient` double, an in-memory object store. A
test overrides the members its subject reads and inherits honest fakes for the
rest.

### 3. Credential kind is a per-route declaration

`withCredential` exists on the family today and must be declared before the
first route. It stays, as a *default*, and gains a per-route twin:

```ts
export const apiKeyRest = defineRestRouter(ApiKeyApi)
  .withNamespace("api-keys")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organization")          // the family default
  .route("POST /")
    .withCredential("instance-admin")      // this route only
    .withInput(apiKeyRestCreateSchema)
    .withPermission("api-keys:manage")
    .handle(async ({ input, app, actor, scope }) => app.create(...))
  .build();
```

The kinds are `project`, `organization`, `browser`, `instance-admin` and
`public`, which are the present `projectKey`, `organizationKey`, `session`,
`instanceAdminKey` and the absent-credential case, renamed to say what the
caller is rather than what the header holds. `scimToken` and `internalSecret`
stay as two further kinds; they are doors, not renames.

The REST runtime resolves every kind itself, through the `identity` and
`api-key` Apps, which it declares as *its own* dependencies. A process no
longer binds a credential per module: `api-key-rest.mount.ts`'s bound
`apiKeyRestCredential` fact is the runtime's answer for kind `organization`,
handed to the handler as `actor` and `scope`, typed by the kind through
`DOOR_SCOPE_TIER`.

### 4. Handlers return plain objects and throw

A handler returns a plain object matching its declared output schema, or throws
a `HandledError`. The runtime serialises both. **Family-level `onError`
handlers do not exist**, and `FeatureInstallOptions.rest.onError` is deleted.

A legacy family whose wire error shape differs from the house shape pins that
shape in its contract's error schema, where the SDK and the browser can read
it, rather than in a process-side handler no client can see.

### 5. Cross-cutting concerns are route declarations

| Declaration | Fulfilled by the runtime from |
| --- | --- |
| `.withAudit("api-key.created")` | `infrastructure.audit`, plus `actor`, the route's params and the result's `id` |
| `.withIdempotency("api-key.create")` | `infrastructure.idempotency` |
| `.withRateLimit(...)` | `infrastructure.rateLimiter` |
| `.withCache(...)` / no-store | `infrastructure.cache` |
| `.withBodyLimit(...)` | the runtime's own request reader |

The App carries none of that plumbing, and no process-side middleware writes an
audit row. `withAudit` names an action; the runtime writes
`{ actorId, action, scope, params, resultId, error }` after a 2xx answer and,
for a refusal, after a `HandledError` with the error's `code`. That is the one
place the rule "record what succeeded" now lives, instead of the four
hand-written copies of `if (context.res.status < 200 …) return`.

**Behaviour lives only in the App.** A route declares; the App decides.

### 6. The module list is generated

`modules/catalogue.json` gains a `tier` per entry (`"core"` by default,
`"enterprise"` for an `enterprise/modules` entry) and a `server` /`web` flag
saying which halves exist. A generator writes two files:

- `packages/runtime-composition/src/server-modules.generated.ts`, exporting
  `serverModules` - every installed module's `<m>Server` declaration.
- `apps/ui/src/features/web-modules.generated.ts`, exporting `webModules`.

The enterprise build generates both tiers; the OSS build generates the core
tier only, and the enterprise imports are absent from the OSS output rather
than guarded at runtime. The generator is `pnpm generate:modules`, runs in
`start:prepare:files`, and its output is checked in so a clone type-checks
before it generates. A test asserts the checked-in file equals a fresh run.

`installApi<Name>`, `apps/api/src/features/**` and every hand mount go away.

### 7. Tests boot the same process

There is one construction path, so a test uses it:

```ts
const runtime = await createApp({
  role: "api",
  config: testConfig,
  infrastructure: createTestInfrastructure(),
}).withModules([apiKeyServer, identityServer]).boot();
```

`createApiFixture` in `@langwatch/test-harness` is rebuilt on that call, so a
transport test exercises the real credential resolution, the real audit write
and the real serialisation, against memory repositories. A test that hand-rolls
a mount is a defect.

### 8. The wire is pinned, and the transition is one module at a time

`apps/api/src/app-rest/api-rest.addresses.json` is generated from the mounted
declarations: every method and path with its credential kind, sorted. One
snapshot test compares the generated inventory with the checked-in file, so a
conversion that moves a route, drops a `v1` twin or changes a door is a failing
diff a reviewer reads in seconds.

During the transition `createApp`'s REST runtime mounts on **the same Hono root**
`api-production.composition.ts` already uses. So a converted module leaves
`api-production` and appears under `createApp` with no wire change, one module
at a time. `api-production.composition.ts` never grows again: it only shrinks,
and it is deleted when the last module converts. `api-rest.doors.ts` is deleted
in the same step, not before.

## Consequences

**Good.**

- Adding a module edits the module and `modules/catalogue.json`. Nothing else.
- Two lanes converting two modules never touch the same file.
- A missing infrastructure member is a compile error, not a `refusing*` twin.
- An audit row, an idempotency key and a rate limit are visible in the route
  declaration a reviewer is already reading.
- One construction path means a test and production differ by their pool.

**Costs.**

- The pool is closed, so a module that wants something new must argue for a
  pool member, derive it, or take a peer Api. That is the point, and it will
  feel slow the first three times.
- Every module's `<M>Infrastructure` interface is rewritten as `Needs<...>`,
  and members that were module-private (`pepper`, `bindingIds`, `diagnostics`)
  move inside the App. That is the bulk of the per-module conversion cost.
- `withAudit` must reproduce each family's present audit rows exactly, or the
  trail changes shape. The address inventory does not cover audit; the per-module
  conversion recipe requires the old rows be listed and asserted.
- `strictFunctionTypes` contravariance is doing load-bearing work. A future
  edit that turns `install` into a method silently deletes the compile-time
  guarantee, so a type test pins it.

**Neutral.**

- The local backend launcher keeps two `createApp` calls, api and worker, in
  one process. Nothing is shared between them: two pools, two Prisma clients,
  two Redis connections, as production has.
- `ServerRole` gains `"tasks"`, replacing `"task"`.

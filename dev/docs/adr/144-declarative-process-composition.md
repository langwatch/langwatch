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

238 names for 40 modules is the number that decided the design. An
"infrastructure" that is 238 distinct members is not infrastructure: it is a
per-module options bag, and most of what is in it is either a capability the
process implements on the module's behalf (`WorkbenchAccessPort`,
`EvaluationExecutionPort`, `DatasetUploadPort`) or a value the module could
derive for itself (`pepper`, `bindingIds`, `generateId`, `diagnostics`).
Fourteen names - `prisma`, `redis`, `clock`, `logger`, `encryption`,
`objectStorage` and their kin - are the ones a process genuinely owns.
`audit` looked like a fifteenth, and is not: see decision 2.

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
app.* Two reviews and a further afternoon of rulings then discarded the first
draft of this decision piece by piece; what follows is what was actually
settled, and it is what `annotation` and `api-key` - the two modules already
converted - were built against.

## Decision

**A process is a role, a config, one closed record of members and a generated
module list. Everything else is declared by the module.**

```ts
// apps/api/src/main.ts - the whole process
const config = parseConfig(apiConfig);

await createApp({ role: "api", config })
  .withModules(serverModules)
  .boot();

// a test overriding one member
await createApp({
  role: "api",
  config: testConfig,
  members: { clock: frozenAt("2026-09-10T12:00:00Z") },
})
  .withModules([...])
  .boot();
```

`apps/worker/src/main.ts` is the same file with `role: "worker"`, and
`apps/tasks/src/main.ts` with `role: "tasks"`. The three differ in one string.
There is no `repositories: "live" | "memory"` or `channels: "live" | "memory"`
argument here: decision 2 explains why an argument like that cannot exist.

### 1. The module declares everything it contributes

```ts
// modules/annotation/server/src/annotation.server.ts - the whole module, as landed
export const annotationServer = defineServerModule("annotation")
  .withRepositories(annotationRepositories)
  .withApp(AnnotationApp)
  .withTransports(annotationRest, annotationTrpcTransport, annotationScoreTrpcTransport);

// modules/api-key/server/src/api-key.server.ts - a module with event sourcing
export const apiKeyServer = defineServerModule("api-key")
  .withRepositories(apiKeyRepositories)
  .withApp(ApiKeyApp)
  .withTransports(apiKeyRest, apiKeyTrpcTransport)
  .withEventing(apiKeyEventing);
```

`defineModule` is renamed `defineServerModule`; the web half is
`defineWebModule`. There is no `.build()`: every `with*` call already returns
something installable, because a builder that must be told it has finished is
a builder that can be forgotten half-built. Both modules above end their chain
on whichever `with*` call they last needed, and neither calls anything more.

| Call | Role that reads it |
| --- | --- |
| `.withRepositories(registry)` | every role, chooses the backend per repository (decision 2) |
| `.withApp(App)` | every role; the App's own `static readonly reads` (decision 2) is what boot reads |
| `.withTransports(...)` | `api` mounts every REST, tRPC and SSE declaration |
| `.withWorkers(...)` | `worker` starts every declared worker |
| `.withTasks(...)` | `tasks` exposes every declared task it was invoked with |
| `.withEventing(...)` | a process running event sourcing installs the pipeline; one that is not ignores the call |

A role reads the declarations addressed to it and ignores the rest. There is no
per-role module list, no `contributesWorkerWork` flag and no second declaration
file: the api process holds the same `serverModules` array the worker does.

**The `tasks` role declares per task, not per role.** `prisma-migrate` must
boot with no ClickHouse, and a role-wide member union would refuse it for a
member it never touches. A task names what it reads on itself -
`defineTask("backfill-x").reads("prisma", "clickhouse")` - and `tasks` builds
the union of only the tasks it was invoked with, never the whole catalogue.
`api` and `worker` still keep the whole-role union, because both serve every
route and every job in the same process for as long as it runs.

### 2. A process hands a module one closed record of members

`Infrastructure`, `"infrastructure"` as a concept name, and the word `pool`
are gone. What used to be a per-module `<M>Infrastructure` interface naming a
subset of an open bag is now `MembersRead<Names>`, sliced from one closed,
process-wide record every module reads the same way:

```ts
// packages/infrastructure/src/members.ts - fourteen members, one shape,
// landed and structurally identical to the ruling this decision records
export interface ProcessMembers {
  readonly prisma: PrismaClient;
  readonly clickhouse: ClickHouseQueryClient; // ONE client; it routes to the tenant's endpoint itself
  readonly redis: RedisConnection;
  readonly eventing: EventSourcing;
  readonly objectStorage: ObjectStorage; // ONE client; it resolves the project's bucket itself
  readonly mail: Mail;
  readonly clock: Clock;
  readonly encryption: Encryption;
  readonly secrets: SecretResolver;
  readonly cache: Cache;
  readonly rateLimiter: RateLimiter;
  readonly idempotency: IdempotencyStore;
  readonly logger: Logger;
  readonly telemetry: Telemetry;
}
export type MemberName = keyof ProcessMembers;

export function reads<const Names extends readonly MemberName[]>(...names: Names): Names {
  return names;
}
```

A module states what it reads in one line, on its App, and nowhere else:

```ts
export class AnnotationApp implements AnnotationApi {
  static readonly contract = AnnotationApi;
  static readonly dependencies = { projects: ProjectApi, traces: TraceApi };
  static readonly reads = reads("clock", "logger");

  static create({ repositories, dependencies, members }: AnnotationSetup): AnnotationApp { … }
}
type AnnotationSetup =
  ModuleSetup<typeof AnnotationApp.dependencies, AnnotationRepositories, typeof AnnotationApp.reads>;
```

`reads(...names)` is the type's source, so there is no interface to keep in
agreement with a list: the tuple is typed directly against `MemberName`, so a
misspelt name fails as `'"clcok"' is not assignable to 'MemberName'` on the
line the author wrote. This replaces two mechanisms the first draft of this
ADR proposed and both reviews then rejected: a curried `.needs<I>()(...members)`
call on the builder (moved onto the App instead, because inferring the set
from `keyof create(setup)` cannot give boot the names at runtime, and a
`.needs<I>()` call that omits a name used to fail several calls later as
`Property 'withRepositories' does not exist on type [...]`, not on the line
that named the members); and a `strictFunctionTypes` contravariance trick on
`install` that made a module "not assignable" when a *per-process* pool
lacked a member. Neither is needed once the record is the same fourteen keys
for every process: what varies between processes is not the record's shape
but whether a given key refuses at boot (below), which is a runtime question,
not a type one.

**Refusal, in two layers.** `packages/infrastructure`'s `createProcessMembers`
builds each member on first read and refuses by member name alone
(`MemberNotConfiguredError`, e.g. `This process has no "prisma" member: set
DATABASE_URL`); `@langwatch/runtime-composition` wraps that as the read is
attributed to the module that claimed it (`MissingMemberError`, carrying both
`module` and `member`, `cause` set to the underlying refusal). Landed:

```
fatal boot failure: Module "annotation" reads the "clock" member, which this
process cannot supply. (caused by: This process has no "clock" member: ...)
```

A member handed in as an own property with the value `undefined` is a second,
distinct refusal (`MemberSuppliedUndefinedError`) rather than a silent
omission: without that case a misspelt override in a test - `members: {
clcok: undefined }` - would silently fall through to the real client, because
`exactOptionalPropertyTypes` is off in `tsconfig.base.json`. A member passed
is used as it stands and is never closed by the process that received it,
because whoever built it owns it; a member omitted is built from config, once,
on first read; a member supplied as `undefined` is the refusal above.

**Order.** Boot builds exactly the union of every installed module's declared
reads and the chosen repository tier's own requirements, eagerly, in one fixed
construction order (`MEMBER_NAMES`, landed): `logger`, `clock`, `secrets`,
`encryption`, `telemetry`, `prisma`, `clickhouse`, `objectStorage`, `redis`,
`cache`, `idempotency`, `rateLimiter`, `eventing`, `mail`. Nothing is lazy:
`cache`, `rateLimiter` and `idempotency` are built from the same `redis`
connection rather than from config a second time, because two constructions
of the same client would give one process two fold caches, two dedup
keyspaces and two tenant broadcast channels. `prisma` opens before
`clickhouse` and `objectStorage`, because both place a tenant through a
directory built once on `prisma` and never through `ProjectApi` - project's
own live tier reads ClickHouse, so member to Api to project's repositories
back to member would be a cycle. That directory refuses on a null tenant and
never falls back to a shared endpoint; this is landed (`tenantDirectory()` in
`packages/infrastructure/src/create-members.ts`), not aspirational.

**A store has no mode word: its address is the statement, and absence always
refuses.** There is no `repositories: "live" | "memory"` argument on
`createApp`, no `CLICKHOUSE=off`, no `*_MODE` leaf. `CLICKHOUSE_URL` present
means live; absent means any repository that needs ClickHouse refuses at boot,
naming the module and the store. The same holds for `DATABASE_URL`: it being
unset must make `prisma` refuse, never quietly select an in-memory repository
behind a readiness check that stays green - that silent downgrade is exactly
the failure this design exists to delete, and it is why an earlier repository
selector that read one `"postgres" | "memory"` string for the whole process is
gone (it also could not be right for a process where one module holds Redis
and another holds ClickHouse; presence and absence differ per module). The
only way to run without a store is to say so in code, by handing a module's
`.withRepositories(...)` its memory registry entry explicitly. That is the one
seam a test uses, and the only place the word `memory` is written.

**One client, and it routes internally.** `clickhouse` is not a resolver a
caller calls with a tenant id, and `objectStorage` is not one a caller calls
with a project id. Each is one object that routes to the right endpoint,
bucket and credentials itself, so a caller cannot obtain an unscoped client
and "every ClickHouse query filters `TenantId` first" is structural rather
than a rule people remember. The 89 files naming `resolveClickHouse*` and the
16 naming `forProject` lose that argument rather than pushing it into the
record.

**Mail is chosen by provider, and its config is discriminated on the
choice.** `MAIL_PROVIDER` is `smtp | ses | resend | off` (landed,
`packages/infrastructure/src/config.ts`), and each provider's own leaves are
required for that provider alone: smtp needs host, port and credentials, ses a
region, resend a key, off nothing. A provider with a missing leaf refuses at
parse, not at the first send; `off` is a configured state that refuses the
`mail` member by name (`this process was started with MAIL_PROVIDER=off`),
never a message silently dropped.

**Slack is not a member.** You provide a webhook or a key or you do not, and
it is never one value for the whole process: the destination belongs to a
project's integration, not to the process. It lives as the owning module's own
config, provided per integration, and it is not in `ProcessMembers`.

**Peer modules are never members.** A module that needs another module's
behaviour names its `*Api` token in the App's `static dependencies`, exactly
as `AnnotationApp` and `ApiKeyApp` do today. `createApp` orders modules
topologically, refuses a cycle by the names in it and refuses a missing peer
by name. Nothing about a peer passes through the member record, and the
record holds no `*Api`.

**`audit` is not a member.** The real sink is the audit-log module's own App;
the record holds no Api for it. A transport declares `.withAudit(action)` and
the runtime resolves the audit-log App as a peer, the way the REST runtime
already resolves identity and credential doors. Fourteen members, not fifteen.

**What is not a member.** Anything derived is derived inside the module that
derives it, and both converted modules are the worked example rather than a
hypothetical: `api-key`'s HMAC pepper is read from its own config slice
(`static readonly configSchema = apiKeyServerConfigSchema`) in `ApiKeyApp.create`,
not handed over as a `pepper` member; its ksuid binding-id deriver
(`ApiKeyBindingIdAdapter`) and its warning log (`ApiKeyDiagnosticsAdapter`) are
the module's own adapters over `logger`, not members either. The record is
closed on purpose: an open one is the optional member production forgets to
supply, which is the defect ADR-133 opened with.

**Where this stands as written.** `@langwatch/infrastructure` (the record,
`reads`, `createProcessMembers`, the two refusal classes, the discriminated
mail config, the tenant directory) is landed and unit-tested on its own; no
module imports it yet, and `@langwatch/runtime-composition`'s `application.ts`
has not been rewired onto it - it still carries the pre-ruling `Infrastructure`
/ `Tier` (`"live" | "memory"`) shape this decision replaces, including a
`repositories: Tier` / `channels: Tier` pair on `createApp`'s options that
ruling 12 above names as dead on sight. Wiring `application.ts` onto
`@langwatch/infrastructure` is the next step of this ADR's implementation, not
a second design.

### 3. Credential kind is a per-route declaration

`withCredential` exists on the family today and must be declared before the
first route. It stays, as a *default*, and gains a per-route twin, both
landed and in use across a dozen modules (`organization`, `role`, `trace`,
`api-key`, `stored-object`, `workflow`, `langy` and others already call
`.withCredential`):

```ts
export const apiKeyRest = defineRestRouter(ApiKeyApi)
  .withNamespace("api-keys")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organization")          // the family default
  .get("/:id", "getApiKey")
    .withAudit("management.api-key.read")  // this route only
    .withMiddleware(apiKeyRestCredential)
    .handle(async ({ input, app, scope }, caller) => …)
  .build();
```

The kinds are `project`, `organization`, `browser`, `instance-admin`,
`scimToken` and `internalSecret` (`RestDoorCredential`, landed). `public` is
deliberately **not** one of them: a route with no credential declares
`publicRoute` access instead, because typing a handler's scope as a value no
door establishes would be worse than not typing it. The five named kinds are
what the present `projectKey`, `organizationKey`, `session` and
`instanceAdminKey` doors are renamed to, saying what the caller is rather than
what the header holds; `scimToken` and `internalSecret` are further doors, not
renames.

The REST runtime resolves the credential *kind* itself, through the
`identity` and `api-key` Apps it declares as its own dependencies. What it
still cannot resolve is a *question about* that credential: `api-key`'s two
organization-wide reads (does this key, not just its holder, reach across the
organization) still bind a fact through `.withMiddleware(apiKeyRestCredential)`
and a process-side `bindRestMiddleware`, because the runtime has no primitive
yet for "resolve this credential and hand its own capability to the handler."
Closing that is unfinished work, not a design gap papered over by the
middleware; until it lands, a family that asks a question about its own
credential keeps its mount-side binding.

### 4. Handlers return plain objects and throw

A handler returns a plain object matching its declared output schema, or
throws a `HandledError`. The runtime serialises both.

**Family-level `onError` handlers do not disappear; they move.** The first
draft of this ADR said `FeatureInstallOptions.rest.onError` is deleted. It is
not, and the api-key conversion is why: a legacy family whose wire error
shape differs from the house shape (`/api/annotations` answers `{ status,
message }`; the house renderer answers `{ error, message, …meta, fault }` at a
different status vocabulary) would have that shape silently rewritten for
every existing integration the moment its `onError` vanished. The renderer
instead moves into the module's own transport file, beside the declaration it
renders for, and is handed to the mount explicitly - landed as
`annotationRestErrors`, exported next to `annotationRest` from
`modules/annotation/server/src/transport/annotation.rest.ts` and re-exported
from the module's `index.ts`. `FeatureInstallOptions.rest.onError` survives
until a route declaration can state a family's wire error shape for itself;
deleting it before then is the same silent rewrite the renderer exists to
prevent.

### 5. Cross-cutting concerns are route declarations

| Declaration | Fulfilled by |
| --- | --- |
| `.withAudit(action)` | the audit-log module's App, resolved as a peer, plus `actor`, the route's params and the result's `id` |
| `.withIdempotency(...)` | the `idempotency` member |
| `.withRateLimit(...)` | the `rateLimiter` member |
| `.withCache(...)` / no-store | the `cache` member |
| `.withBodyLimit(...)` | the runtime's own request reader |

The App carries none of that plumbing, and no process-side middleware writes
an audit row. `withAudit` names an action, dotted lower kebab
(`assertAuditAction`, landed - `management.api-key.read` is valid,
`management.apiKey.read` is refused at declaration time); the runtime writes
`{ actorId, action, scope, params, resultId }` after a 2xx answer and, for a
refusal, the same row with the `HandledError`'s own `code` in place of a
result - a widening from the mount-side middleware it replaces, which wrote a
row only after a 2xx. A route declaring an action against a runtime with no
audit sink is refused at mount, not silently unaudited.

**The tRPC half has no `.withAudit` yet.** The REST half fulfils a declared
action from a resolved peer; tRPC has no equivalent declaration, so a module
recording a curated row there has nowhere to move it to. `api-key`'s curated
tRPC row turned out, on inspection, to be a duplicate of the automatic
mutation row under the same action, adding only an id the generic redaction
was already masking - the fix was the redaction rule, not a new primitive.
Check that first for any other module before asking for `.withAudit` on tRPC.

**Behaviour lives only in the App.** A route declares; the App decides.

### 6. The module list is generated

`modules/catalogue.json` carries a `tier` per entry (`"core"` by default,
`"enterprise"` for an `enterprise/modules` entry) alongside the pre-existing
`classification` field architecture-lint already reads for the same
core/enterprise split; the two currently agree on every entry and have not
yet been folded into one. `dev/scripts/generate-modules.mjs`
(`pnpm generate:modules`, run by `start:prepare:files`) reads the catalogue
and writes, checked in:

- `modules/server-modules.generated.ts` - `export const serverModules = [
  agentServer, analyticsServer, annotationServer, apiKeyServer, … ] as const;`
  for every entry whose `server` half exists on disk and exports a
  declaration named `<camelCasedId>Server` from its `index.ts`.
- `modules/web-modules.generated.ts` - the same for the web half.

Both files are landed and list every present-day module, including the two
already converted. Neither location matches this ADR's first draft, which put
them at `packages/runtime-composition/src/server-modules.generated.ts` and
`apps/ui/src/features/web-modules.generated.ts`; the generator that was
actually built writes both lists into `modules/` itself, next to the
catalogue that drives it. `tier: "enterprise"` entries are emitted only in the
enterprise build (`LANGWATCH_BUILD_TIER=enterprise`), so the OSS output has no
enterprise import at all.

**Nothing reads `serverModules` yet.** No process root imports the generated
array: `apps/api` and `apps/worker` still boot through
`api-production.composition.ts` and `worker-production.composition.ts`. The
generator is proven; wiring a process root to `.withModules(serverModules)`
is not done.

`installApi<Name>`, `apps/api/src/features/**` and every hand mount go away
only as each module converts and the process root is repointed - see decision
8.

### 7. Tests boot the same process

There is one construction path, so a test uses it, handing in only the
members its subject cares about:

```ts
const runtime = await createApp({
  role: "api",
  config: testConfig,
  members: { clock: frozenAt("2026-09-10T12:00:00Z") },
}).withModules([apiKeyServer, identityServer]).boot();
```

`createTestInfrastructure`, `createTestApp` and any notion of a "fakes" bag do
not exist in this design: a test hands in members through the exact seam
production uses, and every member it does not override is built from
`testConfig` the same way a real member would be, because there is no second
construction path for a fake to rot behind. `createApiFixture` in
`@langwatch/test-harness` is rebuilt on this call so a transport test
exercises the real credential resolution, the real audit write and the real
serialisation, against memory repositories chosen the same explicit way
decision 2 describes. A test that hand-rolls a mount is a defect.

**Open: there is no peer seam yet.** `withProvided` was removed from
`ApplicationBuilder` and nothing replaces it; 193 call sites across 62 files
still name a method that no longer exists (measured 2026-09-10, source only).
Annotation names five peers and api-key three; installing a peer's module
today means installing its peers after it, and the chain for annotation
reaches five modules deep, api-key's reaches the authz ledger - which stops
being a unit test. Whatever `withProvided` becomes has to let a test hand in
one peer's Api by its token without booting the peer's whole module graph.

### 8. The wire is pinned, and the transition is one module at a time

`apps/api/src/app-rest/api-rest.addresses.json` is generated from the mounted
declarations: every method and path with its credential kind, sorted. One
snapshot test
(`apps/api/src/app-rest/__tests__/api-rest.addresses.snapshot.integration.test.ts`)
compares the generated inventory with the checked-in file - both landed - so a
conversion that moves a route, drops a `v1` twin or changes a door is a
failing diff a reviewer reads in seconds.

During the transition `createApp`'s REST runtime mounts on **the same Hono root**
`api-production.composition.ts` already uses. So a converted module leaves
`api-production` and appears under `createApp` with no wire change, one module
at a time. `api-production.composition.ts` never grows again: it only shrinks,
and it is deleted when the last module converts. `api-rest.doors.ts` is
deleted in the same step, not before.

### 9. A channel is the fourth layer

A module has four kinds of collaborator, and each has one home:

| Layer | What it is |
| --- | --- |
| repository | state the module owns: Postgres, ClickHouse, Redis used as a store |
| channel | messages to or from something the module does not own, in either direction, with no owned state: the event bus, Redis pub/sub, HTTP to a vendor, a queue, email, Slack, a browser over SSE |
| service | behaviour over repositories and channels |
| member | a raw technical client the process supplies from `ProcessMembers`; a module's channel wraps one with the module's own message types |

The folder grammar mirrors repositories exactly and is landed in
`packages/lint-core/grammar/feature-layout-policy.mjs`'s `SERVER_PATTERNS`:

```
channels/<subject>.channel.ts                     the interface, in the module's own message types
channels/<tier>/<tier>.<subject>.channel.ts       one implementation per tier
channels/<f>-channels.registry.ts                 defineChannels({ live, memory })
```

`<tier>` is one of `eventing`, `redis`, `http`, `sqs`, `ses`, `slack`,
`memory`. Every live channel has a memory twin, so a module is tested without
a broker, a vendor or a mailbox, and the twin is what a test asserts against.

**Nothing uses this yet.** `defineChannels` exists only inside
`packages/architecture-lint`'s own feature-shape policy - the rule that will
enforce this grammar once a module has a `channels/` folder to check - and no
module in `modules/` or `enterprise/modules/` has one. This is a decided shape
with the lint primitive ready and zero adopters, not a landed pattern with
worked examples the way decisions 1, 2, 3 and 5 are.

**A service may not open a channel.** A file under `services/` that imports
`@langwatch/eventing`, `ioredis` publish/subscribe, `undici`, `fetch`, `axios`,
`got`, `@aws-sdk/*`, `resend`, `@slack/*` or `nodemailer` is refused by
`service-does-not-open-a-channel`; the conduit moves to `channels/<tier>/` and
the service takes the channel interface. A channel may import them, and only a
channel may. A live channel with no memory twin, or one absent from
`defineChannels`, is `unregistered-channels`.

The reason is the same one repositories have: a collaborator the module does
not own is a seam, and a seam that is not named is a seam no test can stand in
for. It also draws the line the member record needs: the process supplies a
Redis client; what a module wants is `publishRunFinished(run)`, and the code
that turns one into the other is a channel, not a service and not a member.

`@langwatch/eventing`'s own seam into a module is the one channel-shaped thing
already landed: `defineEventingModule` (`packages/eventing/src/pipeline/eventingModule.ts`,
c747279e4e) hands a module's `build()` exactly four things -
`participation` (`"produce" | "consume"`, because the api only ever sends and
the worker folds, subscribes and runs process managers, so a pipeline that
reads its own projections needs to know which side it is on), `repositories`
(the module's own, already on the backend this process chose), `app` (already
constructed, so the pipeline reuses the same instance every other caller
holds rather than a second graph over the same rows) and `processStore` (the
one graph's own outbox and lease store, because a different graph's store
would prune another process's rows). `.withEventing(apiKeyEventing)` on
`api-key.server.ts` is the whole seam; composition installs it after the
module's App exists, over the same repositories, and calls `.connect()` with
the pipeline's own registered command senders where the declaration asked for
one.

## Consequences

**Good.**

- Adding a module edits the module and `modules/catalogue.json`. Nothing else.
- Two lanes converting two modules never touch the same file.
- A missing member is a boot refusal naming both the module and the member,
  not a `refusing*` twin that answers 503 forever.
- An audit row, an idempotency key and a rate limit are visible in the route
  declaration a reviewer is already reading.
- One construction path means a test and production differ only by which
  members a test overrides.
- Annotation and api-key between them needed **zero** members: annotation
  reads four repositories and five peers, api-key three repositories, three
  peers and its own config slice. The four members api-key's old
  `<M>Infrastructure` interface carried went to four different homes and none
  of them was the member record. The dominant seam in this codebase is peers,
  not members - which is exactly why decision 7's missing peer seam is the
  sharpest open gap, not a footnote.

**Costs.**

- The member record is closed, so a module that wants something new must
  argue for a member, derive it, or take a peer Api. That is the point, and it
  will feel slow the first three times.
- Every module's `<M>Infrastructure` interface is deleted; members that were
  module-private (`pepper`, `bindingIds`, `diagnostics`) move inside the App.
  That is the bulk of the per-module conversion cost.
- `withAudit` must reproduce each family's present audit rows exactly, or the
  trail changes shape. The address inventory does not cover audit; the
  per-module conversion recipe requires the old rows be listed and asserted.
- `@langwatch/runtime-composition`'s `application.ts` and `tiers.ts` still
  carry the pre-ruling `Infrastructure` / `Tier` shape this ADR replaces, and
  no process root imports the generated module list yet. The primitives this
  ADR describes are landed in `@langwatch/infrastructure`; wiring them into
  the actual boot path is the next slice of work, not a detail already
  closed out by writing this document.

**Neutral.**

- The local backend launcher keeps two `createApp` calls, api and worker, in
  one process. Nothing is shared between them: two member records, two Prisma
  clients, two Redis connections, as production has.
- `ServerRole` gains `"tasks"`, replacing `"task"`.

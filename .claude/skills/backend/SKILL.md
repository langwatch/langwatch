---
name: backend
description: "Everything on the Node side of a LangWatch module: composing a process (apps/api, apps/worker, apps/tasks), Server/container/boot, a module's process-half shape, the four-way rule for what a module may demand, declaring REST endpoints and tRPC procedures, the worker role (drain order, eventing pipelines, process managers, subscribers, at-least-once/per-aggregate-ordering), building a new process module end to end, and backend testing (colocated __tests__, installation tests over the installed list, spec-scenario binding, asserting on error code). Use whenever someone is: composing or wiring a process; writing or extending a module's process/ package; hitting a boot() refusal; adding a REST route or tRPC procedure; adding a scheduled process manager, subscriber or projection; creating a brand-new module's process half; or writing/reviewing a unit or integration test for backend code."
user-invocable: true
argument-hint: "<question or backend task>"
---

# The backend

Read `dev/docs/ARCHITECTURE.md` first — this skill is a pointer into it, plus
the procedure. `@langwatch/process` is the Node runtime **and** the
process-half vocabulary: `Server`, the container, `defineProcessModule`,
`defineRepositories`; `definePipeline` comes from `@langwatch/eventing`. An application (`apps/api`,
`apps/worker`, `apps/tasks`, and `apps/backend`, which hosts the api and worker in one process) is only
`main.ts` + `config.ts`; everything else lives in a module's `process/` package or in this
framework (the isolated `apps/scenario-child` is the one narrow runner). Full shape:
record §2, §4. In depth: `process-composition` (§4-§7) and
`module-dependencies` (§3.3, §6, §11).

## `Server`, the container, `boot()` (record §4, §5)

```ts
// apps/api/src/main.ts (abridged; the worker differs only in role and run)
const server = await Server.create("langwatch-api")
  .withEnvironment(processEnvironment) // config.ts: the one process.env seam
  .withConfig(processConfig(processModules)) // the installed list IS the schema
  .withSecrets((config, secrets) => secrets.withEnv().withFile())
  .withUpgradeGate({ role: "api", gate: servingUpgradeGate })
  .withTelemetry(processTelemetry("langwatch-api"))
  .start();
const app = await server
  .container("api")
  .exposeTransports((transports) => transports.trpc().rest().browserBundle())
  .boot();
await server.serve(app);
// worker: server.container("worker").boot({ classifyEventLogRetention }), then server.run(app)
```

`boot()` (record §5): the container opens the stores, orders installers by
peer tokens, and for each installed module picks the tier, checks each
registry's `requires` against the opened stores (refusal at boot, **by name**:
`"webhook needs clickhouse; none opened"`), builds repositories and channels
from the module's registries, resolves peers by token, slices config, calls
`<Name>Module.create({ repositories, channels, dependencies, config, secrets, role, resources })`,
then collects what the role wants (api → REST/tRPC/SSE/command senders;
worker → subscriptions, projections, process managers). The container
answers only stores and peers; every other "is it here?" is the module's own
answer (§3.3 rule 4), never a runtime fallback. There is no `withModules` in
an app: the `processModules` list is generated (`pnpm generate:modules`) from
`modules/catalogue.json`; installing a module edits the catalogue, never
`main.ts`. **The root never grows** — a change that needs it to grow found a
gap in the primitives; report the gap.

Tasks (`apps/tasks`) takes the `Server` for telemetry/config, skips the
listener; `server.container("tasks")` boots producer-only and runs the named
tasks, a module's own declared with `.withTasks(...)` (§5). A test passes no
server: `bootInstalledProcess({ role: "api", ... })` registers nothing
anywhere and returns the runtime for the test to drive (see Testing, below).

The shipped backend (`apps/backend`, `runBackend` from `@langwatch/process/backend-host`) runs the api
and the worker in one Node process, as `npx @langwatch/server` does; dev-runtime reuses the same host.

## A module's process half (record §3.2)

```ts
// modules/<name>/process/src/<name>.module.ts — the installer; the class is app/<name>.app.ts (§3.2)
export const <name>ProcessModule: PublishedProcessModule<"<name>", <Name>Api, <Name>ServerConfig> =
  defineProcessModule("<name>")
  .withRepositories(<name>Repositories)   // registry: { live, memory }
  .withChannels(<name>Channels)           // registry: { live, memory }; only if it has channels
  .withApi(<Name>Module)                  // the one class implementing <Name>Api
  .withTransports(<name>Rest, <name>Trpc) // inert declarations
  .withEventing(<name>Pipeline);          // only if the module owns events (§9)
```

No `.build()`; every `with*` result is installable. `index.ts` exports the
installer and transport declarations, **nothing else**. The installer is annotated
`PublishedProcessModule<name, Api, Config>` (`@langwatch/process`), an opaque type, so the module
class, repositories and generated database types never reach the emitted `.d.ts`; a test reads the
module through its Api, and boot still refuses a missing store by name. The installer lives in
`<name>.module.ts`, the module's identity (`modules/monitor/process/src/monitor.module.ts`); the
`<Name>Module` class lives in `app/<name>.app.ts` and stays thin, forwarding onto `services/`
held in private, `#`-prefixed fields, which carry the weight. `<Name>Module` never holds a
raw client, another service, or a peer's internals.

Folder grammar (linter-enforced): `services/` (one class per entity, never
opens a channel, never names a peer directly), `repositories/` (interface at
top; `prisma/` and `memory/` backends; only `repositories/prisma/**` names
Prisma, `PrismaRepository.for("Model")`, every project query carries
`projectId`; every ClickHouse query filters `TenantId` first),
`channels/` (messages to/from something the module does not own — bus, Redis
pub/sub, vendor HTTP, queue, email, Slack, SSE — one interface, per-tier
implementations, a memory twin, `{ live, memory }` registry), `eventing/`
(the pipeline, §9), `transport/` (declarations only, §8), `rules/` (pure, no
I/O). No `utils/`, `ports/`, `adapters/`, `composition/`, `lib/`, `helpers/`,
`domain/`. A raw client crosses into a module in exactly one place — the
`create(stores)` of one of its repository or channel registries, which the
container calls (record §3.2, §5). There are no members (§3.3).

## The four-way rule (record §3.3) — what a module may demand

1. **Derivable from supplied stores alone** → a repository or channel inside
   the module. No demand.
2. **Another module's capability** → a peer: the `*Api` token in
   `static dependencies`. The container resolves tokens; modules receive
   each other's implementations.
3. **A deployment fact** (signing key, base URL, admin list) → the module's
   declared config slice or secret handle (record §6); a process fact is a
   leaf the slice picks. Module code never reads `process.env`.
4. **An availability decision** (a capability this deployment may not have) →
   the module decides it from its own config and secrets, and its public
   config projects the answer to the browser. Off refuses by name with a
   stable code, or is a visible state; never a silent absence. Nothing
   outside the module answers it (no supply tokens; `.provide` survives only as a test stand-in
   for a channel-bound `*Api`, record §3.3).

A fifth shape is sanctioned for one case: a **channel bound to another module's `*Api`**
(`static readonly binds = { key: XApi }`, received as `bound.key` in the channel's `create`). It
is not a peer and adds no peer-cycles edge (record §5; `modules/analytics/process/src/channels/analytics.channels.ts`).

If a need does not fit one of the four, it is an architecture decision — stop
and say so; do not invent a fifth path (an optional constructor argument, a
`ports/` folder, a `refusing*` twin — all deleted spellings, record §15).

## Transports (record §8) — REST and tRPC are declared, never implemented

The **process mounts declarations; a module never mounts anything.** Listing
a declaration on `.withTransports(...)` is the whole act of publishing it —
no per-module mount file, no hand-assembled router. `boot()` opens the REST
family, the tRPC namespace and the SSE lane for every installed module's
role; auth binds the one API door from its own middleware bindings (record §4)
— a declaration names a permission, never a credential source.

```ts
// contract: declared once — name, kind, input, output
export const <name>Trpc = defineTrpcContract("<name>")
  .query("list").withInput(listInputSchema).withOutput(<name>Schema.array())
  .mutation("create").withInput(createInputSchema).withOutput(<name>Schema)
  .build();

// process: binds permission + handler to a name the contract already declared
export const <name>TrpcTransport = defineTrpcRouter(<Name>Api, <name>Trpc)
  .procedure("list").withPermission("<name>s:view")
    .handle(({ app, input }) => app.list(input))
  .procedure("create").withPermission("<name>s:manage")
    .handle(({ app, input }) => app.create(input))
  .build();

// REST: one complete endpoint per route; a single-response route declares withOutput,
// a multi-status route declares .responds(...) (see api-transports)
export const <name>Rest = defineRestRouter(<Name>Api)
  .withNamespace("<name>s").withVersion(MANAGEMENT_API_VERSION)
  .post("/", "create<Name>")
    .withInput(createInputSchema).withPermission("<name>s:manage")
    .withOutput(responseSchema)
    .handle(async ({ app, input, scope }) => ({ data: await app.create({ ...input, projectId: scope.id }) }))
  .build();
```

A handler reads `{ input, app, actor, scope, signal }`, calls exactly **one**
API operation, and returns a plain value or throws — no `c.json`, no manual
status branches, no error envelope, no `RestErrorHandler` (banned outright).
The wire name is the browser's React Query cache key: chosen once in the
contract, never respelled. The browser derives its client from the same
contract declaration (`ContractApiMap`) — never `AppRouter`, never a
hand-written map for a namespace the module owns.

## The worker role (record §4, §9)

The worker is the same chain with `server.container("worker")`, `server.run()` instead of
`serve()`, and a required retention classifier: `.boot({ classifyEventLogRetention })`
(`apps/worker/src/main.ts`). The role decides what `boot()` hosts: subscriptions, projections and
process managers instead of HTTP doors. The shipped backend starts both halves together (the api
answers at once while the worker upgrades); **shutdown drains the worker before closing the api
listener**, because worker consumers call back into the api's in-process graph.
Every eventing consumer registers **drain-first** on `server.graceful` — a
structural fact, not a convention someone could skip.

The worker also owns the upgrade: at boot, while the ledger is behind its image, its gate runs
the upgrade in-process (`runImageUpgrade`) under the runner's lease and takes no job until the ledger
is current; `pnpm task upgrade` is the run-once entry to the same code. The api
holds nothing and serves every route meanwhile (`upgrade` skill, UPGRADE-IN-WORKER, NO-HOLDS).

A module declares its whole pipeline once:

```ts
// record §9 (abridged); there is no .withJobs and no cron route
definePipeline({ name: "<name>", aggregate: defineAggregate({ type: "<name>" }) })
  .withEvents([<name>CreatedEventSchema]) // the contract's zod schemas
  .withCommand("create", Create < Name > Command) // validate → append
  .withPostgresProjection(<name>StateProjection) // worker-only
  .withEventSubscriber("name", { events: [TYPE], handler }) // worker-only
  .withProcessManager("retentionSweep", (pm) =>
    // worker-only
    pm.state(schema, initial).schedule({ everyMs }).onWake(wake).intent("pass", schema, run),
  )
  .build();
```

`boot()` translates the **same** declaration per role: api is
commands-only — projections, subscribers and process managers are
described for ops introspection but **never started** (§4),
and the role types the eventing requirement so a consumer cannot be
hand-wired into an api-role chain (a compile error, not a runtime mistake).
Worker semantics: delivery is at-least-once, so every subscriber must be
idempotent; ordering is per aggregate via the group queue, so one poisoned
aggregate retries with backoff without blocking its neighbours; projections
fold from the same ordered stream. A reaction to another module's event is a
`withPeerSubscriber` in the reacting module; it writes its own read-model row directly, and sends
its own command only when the reaction is a fact others react to (§9). Its edge runs
reactor → owner, so it closes no cycle. A subscriber follows
the same rules as any other process code.

## Creating a new process module, end to end

**Copy `modules/annotation`** — it is the shape reference. A spelling you
copy that record §15 lists is deleted: write its replacement, not the copy.

1. **Catalogue entry.** `modules/catalogue.json` gets `{ "id": "<name>",
"root": "modules/<name>", "classification": "core", "subjects": ["<name>"] }`.
   If the subject already belongs to a module, this is an extension, not a
   new module.
2. **Spec first**: `modules/<name>/specs/<name>.feature` — golden path plus
   every named failure as its own scenario (see Testing, below, for tagging).
3. **Contract** (`@langwatch/<name>-contract`): the `*Api` interface +
   `moduleApi<X>()` token, domain schemas, `<name>.trpc.ts`
   (`defineTrpcContract`), `<name>.errors.ts` (`HandledError` subclasses,
   stable `code`), and `<name>.config.ts` **only if** a deployment fact is
   needed (four-way case 3) — omit otherwise. Register each new error code in
   `packages/handled-error/src/app-codes.ts`, its customer copy in `presentation.ts` and its
   tip in `remediation.ts`, same change.
4. **Process** (`@langwatch/<name>-process`): repositories first (interface,
   `prisma/`, `memory/`, `defineRepositories({ live, memory })`), channels
   the same way if it talks to anything it does not own, then `services/`, then the `<name>.module.ts` installer above and the module class in
   `app/<name>.app.ts` (record §3.2, Alex 2026-10-05).
5. **`pnpm generate:modules`** regenerates `processModules` from the
   catalogue — no process file changes, no hand-written module list.
6. **The installation test** (below) proves the whole chain resolves over
   memory storage.

## The middle: how a backend change is tested

**Colocated `__tests__/`, beside the code — never a root `tests/` directory
next to `src/`** (record §13; a top-level `tests/` folder is the old shape and
a `module-review`-class finding). `.unit.test.ts` is pure logic or a service
over a memory repository; `.integration.test.ts` is still a **level**, not a
datastore marker: it proves several components together (a rendered component, a service
over a datastore, or a whole installed list over memory twins). Whether a file also needs
Postgres/ClickHouse/Redis is derived from whether it mentions one of those clients (the
`test:integration` script is that datastore lane), declared in the package's own `vitest.config.ts`. Describe blocks nest `given`/`when`; `it`
titles are action-based (`it("checks local first")`, never `it("should...")`).

The installation test boots the installed list over memory twins, with no
server (record §13): `bootInstalledProcess({ role, modules:
processModules.map(overMemory), config, secrets, ... })` over `memoryStores()`,
then `runtime.service(<Name>Api)`. A peer the test does not install is answered by
`testPeer({ token, instance })` from `@langwatch/process/testing`, passed as `peers: [...]`. Copy
`apps/api/src/__tests__/share-link-engine.integration.test.ts`. The older
`apps/api/src/__tests__/api-installation.fixture.ts` still builds with `createApp(...).withMembers(...)`
and `modules/monitor/process/src/app/__tests__/monitor-installation.unit.test.ts` with a
memory builder and `.provide`: that is conversion debt, not the pattern to copy.

Memory bundles need no datastore and no Docker, while peers still resolve
each other for real through the same tokens production uses — no test-only
spelling anywhere (never `withProvided`, never a per-store `with*` call).
`createApiFixture` builds a peer double that **throws on anything
unconfigured**, by name, rather than answering quietly — script every call a
test needs.

**A failure scenario enforces nothing until it is tagged and bound.** Tag
`@unit`/`@integration`/`@e2e`/`@regression` (`@unimplemented` exempts a
tracked-but-not-yet-done scenario); annotate the covering test with
`/** @scenario "<exact scenario title>" */` immediately before the
`it`/`test` call; run `pnpm --filter @langwatch/architecture-enforcer
check:feature-parity` and read the `✗ THIS RUN FAILS: ...` banner, not a
per-file `✓` (a `✓ all bound` is scoped to one file and can coexist with a
failing run). An untagged scenario binds nothing, and a new feature file that is wholly inert or
partly untagged fails the ratchet (`newInert`, `newPartial`). Sabotage once per changed behaviour: break the path, watch the
bound test fail for the stated reason, restore.

**Assert on `code`, never on message prose.** `message` is customer copy and
will change; use `code` equality (not `instanceof`) anywhere the error may
have crossed a process or serialisation boundary. See
`dev/docs/best_practices/error-handling.md` and record §12.

---

The record (`dev/docs/ARCHITECTURE.md`) is the authority; this skill only
points into it. Where the tree and this skill disagree during the renames in
flight, record §16 maps each target name to today's spelling: code keeps
today's spelling until its row lands, and §15 lists what is deleted.

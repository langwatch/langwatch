---
name: backend
description: "Everything on the Node side of a LangWatch module: composing a process (apps/api, apps/worker, apps/tasks), Server/createApp/boot, a module's process-half shape, the four-way rule for what a module may demand, declaring REST endpoints and tRPC procedures, the worker role (drain order, eventing pipelines, jobs, subscribers, at-least-once/per-aggregate-ordering), building a new process module end to end, and backend testing (colocated __tests__, installation tests through the createApp chain, spec-scenario binding, asserting on error code). Use whenever someone is: composing or wiring a process; writing or extending a module's process/ package; hitting a boot() refusal or a MissingSupply error; adding a REST route or tRPC procedure; adding a scheduled job, subscriber or projection; creating a brand-new module's process half; or writing/reviewing a unit or integration test for backend code."
user-invocable: true
argument-hint: "<question or backend task>"
---

# The backend

Read `dev/docs/ARCHITECTURE.md` first — this skill is a pointer into it, plus
the procedure. `@langwatch/process` is the Node runtime **and** the
process-half vocabulary: `Server`, `createApp`, `defineProcessModule`,
`defineRepositories`, `definePipeline`. An application (`apps/api`,
`apps/worker`, `apps/tasks`) is only `main.ts` + `config.ts` — everything else
lives in a module's `process/` package or in this framework. Full shape:
record §2, §4.

## `Server`, `createApp`, `boot()`

`Server.start` orders fatal handlers → secrets → config parse (under
telemetry, so a parse failure logs with the service name) → signals →
deadline. `/healthz` answers **during** boot.

```ts
const server = await Server.start({ name: "langwatch-api", config: apiConfig });
const stores = await openStores(server.config.stores, server.resources);
await createApp({ role: "api", server })
  .withModules(processModules)          // generated from modules/catalogue.json
  .withConfig(server.config.modules)
  .withStores(stores)                   // the one supply call — never per-store with*
  .withTransportAuth((a) => a.withStaticTokens({...}).withBrowserSession(session))
  .provide({ licenseSource })            // every declared supply token, one line each
  .boot();
await server.serve({ port: server.config.process.port, static: uiBundle() });
```

`boot()` (record §5): for each installed module — pick the repository tier
from supplied stores, validate `requires` against what was supplied (refusal
at boot, **by name**: `"webhook needs clickhouse; none supplied"`), build
repositories, resolve peers by token, slice config, call
`<Name>Module.create(...)`, then collect what the role wants (api → REST/tRPC/
SSE/command senders; worker → jobs/subscriptions/projections). An unsupplied
declared requirement is `MissingSupply<...>`, a **compile** refusal naming the
whole outstanding set — never a runtime fallback. The `processModules` list is
generated (`pnpm generate:modules`) from `modules/catalogue.json`; installing
a module edits the catalogue, never `main.ts`. **The root never grows** — a
change that needs it to grow found a gap in the primitives; report the gap.

Tasks (`apps/tasks`) takes the `Server` for telemetry/config, skips the
listener; graceful degenerates to run-to-completion. A test passes no server:
`createApp({ role: "api" })` registers nothing anywhere, and `boot()` returns
the runtime for the test to drive directly (see Testing, below).

## A module's process half (record §3.2)

```ts
// modules/<name>/process/src/<name>.module.ts — installer AND class, one file
export const <name>ProcessModule = defineProcessModule("<name>")
  .withRepositories(<name>Repositories)   // registry: { live, memory }
  .withApi(<Name>Module)                  // the one class implementing <Name>Api
  .withTransports(<name>Rest, <name>Trpc) // inert declarations
  .withEventing(<name>Pipeline);          // only if the module owns events (§9)
```

No `.build()`; every `with*` result is installable. `index.ts` exports the
installer and transport declarations, **nothing else**. The installer and the
`<Name>Module` class share this one file on purpose — the file is the
module's identity, and the class stays thin forwarding onto `services/`
(private, `#`-prefixed), which carry the weight. `<Name>Module` never holds a
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
`domain/`. A raw client crosses into a module in exactly one place — a
registry or channel factory's `create(members)`.

## The four-way rule (record §3.3) — what a module may demand

1. **Derivable from supplied stores alone** → a repository or channel inside
   the module. No demand.
2. **Another module's capability** → a peer: the `*Api` token in
   `static dependencies`. The process resolves tokens; a peer is never a
   member import.
3. **A deployment fact** (signing key, base URL, admin list) → the module's
   own declared config schema (record §6); the process values the slice.
   Module code never reads `process.env`.
4. **An availability decision** (a capability this deployment may not have) →
   a declared supply token the process answers with one `.provide({...})`
   line, or `boot()` refuses to compile. A module never defaults its own
   availability.

If a need does not fit one of the four, it is an architecture decision — stop
and say so; do not invent a fifth path (an optional constructor argument, a
`ports/` folder, a `refusing*` twin — all deleted spellings, record §15).

## Transports (record §8) — REST and tRPC are declared, never implemented

The **process mounts declarations; a module never mounts anything.** Listing
a declaration on `.withTransports(...)` is the whole act of publishing it —
no per-module mount file, no hand-assembled router. `boot()` opens the REST
family, the tRPC namespace and the SSE lane for every installed module's
role; auth is configured once, at the app level
(`withTransportAuth`) — a declaration names a permission, never a credential
source.

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

// REST: one complete endpoint per route, withInput/withOutput mandatory
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

The worker is **the same process file** with `role: "worker"` and
`server.run()` instead of `serve()`. The role decides what `boot()` hosts —
jobs and subscriptions instead of HTTP doors — nothing more. Boot order is
worker then api; **shutdown drains the worker before closing the api
listener**, because worker jobs call back into the api's in-process graph.
Every eventing consumer registers **drain-first** on `server.graceful` — a
structural fact, not a convention someone could skip.

A module declares its whole pipeline once:

```ts
export const <name>Pipeline = definePipeline("<name>")
  .withEvents(<name>Events)
  .withCommands({ create: createCommand })
  .withProjections({ <name>Summary })               // worker-only
  .withSubscribers({ on<Thing>Created })             // worker-only
  .withJobs({ retentionSweep: cron("0 3 * * *") });  // worker-only
```

`boot()` translates the **same** declaration per role: api is
commands-only — projections, subscribers and jobs are **never constructed**,
and the role types the eventing requirement so a consumer cannot be
hand-wired into an api-role chain (a compile error, not a runtime mistake).
Worker semantics: delivery is at-least-once, so every subscriber must be
idempotent; ordering is per aggregate via the group queue, so one poisoned
aggregate retries with backoff without blocking its neighbours; projections
fold from the same ordered stream. A reaction that needs another module still
names it as a peer `*Api` token (four-way rule case 2) — a subscriber follows
the same rules as any other process code.

## Creating a new process module, end to end

**Copy `modules/annotation`** — it is the shape reference and carries no
`feature-shape-baseline.json` entry. Translate any "server"/"web" spelling
you copy through record §16 as you go.

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
   `packages/handled-error/src/app-codes.ts` and its customer copy in
   `presentation.ts`, same change.
4. **Process** (`@langwatch/<name>-process`): repositories first (interface,
   `prisma/`, `memory/`, `defineRepositories({ live, memory })`), then
   `services/`, then the one `<name>.module.ts` installer+class file above.
5. **`pnpm generate:modules`** regenerates `processModules` from the
   catalogue — no process file changes, no hand-written module list.
6. **The installation test** (below) proves the whole chain resolves over
   memory storage.

## The middle: how a backend change is tested

**Colocated `__tests__/`, beside the code — never a root `tests/` directory
next to `src/`** (record §13; a top-level `tests/` folder is the old shape and
a `module-review`-class finding). `.unit.test.ts` is pure logic or a service
over a memory repository; `.integration.test.ts` is still a **level**, not a
datastore marker — whether it also needs Postgres/ClickHouse/Redis is derived
from whether the file mentions one of those clients, declared in the
package's own `vitest.config.ts`. Describe blocks nest `given`/`when`; `it`
titles are action-based (`it("checks local first")`, never `it("should...")`).

The installation test is the same chain production uses:

```ts
const runtime = await createApp({ role: "api" })          // no server: nothing to tear down
  .withModules([<name>ProcessModule])
  .withConfig({ <name>: {} })
  .withStores(memoryStores())                              // branded → memory tier everywhere
  .boot();
const api = runtime.service(<Name>Api);
```

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
failing run). Sabotage once per changed behaviour: break the path, watch the
bound test fail for the stated reason, restore.

**Assert on `code`, never on message prose.** `message` is customer copy and
will change; use `code` equality (not `instanceof`) anywhere the error may
have crossed a process or serialisation boundary. See
`dev/docs/best_practices/error-handling.md` and record §12.

---

The record (`dev/docs/ARCHITECTURE.md`) is the authority; this skill only
points into it. Where the tree and this skill disagree during the renames in
flight, record §16 maps old spellings to the target ones — trust the table,
not what is on disk.

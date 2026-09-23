# LangWatch Architecture

**The one record.** Ruled 2026-09-17/18. Every other architecture document is
deleted or points here. When this document and a lint rule disagree, the rule
is the truth and this document is the defect — fix the document, never code to
it. On conflict between sections, the more specific wins.

---

## 1. The product

Four Node processes and three Go services:

| Process               | Package                   | What it is                                      |
| --------------------- | ------------------------- | ----------------------------------------------- |
| `apps/ui`             | `@langwatch/ui`           | The browser application (Vite SPA)              |
| `apps/api`            | `@langwatch/platform-api` | tRPC + REST + SSE, serves the browser bundle    |
| `apps/worker`         | `@langwatch/worker`       | Queues, schedulers, projections, subscribers    |
| `apps/tasks`          | `@langwatch/tasks`        | One-shot migrations and backfills               |
| `services/aigateway`  | Go                        | Virtual-key data plane (Bifrost fan-out)        |
| `services/nlpgo`      | Go                        | Optimization-studio executions and evaluators   |
| `services/langyagent` | Go                        | Langy conversation manager (pi harness workers) |

**Applications hold no product code.** The product lives in modules. An
application is a `main.ts` and a `config.ts`; everything it used to carry —
transport hosting, static serving, error formatting, lifecycle, signals,
listeners, per-domain compositions, features trees — belongs to the framework
packages below.

**The same code runs everywhere.** One `main.ts` per app, byte-identical
across laptop, CI and production. Only the parsed environment differs. There
is no dev-only branch anywhere in an app, because an app has nowhere to put
one.

---

## 2. The package family

Named by one rule: **where the code runs, or what it declares.**

|          | core                | runs + declares      | reads                       | wire                      | shares               |
| -------- | ------------------- | -------------------- | --------------------------- | ------------------------- | -------------------- |
| **Node** | `@langwatch/module` | `@langwatch/process` | `@langwatch/process-stores` | `@langwatch/api`          | contracts            |
| **Web**  | `@langwatch/module` | `@langwatch/browser` | `@langwatch/browser-host`   | `@langwatch/browser-trpc` | `<name>-browser-kit` |

The core is a contract's only framework import and is incredibly light;
each runtime owns the declaration vocabulary for its own half, so weight is
imported the rest of the way down, never from the top.

- **`@langwatch/module`** — the light core, and ONLY what a contract needs:
  the `moduleApi` token factory, supply tokens, module ids. Zod-only,
  framework-free, browser-safe, near-zero weight. Every contract depends on
  it; it depends on nothing but zod. The heavy declaration vocabulary is NOT
  here — it lives in the runtime that consumes it, so nothing backend-shaped
  ever enters a contract's (or the browser's) graph from the top.
- **`@langwatch/process`** — the Node runtime AND the process-half
  vocabulary: `Server` (signals, fatal handlers, ordered teardown, hosted
  components, `/healthz`, `/metrics`), `GracefulShutdown`, `createApp` with
  the whole supply chain, boot and transport hosting — plus
  `defineProcessModule`, `defineRepositories`, `FeatureSetup`,
  `definePipeline` and the channel registry types. A module's process half
  imports its vocabulary from the thing that installs it. Depends on
  `module`.
- **`@langwatch/process-stores`** — materializes storage from config:
  `storesConfig(modules)`, `openStores`, `memoryStores`. The only package
  that opens Prisma, ClickHouse or Redis clients for a process.
- **`@langwatch/api`** — the server transport framework: `defineRestRouter`,
  `defineTrpcRouter`, doors, auth peers. Never enters a browser graph.
- **`@langwatch/browser`** — the browser runtime AND the browser-half
  vocabulary: `createUi`, the browser supply, `render`, plus
  `defineBrowserModule`. Used by `apps/ui` and every module's browser half.
- **`@langwatch/browser-host`** — the capabilities a screen reads: session,
  navigation, storage, feature flags, toasts, slots, **drawers**. The browser
  analogue of the closed members. Capabilities only — components live in the
  design system or in kits.
- **`@langwatch/browser-trpc`** — the browser's wire: the derived tRPC
  client, batching, the SSE subscription link. All of it is tRPC-derived;
  the browser calls no REST.
- **`@langwatch/design-system`** — components (Chakra v3 underneath; nothing
  imports Chakra directly).
- Support packages: `handled-error` (the error contract), `secrets`
  (ADR-132), `config` (generic config machinery), `observability` (logger +
  OTel), `test-harness` (fixtures and doubles), `installed-modules`
  (generated lists — never edited by hand), and the raw clients
  (`prisma-client`, `clickhouse-client`, `redis-client`, `eventing`).

A package earns existence by being framework, not feature. Feature code in
`packages/` is a defect. The boundary is prefix-checkable: nothing `browser-*`
in a server graph; no `process*` package in a web graph.

---

## 3. A module

A module is one folder owning up to four workspace packages.
`modules/catalogue.json` maps every subject to exactly one owning module.
Enterprise modules mirror the shape exactly under `enterprise/modules/`.

```
modules/trace/
├── feature.json · specs/ · adrs/
├── contract/       @langwatch/trace-contract       shared by everyone
├── process/        @langwatch/trace-process        the half createApp installs
├── browser/        @langwatch/trace-browser        PRIVATE — the half createUi installs
└── browser-kit/    @langwatch/trace-browser-kit    the ONLY thing other browsers may import
```

**Dependency direction, no exceptions:** apps → `*-process`/`*-browser` →
`*-contract`. Browser never imports process; process never imports browser;
contract imports no framework and no other half. Another module imports only
the owner's **contract** and names the owner's `*Api` token; nobody imports
another module's service, repository, or browser package.

### 3.1 The contract

Zod schemas with `infer`, portable types, `HandledError` subclasses with
stable codes, the tRPC declarations (`defineTrpcContract`: every procedure's
name, kind, input, output, declared once), **the module's config schema**
(§6), and the callable API:

```ts
export interface TraceApi { ingestSpan(...): ...; getById(...): ...; }
export const TraceApi = moduleApi<TraceApi>("trace");
```

### 3.2 The process half

```ts
// modules/trace/process/src/trace.module.ts — the installer
export const traceProcessModule = defineProcessModule("trace")
  .withRepositories(traceRepositories) // registry: { live, memory }
  .withApi(TraceModule) // the one class implementing TraceApi
  .withTransports(traceRest, traceTrpc) // inert declarations
  .withEventing(tracePipeline); // §9
```

No `.build()`: every `with*` result is installable. `index.ts` exports the
installer and transport declarations, **nothing else**. The installer and the
`<Name>Module` class share `<f>.module.ts` — the class is thin forwarding
(services carry the weight), and one file is the module's identity.

**`TraceModule`** is the implementation of `TraceApi`: `static contract`,
`static dependencies` (peer tokens), private constructor,
`static create(setup)`. Services and peers are `#private`; the public surface
is exactly the API's operations. The word "App" is retired inside modules.

The internal grammar (enforced by the linter — the grammar file, not this
document, is the authority on filenames):

- `services/` — one class per entity over repository interfaces. A service
  never opens a channel and never names a peer API.
- `repositories/` — interfaces at the top; `prisma/` and `memory/` backends
  below; the registry offers both via `defineRepositories({ live, memory })`.
  Only `repositories/prisma/**` names Prisma, through
  `PrismaRepository.for("Model")`; every project-model query carries
  `projectId`. Every ClickHouse query filters `TenantId` first.
- `channels/` — messages to or from anything the module does not own (bus,
  Redis pub/sub, HTTP vendor, queue, email, Slack, SSE): one interface per
  subject, per-tier implementations, a memory twin each, a registry offering
  `{ live, memory }`. Repository = owned state; channel = unowned messages;
  service = behaviour over both.
- `eventing/` — one folder: the pipeline and everything it names (§9).
- `transport/` — declarations only (§8).
- `rules/` — pure functions and constants; no clock, no I/O.
- No `utils/`, `ports/`, `adapters/`, `composition/`, `lib/`, `helpers/`,
  `domain/`.

**An implementation never sees a raw client.** No prisma, no redis, no
clickhouse in any `*Module` class. Raw clients cross into a module in exactly
one place — a registry or channel factory's `create(members)` — and arrive as
repositories and channels.

### 3.3 What a module may demand — the four-way rule

A module cannot build what needs process information, because it does not
have it: deployment, availability, credentials and base URLs are the
process's knowledge. Every dependency a module has resolves into exactly one
of:

1. **Derivable from supplied stores with no extra info** (a tenant resolver
   over ClickHouse, an actor lookup over Prisma) → a repository or channel
   **inside the module**. No demand exists.
2. **Another module's capability** → a peer: the `*Api` token in
   `static dependencies`. The process resolves tokens; modules receive each
   other's implementations. A peer is never a member.
3. **A deployment fact** (signing key, public base URL, admin list) → the
   module's **declared config schema**; the process values the slice. Module
   code never reads `process.env`.
4. **An availability decision** (a capability this deployment may not have) →
   a **declared supply token** the process answers with one `.provide({...})`
   line — or the seam dies with the dead capability. A module never defaults
   its own availability.

### 3.4 The browser half and the kit

`trace-browser` layers: flat public entries → `model/` (pure) → `behavior/`
(hooks, api bindings, stores) → `ui/elements|blocks|sections`. Elements and
blocks cannot fetch. The tRPC client is derived from the contract's
declarations (`browser-trpc`), never hand-written, never from a router type.
A screen reads no session or router directly: it declares a `*HostApi` the
shell implements from `browser-host` capabilities. The half is declared with
`defineBrowserModule` — screens, drawers, publications, mounts, flags — and
exported at `./declaration`; the generated `browserModules` list installs it.

**One layout, nested** (ruled 2026-09-18). Those layers are the whole
vocabulary. A package that outgrows one `ui/sections/` folder does not invent
a layer, it nests — and a feature is the same shape again, one level down:

```
modules/ops/browser/src/
├── ops.web.ts                  the declaration — the only export (below)
├── model/                      what EVERY feature here shares, and no more
├── behavior/                   likewise: crosses features, or it moves down
├── ui/elements|blocks|sections
└── features/
    ├── queue/                  a feature owns its whole stack
    │   ├── model/
    │   ├── behavior/           queue's hooks live HERE, not in the bucket above
    │   └── ui/elements|blocks|sections
    └── foundry/                same shape, again
```

Behaviour belongs to the feature that owns it, never to a package-wide bucket
every feature reaches into — that bucket is how `behavior/` became a junk
drawer in the packages that have one. A feature that is one component is a
section, not a feature.

**A browser package exports `./declaration` and nothing else** (ruled
2026-09-18):

```jsonc
// modules/trace/browser/package.json — after. One entry, and this is its
// full shape: the declaration source is what the generator reads.
"exports": {
  "./declaration": {
    "langwatch-declaration-source": "./src/trace.web.ts",
    "types": "./dist/trace.web.d.ts",
    "default": "./src/trace.web.ts"
  }
}

// before: 35 entries, 29 of them side doors
"exports": {
  "./declaration":            { /* … */ },
  "./surfaces/trace-filters": { /* … */ },   // ← scenario imported this
  "./surfaces/conversation":  { /* … */ },   // ← and this
  "./surfaces/trace-id-peek": { /* … */ },   // ← and 17 more like it
  "./screens/traces":         { /* … */ }
}
```

Rule 4 below stops a KIT being a subpath; nothing stopped an OWNER growing
them, and that is the hole the tree fell through — 23 packages opened
`./surfaces/*` entries and 626 cross-module import lines walked in, none of
them a dependency-graph edge any baseline could hold. The exports map IS the
enforcement: what is not exported cannot be reached, so closure is structural
rather than a lint the next refactor forgets. Rule 1 never needed a new rule,
only a door that shuts. `surfaces/` and `screens/` are deleted spellings
(§15), and a kit answers the same way with one entry:

```jsonc
// modules/trace/browser-kit/package.json
"exports": { ".": "./src/index.ts" }   // no subpaths: inside a kit is unreachable
```

**The kit law** — each rule earned by a measured failure:

1. **`trace-browser` is closed.** Nothing else imports it, ever. The moment
   another module needs a trace hook, store or component, that thing moves to
   `trace-browser-kit`. Sharing is declared by moving, never observed by
   reaching in.
2. **A kit is a leaf.** It may import contracts (any module's),
   `design-system` and `browser-host`. It may not import its own module's
   browser package (the rule that broke the nine cyclic web pairs), any other
   `*-browser`, or another kit.
3. **A kit fetches nothing.** No project-scoped queries, no `browser-trpc`.
   Presentational components, pure hooks, shared stores; consumers wire the
   data (the model-selector ruling: the kit takes `options/value/onChange`,
   each consumer runs its own query).
4. **A kit is a package, not a subpath** — a subpath is invisible to the
   dependency graph, so it cannot break a cycle or be budgeted. A package
   makes every cross-module browser edge a visible, lintable manifest line.
5. **A kit exists only where sharing is real** — three or more consumers. One
   consumer is not enough to MINT a kit: that is bilateral coupling, and the
   answer is to inline or duplicate it. The published tier is shrink-only.
   (What an already-existing kit may hold is rule 6.) **Amended 2026-09-18:**
   three is the default, and two consumers mint a kit where the alternative is
   duplicating a large surface. The case that forced it: `suite` is reached
   for by two consumers across 56 import lines — run cards, dialogs,
   formatters, history store, form and pickers. Dissolving that copies six
   surfaces twice to honour a number. The floor exists to stop premature kits,
   not to force copy-paste where sharing is plainly already real. One consumer
   is still never enough, and two with a thin surface still dissolves.
6. **The floor gates a kit's EXISTENCE, not its contents** (ruled 2026-09-18).
   Once a kit is warranted and exists, it may hold a symbol with one consumer;
   creating a NEW kit still needs three. The case that forced the ruling: all
   three legs of the `agent -> scenario -> workflow` browser cycle bottom out
   in one React component or context with exactly one external consumer —
   below the floor, and not contract-portable because a contract imports no
   framework. Reading the floor as gating contents left the cycle with no
   sanctioned fix at all. A cycle is broken by moving that symbol into the
   owner's existing kit; where the owner has no kit, the three-consumer rule
   decides whether one is warranted, and if it is not, rule 5 still applies.
7. **Owner UI that fetches is lent, not copied** (Alex, 2026-09-23). When another
   module needs a component that fetches its owner's data (presence, annotation,
   share, trace's own surfaces), the owner publishes it through its declaration's
   `withCapabilities` slot, as `joinOffer` does, and the consumer renders what it is
   handed. The owner keeps its UI and its data; rule 5's duplicate is for thin,
   non-fetching surfaces only.

---

## 4. A process, whole

```text
apps/api/src/main.ts                 # process declaration, at most 50 lines
apps/worker/src/main.ts              # same graph, consuming pipelines
packages/api/src/hosting/            # HTTP mux, API hosts and browser bundle
packages/api/src/policy/             # headers, CSP and client address
packages/process-server/src/         # boot, lifecycle and peer composition
```

The application declares what it serves through `exposeTransports`.
Framework classes implement hosting, and process composition resolves their
peer dependencies. Authentication policy stays in the API runtime; wiring
installed peer APIs into that runtime belongs to process composition. This
keeps transport machinery out of `main.ts` without making the API framework
import the feature implementations which depend on it.

There is no app config file (ruled 2026-09-18): config comes from the
installed server modules' own declared schemas, composed by the generated
parse (§6). A hand-maintained per-app config module is a defect.

```ts
// apps/api/src/main.ts
import "@langwatch/time/polyfill";
import { serverModules as processModules } from "@langwatch/installed-modules/server";
import { processTelemetry } from "@langwatch/observability/node";
import { processConfig, Server } from "@langwatch/process-server";

const server = await Server.create("langwatch-api")
  .withConfig(processConfig(processModules))
  .withSecrets((config, secrets) =>
    secrets.withEnv().withFile().withOnePassword(config.process.onePasswordAccount),
  )
  .withTelemetry(processTelemetry("langwatch-api"))
  .start();

const app = await server
  .composeProcess("api")
  .withModules(processModules)
  .exposeTransports((transports) => transports.trpc().rest().browserBundle())
  .withPipelines((pipelines) => pipelines.produce())
  .boot();

await server.serve(app);
```

```ts
// apps/worker/src/main.ts — the whole difference
const app = await server
  .composeProcess("worker")
  .withModules(processModules) // SAME module graph: apps install fully, jobs call them in-process
  .withPipelines((pipelines) => pipelines.consume()) // consumers, jobs, process managers
  .boot();

await server.run(app);
```

**Transport selection and pipeline participation are separate fluent APIs.**
`exposeTransports` exists only on the API builder. Its callback selects
`.trpc()`, `.rest()` and `.browserBundle()`, plus `.framedDocument({ path,
document })` for a module-built document that answers on the app origin
under the sandbox frame policy (a fresh nonce per answer, its own CSP, never
the app's); it carries no members, logger, stores, credentials or paths. Required slots derive from the installed
module declarations: an omitted declared transport refuses boot by name.
The bundle is explicit, including an explicit opt-out for deployments
without one. Both processes use `withPipelines`: the API's callback offers
`produce()`, the worker's offers `consume()`. Pipelines are never exposed as
HTTP surfaces. Consumption includes command production for follow-up work.
Each process entry point and its surface declaration stay within 50 lines;
framework implementations retain the code needed to preserve behaviour.

**The HTTP boundary is API versus browser bundle.** The host knows two
paths, `/api` and `/`. The API package owns the fixed tRPC prefix
`/api/trpc`, REST paths under `/api`, and the existing `/api/sse` subscription
lane. Apps select transports without repeating or configuring these paths.
The `api` value below is the framework's assembled transport surface, with
all installed declarations mounted and API authentication resolved.

```ts
const bundle = BrowserBundle.create({
  dist,
  publicConfig,
  sessionReader,
  security: SecurityHeaders.strict().withContentSecurityPolicy(csp),
});

const http = HttpMux.create()
  .use(ClientAddress.fromTrustedProxies(trustedProxies))
  .use(SecurityHeaders.strict())
  .route("/api", api)
  .route("/", bundle);
```

These are framework construction sites, not additional application code.
`HttpMux` owns middleware and routing; separate `ApiForward` and
`RequestPreamble` wrappers would duplicate those responsibilities.
`BrowserBundle`, `ClientAddress`, `SecurityHeaders` and
`ContentSecurityPolicy` are named classes. The canonical implementation
lives in `@langwatch/api` hosting/policy code, not duplicate app directories.
Hono remains internal to hosting; the public boundary accepts request
handlers and named classes, never Hono routers.

**Longest matching path prefix wins, independent of registration order.**
Matching respects segment boundaries: `/apiary` belongs to the bundle.
`/` is an ordinary route. Unknown paths inside `/api` remain API 404s and
never fall through to the bundle. Hashed assets are immutable; a missing
asset returns 404 rather than the SPA shell. Other browser document paths
resolve to the shell with its public config injected.

**Transport mounts consume their prefix once.** Public URLs remain stable;
inside the tRPC mount, `/api/trpc/getBatch` routes as `/getBatch`. A REST
version mount can route `/api/v1/roles` as `/roles`; version selection stays
with the REST host, preserving dated versions and existing aliases. Module
handlers never strip prefixes themselves. Routing uses a relative path
while retaining the original request URL for signature checks, auth
callbacks, redirects, audit and logging. Reading a request body or resolving
a session twice to achieve this boundary is prohibited. Existing absolute
route declarations must be adapted with parity coverage before the mount
starts consuming their prefix.

**Common security policy applies to every response.** Trusted-proxy handling
resolves the caller IP once from the socket and configured forwarding trust,
then all transports use that answer. Forwarded headers from untrusted peers
do not establish identity. The shared security headers cover successful
responses, 404s, redirects and failures in the preamble itself. Error
presentation follows the selected prefix: canonical JSON for API failures,
a self-contained HTML error page for bundle failures. An error page never
re-enters the failing bundle loader.

**Headers remain explicit, fluent policy values.** The HTTP host supplies
`SecurityHeaders.strict()` as the common floor; transport and bundle
construction accepts overlays. `with` and `merge` add or override named
headers, and `without` explicitly removes one. Bare transport selectors use
`trpcSurfaceDefaults()`, `restSurfaceDefaults()` and
`browserBundleDefaults()`; optional policies extend those defaults. Parsed
config determines production HSTS, document CSP and allowed asset/storage
origins. These settings do not require threading auth or store bags through
the process declaration.

**API owns transport authentication and authorization.** tRPC uses verified
browser sessions; REST uses API credentials. Endpoint exceptions belong to
the declaring module, including public routes and module-owned internal
bearers. Neither the main nor a surface declaration receives bearer maps or
constructs credential services. Tests can supply verifier doubles at the
owning service boundary.

**The bundle shares the API session reader.** It reads the verified caller
for document requests only, never for assets. A document access policy can
use that caller to admit or redirect before rendering, including a private
instance gate. The default shell remains public so sign-in can be reached;
reading a session alone is not access enforcement. Public config projection
receives the caller without exposing credentials to the browser.

**`Server.create` ordering is the point:** fatal handlers first (raw stderr
until a logger exists) → owner-declared config parses → the secrets reader
is constructed from that config → telemetry initializes → signals wired,
deadline armed. Config failures retain the process name in their report. `/healthz` answers **during** boot, not after.

**The server threads through `boot()`.** `createApp` takes it as a
dependency; `main.ts` never touches lifecycle:

- The assembled router (every declared REST family, tRPC namespace, SSE lane)
  registers as a server component with the server's logger and readiness — a
  draining door refuses new work by name.
- Each transport host registers its own drain phase on `server.graceful`
  (stop accepting → finish in-flight → close). No app ever writes a shutdown
  phase.
- Eventing consumers (role worker) register drain-first — which makes "the
  worker drains before the api's graph closes under it" a structural fact.
- Module services start in dependency order; teardown registers in reverse.

|                    | knows about                                                 |
| ------------------ | ----------------------------------------------------------- |
| `main.ts`          | the config schema and the chain — no lifecycle, no hosting  |
| `createApp`/`boot` | what modules declared, and how to register it on the server |
| `Server`           | signals, phases, deadline, `/healthz`, `/metrics`, serve    |

**The Server chain is fluent and speaks in named factories** (settled
2026-09-18, superseding the same day's generic-`.with(component)` phrasing).
Health is **built in and on by default**: `Server.create({..., healthPort })`
opens the one HTTP door, `/healthz` answering during boot. The preamble names
its concerns — `withSecrets`, `withConfig`, `withTelemetry`, `withMetrics`,
then `start()` — while every ARGUMENT is a named factory from the owning
package, which is where the vocabulary lives. After `boot()`, `serve(app)`
composes the hosting dispatch and policy middlewares (§4 above: proxy remap,
base security headers) and sends `/api/**` through to the api package.
`prometheusMetrics({ token })` comes from `@langwatch/observability` (so an
OTel export variant can sit beside it without any main changing shape).
**Telemetry initializes immediately after the config parse** (ruled
2026-09-18): one named call, `initializeTelemetry(process.observability)`,
wires traces, logs and metrics from config alone — no `instrumentation.node`
preload file, and anything requiring preload is out of scope by design.
**Metrics transport is a binary knob**, `process.observability.metrics.mode:
"prometheus" | "otlp"` — absent means `prometheus` so no self-hosted scrape
setup breaks on upgrade; LangWatch production sets `otlp` (a push is
cheaper than a scrape at our cardinality). Under `otlp` the scrape endpoint
is NOT mounted, and composing `prometheusMetrics` refuses by name — an
unmounted endpoint is honest, a mounted-but-empty one lies to a prober.
Traces and logs compose through the `langwatch` SDK's own observability
setup where its API fits — the platform dogfoods its SDK.
`hostedMembers(stores)` from process-stores, `hostedRuntime({ name, runtime,
drain })` from the process package. A raw `{ name, start, stop }` object
literal at a call site is banned — if a component has no spoken factory,
write the factory. Transport/route discovery is likewise built in at the
layer that owns the route table (`boot()`/the api package), never a module.

The HTTP host composes the two routes and shared middleware described above.
Boot resolves transport dependencies and mounts module declarations before
serving. Auth verifiers are constructed by their owner from declared config
and secrets; the process entry point supplies neither credentials nor
transport internals.

**Deployment-choice modules are one line in the main.** The audit sink is
the worked example: OSS composes `auditLogNullServer` (records nothing),
an enterprise deployment swaps in its real module — one `.withModules`
line, no conditional wiring.

**The worker** is the same file with `role: "worker"` and `server.run()`
instead of `serve()`. The role decides what `boot()` hosts: jobs and
subscriptions instead of HTTP doors. Liveness/metrics is a built-in Server
component. Its pipeline declaration selects consumption, and shutdown drains that work
before closing the services and stores it uses.

**Tasks** takes the Server for telemetry and config, skips the listener;
graceful degenerates to run-to-completion. Migrations are tasks (§7).

**A test passes no server** — `createApp({ role: "api" })` registers nothing
anywhere; `boot()` returns the runtime and the test drives `start`/`stop`.

---

## 5. What boot() does — the translation

```
withModules(processModules)
  │  collect installers, order by peer dependencies (tokens, never imports)
  ▼  for each module:
  1. pick the repository tier from the supplied stores (§7)
  2. validate the chosen factory's requires against what was supplied
     — refusal at boot, BY NAME ("webhook needs clickhouse; none supplied")
  3. build repositories:  live.create({ prisma, clickhouse, encryption })
  4. resolve peers: each token → the implementation built earlier in the order
  5. slice config: config.<name>, already validated by the module's own schema
  6. TraceModule.create({ repositories, dependencies, config, supplies })
  7. collect what the module declared for THIS role:
        role api    → REST families + tRPC namespaces + SSE + command senders
        role worker → jobs + subscriptions + projections + process managers
  ▼
register everything on the server; return the runtime
```

`boot()` takes no arguments beyond what the chain supplied and is **callable
only when everything the installed modules declared has been supplied**. An
absent supply is a compile refusal — `MissingSupply<...>` names the whole
outstanding set at once — never a runtime fallback, never a logged absence,
never an absence class.

**The vocabulary is dependencies, in two kinds** (ruled 2026-09-18; the
"members" wording above is the interim spelling and dies with the kernel).
**Process dependencies** are global — `prisma`, `clickhouse`, `redis`,
`logger`, `clock`, `rateLimiter` — one instance for the whole process; if a
process uses Prisma it uses it everywhere. **Module dependencies** are what
only that module needs. A module **registers** process dependencies by name
(strings: `registerProcessDependencies`); the app **adds** them as objects
(`addProcessDependencies`); `createProcessApp(role, config)` resolves both
kinds from config. The code override also comes in two, one per kind —
`withProcessDependencies({...})` and `withModuleDependencies({...})` (exact
spellings settle with the wave) — and an override always takes precedence
over what config resolved. Delivery is **registry-based**: a module declares what it needs
or supports in a registry (the `defineRepositories({ live, memory })`
pattern generalised — the module says "for this I support these", the app
chooses which), and every `create()` **arrives with its things already
resolved**. Passing a hand-assembled composition object into anything is
banned as a shape — nothing receives a bag it has to pick apart.

**The application half extends `ProcessModuleApp`** (ruled 2026-09-18) —
the base class in `@langwatch/module` that carries the declaration statics,
the setup-type inference and the graph contract. The name says all three
words on purpose: the **app** of the **module**'s **process** half — the
module also has a browser half this class has nothing to do with. The
class keeps its `<Name>App` name: "module" stays reserved for the whole
`{contract, process, browser}` unit. Both dependency declarations
are **string tuples** against a closed vocabulary — the process names, and
the generated module-name map — so a typo is a compile error and `create()`
receives exact typed picks. The graph resolves transitively (a dependency's
dependencies are its own business — only its API travels), cycles refuse at
boot by name, and an instance bound at create may not be invoked until
after boot.

**Registry resolution ends at `ModuleApp.create`.** Inside the module,
`create()` is the composition root: internal services are built explicitly
— `LicensingCapService.create({ prisma: process.prisma, graceDays:
config.graceDays })` — each receiving the narrowest slice that answers its
question. Internal services never declare dependencies and are never
auto-built; a `create()` that gets painful is a module doing too much, not
a reason for a container.
A factory under `repositories/` or `services/` that assembles collaborators is
composition in the wrong folder: it moves into `create()`, and another process
reaches the module through its API, never through its factories (2026-09-23).

The `processModules` list is generated from `modules/catalogue.json`
(`pnpm generate:modules` → `@langwatch/installed-modules`). **Installing a
module edits the catalogue, never a root.** A process composes the whole
list in one call — `server.composeProcess(role).withModules(serverModules)` —
and that is also the cheap shape: one call over all 49 modules costs ~88k type
instantiations, where the ten-step chunked chain it replaced cost 11.3M.
Instantiation cost grows with the length of the chain, not the size of the
list, because each `withModules` re-instantiates the accumulated type. Do not
split the list to appease TS2589. Uninstalling a module that another module
peer-depends on fails to compile, naming the dependent.

**The root never grows.** A change that needs it to grow has found a gap in
the primitives; report the gap, never widen the root.

---

## 6. Config

**Every value is declared at its owner; the parse is generated; apps hold no
config file** (settled 2026-09-18 — this section replaces every earlier
iteration).

```ts
// modules/github/contract/src/github.config.ts — the declaration, in the contract
export const githubConfig = Config.define((c) => ({
  appId: c.env("GITHUB_APP_ID", z.string().optional()),
}));
export const githubSecrets = {
  privateKey: Secret.load("GITHUB_APP_PRIVATE_KEY", { optional: true }),
} as const;
export type GithubConfig = ConfigOf<typeof githubConfig>;

// modules/github/process/src/app/github.app.ts — the process half attaches them
static readonly config = githubConfig;
static readonly secrets = githubSecrets;

// apps/api/src/main.ts — the app's entire involvement
const server = await Server.create("langwatch-api")
  .withConfig(processConfig(processModules))  // the installed list IS the schema
  .withSecrets((config, secrets) => secrets.withEnv().withFile())
  ...
```

**The declaration lives in the contract; the process half attaches it and the
browser half projects from it** (ruled 2026-09-18). All three halves read one
declaration rather than each writing their own:

- **contract** — `<name>.config.ts` holds the config slice (one
  `Config.define`, whose `c.env` leaves), the secret handles (`Secret.load`), the inferred `ConfigOf<…>`
  type, and the browser projection schema plus its `project` function. This
  is the only file that names an environment variable.
- **process** — the App class attaches them as `static readonly config` and
  `static readonly secrets`; `create()` receives the parsed slice and a
  scoped `secrets`, and resolves through `secrets.into(handle, build)`.
  Nothing in the process half names an env var or re-declares a schema.
- **browser** — `defineBrowserModule` validates the contract's projection
  slice before first render; the browser never sees a handle or a leaf.

A module with no deployment facts declares neither and contributes no root
key. Framework owners (process-server, stores, observability) declare the
same way at their own package, which is why they are not module-shaped.

**You write the schema yourself and attach it where you define the module**
(ruled 2026-09-18). Both halves work the same way: defining the process
module or the browser module takes a hand-written Zod schema, and the
schema itself carries the validation, the environment reading and the
parsing — nothing else defines anything. In the app you read the modules
you installed and pull the schemas back out. That is the whole mechanism:
no generated config map, no registry, no defineProcessConfig ceremony;
inference flows from the module array itself, so a field added on a schema
appears everywhere with no other edit. Framework-owned values follow the
same rule at their owning package (the server's port and shutdown deadline
on the process package, store connections on the stores config,
observability on its own). There is no per-app config file — a `config.ts`
in an app is a defect. **The pre-existing config machinery is deleted, not
migrated** (ruled 2026-09-18): RuntimeConfig definitions, the contract
`*ConfigDefinition` files, the generated config map and both app config
files all go; the compiler enumerates the fallout and this section is what
replaces them.

**One environment variable has exactly one owner** (ruled 2026-09-18). The
parse refuses a second claim by name — `"BASE_HOST" is declared by "process"
and "platform-health"` — and the process does not boot. The owner that
declares a value passes it down; nobody re-declares it to get a copy.

This is what makes **a process fact not a module fact** enforceable rather
than advisory. Two worked cases, both declared once on the process owner
(`packages/process-server/src/owner.ts`) and handed to every module as a
member:

- `BASE_HOST` → the `publicBaseUrl` member (optional; blank and absent both
  mean the deployment named none). The eight modules that link back to the
  product read it; none names the variable.
- `NODE_ENV` → the `nodeEnvironment` member, carried as the raw string. The
  `http` owner no longer declares it either — it **derives** `production` from
  the process slice, because a derived value is not a second claim. A module
  wanting a boolean derives it the same way.

The same holds for `processName` and anything else the process, not the
deployment's module, knows.

When the single owner is a **module** rather than the process, it passes the
value down as a capability on its own `*Api`, never as a shared variable and
never as a member the composition has to remember (ruled 2026-09-18):

- `PASSKEYS_ENABLED` is auth's. `user` asks `AuthApi.offersPasskeys()`.
- `DEMO_PROJECT_ID`/`DEMO_PROJECT_USER_ID` are authz's. `organization` asks
  `AuthzApi.demoProject()`, beside the `isDemoProject` it already answered.

This is the four-way rule's second way, and it is why a config fact two modules
both want is not evidence that the fact should be process-wide — it is usually
evidence that one of them owns it and the other should be asking.

Note the two member vocabularies, which are not interchangeable: `reads(...)`
from `@langwatch/process-stores/members` is a **closed** list of the fourteen
store members, so `reads("publicBaseUrl")` is a compile error on purpose. A
module reading anything else declares the raw literal
`static readonly reads = ["prisma", "publicBaseUrl"] as const` and restates
the member shapes in its own `Readonly<{…}>` type — a module depends on
contracts, never on the stores package's types. `modules/platform-health` and
`modules/project` are the exemplars.

**`configSchema` is deleted, not migrated** (ruled 2026-09-18). The legacy
static — an App-level Zod schema re-parsed per feature and fed by the deleted
`apps/api/src/config.ts` — held four different kinds of thing at once, and
only the first is config: a module deployment fact (→ the contract slice), a
process fact (→ the owning process, drilled as a member), an availability
decision (→ a declared supply the process answers, never an env var), and a
role decision (→ the composition's word). Sorting those four is the port; the
static, its `*AppConfigSchema` const, its inferred type and the kernel's
`withConfig(app.configSchema)` parse branch all go. A module with no
deployment facts of its own declares no `config` static at all and its
`FeatureSetup` config parameter is `undefined`.

The kernel keeps only a type-only `withConfigType<Config>()` where the schema
used to be: the process parse has already produced the slice, so the
declaration states its type and nothing re-validates. Two phantom anchors make
that safe and must not be "tidied away" — `InstallableServerFeature.configType`
is what `ModuleConfigGuard` infers a module's config from, and without it the
guard type-checks nothing while still compiling green.

**Secrets are the sibling package, and a secret is a value you may only
pass through** (approved 2026-09-18). A module declares its handles beside
its config — `Secret.define({ privateKey: Secret.load("GITHUB_APP_PRIVATE_KEY") })`
— where **`Secret.load(id)` takes ONE identifier every adapter interprets
for itself**: the env adapter reads the variable of that name, the
1Password adapter reads that key in the vault's dictionary (config, by
contrast, always reads the environment). **1Password addressing is
convention plus one config key** (ruled 2026-09-18): a single config value
selects the account (personal or work); the vault is your private vault by
convention; the handle's own `load` id is the key inside the dictionary
there — nothing else to configure. **The preflight is part of start()**
(approved 2026-09-18): the moment the chain exists, every required handle
declared anywhere in the module array is checked answerable — env set, or
key present in the vault — and a miss fails the boot immediately, naming
every missing key at once, values never held. **Global concerns declare the
same way at their framework owner** — logging and telemetry are
everyone-sends-to-one-place concerns, so the process-server and
observability packages declare their config slices and secret handles
exactly as a module does, and the preamble order (config → secrets →
telemetry) is what makes a logging credential resolvable the moment
telemetry initializes. The app builds only the READER — a fluent adapter chain built from a handed-in builder,
`.withSecrets((config, secrets) => secrets.withEnv().withFile()
.withOnePassword(...))` — installed on the Server preamble AFTER
`withConfig`, so config can feed secrets (the 1Password vault key is a
config fact); the builder is never imported and chains directly. **The
chain is a lookup order, not a store**: it holds no values, pre-fetches
nothing, enumerates no vault — each declared handle is fetched singly, at
its owner's construction site, and handed straight to its closure. `boot()`
scopes the resolver per module: a `create()` can resolve only the handles
its own module declared, each resolve validates against the handle's
schema and hands the value to a closure —
`secrets.into(handle, (key) => Cipher.create(key))` — so only the
constructed collaborator escapes and travels. There is no `get()` that
returns a string to keep. When the last `create()` returns, the resolver
SEALS: a post-boot resolve refuses by name. Declarations live on modules
and framework packages; the server carries only the mechanism; the app
declares nothing. Every key is a **root object** — `process` for the framework
globals, or the module's name for its slice — and Zod reads the environment
at the one boot seam. A missing required value refuses **naming module and
key** (`github.appId ← GITHUB_APP_ID`); a module with a schema and no slice
fails to compile. `.readonly()` on the schema is the immutability story —
no `Object.freeze`, no mirror types, no re-plumbing.

**Defaults are production-shaped; development earns convenience explicitly.**
`developmentDefault` values (localhost store URLs) apply only under
`NODE_ENV=development` — so a bare `pnpm dev` boots with zero configuration —
and are inert in production, where every required value must be explicit or
the parse refuses. Production infrastructure always sets
`NODE_ENV=production` (the image sets it; a pod cannot forget it), so no
development default can ever reach a server.

**Config and secrets are separate** (ruled 2026-09-18). A secret is never a
field on the parsed config object and never travels inside it. Secrets
resolve through the chain above and are **injected into the thing that uses
them as early as possible**: the cipher is constructed with its key, the
database client with its URL, the token verifier with its bearer secret —
and only the constructed collaborator travels, as a process or module
dependency. The wall is decentralised (landed 2026-09-18, replacing the
`keys.json` registry): the one parse cross-checks every config leaf's env
name against every owner's declared secret handles and refuses a claim of
both, naming both owners — `ConfigClaimsSecretError`. Connection strings
are secrets, so they belong at the dependency-construction seam, never in
a config object a module reads. Every refusal in both packages is a
`HandledError` with a stable code.

**Three layers, and which one a value belongs to** (ruled 2026-09-18):

1. **Store connections are process-global and invisible to modules.**
   `DATABASE_URL`, `CLICKHOUSE_URL`, `REDIS_URL` are declared once, in the
   process's stores config; a module declares `reads("prisma")` and receives
   an opened client. Which tier that client is — Postgres or memory — is the
   process's config, and the module cannot tell.
2. **Module-shaped values live on the module's own schema** (github's
   signing key, monitor thresholds, retention days). The global object is
   **domain-driven** (`stores`, `mail`, `deployment`, …); a module-named
   slice exists only when a module truly has its own values — most have none.
3. **Shared deployment facts are canonical leaves.** A fact several schemas
   legitimately read (`BASE_HOST`, `IS_SAAS`) is ONE exported `ConfigValue`
   in `@langwatch/config` (`deployment-facts.ts`), imported by instance. The
   compiler admits a re-bound env var only when the claimants are literally
   that same leaf — one meaning shared N ways passes, a second meaning for
   the same variable still refuses at boot (that refusal caught a real bug
   the night it landed).

**Config is drilled, never ambient.** There is no async context and no
dependency-injection container. The process config is one object composed of
smaller objects; every function receives the narrowest slice that answers
its question, as an argument. Deep nesting paying for itself in signatures
is the intended pressure.

**A module maps its own config to its dependency state.** Whether a seam is
configured is derived _inside_ the module from its declared slice plus its
closed members — never defaulted invisibly, never hand-supplied by the
process. An unconfigured seam refuses by name with a stable error code. This
is the completion of §3.3's fourth case: what remains for the process to
`.provide` is only what no slice and no member can answer.

**Browser config is a declared projection.** A module's contract names which
of its values are browser-safe (a schema plus a `project` function — by
construction never a secret). The api builds one namespaced object from
every installed module's projection and injects it into the served page;
`defineBrowserModule`'s config declaration validates its slice **before
first render**, so a missing value is a boot refusal naming the module, not
an `undefined` deep in a component. The same drilling rule applies on the
browser: screens receive values as props, nothing reads the injected blob
directly.

---

## 7. Stores, the tier, and migrations

```bash
# ── local dev (live tier — the default; same shape as production) ──
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/langwatch   # or the development default
CLICKHOUSE_URL=http://default@localhost:8123/langwatch
REDIS_URL=redis://localhost:6379

# ── zero-dependency mode: ONE knob, by the word ──
LANGWATCH_STORES=memory

# ── production: identical shape, managed URLs, the knob unset ──
```

```ts
export const storesConfig = (modules) =>
  Config.group({
    tier: Config.value(z.enum(["live", "memory"]).default("live"), { env: "LANGWATCH_STORES" }),
    postgres: Config.value(z.string().url(), {
      env: "DATABASE_URL",
      developmentDefault: "postgresql://…localhost…",
    }),
    clickhouse: Config.value(z.string().url(), {
      env: "CLICKHOUSE_URL",
      developmentDefault: "http://…localhost…",
    }),
    redis: Config.value(z.string(), {
      env: "REDIS_URL",
      developmentDefault: "redis://localhost:6379",
    }),
  }).refine(
    /* rule 1: live + a required store unset → refuse naming modules and key
             rule 2: memory + NODE_ENV=production → refuse by name */
  );
```

| You did                                 | What happens                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| forgot `DATABASE_URL` in production     | refusal: _"live stores: trace, annotation require postgres; DATABASE_URL is unset"_ — **never memory** |
| `LANGWATCH_STORES=memory` locally       | whole process on memory twins, stated, one line                                                        |
| `LANGWATCH_STORES=memory` in production | refusal: _"asked to run production on memory storage"_                                                 |
| typo'd the knob                         | enum refusal — not a fallback to either side                                                           |

Memory is reachable only by writing the word, and only outside production.
Absence always refuses. There is deliberately no per-store tier: one knob,
whole process, no mixing — half-real storage tests a lie.

**The tier travels inside the value.** `openStores` returns branded live
clients or the branded `memoryStores()` — same type, one `.withStores(...)`
call — and `boot()` selects every module's registry (`live` or `memory`) from
the brand. Config is the only place a human states anything about storage;
the chain call is plumbing that carries config's answer, and the test seam
(tests hand `memoryStores()` directly and never touch env).

**Migrations are not the api's job.** They are tasks —
`pnpm --filter @langwatch/tasks task prisma-migrate clickhouse-migrate` — run
before serve by the start script and the deploy pipeline. Prisma migrations
live with the schema; ClickHouse migrations are goose SQL files. A serving
process holding DDL locks is how deploys die.

**Clients appear in exactly one place: the chain.** From there only registry
and channel factories touch them. There is no second path.

**Resolving is invisible: callers just call the client** (ruled 2026-09-18,
landing): a module holds the `clickhouse` member and queries it — every
query already names `TenantId`, and `@langwatch/clickhouse-client` routes to
the right physical endpoint internally, per call. No resolver type, no
`.resolve()` step, and no adapter exists outside that package; a caller
never thinks about resolution at all. The per-module resolver adapters
(`create<F>ClickHouseResolver`) are transitional and die when this lands.

---

## 8. Transports (REST + tRPC)

- Transport files **declare**; they never implement. A tRPC procedure is
  declared once, in the contract; the process half binds permission + handler
  (`defineTrpcRouter`); the browser derives its client from the same
  declaration. REST is one complete endpoint per route (`defineRestRouter`),
  `withInput`/`withOutput` mandatory; the framework parses, validates,
  refuses, serialises.
- Handlers receive `{ input, app, actor, scope, signal }`, call exactly one
  API operation, and **return a plain value or throw**. No `c.json`, no
  `JSON.parse`, no manual status branches, no error envelopes, no
  `RestErrorHandler` — banned outright.
- Every wire schema imports from the module's own contract. The one
  sanctioned exception: the `moduleApi<X>()` app-port interface a door
  declares for its own implementation.
- A path parameter is named for what it identifies (`:virtualKeyId`, never `:id`). A route main already
  publishes in `docs/api-reference/openapiLangWatch.json` keeps the names it published (Alex, 2026-09-23).
- A handler never sets a header to refuse: a `HandledError` carrying `meta.retryAfterMs` is rendered by
  the REST runtime with `Retry-After` (2026-09-23).
- An action that takes no body declares an empty input schema from its contract; the runtime reads an
  absent body as that empty object, so a bodiless call keeps working (2026-09-23).
- A protocol route (SCIM) renders its protocol's error bodies through its protocol response, never a
  `RestErrorHandler`, including refusals raised before the handler, through the renderer the route
  declares (`withResponse("protocol", { refusal })`). A body that does not parse is the handled 400
  `malformed_request` in every family, never a 500. A JSON route never borrows the protocol kind to reach the request: the caller
  arrives as `actor`/`scope` from the runtime's credential authentication (2026-09-23).
- `publicRoute`/raw results only for genuinely non-JSON protocols (SCIM,
  OAuth device flow, MCP streams, webhook raw bodies) and the documented
  `*-legacy.rest.ts` family, each carrying a one-line reason.
- The **process** mounts declarations; `boot()` opens the hosts. A module
  never mounts anything.
- **A route's documentation lives on the route, in its own `.withDocs()`
  call, in the same `*.rest.ts` file `.withOutput()` is in — never in a
  separate `*-openapi.rules.ts` file (§15).** The success body is
  `.withOutput()`'s Zod schema, generated live; `.withDocs()` adds
  `summary`/`description`/`tags` and, when useful, `errors` — a status and a
  sentence, never a body. A response that genuinely needs its own schema
  beyond the declared success (an extra status, a non-JSON body) names it
  through `documentedResponses()`, which resolves a real Zod type; nothing
  publishes hand-written JSON Schema or a bare `$ref` string, because nothing
  merges a components section for one to resolve against. A split-out docs
  file did exactly that — the schema and the route drifted, one `$ref`
  pointed at a component that had never existed, and the discovery route
  crashed presenting the document rather than at the split.

---

## 9. Eventing

The module declares its whole pipeline once:

```ts
// modules/trace/process/src/eventing/trace.pipeline.ts
export const tracePipeline = definePipeline("trace")
  .withEvents(traceEvents) // zod-typed, versioned
  .withCommands({ ingestSpan }) // validate → append
  .withProjections({ traceSummary }) // fold → read model      (worker-only)
  .withSubscribers({ onSpanIngested }) // reactions, idempotent  (worker-only)
  .withJobs({ retentionSweep: cron("0 3 * * *") }); // schedules              (worker-only)
```

Jobs are declared on the pipeline and installed with it through `.withEventing` — there is no
module-level `.withJobs`. `.withJobs` takes two kinds (Alex, 2026-09-23): a `cron(...)` schedule, and a long-running job, a
factory returning `{ start, stop }` that owns its own timers (first tick, delay after each run). The
worker starts every job after boot and stops it before the stores close; the api never constructs one.
Work that must run in every role (ADR-090's lease-held writer) is not a job: it stays a service the
module owns. `withWorkers` is retired.

A module may host several pipelines: it calls `.withEventing(...)` once per
pipeline, each a `defineEventingModule` declaration over the same app and
repositories. The process builds, registers and connects them one at a time in
the order declared, so a later pipeline's `build` may read senders an earlier
one's `connect` handed the app. Each still follows the role table below — the
api constructs none of their reactions. A pipeline the module defines but does
not declare this way is registered by nobody; no application line stands in.

`withPipelines((pipelines) => pipelines.produce())` selects API production;
`withPipelines((pipelines) => pipelines.consume())` selects worker consumption.
Neither declaration exposes a transport. `boot()` translates the same module
pipeline declaration per role — **api is commands-only,
structurally**:

|                                              | role `"api"`                            | role `"worker"`                    |
| -------------------------------------------- | --------------------------------------- | ---------------------------------- |
| commands                                     | send (append + return)                  | send                               |
| projections / subscribers / process managers | **never constructed** — nothing to call | hosted, per-aggregate ordered      |
| scheduled jobs                               | never constructed                       | hosted                             |
| eventing supply the role's chain demands     | `EventingProducer` (the type)           | `EventingHost` (consume + produce) |

Two enforcement layers: the reaction half is simply not built in an api
process, and the role types the eventing requirement — an api-role chain
compiles only against a producer handle, so hand-wiring a consumer into it is
a type error.

Worker semantics: delivery is at-least-once, so subscribers are idempotent;
ordering is per aggregate via the group queue, so one poisoned aggregate
retries with backoff without blocking neighbours; projections fold from the
same ordered stream; every consumer registers drain-first on the server.

---

## 10. The browser application

```ts
// apps/ui/src/main.tsx
const ui = await createUi({ mount: "root" }) // document + meta-tag config read are defaults
  .withModules(browserModules)
  .render();
mountShell(ui); // shell/: providers + router over declarations
```

`createUi` reads the injected public config from the DOM meta tag by default
(`withInjectedConfig` is a test-only override) and validates it against every
installed browser module's declaration **before a component renders**. Browser
modules register everything — screens, drawers, api bindings — via
their declarations; the app contributes only the shell chrome
(`src/{main.tsx, shell/, styles/}`).

**The declaration is the module's one browser export that matters** (landed
2026-09-18): a browser package's `exports` map lists `./declaration` only
(§3.4 — every sibling entry is a side door, and 23 packages grew one),
and the declaration file (`<name>.web.ts`, colocated test beside it)
declares screens, drawers and api bindings with the same loader shape —
`{ load }` — for each. The kernel (`@langwatch/ui-kernel`) stays React-free
and merges what modules declared: `installedModuleScreens` and
`installedDrawerLoaders` each fold the installed array into one registry
and **refuse a name two modules claim, naming both owners**. The shell
turns registries into lazy components and mounts them once — screens under
the route table, drawers through `CurrentDrawer`. **Drawer names are the
wire**: they resolve straight from the address bar (`?drawer.open=<name>`),
ride shared links and REST `platformUrl` fields, so a declared name matches
the served product exactly or it is a regression.

**`uiBundle()`** is the built browser app as a deployment artefact —
`apps/ui/dist/client`, resolved by path (env-overridable). `server.serve({
static: uiBundle() })` serves hashed assets with immutable caching, answers
`index.html` for unmatched non-API routes **after** every declared route (it
can never shadow one), and **injects the public-config meta tag at serve
time** — the api knows the deployment, which is how the browser gets its
config without a second channel. Absent `dist/` (local dev, Vite owns the
browser), it serves nothing.

Drawers are URL-routed singletons with a navigation stack, opened through the
host capability, registered through the declaration. One tRPC client for the
whole browser.

A surface too wide for a typed hook calls a procedure by PATH through the
shell's `UiRpc`, and the answer is published under the key the typed hook
would have written, so the two never hold two versions of one read. **A
`queryFn` never re-enters the query cache under the key it is resolving**
(measured 2026-09-18): joining the fetch in flight for that key joins the
caller's own, so the function awaits the promise it is itself supposed to
resolve. The request answers 200 and the query stays pending for the life of
the document — the failure that left 99 of 126 addresses drawing a spinner
over a workspace graph that had already arrived. The hazard is the re-entry,
not the shared key; a `queryFn` calling the transport under a `trpcQueryKey`
is the normal shape. specs/ui/by-path-dispatch.feature.

### 10.1 Shared browser machinery (ruled 2026-09-18)

The browser mirrors the process grammar, adapted rather than copied — when a
browser shape has no obvious process twin, the shape is asked for, not
invented:

- **Capability classes on the shell.** Everything shared (analytics, session,
  navigation, environment) is a small class composed by the shell and received
  by modules only through their declared `*HostApi`. Ambient React context is
  never a cross-module transport; modules never import a vendor (posthog,
  router, theme) directly.
- **A declaration slot nothing consumes is deleted, not kept** (ruled
  2026-09-18). The declaration is a contract, and a slot with no consumer is
  not one — it is an invitation to declare something that will never be read.
  Counted across `defineWebModule`'s ten module-facing slots:

  | slot                         | declarers | consumer                             |
  | ---------------------------- | --------- | ------------------------------------ |
  | `withScreens`                | 33        | `installedModuleScreens`             |
  | `withDrawers`                | 11        | `installedDrawerLoaders`             |
  | `withConfig`                 | 1         | yes                                  |
  | `withApi`                    | 1 of 33   | `installedModuleApis`                |
  | `withCapabilities`           | 6         | `declared(name)` (`declarations.ts`) |
  | `withSlots`                  | **0**     | built (`browser-host/src/slots.tsx`) |
  | `withFailureInterceptors`    | **0**     | built (`ui-feature-shell.tsx:162`)   |
  | `withSeatTypeCopy`           | **0**     | built (`slots.tsx:143`)              |
  | `withFlags` · `withCommands` | **0**     | **none**                             |
  | `publishSurfaces`            | 13        | **none — superseded, below**         |

  Only the last row is builder surface that does nothing, and only it is
  deleted. The three above it are the opposite case and stay: their consumers
  are built and waiting, and what they lack is declarers. That
  `withFailureInterceptors` has none is its own finding — the shell runs every
  installed interceptor over each failed mutation so that "a failure a feature
  answers application-wide is reported once, rather than by every screen that
  happens to trip it", and no feature answers one.

  **`publishSurfaces` is superseded by the kit** (ruled 2026-09-18). It is the
  declaration-side twin of the `./surfaces/*` exports entries §3.4 just closed:
  `organization` publishes `surfaces/department-picker` and
  `surfaces/personal-workspace-features` — the same names its exports map
  opened. Both halves answered the same question, "how does another module
  reach into mine", and the kit is now the whole answer. 13 modules declare it
  and nothing reads it at runtime, so no behaviour depends on the removal; the
  surfaces travel to the owner's kit, or they dissolve. Found while correcting
  this table for the third time — it was missed because a census of the
  builder's `with*` methods does not match a method named `publish*`.

  **Count the consuming side, not only the declaring side** (the method note
  this table cost). A first pass read four slots as dead both ends; two of them
  had live consumers and were one lane away from deletion. The miss was
  mechanical: a slot is renamed in transit — `failureInterceptors` is consumed
  as `features.failures` — so grepping the slot's own name finds nothing and
  looks like proof. Counting declarers finds what nobody uses; counting
  consumers finds what nobody fills. The two look identical from one side, and
  every seam found today has been the second kind.

- **An unmounted host is refused at install, not thrown at render** (ruled
  2026-09-18). A screen declares a `*HostApi`; if nothing mounts it, `createUi`
  refuses by name — the same way the kernel already refuses a screen name two
  modules claim, and in the same pass, **before a component renders** (§10).

  The measurement that forced it: **35 of 39 `*HostProvider`s had no production
  mount at all.** Every one is exported from its package barrel, ready, and
  nobody mounts it. The failure that surfaced it was `auth`: loading `/`
  redirected to `/auth/signin`, which threw `AuthHostUnavailableError` from
  `usePublicEnv` and rendered "This page did not load". Auth was not special —
  it was the screen someone happened to open.

  The defect is not the missing mount, which is ordinary unfinished work. The
  defect is that **nothing said so**: a seam declared across 39 packages and
  implemented in 4 read as healthy, and each one waits to fail until a customer
  navigates to it. A refusal that names the module and the host turns 35 latent
  runtime crashes into one boot error with a list.

  The shape to mount is the one that already works, which is why the capability
  slot below is the mechanism rather than a second idea:

  ```tsx
  // packages/ui-kernel/src/ui-feature-shell.tsx — the only mount pattern
  <UiScopeHostProvider value={resolved.scope?.scopeHost()}>
  ```

  **The refusal is wired and inert, and the mount has no mechanism** (measured
  2026-09-18, evening). Both halves need saying, because from one side this
  reads as done:

  - `checkHostMounts` is written, correct, and called — `ui-supply.ts:181`. It
    collects every offender rather than stopping at the first, and throws
    `BrowserHostUnmountedError` naming module and host. Nothing is wrong with
    it. It simply never fires: **`withHosts` has zero declarers**, so every
    module's `requires` is empty and the check passes over 31 missing mounts.
    A guard nothing feeds is the same seam this section is about, one level up.
  - A module **cannot** mount its own host today. `withScreens` and
    `withDrawers` carry a loader; `mounts` carries a bare string:

    ```ts
    // packages/ui-kernel/src/web-module.ts — names only, nothing to render
    type WebHostDeclaration = {
      readonly requires: readonly string[];
      readonly mounts: readonly string[];
    };
    ```

    `hosts.mounts` is read in exactly one place, `ui-host-mounts.ts`, to decide
    whether a `requires` is satisfied. No code path renders a mount, so
    `mounts` today is a promise about the world, not a thing the kernel does.

  Restoring the deleted `apps/ui/src/features/*/ui/sections/*-host.tsx` files
  is **not** the fix and is refused (ruled 2026-09-18): those reached into
  `apps/ui/src/behavior/*` from inside the application, which is the shape
  `01d92f9c74` existed to delete. The mount is new-shape or it does not happen.

  **A port with no honest answer is widened, never filled** (ruled 2026-09-18,
  from mounting all 36). A host method typed `string` whose real answer is
  "nobody told me" has exactly two legal outcomes: widen the capability so
  somebody does, or widen the port to `string | undefined` so absence is
  sayable. What a mount may never do is satisfy the type with a value — not
  `""`, not `"unknown"`, not a plausible default — because downstream that is
  indistinguishable from a real answer at every call site.

  The case that forced it: two enterprise hosts answered `""` for the
  deployment's base URL, which renders links and copy-to-clipboard values that
  look real and are not. Licensing, whose port allowed `undefined`, was honest
  about the same gap on the same day. The capability grew `appBaseUrl` and both
  stopped lying; `licensePaymentUrl` followed. An array port is different — `[]`
  is the honest smallest instance, not a placeholder.

  **A mount carries a loader, and the shell composes them at the router root**
  (ruled 2026-09-18, evening). `mounts` stops being a bare string and becomes
  what `withScreens` and `withDrawers` already are:

  ```ts
  // modules/secret/browser/src/secret.web.ts — the worked half
  .withHosts({
    requires: ["SecretHostApi"],
    mounts: { SecretHostApi: { load: () => import("./behavior/secret-host-mount.tsx") } },
  })
  ```

  The loader resolves a default-exported provider rendering
  `<SecretHostProvider value={host}>{children}</SecretHostProvider>`;
  `installedModuleHostMounts` collects every declared one in install order and
  `createUiModuleHostStack` composes them into the root layout, below the
  feature shell and below the router.

  Two constraints decided the position, and both rule out the alternative of
  wrapping the declaring module's own screen loaders:

  - A host is regularly read by a **peer's** screens — `requires` is per
    module, and scenario reading workflow's port is the ordinary case. A mount
    around one module's own loaders cannot answer it.
  - A host that reads the **address bar** (auth and authorize both do) has to
    be inside the router. Api providers mount above it; hosts do not.

  The module writes the projection, so the application learns nothing about the
  module: every method of a host is `session.x()`, `feedback.x()` or
  `scope.x()` over `@langwatch/browser-host` capabilities the module can
  already reach.

  **A mount nobody requires is refused too**, by `findUnrequiredHostMounts`.
  Both halves of the seam are free strings, so `requires: ["WorkflowHostApi"]`
  against `mounts: { WorkflowHost }` satisfies the unmounted check and still
  crashes at render — the same shape of silent pass this whole section is
  about. Reading the seam from the mount side names the typo, and it is why a
  module declares both halves in one change rather than mounting first.

- **A capability travels by declaration** (ruled 2026-09-18). `defineWebModule`
  carries a capability slot, and the composition root reaches a module's
  capability implementation through `./declaration` like everything else:

  ```ts
  // modules/organization/browser/src/organization.web.ts
  export const organizationWeb = defineWebModule("organization")
    .withScreens({/* … */})
    // "Where they are standing" is organization's to answer. It RUNS
    // organization.getAll, so it is not kit-legal (rule 3) — it is declared.
    .withCapabilities({
      scope: { load: () => import("./behavior/scope-capability.ts") },
    });
  ```

  ```ts
  // apps/ui/src/main.tsx — the composition root reads what was declared.
  // It never names a module's internals, so the exports map stays shut.
  const ui = await createUi({ mount: "root" }).withModules(browserModules);
  ```

  The gap that forced it: a capability implementation had no legal home once a
  browser package closed. It cannot be a kit — kit rule 3 says a kit fetches
  nothing, and `useUiScopeReading` runs `organization.getAll` — and it cannot
  be reached directly, because that is the side door §3.4 just shut. The two
  rejected answers are worth naming. Exempting the composition root reopens
  the hole: "composition root" is a door, and doors get claimed by whoever can
  argue they are composing. Relaxing rule 3 for capabilities destroys the
  property that makes a kit safe to depend on — a kit that may fetch is a
  browser package with a nicer name. Declaring it instead completes the
  sentence this section already starts: capabilities are composed by the shell
  and reach modules through a declared `*HostApi`.

  **The slot is "what the composition root installs from this module", whether
  or not it fetches** (ruled 2026-09-18). Fetching is what makes a capability
  ineligible for a KIT; it was never what makes it a capability. Reading the
  slot as fetch-only stranded a whole class: a PURE symbol whose only consumer
  is `apps/ui` could not be a kit (rule 5 — one consumer never mints one), nor
  a capability, nor a subpath (§3.4), and rule 5's usual remedy — inline or
  duplicate into the consumer — assumes the consumer may hold code, which
  §10.1 says `apps/ui` may not. Measured before ruling: **9 such specifiers
  across 6 modules** (auth, langy, navigation, organization, scenario, trace),
  so it is a class and not a coincidence. Each is a barrel today, and splits
  into fetching and pure halves on inspection; both halves ride the slot, so
  the split costs nothing.

  A theme config still is NOT a capability. It is pure data with consumers
  besides the composition root, so it belongs in a kit — `apps/ui` keeps the
  skin, and `langy-theme` travelling as theme data is the shape. The test is
  the consumer, not the purity: **many consumers → kit; the composition root
  → the slot.**

- **One Analytics capability** wraps every instrumentation destination
  (posthog, gtag, browser tracing). Modules emit named events through it —
  the browser twin of a channel.
- **Session and scope are two capabilities with two owners** (ruled
  2026-09-18). "Who is here" is `auth`'s: it is built on auth's own session
  read and nothing else may build it. "Where they are standing" — which
  organization, team and project this page is about — is `organization`'s: it
  is resolved against the organization graph, from the address bar and the
  device's remembered selection. They settle on different schedules and fail
  in different ways, so one capability answering both made every scope read
  wait on a session read that did not gate it.

  The consequence is a rule, not a preference: **the session capability never
  resolves scope.** An auth screen that needs the active scope reads the scope
  capability beside it. If `auth-browser` finds itself importing
  `organization-browser`, the split has been done wrong — the composition root
  installs the two side by side, and neither module imports the other.

  Known debt, recorded rather than fixed (2026-09-18): the legacy scope host
  behind `useOrganizationTeamProject` — read in 506 files — answers
  `hasPermission` and `hasOrganizationPermission` as well as the scope. That
  conflation is what makes session and scope mutually dependent at all, and
  moving those two reads onto the session capability would remove the knot at
  its source. It was not done here because `modules/trace` and
  `modules/scenario` build their own scope hosts for PUBLIC shared pages where
  no session is mounted, so changing who answers `hasPermission` changes
  authorization behaviour on those pages. That is a change with its own spec
  and its own scenarios, not a side effect of a file move.

- **State defaults to server state**: react-query over the derived tRPC
  client is the normal answer, so cross-module client state is rare and ruled
  case by case. The unit of browser sharing is the **published hook** — the
  owner publishes hooks through its kit; shared mutable-state packages are
  not a tier.
- **apps/ui holds NOTHING but its composition** (amended 2026-09-18):
  `main.tsx` + `styles/`, and nothing else. The browser app obeys the same rule
  §2 gives the process apps — an app is a main and a config, the product lives
  in modules, and the MACHINERY lives in framework packages. The earlier
  wording here allowed the browser a whole `shell/`, which is the one place the
  browser was permitted to differ from the process side for no stated reason;
  that asymmetry is closed rather than justified.

  So: the former `behavior/` layer dissolves — shared machinery becomes
  capability classes in `@langwatch/browser-host`, module-specific parts move
  into their owning module's browser half — and `shell/` follows it out, into
  `@langwatch/ui-kernel`, which is the browser twin of the process kernel and
  already owns `createUi`. Providers, the router construction, route
  materialisation, page fallbacks, the drawer mount and the error boundary are
  all machinery: none of them is specific to this deployment of the product.

  The measurement that forced the amendment: apps/ui held 75 files across
  `behavior/`, `shell/`, `ui/` and `model/`, while `ui-kernel` held 6.

  The route table is the interesting residue. It is data about which address a
  module serves, and every module that declares its own screens shrinks it —
  so it ends at nothing rather than moving. Until then it is composition input,
  named by `main.tsx`, not machinery.

  Which settles what "nothing but its composition" admits, since the two
  sentences above read as a contradiction otherwise (clarified 2026-09-18):
  `apps/ui/src` holds the entry point, `styles/`, and the shrinking route
  table — the three things that are true of THIS deployment of the product and
  of nothing else. Everything a second browser application would also need is
  machinery and leaves. The test is not "is it small" or "is it composition-
  adjacent"; it is **would a second browser application want this file** — if
  yes it belongs in `@langwatch/browser-host` or `@langwatch/ui-kernel`, and if
  no it is composition and may stay until it dissolves.

---

## 11. Enterprise

`enterprise/modules/<name>` mirrors the module shape exactly and **exports
modules like any other** — the generated lists carry core and enterprise
tiers, and the same catalogue installs both into the same processes. There is
no enterprise composition package, no separate wiring, no conditional
mounting: **enterprise routes are always mounted and refuse per-organization
on entitlement**. Entitlement depends on the installed `LicensingApi` peer.
Licensing resolves each organization’s signed license; an absent or invalid
license is a normal domain result, not deployment-level capability absence.
An adapter that reads a licence, a signature or a feature flag to decide what
a tier may do lives in the **enterprise module that holds the gate**, which may
depend on `@langwatch/enterprise-licensing-contract` and
`@langwatch/feature-flag-contract` and asks a core module for facts through its
`*Api` only — a core module never grows a supply token for a tier context.

---

## 12. Errors

Throw `HandledError` only when the cause is known **and** the caller can act;
register the `code` in `packages/handled-error/src/app-codes.ts` and its
customer copy in the presentation registry. Everything else stays a plain
`Error` and degrades to "unknown" + trace id at the boundary — deliberately.
`message` is customer-safe, never internals; the tRPC wire message is the
code slug, so clients render from the registry and never toast
`error.message`. A 5xx subclass sets `fault` explicitly. Tests assert on
`code`, never prose. A knowable failure surfacing as "unknown error" is a bug
in the feature, not a gap in the error system.

---

## 13. Testing

Specs first (`specs/`, Gherkin); an enforced scenario carries
`@unit|@integration|@e2e|@regression` and a `/** @scenario */` binding —
untagged scenarios enforce nothing. Peer doubles come from `createApiFixture`
— anything unconfigured throws by name; the same philosophy governs every
double (`memoryAnalytical` throws on unscripted SQL). Component tests are
`.integration.test.tsx` with the jsdom docblock. Each package owns its vitest
config and declares its own datastore needs. **Tests live beside what they
test, in a colocated `__tests__/` folder — never in a root `tests/` directory
next to `src/`.**

The installation test is the same chain as production:

```ts
const runtime = await createApp({ role: "api" }) // no server: nothing to tear down
  .withModules([annotationProcessModule, traceProcessModule, presenceProcessModule])
  .withConfig({ annotation: {}, trace: {}, presence: {} })
  .withStores(memoryStores()) // branded → memory tier everywhere
  .boot();

const traces = runtime.service(TraceApi);
await traces.ingestSpan({ projectId, span });
```

Memory bundles require nothing, so no datastore and no Docker — while peers
resolve each other for real through the same tokens production uses. Zero
test-only spellings.

---

## 14. Worked examples

**A. Three modules over Prisma, ClickHouse, Redis** — annotation (Prisma),
trace (Prisma + ClickHouse), presence (Redis). `main.ts` is §4 verbatim with
those three in the list. Boot validates each live registry's `requires`
against the supplied stores; removing ClickHouse from the deployment fails
the config parse naming trace.

**B. GitHub and Slack** — both are things modules don't own → channels.
`github`'s `channels/http/http.github-app.channel.ts` reads the module's
config slice (app id, private key from env); `automation`'s Slack channel
takes per-tenant tokens from a **repository** (tenant data is owned state,
not config). `main.ts` unchanged; env carries `GITHUB_*`. Unset, the module's
own optional config decides: operations refuse by name ("GitHub app not
configured") — configuredness is a config fact, which modules may own.

**C. Slack without GitHub** — remove `github` from the catalogue, regenerate.
Its routes vanish, its config slice is no longer demanded, `GITHUB_*` env is
ignored. Any module that peer-depended on `GithubApi` fails to compile,
naming itself. `main.ts` and `config.ts`: zero edits.

**D. Memory-tier test** — §13.

---

## 15. Deleted spellings

Deleted, not deprecated. Writing one new is a defect; reading one marks
conversion debt:

`createProcess` · `withProvided` · `withMemoryRepositories` · `membersFrom` ·
`reads(...)` statics · the `members:` option on `createApp` ·
`withInfrastructure` · `withPersistence` · process-side `withTransports` ·
per-store supply calls (`withRelational`/`withAnalytical`/`withKeyvalue` —
collapsed into `withStores`) · absence classes (`Logged*Absence`, `Absent*`) ·
`ApplicationBuilder`'s public surface · per-process host files · per-module
composition files under `apps/*` · hand-projected per-module config · bespoke
member bags · `*App` classes inside modules · `defineServerModule` /
`defineWebModule` (renamed) · `RestErrorHandler` · error envelopes in
transports · re-exports for backwards compatibility · `refusing*` twins ·
`try*`/`require*` method names · `T | null` returns in new code (`find*` =
array; `get*` = one or throws) · `static readonly configSchema` and its
`*AppConfigSchema`/`*ServerConfigSchema` consts · a module declaring an env
var another owner already declares (`BASE_HOST` outside the process owner) ·
`surfaces/` and `screens/` browser folders · any `exports` entry on a browser
package other than `./declaration` · any `exports` entry on a kit other than
`.` · a kit importing another kit · `*-openapi.rules.ts` files hand-writing a
route's REST response schema (§8) — migrate the summary/description/tags
into the route's own `.withDocs()` call and drop any hand-written success
body outright; an error keeps only its status and a sentence via `errors`,
and a response that truly needs its own schema goes through
`documentedResponses()`, never raw JSON.

---

## 16. Renames in flight

This document names the target. **Landed 2026-09-18:** the tree rename
(`modules/*/process`, `*/browser`, `*/browser-kit`; package names
`*-process`/`*-browser`/`*-browser-kit`), `@langwatch/process-stores`,
`@langwatch/browser-host` (+drawer), `@langwatch/browser-trpc`, plan-gate
dissolved into `entitlement-contract`, and `.withStores(stores)` on the
chain. New code uses the left column only.

| Target                                        | Today                                                              |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `@langwatch/module` (light core)              | `@langwatch/kernel`'s token half                                   |
| `@langwatch/process`                          | `@langwatch/process-server` + kernel's boot AND declaration halves |
| `@langwatch/browser`                          | `@langwatch/ui-kernel` (boot half)                                 |
| `createProcessApp(role)`                      | none — apps compose directly (see note below)                      |
| `openStores(config)`                          | `createProcessMembers({ config })`                                 |
| `defineProcessModule` / `defineBrowserModule` | `defineServerModule` / `defineWebModule`                           |
| `traceProcessModule` / `processModules`       | `traceServer` / `serverModules`                                    |
| `TraceModule` + `.withApi(...)`               | `TraceApp` + `.withApp(...)`                                       |
| `<f>.module.ts` / `<f>.web.ts` file stems     | `<f>.server.ts` / `<f>.web.ts`                                     |

`createProcessApp` stays the target shape. Its previous implementation, the
generated `createServerApp` and its `serverModuleChunk0..9`,
`coreServerModules` and `enterpriseServerModules` lists, was **removed
2026-09-18 as dead code** — nothing outside the generator imported it, yet it
cost 11.3M type instantiations in every program that compiled it: because
`modules/` emits no `.d.ts`, `apps/{api,worker,ui}` and `dev-runtime` each
compiled it from source. Removing it took those five programs from 70.5M
instantiations (107.2s of checking) to 13.9M (2.3s). Build it again once
`modules/` can emit a `.d.ts`; today it cannot
(`TS7056` — the composed type exceeds what the compiler will serialize, and
~50 `TS2883`s name module repositories the composed type should not expose).
Until then a process composes `serverModules` directly.

Also open, each a worklist: the config-defined dependency state migration
(§6 — deletes the remaining bespoke member tail); eventing member composition for both roles; `browserModules` is
empty (no module exports `./declaration` yet — the browser serves chrome
only); the ClickHouse resolver ruling (§7); worker job declarations designed,
not landed.

---

## 17. Enforcement

The linter is the authority: the file grammar lives in
`packages/oxlint-rules/grammar/feature-layout-policy.mjs`, the boundaries in
`langwatch/package-boundaries` and `packages/architecture-enforcer/`
(`pnpm lint:architecture`). ADR-147 (compiler-checked supply) and ADR-148
(declared browser supply) are the ruling decision records and are cited by
this document; all earlier composition ADRs are historical. When someone
finds this document teaching something the tree refuses, the fix is a change
to this file in the same commit as the code — an out-of-date architecture
document is worse than none, because it reads authoritative.

## 18. Running work

Nx is the workspace task runner (ADR-150). It reads the workspace that
already exists: projects come from `pnpm-workspace.yaml`, targets from each
package's `scripts` block. No package carries a `project.json`, no script is
an Nx executor, and Nx generates nothing — a module is still installed by
editing `modules/catalogue.json` and running `pnpm generate:modules`. The
whole configuration is `nx.json` at the root.

What Nx decides is _when_ a script runs and whether it may be skipped, never
what a package is. That distinction is load-bearing: the file grammar, the
architecture-enforcer and the catalogue already say what a package is, and a
second system describing the same packages would be a second authority
disagreeing with the linter.

Cache inputs are declared for a workspace that resolves source, not build
output. Packages point their `exports` at `./src/*.ts`, so a dependency's
source is an input to its dependents' tests with no build in between —
`typecheck` and `test` therefore both take `["default", "^default"]`. A cache
keyed on a package's own files alone would replay a stale pass after a
dependency changed underneath it. `test:integration` is left uncached on
purpose: those suites read Postgres, ClickHouse and Redis, and their result is
a function of datastore state that no input declaration describes.

The root scripts are unchanged. `test`, `typecheck`, `lint` and `build` keep
the filter sets CI, haven and this documentation already invoke; Nx is
available beside them as `test:all`, `test:affected`, `typecheck:all`,
`typecheck:affected`, `build:affected`, `lint:affected` and `graph`. Repointing
the root scripts at Nx is a separate decision — the current root `test` covers
`packages/`, `modules/` and the enterprise packages and deliberately excludes
the applications, the SDK and the e2e suites, so the two are not the same set.

The cache is local. No Nx Cloud account is configured and `nxCloudId` is
absent, so no source or task metadata leaves the machine.

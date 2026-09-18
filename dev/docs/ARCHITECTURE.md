# LangWatch Architecture

**The one record.** Ruled 2026-09-17/18. Every other architecture document is
deleted or points here. When this document and a lint rule disagree, the rule
is the truth and this document is the defect — fix the document, never code to
it. On conflict between sections, the more specific wins.

---

## 1. The product

Four Node processes and three Go services:

| Process | Package | What it is |
|---|---|---|
| `apps/ui` | `@langwatch/ui` | The browser application (Vite SPA) |
| `apps/api` | `@langwatch/platform-api` | tRPC + REST + SSE, serves the browser bundle |
| `apps/worker` | `@langwatch/worker` | Queues, schedulers, projections, subscribers |
| `apps/tasks` | `@langwatch/tasks` | One-shot migrations and backfills |
| `services/aigateway` | Go | Virtual-key data plane (Bifrost fan-out) |
| `services/nlpgo` | Go | Optimization-studio executions and evaluators |
| `services/langyagent` | Go | Langy conversation manager (pi harness workers) |

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

| | core | runs + declares | reads | wire | shares |
|---|---|---|---|---|---|
| **Node** | `@langwatch/module` | `@langwatch/process` | `@langwatch/process-stores` | `@langwatch/api` | contracts |
| **Web** | `@langwatch/module` | `@langwatch/browser` | `@langwatch/browser-host` | `@langwatch/browser-trpc` | `<name>-browser-kit` |

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
  .withRepositories(traceRepositories)   // registry: { live, memory }
  .withApi(TraceModule)                  // the one class implementing TraceApi
  .withTransports(traceRest, traceTrpc)  // inert declarations
  .withEventing(tracePipeline);          // §9
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
   consumer is bilateral coupling, not an API: inline or duplicate it. The
   published tier is shrink-only.

---

## 4. A process, whole

```
apps/api/src/
├── main.ts           # everything below, ~40 lines
└── transport/        # HttpMux · BrowserBundle — tiny classes ("transport" for consistency)
    └── policy/       # SecurityHeaders · ContentSecurityPolicy · ClientAddress · RequestPreamble
```

**The transport composition lives in the api app, not in `@langwatch/api`**
(ruled 2026-09-18): the dependency points the other way — these classes USE
the api package; the api package never contains its own front door. **There
is no ApiForward** (ruled 2026-09-18, superseding the noun): the /api
composition rides `composeProcess().expose()` — trpc and rest allowed iff
declared, then the security middleware, then the bundle route after them —
so the front door is the expose chain's product, not a class of its own.

There is no app config file (ruled 2026-09-18): config comes from the
installed server modules' own declared schemas, composed by the generated
parse (§6). A hand-maintained per-app config module is a defect.

```ts
// apps/api/src/main.ts — the whole process (ruled 2026-09-18; the landed
// interim uses createServerApp + withStores, see git log)
import "@langwatch/time/polyfill";

const server = await Server.create("langwatch-api")
  .withSecrets(secretsChain())          // ADR-132 chain: env → 1Password → refusal by name
  .withConfig(apiConfig)                // §6 generated parse, UNDER telemetry: refusals are logged, named
  .withTelemetry(grafanaTelemetry())    // logger + trace links + OTLP export, from config
  .withMetrics(prometheusMetrics())     // scrape endpoint, token from config
  .start();                             // fatal handlers → secrets → parse → /healthz live

const app = await server.composeProcess("api")
  .withModules(processModules)          // dependencies resolve from config — no store lines (§5)
  .expose((transports) => transports    // REQUIRED on the api; not on the worker's builder at all
    .trpc()                             //   required iff any module declares namespaces
    .rest()                             //   required iff any module declares families; family
                                        //   credentials bind at their declaring modules, not here
    .browserBundle())                   //   ALWAYS required on the api; .browserBundle(none) opts out loudly
  .produce((pipelines) => pipelines
    .commands())                        // the api emits commands onto the queue; never claims it
  .boot();

await server.serve(app);
```

```ts
// apps/worker/src/main.ts — the whole difference
const app = await server.composeProcess("worker")
  .withModules(processModules)          // SAME module graph: apps install fully, jobs call them in-process
  .consume((pipelines) => pipelines
    .commands())                        // claims the queue: consumers, jobs, process managers
  .boot();

await server.run(app);
```

**Surface slots are compiler-driven and role-shaped.** `expose` exists only
on the api builder, `consume` only on the worker's — a worker exposing REST
is unwritable, not merely unwise. **Nothing extra rides the expose chain**
(ruled 2026-09-18): no members, logger or stores threaded through the
surface, and auth machinery — internal bearers, the admin instance bearer,
credential binding — is the api package's own business behind a service,
never something the main or the surface carries along. Inside `expose`, the members are typed
from the installed tuple: install the first namespace-declaring module and
`.trpc()` becomes required (boot() refuses to compile, naming
`surface.trpc`); uninstall the last one and the `.trpc()` line goes red in
place. **All routing is the framework's.** Every request flows through
`@langwatch/api` — middleware, family and namespace placement, per-route
auth binding, all driven by the modules' declarations. No application code
routes anything. **The hosting dispatch is a pass-through with exactly one
decision** (ruled 2026-09-18): an unconditional preamble on every request —
trusted-proxy remap resolved once, base security headers stamped on every
response, owned by no surface so no surface can forget them — then `/api/**`
forwards to the API package (the tRPC-vs-REST split is the framework's own
routing; the dispatch does not know tRPC exists), and everything else is
the bundle side: an optional session READ on document requests only (never
hashed assets — the surface is auth-capable, not auth-enforcing, until a
policy such as a private-instance gate says otherwise), then serving —
immutable assets, `index.html` with the injected meta tag, CSP overlaid on
the stamped base. **The hosting layer is one muxer with routes and
middleware** (ruled 2026-09-18), spoken in the industry's own words:
`HttpMux.create().use(ClientAddress.fromTrustedProxies(...)).use(
SecurityHeaders.strict()).route("/api", api).route("/", spa)` — middleware
runs before routing on every request; `/` is a route, not a fallback,
because longest prefix wins; `.use`/`.route` are internal (boot() writes
the composition, prefixes stay library constants, no app code ever holds
the mux). **The pieces are tiny classes, legible at their constructor
sites** (ruled 2026-09-18, superseding the SinglePageApp name):

```ts
const bundle = BrowserBundle.create({
  dist,
  publicConfig,
  sessionReader,                       // Caller | null, document requests only
  security: SecurityHeaders.strict().withContentSecurityPolicy(csp),
});
const handler = RequestPreamble.create({
  clientAddress: ClientAddress.fromTrustedProxies(trustedProxyConfig),
  security: SecurityHeaders.strict(),
  next,
});
```

`BrowserBundle` serves the bundle side; `RequestPreamble` is the
unconditional preamble as a class. The /api front has no noun of its own —
`expose()` composes it (trpc/rest iff declared, then security, then the
bundle route last). The fluent mux above and these constructor sites are
one design — the mux composes them. **The mux is backed by
Hono internally** (ruled 2026-09-18): the framework's `/api` surface is
already a Hono app, so the mount is a native sub-app and one router tree
serves the request end to end, with Hono owning the HTTP edge cases a
hand-rolled prefix match gets wrong — but Hono never leaks from the
hosting layer's public surface; it is an implementation detail confined to
the mux's own file. There is no public Router class, no mount API, no
scoped router object anywhere. **The mux
carries the last-resort error boundary, and error presentation follows the
path prefix** (ruled 2026-09-18): an error anywhere in the chain on an
`/api` request answers the canonical JSON envelope (generic "unknown" +
trace id for the unnamed — an API client never receives HTML, even for a
middleware crash before routing); on any other request it answers the
standard error page — minimal self-contained HTML with the trace id, never
a re-attempt of the SPA shell, because the bundle machinery may be what
failed. Inside `/api` the framework's canonical-error middleware remains
the handler for everything it reaches; the mux boundary catches only what
escapes or precedes it, answering in the same envelope shape. **The code's
physical shape matches**: concept-named directories in the api app —
`transport/` (HttpMux, BrowserBundle) with `transport/policy/` inside it
(SecurityHeaders, ContentSecurityPolicy, ClientAddress, RequestPreamble) —
tiny classes, tens of lines each, composition by constructor, helpers
inside the class file they serve; a directory growing past a few classes
means the concept is wrongly cut. **Each expose member sets up only the base**: headers and
general security, as named CLASSES from `@langwatch/api`, never inline
data — `SecurityHeaders.strict()` (the floor no surface drops below; `.with`/
`.merge` overlay, `.without` is the loud exception), `ContentSecurityPolicy
.app()` (the browser bundle's composed overlay — connect-src rides config),
`ClientAddress.fromTrustedProxies(...)` (Server-level — client-address truth is
one answer for every surface). The chaining is pre-done in importable
defaults — `trpcSurfaceDefaults()`, `restSurfaceDefaults()`,
`browserBundleDefaults()` — and a bare member call IS its default; a
deviating deployment imports the default and chains on it, never rebuilds
from parts.

**Surface auth is structural, not policy** (ruled 2026-09-18). tRPC IS
session-authenticated; REST IS API-key-authenticated; neither default is
settable in the expose block, because it is what the surface means. The
only written auth is the per-endpoint exception, declared on the route in
the owning module's transport declaration: `.withAuth(BearerTokenAuth
.fromConfig("cronBearerToken"))` — the workflow module binds ITS bearer
from ITS slice; langy likewise — or `.public()`, which stays guarded by
the no-scope-input check. No internal-family credential appears in a main,
a surface block, or any process-global bag. Tests construct a surface with
a fake session or credential — the one override, never a deployment.

**`Server.create` ordering is the point:** fatal handlers first (raw stderr
until a logger exists) → secrets resolve → config parses **under** telemetry,
so a parse failure is logged with the service name instead of vanishing →
signals wired, deadline armed. `/healthz` answers **during** boot, not after.

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

| | knows about |
|---|---|
| `main.ts` | the config schema and the chain — no lifecycle, no hosting |
| `createApp`/`boot` | what modules declared, and how to register it on the server |
| `Server` | signals, phases, deadline, `/healthz`, `/metrics`, serve |

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

**The router is the spine, and it is generic** (ruled 2026-09-18). The
Server defines ONE router at the very beginning; every surface **plugs in
on a path hierarchy** — and the hierarchy is **the library's own, not
configuration**: tRPC is `/api/trpc`, REST is `/api`, the static bundle is
`/`, hard-wired where the router lives. No application code mounts,
moves or reorders a surface. Routing is by path prefix, never by an
ordered list of handlers each inspecting a request and claiming it. The
router is passed down the stack and appended to; the beginning of a path
can never be changed by whoever received it. Security headers are a **base
policy in the library plus per-surface overlays** — every response carries
the base; the static surface overlays CSP and asset caching, the API
surface its own set; each surface class composes its overlay and no
deployment assembles headers. The router itself knows no
transport vocabulary — tRPC hosting, REST hosting, asset serving, security
headers, trusted-proxy handling and browser-session composition are each
their own class in the package that owns that concern, and each arrives
with what it declared (registry-resolved, §3), never with a hand-assembled
composition bag. There is no "door": `boot()` registers every installed
module's declared transports onto the router, and the main never sees a
namespace, a mount, or any transport internals. Transport auth follows the
same rule as every dependency: it resolves from config, verifiers built
with their secrets at construction, and an override stated inside the
surface's own `expose` member block (§4) takes precedence over config —
tests and special deployments override in code, scoped to the surface it
guards; an ordinary deployment states nothing.

**Deployment-choice modules are one line in the main.** The audit sink is
the worked example: OSS composes `auditLogNullServer` (records nothing),
an enterprise deployment swaps in its real module — one `.withModules`
line, no conditional wiring.

**The worker** is the same file with `role: "worker"` and `server.run()`
instead of `serve()`. The role decides what `boot()` hosts: jobs and
subscriptions instead of HTTP doors. Liveness/metrics is a built-in Server
component. There is no third thing a worker does — install, and that's it.

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

The `processModules` list is generated from `modules/catalogue.json`
(`pnpm generate:modules` → `@langwatch/installed-modules`). **Installing a
module edits the catalogue, never a root.** The generated `createServerApp`
owns the chunked chain TypeScript's instantiation depth forces; no
hand-written file names a chunk. Uninstalling a module that another module
peer-depends on fails to compile, naming the dependent.

**The root never grows.** A change that needs it to grow has found a gap in
the primitives; report the gap, never widen the root.

---

## 6. Config

**Every value is declared at its owner; the parse is generated; apps hold no
config file** (settled 2026-09-18 — this section replaces every earlier
iteration).

```ts
// modules/github/process/src/github.server.ts — the module declares, on itself
static configSchema = z.object({
  appId: z.string().optional(),               // GITHUB_APP_ID
}).readonly();

// apps/api/src/main.ts — the app's entire involvement
const server = await Server.create("langwatch-api")
  .withSecrets(secretsChain())
  .withConfig(apiConfig())                    // generated from the installed list
  ...
```

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
in an app is a defect. Every key is a **root object** — `process` for the framework
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
dependency. A module's config slice may not declare a key `keys.json`
classifies as `secret` or `composite`; the schema generator refuses it by
name. Connection strings are composite secrets, so they belong at the
dependency-construction seam, never in a config object a module reads.

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
configured is derived *inside* the module from its declared slice plus its
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
export const storesConfig = (modules) => Config.group({
  tier:       Config.value(z.enum(["live", "memory"]).default("live"), { env: "LANGWATCH_STORES" }),
  postgres:   Config.value(z.string().url(), { env: "DATABASE_URL",   developmentDefault: "postgresql://…localhost…" }),
  clickhouse: Config.value(z.string().url(), { env: "CLICKHOUSE_URL", developmentDefault: "http://…localhost…" }),
  redis:      Config.value(z.string(),       { env: "REDIS_URL",      developmentDefault: "redis://localhost:6379" }),
}).refine(/* rule 1: live + a required store unset → refuse naming modules and key
             rule 2: memory + NODE_ENV=production → refuse by name */);
```

| You did | What happens |
|---|---|
| forgot `DATABASE_URL` in production | refusal: *"live stores: trace, annotation require postgres; DATABASE_URL is unset"* — **never memory** |
| `LANGWATCH_STORES=memory` locally | whole process on memory twins, stated, one line |
| `LANGWATCH_STORES=memory` in production | refusal: *"asked to run production on memory storage"* |
| typo'd the knob | enum refusal — not a fallback to either side |

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
- `publicRoute`/raw results only for genuinely non-JSON protocols (SCIM,
  OAuth device flow, MCP streams, webhook raw bodies) and the documented
  `*-legacy.rest.ts` family, each carrying a one-line reason.
- The **process** mounts declarations; `boot()` opens the hosts. A module
  never mounts anything.

---

## 9. Eventing

The module declares its whole pipeline once:

```ts
// modules/trace/process/src/eventing/trace.pipeline.ts
export const tracePipeline = definePipeline("trace")
  .withEvents(traceEvents)                          // zod-typed, versioned
  .withCommands({ ingestSpan })                     // validate → append
  .withProjections({ traceSummary })                // fold → read model      (worker-only)
  .withSubscribers({ onSpanIngested })              // reactions, idempotent  (worker-only)
  .withJobs({ retentionSweep: cron("0 3 * * *") }); // schedules              (worker-only)
```

`boot()` translates the same declaration per role — **api is commands-only,
structurally**:

| | role `"api"` | role `"worker"` |
|---|---|---|
| commands | send (append + return) | send |
| projections / subscribers / process managers | **never constructed** — nothing to call | hosted, per-aggregate ordered |
| scheduled jobs | never constructed | hosted |
| eventing supply the role's chain demands | `EventingProducer` (the type) | `EventingHost` (consume + produce) |

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
const ui = await createUi({ mount: "root" })   // document + meta-tag config read are defaults
  .withModules(browserModules)
  .render();
mountShell(ui);                                 // shell/: providers + router over declarations
```

`createUi` reads the injected public config from the DOM meta tag by default
(`withInjectedConfig` is a test-only override) and validates it against every
installed browser module's declaration **before a component renders**. Browser
modules register everything — screens, drawers, api bindings, surfaces — via
their declarations; the app contributes only the shell chrome
(`src/{main.tsx, shell/, styles/}`).

**The declaration is the module's one browser export that matters** (landed
2026-09-18): a browser package's `exports` map lists `./declaration` first,
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

### 10.1 Shared browser machinery (ruled 2026-09-18)

The browser mirrors the process grammar, adapted rather than copied — when a
browser shape has no obvious process twin, the shape is asked for, not
invented:

- **Capability classes on the shell.** Everything shared (analytics, session,
  navigation, environment) is a small class composed by the shell and received
  by modules only through their declared `*HostApi`. Ambient React context is
  never a cross-module transport; modules never import a vendor (posthog,
  router, theme) directly.
- **One Analytics capability** wraps every instrumentation destination
  (posthog, gtag, browser tracing). Modules emit named events through it —
  the browser twin of a channel.
- **State defaults to server state**: react-query over the derived tRPC
  client is the normal answer, so cross-module client state is rare and ruled
  case by case. The unit of browser sharing is the **published hook** — the
  owner publishes hooks through its kit; shared mutable-state packages are
  not a tier.
- **apps/ui holds no product code**: `main.tsx` + `shell/` (+ `styles/`)
  only. The former `behavior/` layer dissolves — shared machinery becomes
  shell capability classes, module-specific parts move into their owning
  module's browser half.

---

## 11. Enterprise

`enterprise/modules/<name>` mirrors the module shape exactly and **exports
modules like any other** — the generated lists carry core and enterprise
tiers, and the same catalogue installs both into the same processes. There is
no enterprise composition package, no separate wiring, no conditional
mounting: **enterprise routes are always mounted and refuse per-organization
on entitlement**. The licence leg is the `licenseSource` supply token,
provided by the process.

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
const runtime = await createApp({ role: "api" })          // no server: nothing to tear down
  .withModules([annotationProcessModule, traceProcessModule, presenceProcessModule])
  .withConfig({ annotation: {}, trace: {}, presence: {} })
  .withStores(memoryStores())                              // branded → memory tier everywhere
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
array; `get*` = one or throws).

---

## 16. Renames in flight

This document names the target. **Landed 2026-09-18:** the tree rename
(`modules/*/process`, `*/browser`, `*/browser-kit`; package names
`*-process`/`*-browser`/`*-browser-kit`), `@langwatch/process-stores`,
`@langwatch/browser-host` (+drawer), `@langwatch/browser-trpc`, plan-gate
dissolved into `entitlement-contract`, and `.withStores(stores)` on the
chain. New code uses the left column only.

| Target | Today |
|---|---|
| `@langwatch/module` (light core) | `@langwatch/kernel`'s token half |
| `@langwatch/process` | `@langwatch/process-server` + kernel's boot AND declaration halves |
| `@langwatch/browser` | `@langwatch/ui-kernel` (boot half) |
| `createProcessApp(role)` | `createServerApp(role)` (generated) |
| `openStores(config)` | `createProcessMembers({ config })` |
| `defineProcessModule` / `defineBrowserModule` | `defineServerModule` / `defineWebModule` |
| `traceProcessModule` / `processModules` | `traceServer` / `serverModules` |
| `TraceModule` + `.withApi(...)` | `TraceApp` + `.withApp(...)` |
| `<f>.module.ts` / `<f>.web.ts` file stems | `<f>.server.ts` / `<f>.web.ts` |

Also open, each a worklist: the config-defined dependency state migration
(§6 — deletes the remaining bespoke member tail and the `licenseSource`
token); eventing member composition for both roles; `browserModules` is
empty (no module exports `./declaration` yet — the browser serves chrome
only); the ClickHouse resolver ruling (§7); worker job declarations designed,
not landed.

---

## 17. Enforcement

The linter is the authority: the file grammar lives in
`packages/oxlint-rules/grammar/feature-layout-policy.mjs`, the boundaries in
`packages/architecture-enforcer/`, the banned spellings in
`banned-legacy-names`. ADR-147 (compiler-checked supply) and ADR-148
(declared browser supply) are the ruling decision records and are cited by
this document; all earlier composition ADRs are historical. When someone
finds this document teaching something the tree refuses, the fix is a change
to this file in the same commit as the code — an out-of-date architecture
document is worse than none, because it reads authoritative.

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

**One exception to "no product code" in shape, not in kind (R4, Alex, 2026-10-01).** An app may also
hold a generated module list: the process apps (`api`, `worker`, `tasks`) each carry the list of
installed process halves in `src/process-modules.generated.ts`, and `apps/ui` the list of installed
browser halves in `src/browser-modules.generated.ts`, written by
`pnpm generate:modules` from `modules/catalogue.json` and never edited by hand. Each app depends only
on the half it runs, so no declared edge reaches a browser package from a process app. The
`installed-*` packages are deleted.

`apps/scenario-child` is the one exception: a standalone program the scenario
module spawns per run, which owns its own logic (adapters, turn execution) and
reads the parent-child protocol from `@langwatch/scenario-contract` (Alex,
2026-09-28). The scenario module locates the program by its own path under the workspace root; no member and no app import carries it (Alex, 2026-09-29).

**Agent runtimes** (Alex, 2026-10-01): scenario owns execution orchestration and a versioned
child protocol. Each runtime declares its input schema, executable artefact, resource class and
cancel/drain behaviour. A host chooses which resource classes it consumes, independently of which
APIs it installs, and admission uses weighted slots. The child stays a narrow runner.
A worker admits only the resource classes it consumes, within a weighted slot budget (voice weighs 1),
and each runtime declares its stop signal (Alex, 2026-10-01).

`apps/*-web` are the internal consoles (haven hub and stack home, IdP
simulator, mail sink): React bundles built by Vite and served by their Go
owner, on `@langwatch/design-system-internal`, `@langwatch/sim-console` (the simulators' shared shell) and `@langwatch/time` only,
importing nothing from `modules/` ([ADR-160](adr/160-internal-consoles-are-go-served-react.md); Alex,
2026-09-28).

**The same code runs everywhere.** One `main.ts` per app, byte-identical
across laptop, CI and production. Application logic is shared and the parsed
environment differs; hosting differs too: locally one process and one shared module
runner and event loop can host ui, api and worker (§19), so a combined boot proves no
multi-process lifecycle or singleton isolation (Alex, 2026-10-01). There
is no dev-only branch anywhere in an app, because an app has nowhere to put
one.

---

## 2. The package family

Named by one rule: **where the code runs, or what it declares.**

|          | core                | runs + declares      | reads                       | wire                 | shares          |
| -------- | ------------------- | -------------------- | --------------------------- | -------------------- | --------------- |
| **Node** | `@langwatch/module` | `@langwatch/process` | `@langwatch/process-stores` | `@langwatch/api`     | contracts       |
| **Web**  | `@langwatch/module` | `@langwatch/browser` | `@langwatch/browser-host`   | `@langwatch/browser` | `<name>-client` |

The core is a contract's only framework import and is incredibly light;
each runtime owns the declaration vocabulary for its own half, so weight is
imported the rest of the way down, never from the top. This stays strict and gains a lint; the date and
hosting helpers move where a contract may import them (Alex, 2026-10-05). Until they do, analytics' and
trace's contracts import `@langwatch/api/dates` and gateway's `@langwatch/api/hosting`.

- **`@langwatch/module`** — the light core, and ONLY what a contract needs:
  the `moduleApi` token factory, module ids, UI tokens and
  release-flag tokens (§10.1; Alex, 2026-10-01), and the contract declarations (`defineTrpcContract`, `defineRestMiddleware`). Zod-only,
  framework-free, browser-safe, near-zero weight. Every contract depends on
  it; it depends on nothing but zod. The heavy declaration vocabulary is NOT
  here — it lives in the runtime that consumes it, so nothing backend-shaped
  ever enters a contract's (or the browser's) graph from the top.
- **`@langwatch/process`** — the Node runtime AND the process-half
  vocabulary: `Server` (signals, fatal handlers, ordered teardown, hosted
  components, `/healthz`, `/metrics`), `GracefulShutdown`, the container
  (§4), boot and transport hosting — plus
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
- **`@langwatch/browser-host`** — the host services a screen reads: session,
  navigation, storage, toasts, **drawers**. The browser analogue of the
  closed members. Host services only — components live in the design system;
  release flags come from feature-flag (§10.1).
- **The browser's wire** lives in `@langwatch/browser`: the transport (the SSE
  subscription link), the browser RPC and the query
  client. Only a `<name>-client` package and a screen's behaviour import it; design-system components
  fetch nothing. The client types are
  derived from contracts by `@langwatch/api/web`; the browser calls no REST.
- **`@langwatch/design-system`** — components (Chakra v3 underneath). Only this package imports
  `@chakra-ui/*` or `@emotion/*` (Alex, 2026-10-01): feature browsers, apps and tests import
  `@langwatch/design-system/<subpath>`; `./primitives` re-exports Chakra's primitives and raw parts
  unchanged until real components replace them, wrapped parts come from their wrapper subpath, and
  tests mount `renderWithDesignSystem`. ADR-001 amended; enforced by `no-direct-chakra` (wave 4).
  **Colour is made only here** (Alex, 2026-10-01): elsewhere code names semantic tokens (`fg.*`,
  `bg.*`, `border.*`, `fg|bg|border.<status>`, `<palette>.<role>`, `chart.N`, `accent.*`,
  `bg.scrim`), never a scale step, hex, `rgb()` or bare white/black. A library that needs a string
  takes Chakra's `useToken` / `system.token.var` (a variable that follows the mode) or
  `getRawColorValue` / `useColorRawValue` (a literal for the current mode). Enforced by `no-raw-color`.
- Support packages: `handled-error` (the error contract and its presentation: `/presentation`,
  `/app-codes`, `/docs-url`, `/read-handled-error`; `error-views` stays its own package because it
  depends on the design system), `authorization` (principals, grants, the principal and credential types and the one `ledgerActorSchema`; no contract imports `@langwatch/api` for them, Alex, 2026-10-01), `secrets`
  (ADR-132), `config` (generic config machinery), `observability` (logger +
  OTel), `test-harness` (fixtures and doubles, including `./api-fixture`), and the raw clients
  (`prisma-client`, `clickhouse-client`, `redis-client`, `eventing`).

A package earns existence by being framework, not feature. Feature code in
`packages/` is a defect. The boundary is prefix-checkable: nothing `browser-*`
in a server graph; no `process*` package in a web graph.
Trace's query language and content dispatchers are to be a trace-owned package, portable and
framework-free, which trace's process, the server and any browser import, in neither the contract nor
a shared browser package (Alex, 2026-09-29). It is not extracted yet: no `modules/trace/query-language`
exists, and the field metadata sits in trace's contract (`trace-query-metadata.ts`). Trace and analytics read the same trace data, and
operational state has one owning writer. Analytics may own declared analytical read models fed from
owners' facts; each cross-subject query names its read-model owner, grain, join keys, late-update
semantics and freshness. Today's trace and evaluation analytical joins are a named compatibility
surface until migrated, not licence to query a peer's tables (Alex, 2026-10-01; replaces the
open item of 2026-09-29).
Analytics' filter field registry (`availableFilters` and its field types) is `modules/analytics/filters`
(`@langwatch/analytics-filters`), an analytics-owned package, portable and framework-free on the same
terms; analytics' browser and automation's process import it (Alex, 2026-09-30).
The unkeyed-filter detector (`findUnkeyedFilterFields`) moves to the contract that owns the filter grammar,
and both trace search and automation triggers import it (Alex, 2026-10-05): that is
`@langwatch/analytics-filters`, which owns `requiresKey` and which automation already imports, so trace's
process becomes an importer (coordinator, citing that ruling, 2026-10-05). Trace owns the metadata columns, so
trace-contract exports main's two metadata key/value condition builders (the three storage formats) and
analytics imports them: one copy, a contract export, not an Api operation (Alex, 2026-10-05).
The instant-evals consent columns stay on `Organization`: organization owns them, and instant-eval reads and
sets them through new `OrganizationApi` operations. Monitor reads an evaluator's effective settings through one
new `EvaluationApi` read operation. Billing's Slack channel is renamed `billing-alert` (`BillingAlertChannel`),
ownership unchanged (Alex, 2026-10-05).

---

## 3. A module

A module is one folder owning up to four workspace packages, plus any portable, framework-free library its
process and browser both import (`modules/analytics/filters` is one; Alex, 2026-09-29).
`modules/catalogue.json` maps every subject to exactly one owning module.
The owning module's process serves the subject's endpoints and runs its collection; another module's
share crosses only as its `*Api` ops. Where main hosted a subject elsewhere (`traces.logCollection`),
the port moves it to its owner — main decides _what_, the record decides _where_ (Alex, 2026-09-25).
A tRPC namespace belongs to one module: a procedure main hosted under another subject's namespace
moves into its owner's namespace and the wire path moves with it (Alex, 2026-09-25).
Enterprise is a licence, not a separate app: enterprise modules are always installed, and a core module
may import an enterprise contract or client like any peer's. The enterprise owner refuses per organization
on entitlement; a core caller never re-checks (Alex, 2026-09-29). Operator views over enterprise subjects
(license registry, self-hosted instances) live in an enterprise ops module that calls the owners' `*Api`s
(Alex, 2026-09-25).
Enterprise-licensed subjects moving to their owner land in that owner's enterprise module
(`enterprise-gateway` owns routing policy and personal virtual keys), never relicensed into core (Alex, 2026-09-25).
Enterprise modules mirror the shape exactly under `enterprise/modules/`.
Usage is a module of its own and owns all counting: the counters, their enforcement, the warning
thresholds, the billable-events meter (SaaS only; a projection and its table), and the trace count it takes itself.
Entitlement keeps plans and features only. Usage is events (Alex, 2026-10-01): limits travel as
`limit_reached` and `limit_cleared`, the month's total as `month_counted`, and no module asks `UsageApi`
for either, so no trace-usage or billing-usage cycle forms (Alex, 2026-09-29). `UsageApi` exists with zero
operations. Billing peer-subscribes to `month_counted`; a lower corrected total goes to Stripe as a negative
meter event (Alex, 2026-10-01). Per-entity periodic work is a keyed process manager (§9, "Per-entity calendar
work"), never `.schedule`. Every limit is soft:
eventual and fail-open, with a documented enforcement lag and overshoot (Alex, 2026-10-01).
Not built yet (Alex, 2026-09-30): `entitlement -> trace` and `trace -> entitlement` are peer cycle edges
the peer-cycle test refuses until usage lands (the allowed list is gone, §5; Alex, 2026-10-05).
Slack is a module of its own (Alex, 2026-09-30; supersedes ADR-093 §5a on ownership). `modules/slack`
owns the Slack connection subjects: the `SlackIntegration` table, its repositories and services,
`SlackApi` (main's list, create, update and delete of a connection, plus the reads delivery needs), the
`slackIntegration` tRPC namespace, `/api/slack-connections`, the `slackConnection` drawer and
`slack-client`, which automation, integration and langy read their connection data through. Automation reads a connection only
through `SlackApi` and keeps its own delivery.
A connection in use is claimed, not counted (Alex, 2026-09-30). Slack owns `slack_connection_claim`;
automation claims a connection through `SlackApi.claimConnection` when it saves a trigger on it and
releases it through `releaseConnection` when the trigger moves off it, pauses or is deleted.
`deleteSlackConnection` refuses while any claim exists (409 `slack_connection_in_use`, naming the
claimants), and the connection's dependent count is its claim count. Slack never reads automation's
triggers.
`modules/integration` owns `/settings/integrations` (Alex, 2026-09-30). Its browser renders both cards:
the GitHub card, which reads github through `GithubHostApi` and a client derived from github's contract,
and the Slack card, over `slack-client` data. Github lends no card and keeps no UI on the page;
integration has no client, since nothing outside it would read one.

```
modules/trace/
├── specs/ · adrs/
├── contract/       @langwatch/trace-contract       shared by everyone
├── process/        @langwatch/trace-process        the half createApp installs
├── browser/        @langwatch/trace-browser        PRIVATE — the half createUi installs
└── client/         @langwatch/trace-client         the data other browsers read, never a component
```

No module has a `feature.json` at its root, and nothing reads one. Five modules still carry
per-feature `feature.json` files under `browser/src/features/` (governance's included): leftovers to
delete, not a shape to copy. A sub-feature whose module and backend already exist is split out into that module;
the rest stays contained, flattened, in its module (Alex, 2026-09-29).

**Dependency direction, no exceptions:** apps → `*-process`/`*-browser` →
`*-contract`. Browser never imports process; process never imports browser;
contract imports no framework and no other half. Another module imports only
the owner's **contract** and names the owner's `*Api` token; nobody imports
another module's service, repository, or browser package.
A declared dependency is an edge even when nothing imports it: a contract's `package.json` names no raw
client or process runtime (`eventing`, `group-queue`, `prisma-client`, `clickhouse-client`, `redis-client`,
`process-*`), and the package-cycle check walks every workspace package, `packages/*` included. The
`manifests` and `cycles` policies refuse both (2026-09-30).

### 3.1 The contract

Zod schemas with `infer`, portable types, `HandledError` subclasses with
stable codes, the tRPC declarations (`defineTrpcContract`: every procedure's
name, kind, input, output, declared once), **the module's config schema**
(§6), and the callable API:

```ts
export interface TraceApi { ingestSpan(...): ...; getById(...): ...; }
export const TraceApi = moduleApi<TraceApi>()("trace");
```

### 3.2 The process half

```ts
// modules/trace/process/src/trace.module.ts — the installer
export const traceProcessModule = defineProcessModule("trace")
  .withRepositories(traceRepositories) // registry: { live, memory }
  .withChannels(traceChannels) // registry: { live, memory }; the container builds both (§5)
  .withApi(TraceModule) // the one class implementing TraceApi
  .withTransports(traceRest, traceTrpc) // inert declarations
  .withEventing(tracePipeline); // §9
```

No `.build()`: every `with*` result is installable. `index.ts` exports the
installer and transport declarations, **nothing else**. The installer lives in `<f>.module.ts`, the
module's identity; the `<Name>Module` class lives in `app/<f>.app.ts` (Alex, 2026-10-05: the record
follows the tree, no code moves). The class is thin forwarding (services carry the weight).

**`TraceModule`** is the implementation of `TraceApi`: `static contract`,
`static dependencies` (peer tokens), private constructor,
`static create(setup)`. Services and peers are `#private`; the public surface
is exactly the API's operations. The word "App" is retired inside modules.

The internal grammar (enforced by the linter — the grammar file, not this
document, is the authority on filenames):

- `services/` — one class per entity over repository interfaces, channels and
  narrow peer slices (`Pick<PeerApi, …>`) the module class hands it from its
  `static dependencies` (Alex, 2026-09-25). A service never opens a channel or
  a client itself, and never declares a peer — only the module class does.
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
  Messages to ourselves are `@langwatch/internal-slack` templates sent through
  the owning module's Slack channel. Slack a customer configures stays in
  automation's channels and never uses this package (Alex, 2026-09-28).
- `eventing/` — one folder: the pipeline and everything it names (§9).
- `transport/` — declarations only (§8).
- `rules/` — pure functions and constants; no clock, no I/O. Value types (data
  bags and the pure functions over them) live here too, not as `*Service`
  classes and not in a new slot (Alex, 2026-09-28).
- Ids: a new record's id is a KSUID with its resource prefix; ids minted before (nanoid, uuid) keep
  their format and stay accepted, since clients hold them as opaque strings (Alex, 2026-09-27).
  The prefix is the owning subject's name without hyphens: `slackintegration` (Alex, 2026-09-30).
- No `utils/`, `ports/`, `adapters/`, `composition/`, `lib/`, `helpers/`,
  `domain/`.

**A value is parsed once, where it enters untyped** (a transport, a channel's inbound message, a
fold's stored payload) and travels as its `z.infer` type after that: a service does not re-parse what
its transport or a peer's typed call handed it, and a Prisma repository does not parse columns Prisma
already types (Alex, 2026-09-28).

**A public signature takes one options object** (`max-params`), framework constructors and the Trace,
EventStore and log-record repositories included. The one exception is `ksuid`, whose signature is a
cross-language wire and is documented as such (Alex, 2026-09-29).
In module code a scope travels as a named parameter, never through `AsyncLocalStorage` (framework
trace-context propagation in `packages/observability` is the exception; identity's birth
ceremony threads its scope explicitly) (Alex, 2026-09-29).
The caller's `Authorization` is such a parameter: `authorization` passes from route to `*Api` op to service to
repository, never ambient (Alex, 2026-09-30; [ADR-166](adr/166-grant-scoped-data-access.md)).

**An implementation never sees a raw client** (Alex, 2026-10-01). No prisma, clickhouse, redis,
objectStorage or rateLimiter in any `*Module` class or service. A store client crosses into a module
in exactly one place: the `create(stores)` of one of its repository or channel registries, which the
container calls. The module class receives built repositories and channels.

### 3.3 What a module may demand — the four-way rule

A module cannot build what needs process information, because it does not
have it: deployment, availability, credentials and base URLs are the
process's knowledge. Every dependency a module has resolves into exactly one
of:

1. **Derivable from the opened stores with no extra info** (a tenant resolver
   over ClickHouse, an actor lookup over Prisma) → a repository or channel
   **inside the module**, built by the container from the module's registry (§5). No demand exists.
2. **Another module's capability** → a peer: the `*Api` token in
   `static dependencies`. The container resolves tokens; modules receive each
   other's implementations.
3. **A deployment fact** (signing key, public base URL, admin list) → the
   module's **declared config slice** or secret handle (§6). A process fact (`publicBaseUrl`,
   `isSaas`) is a leaf the slice picks from the one shared process config. Module
   code never reads `process.env`. The test process's boot seam is `packages/vitest-config`,
   read like an app's `main.ts`/`config.ts` (Alex, 2026-09-27).
4. **An availability decision** (a capability this deployment may not have) →
   the **module decides it** from its own config and secrets, and its public config projects the
   answer to the browser (Alex, 2026-10-01). Off refuses by name with a stable code, or is a
   visible state as mail's is (§6); never a silent absence. Nothing outside the module answers it.

**There are no members** (Alex, 2026-10-01): "member is just an abstraction over DI, and we
already have the container". A module class receives `repositories`, `channels`,
`dependencies`, `config`, `secrets`, `role` and `resources`, never a bag of clients or facts.
There are no supply tokens and no `.provide`; a test stubs a peer through the module's own test
seams (§13).

**Members are removed now** (Alex, 2026-10-05): before other module work, lanes remove `withMember`,
`app/<f>.members.ts` and `app/<f>-composition.build.ts` (deleted, §15), each member becoming a config leaf, a secret
handle or a peer `*Api`; then the grammar refuses the files. Where each kind goes (coordinator, members
wave, 2026-10-05, citing that ruling):

- **The cipher is a registry input**, not a member and not a shared helper: the live registry
  `requires` `encryption` and the live Prisma repository seals and opens, as model-provider, webhook and
  notification do; memory twins hold plaintext, and services stop sealing. Stored-object's memory-tier
  URL seal signs with a random per-process key, never plaintext.
- **A rate limiter is a named repository**, `<module>-rate-limit.repository.ts`, with a memory
  fixed-window twin; the live one wraps the store's `rateLimiter`, so Redis keys are unchanged (trace,
  46d240425b). Model-provider's talks to Redis with its own `model-provider:rate-limit:` keys, since
  wrapping would change its keys and its 429's reset time (accepted).
- **Shared deployment facts are shared leaves** (§6): `publicBaseUrl`, `nlpServiceUrl`, `serviceVersion`
  and `otelResourceAttributes` in `@langwatch/config`, `nlpInternalSecret` in `@langwatch/secrets`, one
  instance each, which `packages/process`'s `owner.ts` holds too. A module adds the leaf to its contract
  config.
- **The logger** is `createLogger("langwatch:<module>[:<part>]")` inside the module; **`processName`**
  (deleted, §15) gives way to the role; memory twins take time from `@langwatch/time`.
- **A task reads config**: `withTasks` factories receive the module's parsed config.

One unowned service has one owning module: evaluation owns the langevals boundary — its endpoint,
the S3 staging of large payloads and their config — and topic and workflow reach langevals through
`EvaluationApi` (Alex, 2026-09-25).
Workflow owns the NLP engine boundary the same way. The per-project studio fleet
(`LANGWATCH_NLP_LAMBDA_CONFIG`) is workflow's own declared `Secret.load` handle, parsed at boot;
its shared ARN cache and its staged oversized payloads are workflow repositories over the `redis`
and `objectStorage` clients, as evaluation stages langevals payloads. Precedence is main's: a
named fleet wins, a named fleet that cannot be used refuses every run by name rather than falling
back, no fleet and an address runs at the address, and neither refuses by name (Alex, 2026-09-30).
Notification owns mail outright: its config, its provider and its sending. No other module holds mail;
auth, identity, user, automation and billing send through `NotificationApi.sendEmail`, which takes
intent (`undisclosedRecipients`, `unsubscribe: { url }`, `replyless: { tag }`, which notification
writes as `no-reply+<tag>@<its sender domain>` with the recipients in bcc), never raw headers (Alex, 2026-09-29).
Presence is a generic project-event fan-out: `PresenceApi.publishProjectEvent` and
`subscribeProjectEvents` carry any channel, and each publisher owns its channel's name and schema; the
contract carries no `EventEmitter`. Scenario and trace publish through it and keep no Redis broadcast of
their own, notification's copy is deleted, and the memory tier emits locally (Alex, 2026-09-29).
Presence is the only writer of the browser-facing `broadcast:*` wire: trace, discover, simulation, experiment
and Langy signals stay presence data channels with their own SSE procedures, and the framework's read hints
arrive on eventing's own `eventing:read_invalidated` channel, which presence subscribes to and relays (Alex, 2026-10-01).
Langy owns its mirror project id: it stamps the mirror tier on the Langy key it creates through gateway,
and gateway stores it on the key; no composition supplies the value (Alex, 2026-09-29).

The legacy `filters` grammar (a filter field to a parameterised ClickHouse condition over `trace_summaries` and
`stored_spans`) is trace's, as the owner of the tables it reads; analytics' filter pickers ask
`TraceApi.translateLegacyFilters` for their scope (Alex, 2026-09-29).

Enterprise-licensed code stays in enterprise modules: auth (open) obtains the SSO provider configs better-auth needs from
`SsoApi`, building better-auth lazily so no peer is called during construction (Alex, 2026-09-25).
Model provider asks the enterprise `ManagedProviderApi` whether LangWatch supplies a provider's credentials and
for a managed call's parameters, naming the project's organization itself so managed-provider holds no project
peer and closes no construction or package-import cycle (Alex, 2026-09-29).

### 3.4 The browser half; no kits

`trace-browser` layers: flat public entries → `model/` (pure) → `behavior/`
(hooks, api bindings, stores) → `ui/elements|blocks|sections`. Elements and
blocks cannot fetch. The tRPC client is derived from the contract's
declarations (`@langwatch/api/web`), never hand-written, never from a router type.
Its inputs and outputs are typed from those declarations, never `any` (Alex, 2026-09-24). An
interactive element is the native one (`button`, `a`, `input`) styled through the design system to
look as before; a `div` given a role is not (Alex, 2026-09-24).
A screen reads host services directly, typed by tokens: `useLent`, `openDrawer`,
`useFeatureFlag` (Alex, 2026-10-01; it keeps its name and leaves §15's deleted list, Alex 2026-10-05). A `*HostApi` keeps
only a module's own host needs, which the shell implements from `browser-host` capabilities. The half is declared with
`defineBrowserModule` — screens (each may name the release `flags:` it sits behind, §10.1), drawers, publications, host mounts — and
exported at `./declaration`; the generated `browserModules` list (`apps/ui/src/browser-modules.generated.ts`) installs it.

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

A folder over 30 source files is grouped into features, not left flat; a process nests the same
way, `process/src/features/<concern>/` holding that concern's services, rules and the rest
(Alex, 2026-10-01).

**Process and contract nest the same way** (Alex, 2026-10-01): a folder past 30 source files is grouped into concern features of small, single-responsibility classes, never a pile of loose root-level functions. `process/src/features/<concern>/` repeats `services/`, `rules/`, `repositories/` and `eventing/`; `contract/src/features/<concern>/` holds that concern's schemas, events and commands. What every concern shares stays at the top level; a concern's pieces move together. A lint budget on files per folder and lines per file keeps it from growing back. Nesting is one level: a module takes as many concerns as keep each folder at 30 or under, never `features/<a>/features/<b>/`. A framework package groups its files into plain folders behind unchanged `package.json` export subpaths.

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

Nothing stopped an OWNER growing
subpaths, and that is the hole the tree fell through — 23 packages opened
`./surfaces/*` entries and 626 cross-module import lines walked in, none of
them a dependency-graph edge any baseline could hold. The exports map IS the
enforcement: what is not exported cannot be reached, so closure is structural
rather than a lint the next refactor forgets. Closure never needed a new rule,
only a door that shuts. `surfaces/` and `screens/` are deleted spellings
(§15).

**No kits; data through clients** (Alex, 2026-10-01). There are no kits and no shared browser
packages. Code repeated within one module stays in that module; repeated across modules it goes to
the design system, which takes props or a query RESULT (never a hook, never fetches); pure domain
logic goes to the owner's contract; framework hooks go to `browser-host`. Modules share data, not code: every
module with tRPC has a `<name>-client` package (`modules/<name>/client`) holding the hooks
`createModuleApi` derives from its own contract and at most a few thin convenience hooks, never a
component. A client imports only its contract and `@langwatch/api/web`, never another client; a
hook combining two modules lives in the screen that needs it. Kits and their law existed until
2026-10-01 and are gone; what remains of them is that browser packages are closed.

**A screen expects its data to be missing** (Alex, 2026-10-01). The frame (header, tabs, actions)
renders at once; each block loads on its own behind a skeleton in its final shape. Data already
held stays on screen while it reloads (a shimmer at most, never hidden, never a skeleton). An error
shows inline in its block with Retry, and Retry shows the loader or skeleton at once. Empty,
loading and error never look alike. A full-page spinner is for the first boot only.

**A browser package is closed.** Nothing else imports it, ever; sharing is by data through
`<name>-client`, or by the design system, the owner's contract and `browser-host`, as the paragraph
above rules. Closed to values only: an `import type` / `export type` of a browser package crosses,
because types are erased (Alex, 2026-09-27). A component that fetches a peer's data or reads a
`*HostApi` is lent by its owner's token (§10.1) and the consumer renders what it is handed. A flow
opens as the owner's drawer by name: ops' SSO import opens sso's register-connection drawer
(Alex, 2026-09-29).

### 3.5 Can this be used here? Four capability layers (Alex, 2026-09-29)

"Capability" means exactly these four layers. Each has one owner and one answer; nothing else
decides it, and no layer, projection or screen re-derives another's answer.

| Layer                   | Question                                                                   | Owner and where it is answered                                                                                      | How the browser learns it                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Deployment availability | Does this install have it (email, object storage, langevals, the gateway)? | The owning module, from its own config and secrets, answered once inside the module (§3.3 rule 4; Alex, 2026-10-01) | A public-config boolean projected from that same answer after the module is built; never recomputed from config leaves or secret presence |
| Entitlement             | May this organization use it (plan, licence)?                              | `EntitlementApi`; routes stay mounted and refuse per organization (§11)                                             | An entitlement read through the owner's `*Api`                                                                                            |
| Permission              | May this user do it?                                                       | authz; the service checks before acting                                                                             | The session's `hasPermission` / `hasOrganizationPermission`                                                                               |
| Release flag            | Is it rolled out here yet?                                                 | Feature flags                                                                                                       | The flags host service                                                                                                                    |

**Fixed bounds read the registry; per-organization bounds ask entitlement** (Alex, 2026-10-01). A
bound fixed before any organization is known (a route's body limit at declaration, a default page
size, a per-IP rate limit before auth) reads `@langwatch/plans` directly. Every bound that varies
by organization goes through `EntitlementApi.requestBound` / `assertWithinUsageLimit`. Known gap:
fixed bounds do not honour the `LANGWATCH_REQUEST_BOUNDS` override.

**Off is opaque by default.** The feature is hidden or disabled, and the screen says only "contact
LangWatch support" (SaaS) or "contact your administrator" (self-hosted), never why. A reader holding
the permission that could fix it may be told what is missing, through a read only that permission
answers: the explanation is never in public config or in any page's HTML for everyone.

**The LangWatchQL catalogue names who may read** (Alex, 2026-09-30; ADR-082 amended). Analytics'
`LWQL_CATALOG` is `defineLwqlCatalog({ <view>: defineTableCatalogue({ sourceTable, access, columns }) })`.
The row type is looked up from `sourceTable`, never passed, so completeness is checked against the
stored table. `access` is `{ allOf }` or `{ anyOf }` over authz permissions, never empty. Every stored
column has an entry, or the catalogue fails to compile: `"inherit"` (its own name, table access only),
`"omit"` (exposed nowhere, never a `source`) or `{ source?, access?, content? }`. Keys are exposed
names and `source` names the stored column. `content` is `"input"`, `"output"` or both, decided by
data-privacy's policy, never by authz; a cost column carries `access: { allOf: ["cost:view"] }`. The
database's column grants derive from the same catalogue and stay the backstop.

It resolves per principal and scope through `AuthzApi` (`resolveAccessibleCatalog`, no new operation);
the project as principal holds everything. As before, a table the caller may not read is hidden and
refused with `TABLE_NOT_ALLOWED`; a column is listed unavailable with its gate and refused with
`GATED_COLUMN`. Privacy group audiences apply: group ids come from `AuthzApi.getAccessBreakdown`, read
only when an audience names a group, and a failed read means no groups. A key spanning projects fails
closed: a table is refused if any of its projects lacks it. Filtering per project within one statement
is a tracked gap (`@unimplemented` in `specs/lwql/catalogue-grants.feature`).

**Authority fails closed, tooling fails open** (Alex, 2026-09-30). A failed authz check is a plain 500
with no rows, never a partial answer. The LWQL editor still edits without a schema (grammar only), a
failed validation clears its markers, and Run always asks the server. Its markers come from the
`analytics.lwql.validate` query (Alex, 2026-09-30), the server's own validator, which never executes;
the browser never validates.

The shell's lent services (session, navigation, storage, toasts, drawers) are **host
services**, not capabilities (§16). Enforcement is prose for now; a lint rule follows once email is
converted (no availability logic in `*.config.ts` projections; off states use the shared notice).

**Ops and Cloud admin are split by audience** (Alex, 2026-09-29). **Ops** (`/ops/**`) is for every
instance operator, self-hosted included: the dashboard, event sourcing, the foundry, flags,
migrations, and instance administration (users, organizations, projects, SSO connections,
identity lookup, directory sync). **Cloud admin** (`/ops/cloud/**`) is LangWatch's own company
tooling (subscriptions, licences, self-hosted instances, bug reports): the ops gate plus ops's own
cloud-ops capability, invisible and refused elsewhere. `/ops/backoffice/**` redirects; "backoffice" is
a deleted name (§15).
The capability is ops's, from its own config and secrets, never `isSaas`: ops config asks for cloud
ops (`LANGWATCH_CLOUD_OPS`), and ops's secrets hold the licence private key, which must match the
release's built-in public key. Asked for without a matching key refuses boot (Alex, 2026-09-29).

---

## 4. A process, whole

```text
apps/api/src/main.ts                 # process declaration, at most 50 lines
apps/worker/src/main.ts              # same graph, consuming pipelines
packages/api/src/hosting/            # HTTP mux, API hosts and browser bundle
packages/api/src/policy/             # headers, CSP and client address
packages/process/src/                # boot, lifecycle and peer composition
```

The application declares what it serves through `exposeTransports`.
Framework classes implement hosting. **The container** (`server.container(role)`) installs the
modules, opens the stores and boots. Nothing more (Alex, 2026-10-01): it holds no members, answers
no supply and takes no `.provide` or `withMember`. Authentication policy stays in the API runtime. auth
binds the one API door (sessions, key credentials, plan gate, audit sinks) from
the peers it already holds, in its own transport facts; the process opens it
before its hosts and builds both over it. A process with no door, or two,
refuses boot by name, and `@langwatch/process` names no module contract but ops (its
admin edge). This keeps transport machinery out of `main.ts` without making
the API framework import the feature implementations which depend on it.

There is no per-app config schema (ruled 2026-09-18): config comes from the
installed server modules' own declared schemas, composed by the generated
parse (§6). An app's `config.ts` holds none of it: api's and worker's is only
`processEnvironment`, the one place `process.env` reaches the preamble; tasks' names its
own runner controls and connections, and scenario-child's reads what its parent stated.
A hand-maintained per-app config of what modules own is a defect. One rule, here and in §6:
an app's `config.ts` holds only that environment seam, never a module's config or a connection
string (Alex, 2026-10-01). Only `config.ts` reads `process.env`, apps' `main.ts` included, and
`langwatch/environment-boundaries` refuses the rest (Alex, 2026-10-05).

```ts
// apps/api/src/main.ts
import "@langwatch/time/polyfill";
import { processModules } from "./process-modules.generated.ts";
import { processTelemetry } from "@langwatch/observability/node";
import { processConfig, Server } from "@langwatch/process";

const server = await Server.create("langwatch-api")
  .withConfig(processConfig(processModules))
  .withSecrets((config, secrets) =>
    secrets.withEnv().withFile().withOnePassword(config.process.onePasswordAccount),
  )
  .withTelemetry(processTelemetry("langwatch-api"))
  .start();

const app = await server
  .container("api")
  .exposeTransports((transports) => transports.trpc().rest().browserBundle())
  .boot();

await server.serve(app);
```

```ts
// apps/worker/src/main.ts — the whole difference
// Same installed list (apps install fully, jobs call modules in-process); the role
// decides pipelines: consumers, jobs, process managers.
const app = await server.container("worker").boot();

await server.run(app);
```

**Transport selection and pipeline participation are separate fluent APIs.**
`exposeTransports` exists only on the API builder. Its callback selects
`.trpc()`, `.rest()` and `.browserBundle()`, plus `.framedDocument({ path,
document })` for a module-built document that answers on the app origin
under the sandbox frame policy (a fresh nonce per answer, its own CSP, never
the app's); it carries no logger, stores, credentials or paths. An unselected surface is skipped (D3,
below).
The bundle is explicit, including an explicit opt-out for deployments
without one. There is no `withModules` and no `withPipelines` in an app: a container takes its
modules from the owners the app already handed to `withConfig(processConfig(processModules))`,
so `packages/process` never imports the installed list, and the role decides
pipeline participation (api produces, worker consumes, tasks produces) (Alex,
2026-09-29). Pipelines are never exposed as HTTP surfaces. Consumption includes command production for follow-up work.
The API also registers every pipeline's consume-side definitions descriptively, so ops
introspection lists projections, subscribers and process managers: described, never started, and
a module's `build` must describe itself without the worker's dependencies (Alex, 2026-09-29).
Each process entry point and its surface declaration stay within 50 lines;
framework implementations retain the code needed to preserve behaviour.

**A process mounts only the surfaces it selects and skips the rest (D3, Alex, 2026-10-01).** The
API package is split into core, `api-rest` and `api-trpc`;
a process that does not select `.rest()`, `.trpc()` or `.browserBundle()` neither imports nor mounts
that surface. A module whose transport needs a surface the process did not select still installs, and
that transport is skipped, not refused (Alex, 2026-10-05; §4 says this here only). Deployment is unchanged
for now: locally one server runs rest, trpc, ui and the worker; in production one pod runs api, trpc
and ui, and another the worker.

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
inside the tRPC mount, `/api/trpc/getById` routes as `/getById`. A REST
version mount can route `/api/roles`, or its optional `/api/v1/roles`, as `/roles` (§8); version selection stays
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
**Telemetry is recorded, never passed** (Alex, 2026-09-23): any package or module records counters,
histograms and gauges through `@langwatch/observability`'s instruments directly — no `*Api` operation,
channel or member carries a metric. Telemetry is write-only: a decision the app makes at runtime (an
anomaly, a limit) reads owned state, never exported metrics.
A gauge over a costly read (storage stats) is fed by one scheduled process manager that collects the
readings and publishes them to shared state; each process's gauge reads that state, so N replicas
never repeat the query and every gauge agrees (Alex, 2026-09-29).
Traces and logs compose through the `langwatch` SDK's own observability
setup where its API fits — the platform dogfoods its SDK.
`hostedStores(stores)` from process-stores, `hostedRuntime({ name, runtime,
drain })` from the process package. A raw `{ name, start, stop }` object
literal at a call site is banned — if a component has no spoken factory,
write the factory. Transport/route discovery is likewise built in at the
layer that owns the route table (`boot()`/the api package), never a module.

The HTTP host composes the two routes and shared middleware described above.
Boot resolves transport dependencies and mounts module declarations before
serving. Auth verifiers are constructed by their owner from declared config
and secrets; the process entry point supplies neither credentials nor
transport internals.

**There are no deployment-choice lines.** The container chain names no module and wires
nothing conditionally (Alex, 2026-10-01): a module whose behaviour depends on the deployment decides
it from its own config and secrets (§3.3 rule 4). The audit log follows the same rule (Alex,
2026-09-24): every module is always installed and entitlement refuses per
organization (§11), so the generated list (`process-modules.generated.ts` in each process app) installs audit-log in every
deployment, as main recorded in every deployment. No app names it.
Audit-log first becomes a leaf: it records and reads, and recording is never gated. Organization's
trail read moves into it, the recent items move to project (which owns home), and
`packages/audit-log-null` is deleted. Then it moves to `enterprise/modules/audit-log`, as it was `ee`
on main; webhook, ops admin and demo-data stay where they are (Alex, 2026-09-29).

**The worker** is the same file with `role: "worker"` and `server.run()`
instead of `serve()`. The role decides what `boot()` hosts: jobs and
subscriptions instead of HTTP doors. Liveness/metrics is a built-in Server
component. Its pipeline declaration selects consumption, and shutdown drains that work
before closing the services and stores it uses.
A module's `static create(setup)` is told the role it boots in as `setup.role`, so work only
one role owns (the worker's voice tunnel) is built there and released through
`setup.resources` (Alex, 2026-09-28).

**Tasks** takes the Server for telemetry and config, skips the listener;
graceful degenerates to run-to-completion. Migrations are tasks (§7), run before any module boots,
so `apps/tasks` keeps them by hand. Every other task is a module's: `.withTasks(({ app,
repositories, dependencies }) => [task])` builds it over the booted App in the tasks role only, and
`server.container("tasks")` boots the installed list producer-only and runs the named tasks
(coordinator ruling, 2026-09-25). A task in `apps/tasks` may read and write the datastores
directly (Prisma, ClickHouse, Redis): the dev/CI storage seed is such a task, and no module Api
grows a seeding operation for it (Alex, 2026-09-27).

**A test passes no server** — `bootInstalledProcess({ role: "api", ... })` registers nothing
anywhere and returns the runtime; the test drives `stop`.

---

## 5. What boot() does — the translation

```
server.container(role)            # modules from the owners handed to withConfig
  │  open the stores (§7); order installers by peer dependencies (tokens, never imports)
  ▼  for each module:
  1. pick the tier the stores state (§7); a module with repositories whose tier nobody stated refuses
     boot by name (`StoreTierUnstatedError`, Alex 2026-10-05)
  2. check each registry's requires against the opened stores
     — refusal at boot, BY NAME ("webhook needs clickhouse; none opened")
  3. build repositories and channels from the module's registries:
        live.create({ prisma, clickhouse, encryption, config, secrets })
  4. resolve peers: each token → the implementation built earlier in the order
  5. slice config: config.<name>, already parsed from the module's own declaration
  6. TraceModule.create({ repositories, channels, dependencies, config, secrets, role, resources })
  7. collect what the module declared for THIS role:
        role api    → REST families + tRPC namespaces + SSE + command senders
        role worker → jobs + subscriptions + projections + process managers
  ▼
register everything on the server; return the runtime
```

`boot()` takes no arguments beyond what the chain supplied. The container answers nothing but
stores and peers (Alex, 2026-10-01): a store a registry requires and the deployment did not open
refuses boot by name, and every other "is it here?" is the module's own answer (§3.3 rule 4).
Never a runtime fallback nobody sees, never a logged absence, never an absence class.

**Two inputs, each with one receiver** (Alex, 2026-10-01; supersedes the 2026-09-18 "two kinds of
dependencies", `registerProcessDependencies` and `createProcessApp`). **Stores** (`prisma`,
`clickhouse`, `redis`, `objectStorage`, `rateLimiter`, and the clients the stores build over them)
go only to a module's repository and channel registries. **Peers** (`*Api` tokens) go only to the
module class. Config and secrets are declarations (§6), not dependencies. Delivery is
**registry-based**: a module declares `{ live, memory }` registries for its repositories and its
channels, the installer names both (`.withRepositories(...)`, `.withChannels(...)`), and the container
picks the tier and calls `create`. Every `create()` **arrives with its things already resolved**.
Passing a hand-assembled composition object into anything is banned as a shape: nothing receives a
bag it has to pick apart.

**The module class is the process half's implementation** (§3.2), in `app/<f>.app.ts` (Alex,
2026-10-05): `static contract`,
`static dependencies` (peer tokens), `static config`, `static secrets` and `static create`. Peers
are tokens, so a typo is a compile error and `create()` receives exact typed peers. The graph resolves transitively (a dependency's
dependencies are its own business — only its API travels), cycles refuse at
boot by name, and an instance bound at create may not be invoked until
after boot.

**Peer cycles are refused, and the test stays red until the last is cut** (Alex, 2026-09-29; the list
deleted 2026-10-05, Alex). Refusal is the rule, but today nothing reaches it at boot: the container hands
every `*Api` token a proxy before any module installs and orders modules without them, so two modules
naming each other's `*Api` in `static dependencies` boot. The shrink-only list that held this transition
was deleted on 2026-10-05 (Alex, 2026-10-05): every cycle is now reported and none is allowed. The
`peer-cycles` policy reports every declared peer edge whose peer reaches back, and
`packages/architecture-enforcer/tests/boundary-ratchets.unit.test.ts` expects the edge list to be empty,
so it fails until the last cycle is cut. A cycle is cut from the reactor's side, in §9's shape (a
command on the other module's pipeline, or a pull by a scheduled process manager where that would
itself be a cycle); `dev/docs/plans/peer-cycles-2026-10-05.md` maps them. Once none remains the
container refuses a peer cycle at boot by name.
No peer-cycle edge is cut or listed without asking Alex first (Alex, 2026-10-05). Two cuts are ruled:
`secret -> project`, and `gateway -> webhook`, where webhook subscribes to gateway's events (§9) and
gateway holds no `WebhookApi` peer. Workflow's HTTP-credentials backfill is still needed for a while: it
stays, done another way (workflow walks its own rows; the agents half becomes agent's own task), so
workflow drops `ProjectApi` and `OrganizationApi` (Alex, 2026-10-05).

Online policy execution (guardrails) is a synchronous capability with an end-to-end deadline and
cancellation, distinct from monitors and run history. The evaluation runtime it calls is a dependency
leaf, depending on none of gateway, monitor or run orchestration. Reporting follows the decision, and
removing a cycle may not make a synchronous precondition eventual (Alex, 2026-10-01).
A request guardrail answers within 800 ms through `EvaluationApi.checkGuardrail`, the gateway's only
evaluation dependency; a fail-closed deadline answers the retryable 503 (Alex, 2026-10-01).

`gateway -> evaluation` (guardrail checks) and `instant-eval -> licensing` (Connect judge) were listed
temporarily (Alex, 2026-09-30): hosted judging moves to instant-eval, and the guardrail check's owner is
revisited later. With the list deleted they are reported like every other cycle (Alex, 2026-10-05).
`project -> data-privacy` was listed too (Alex, 2026-09-30): `/api/projects/{id}` carries `piiRedactionLevel`
through `DataPrivacyApi.getPiiRedactionLevel`/`setPiiRedactionLevel`, which merge the level into the
project-scope rule and read `custom` as `STRICT`.

**Registry resolution ends at `TraceModule.create`.** Inside the module,
`create()` is the composition root: internal services are built explicitly
from what it was handed — `LicensingCapService.create({ caps: repositories.caps, graceDays:
config.graceDays })` — each receiving the narrowest slice that answers its
question. Internal services never declare dependencies and are never
auto-built; a `create()` that gets painful is a module doing too much, not
a reason for more container.
A factory under `repositories/` or `services/` that assembles collaborators is
composition in the wrong folder: it moves into `create()`, and another process
reaches the module through its API, never through its factories (2026-09-23).
So are `*-composition.build.ts` and `*.members.ts` beside the module class, deleted (§15): store wiring
moves into the registries, the rest into `create()` (Alex, 2026-10-01). Lanes remove the remaining files
before other module work, and the grammar then refuses them (Alex, 2026-10-05; §3.3 says where each
member goes).

The `processModules` list is generated from `modules/catalogue.json`
(`pnpm generate:modules` writes one list into each app: process halves into `api`, `worker` and `tasks`, browser halves into `ui`). **Installing a
module edits the catalogue, never a root.** A process composes the whole
list by asking for its container — `server.container(role)` takes the modules
`withConfig(processConfig(processModules))` named (Alex, 2026-09-29) — and that is also the cheap shape: one call over all 49 modules costs ~88k type
instantiations, where the ten-step chunked chain it replaced cost 11.3M.
Instantiation cost grows with the length of the chain, not the size of the
list, because each chained `withModules` re-instantiated the accumulated type. Do not
split the list to appease TS2589. Uninstalling a module that another module
peer-depends on fails to compile, naming the dependent.

**The root never grows.** A change that needs it to grow has found a gap in
the primitives; report the gap, never widen the root.

---

## 6. Config

**Every value is declared at its owner; the parse is generated; apps hold no
module config** (settled 2026-09-18 — this section replaces every earlier
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

// modules/github/process/src/app/github.app.ts — the module class attaches them
// (github's handles move to its contract, Alex 2026-10-05; today github.app.ts declares them)
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
- **process** — the module class attaches them as `static readonly config` and
  `static readonly secrets`; `create()` and the module's registries receive the parsed slice and
  a scoped `secrets`, and resolve through `secrets.into({ key: handles.key }, build)`.
  Nothing in the process half names an env var or re-declares a schema.
- **browser** — `defineBrowserModule` validates the contract's projection
  slice before first render; the browser never sees a handle or a leaf.

A module with no deployment facts declares neither and contributes no root
key. Framework owners (process, stores, observability) declare the
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
observability on its own). There is no per-app config schema: an app's `config.ts`
holds only the environment seam (§4), and anything else in it is a defect. **The pre-existing config machinery is deleted, not
migrated** (ruled 2026-09-18): RuntimeConfig definitions, the contract
`*ConfigDefinition` files, the generated config map and both app config
files all go; the compiler enumerates the fallout and this section is what
replaces them.

**One environment variable has exactly one owner** (ruled 2026-09-18). The
parse refuses a second claim by name — `"BASE_HOST" is declared by "process"
and "platform-health"` — and the process does not boot. The owner that
declares a value passes it down; nobody re-declares it to get a copy.

This is what makes **a process fact not a module fact** enforceable rather
than advisory. **Process facts live in ONE shared config** (Alex, 2026-10-01): `processFacts` in
`@langwatch/config`, one leaf each for `publicBaseUrl`, `isSaas`, `nodeEnvironment`,
`outboundProxy`, `serviceVersion` and `rawSocketPort`. Each module's `Config.define` **picks** the
leaves it needs; it never re-declares one, and no fact travels as a member:

```ts
export const billingConfig = Config.define((c) => ({
  publicBaseUrl: processFacts.publicBaseUrl, // picked: same leaf, same env var, one claim
  isSaas: processFacts.isSaas,
  hubspotFormId: c.env("HUBSPOT_FORM_ID", z.string().optional()),
}));
```

- `BASE_HOST` → `publicBaseUrl` (optional; blank and absent both mean the deployment named none).
- `NODE_ENV` → `nodeEnvironment`, the raw string. The `http` owner **derives** `production` from it,
  because a derived value is not a second claim. A module wanting a boolean derives it the same way.
- `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` and their lower-case spellings → `outboundProxy`, raw by env
  name; notification and webhook parse it.

Framework owners (process, observability) pick from the same object.

**Landed as single shared leaves** (coordinator, members wave, 2026-10-05, citing Alex's members
ruling): `@langwatch/config`'s deployment facts export `publicBaseUrl` (`BASE_HOST`), `isSaas`, `nlpServiceUrl`, `serviceVersion` and `otelResourceAttributes` (read a reported
version through `releaseVersionOf`), and `@langwatch/secrets` exports the `nlpInternalSecret` handle.
`packages/process`'s `owner.ts` holds the same instance of each, so a module that adds one to its
contract config never collides.

When the single owner is a **module** rather than the process, it passes the
value down as a capability on its own `*Api`, never as a shared variable and
never as a value the composition has to remember (ruled 2026-09-18):

- `PASSKEYS_ENABLED` is auth's. `user` asks `AuthApi.offersPasskeys()`.
- `DEMO_PROJECT_ID`/`DEMO_PROJECT_USER_ID` are authz's. `organization` asks
  `AuthzApi.demoProject()`, beside the `isDemoProject` it already answered.

This is the four-way rule's second way, and it is why a config fact two modules
both want is not evidence that the fact should be process-wide — it is usually
evidence that one of them owns it and the other should be asking.

**No members** (Alex, 2026-10-01; supersedes the same day's "one member vocabulary"). There is
no `static reads`, no `setup.members` and no restated member type. A registry declares the stores
it `requires`; the module class declares only peers, config and secrets.

**A credential's owner builds what others need from it** (ruled 2026-09-24,
ADR-132 applied). The stores own `CLICKHOUSE_URL` and `DATABASE_URL`, and a
second `Secret.load` of either is refused. So the stores open two clients
more, built inside the closure that resolves the URL:
`clickhouseAdmin` (the credential-free server origin and database, plus an
untenanted statement client for DDL) and `databaseTarget` (the credential-free
Postgres endpoint). Each answers `{ configured: false }` rather than refusing.
A module never re-derives them from `process.env`.

**A module builds its own objects in its registries; `main.ts` wires none of them** (Alex,
2026-09-28; Alex, 2026-10-01). LangWatchQL is one: analytics' registry requires `clickhouseAdmin`,
`databaseTarget` and `prisma` and builds its connection bundle there. Its
passwords stay the module's own `static readonly secrets`. No password means
LangWatchQL answers "unavailable" and every query is refused (ADR-159).
Data-privacy's directory is another: its repository registry builds it over
`prisma`.

**`configSchema` is deleted, not migrated** (ruled 2026-09-18). The legacy
static — an App-level Zod schema re-parsed per feature and fed by the deleted
`apps/api/src/config.ts` — held four different kinds of thing at once, and
only the first is config: a module deployment fact (→ the contract slice), a
process fact (→ a leaf the slice picks from `processFacts`), an availability
decision (→ the module's own answer from its config and secrets), and a
role decision (→ `setup.role`). Sorting those four is the port; the
static, its `*AppConfigSchema` const, its inferred type and the container's
`withConfig(app.configSchema)` parse branch all go. A module with no
deployment facts of its own declares no `config` static at all and its
`FeatureSetup` config parameter is `undefined`.

The container keeps only a type-only `withConfigType<Config>()` where the schema
used to be: the process parse has already produced the slice, so the
declaration states its type and nothing re-validates. Two phantom anchors make
that safe and must not be "tidied away" — `InstallableServerFeature.configType`
is what `ModuleConfigGuard` infers a module's config from, and without it the
guard type-checks nothing while still compiling green.

**Secrets are the sibling package, and a secret is a value you may only
pass through** (approved 2026-09-18). A module declares its handles beside
its config as a plain record — `{ privateKey: Secret.load("GITHUB_APP_PRIVATE_KEY") } as const`
(there is no `Secret.define`) — where **`Secret.load(id)` takes ONE identifier every adapter interprets
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
everyone-sends-to-one-place concerns, so `@langwatch/process` and
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
constructed collaborator escapes and travels. **`into` takes a record of handles** (Alex,
2026-10-01): `secrets.into({ key: h.stripeKey, signups: h.slackSignups }, ({ key, signups }) =>
…)` resolves them together, so no `into` nests inside another. There is no `get()` that
returns a string to keep. When the last `create()` returns, the resolver
SEALS: a post-boot resolve refuses by name. Declarations live on modules
and framework packages; the server carries only the mechanism; the app
declares nothing. Every key is a **root object** — `process` for the framework
globals, or the module's name for its slice — and Zod reads the environment
at the one boot seam. A missing required value refuses **naming module and
key** (`github.appId ← GITHUB_APP_ID`); a module with a schema and no slice
fails to compile. `.readonly()` on the schema is the immutability story —
no `Object.freeze`, no mirror types, no re-plumbing.

**A family handle answers every name under one prefix** (Alex, 2026-09-29; ADR-132 amendment).
`Secret.family(prefix)` resolves to a name-to-value map, for a credential a deployment names by
convention (main's `CLICKHOUSE_URL__<label>__<orgId>`). The env and `.env` adapters scan by prefix
and 1Password answers none; the resolver scopes a family like any handle and answers only names
under its prefix; the preflight treats a family as optional; and a config leaf may not claim a
name under a declared prefix (`ConfigClaimsSecretError`). It is the one enumeration the chain
does, bounded by a prefix its owner declared.

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
There is one cipher: stored secrets are encrypted through the stores' `encryption` client, and
`AesGcmSecretEncryptionService` is deleted (Alex, 2026-09-29).

**Three layers, and which one a value belongs to** (ruled 2026-09-18):

1. **Store connections are process-global and invisible to modules.**
   `DATABASE_URL`, `CLICKHOUSE_URL`, `REDIS_URL` are declared once, in the
   process's stores config; a module's registry declares `requires: ["prisma"]` and receives
   an opened client, which the module class never sees. Which tier that client is — Postgres or
   memory — is the process's config, and the module cannot tell.
2. **Module-shaped values live on the module's own schema** (github's
   signing key, monitor thresholds, retention days). The global object is
   **domain-driven** (`stores`, `deployment`, …; mail is notification's own, Alex 2026-09-29); a module-named
   slice exists only when a module truly has its own values — most have none.
3. **Process facts are canonical leaves.** A fact several schemas
   legitimately read (`BASE_HOST`, `IS_SAAS`) is ONE leaf in `processFacts` (`@langwatch/config`),
   picked by instance (Alex, 2026-10-01). A feature's leaves and secret handles live in their
   owner's contract, never in `packages/config` or `packages/secrets` (Alex, 2026-10-01). The
   compiler admits a re-bound env var only when the claimants are literally
   that same leaf — one meaning shared N ways passes, a second meaning for
   the same variable still refuses at boot (that refusal caught a real bug
   the night it landed).
   A shared secret follows the same rule: one exported `Secret.load` handle, and a double claim
   passes only when every claimant holds that same handle (Alex, 2026-09-25).
   A fallback between secrets is declared, not configured: the owner declares each handle and
   resolves them in one record `into`, first answer wins. The API-key pepper is `API_KEY_PEPPER ?? CREDENTIALS_SECRET ??
NEXTAUTH_SECRET`, and the boot refuses when none answers (Alex, 2026-09-28).

**Config is drilled, never ambient.** There is no async context, and the container (§4) hands
each module only its own slice. The process config is one object composed of
smaller objects; every function receives the narrowest slice that answers
its question, as an argument. Deep nesting paying for itself in signatures
is the intended pressure.

**A module decides its own availability** (Alex, 2026-10-01). Whether a seam is
configured is derived _inside_ the module from its declared slice and secrets — never defaulted
invisibly, never supplied by the process. An unconfigured seam refuses by name with a stable error
code, and the module's public config projects the same answer (§3.3 rule 4). Nothing is left for
the process to provide.

**Browser config is a declared projection.** A module's contract names which
of its values are browser-safe (a schema plus a `project` function — by
construction never a secret). The api builds one namespaced object from
every installed module's projection and injects it into the served page;
`defineBrowserModule`'s config declaration validates its slice **before
first render**, so a missing value is a boot refusal naming the module, not
an `undefined` deep in a component. The same drilling rule applies on the
browser: screens receive values as props, nothing reads the injected blob
directly. The contract exports `xBrowserConfig = defineBrowserConfig({ schema: xWebConfigSchema,
project })`; the module class attaches `static readonly publicConfig = xBrowserConfig.project`. The
dev UI reads the api's projection too and keeps no copy of the leaves (Alex, 2026-10-01). The process
owner's slice is `process` (address, mode, deployment, nlp); rum owns the browser tracing
switch and projects `rum` (enabled, sampleRatio) (Alex, 2026-09-27). A browser module reads
any owner's slice by that owner's name: `withConfig({ process: schema })` (2026-09-25).

**No config endpoint: the page carries it** (Alex, 2026-09-25: "for public
env, that endpoint should be removed, and config injected directly into the
html on render, secrets never hitting it, and only the config needed. then
it's instant and doesn't require a backend call."). main's `publicEnv` query
is not ported and no browser code fetches its config. The api injects the
projection above into the document it renders; the projection carries only
fields some browser code reads and never a secret handle or value, so the
browser has its config before first render with no loading state. A browser
module reads deployment facts through the shell's `useUiDeployment()`
capability or its own `*HostApi` — never a fetch, never its own parse of
the meta tag.

---

**Mail off is a state, not a boot failure** (Alex, 2026-09-23). With no mail provider configured the
process boots; notification answers every send by skipping it with one log line naming what was
not sent, and the browser learns it from public config's `capabilities.email`, so a self-hosted
install shows that email is not configured instead of silently dropping it.
One send refuses instead of skipping: a test fire of an email automation on an install with no mail
provider throws `EmailProviderNotConfiguredError` (`email_provider_not_configured`), and the authoring
drawer disables the email channel with the tooltip "Email is not configured. Ask an admin to set up a
mail provider.", read from the deployment's `hasEmailProvider`. That tooltip is the ruled exception to §3.5's "off is
opaque" (Alex, 2026-09-30).
Email is a capability notification answers from its own config and secrets, never a config leaf
guess: a SendGrid-only install has it. Notification owns mail outright and no other module holds
mail (§3.3; Alex, 2026-09-29). Where it is off, password reset by email is disabled
without saying why; the screen tells the user to contact support (SaaS) or their admin (self-hosted)
(Alex, 2026-09-29).

## 7. Stores, the tier, and migrations

```bash
# ── local dev (live tier; same shape as production) ──
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/langwatch   # or the development default
CLICKHOUSE_URL=http://default@localhost:8123/langwatch
REDIS_URL=redis://localhost:6379

# ── production: identical shape, managed URLs ──
# There is no tier knob: memory is asked for in code, by a test or dev harness (Alex, 2026-10-05)
```

```ts
export const storesConfig = (modules) =>
  Config.group({
    /* DATABASE_URL, CLICKHOUSE_URL and REDIS_URL are secrets: see storesSecrets below */
    objectStorage: Config.group({
      backend: Config.value(z.enum(["s3", "azure", "file"]).optional(), {
        env: "STORED_OBJECTS_BACKEND",
      }),
      /* s3: S3_*; azure: AZURE_BLOB_*, AZURE_* identity; localRoot: LANGWATCH_LOCAL_STORAGE_PATH */
    }),
  }).refine(/* a required store unset → refuse naming modules and key */);

// connection strings are Secret declarations, never Config.value fields (Alex, 2026-10-01)
export const storesSecrets = {
  postgres: Secret.load("DATABASE_URL"),
  clickhouse: Secret.load("CLICKHOUSE_URL"),
  redis: Secret.load("REDIS_URL"),
} as const;
```

| You did                                       | What happens                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| forgot `DATABASE_URL` in production           | refusal: _"live stores: trace, annotation require postgres; DATABASE_URL is unset"_ — **never memory** |
| a test or dev harness hands `memoryStores()`  | whole process on memory twins, stated in code                                                          |
| a module with repositories and no stated tier | refusal: `StoreTierUnstatedError`, naming the module, before any client opens                          |

**Store tiers fail closed** (Alex, 2026-10-05). Outside tests a missing tier refuses to boot by name;
memory runs only when a test or dev harness asks for it. There is no `LANGWATCH_STORES` knob and no
per-store tier: whole process, no mixing — half-real storage tests a lie.

**The tier travels inside the value.** `openStores` returns branded live
clients or the branded `memoryStores()` — same type, one `.withStores(...)`
call — and `boot()` selects every module's registry (`live` or `memory`) from
the tier the value states: opened stores state `live`, `memoryStores()` states `memory`. A module with
repositories whose tier nobody stated refuses boot by name (Alex, 2026-10-05). Production and dev open
live stores; a test or dev harness hands `memoryStores()` directly and never touches env.

**Migrations are not the api's job.** They are tasks —
`pnpm --filter @langwatch/tasks task prisma-migrate clickhouse-migrate` — run
before serve by the start script and the deploy pipeline. Prisma migrations
live with the schema; ClickHouse migrations are goose SQL files. A serving
process holding DDL locks is how deploys die. Because they run before any module boots, apps/tasks'
migration-runner files (`src/*migrat*.ts`) may name process packages (Alex, 2026-09-27), and
so may `lwql-provision.ts` and `lwql-render-access-config.ts`: LangWatchQL provisioning reads
both schemas under the same migration lock, before serve, and the access-config render runs from
env alone in its Helm job (Alex, 2026-09-28).

**In-place system migrations belong to their subject; the runner belongs to ops.** Identity,
authz and automation each answer the migrations they own through their `*Api` (`registeredMigrations()`, with
identity's user-rooted `userMigrations()` beside it), and ops composes the migrations page,
enrolment, the targeted run and the pass over its own `SystemMigration*` tables and Redis lease,
never importing a peer's process package. The api serves the page and awaits a targeted run
in-request, as main did; passes run on a worker (§9); apps/tasks keeps the startup convergence
(Alex, 2026-09-28). Automation's Slack connection migration is one such pass per organization, with
no manual task (Alex, 2026-09-30).

**Clients appear in exactly one place: the chain.** From there only registry
and channel factories touch them. There is no second path.

**A read across organizations is declared, never exempted** (Alex, 2026-09-28). The guarded
client stays strict for every model. The module that owns the table declares
`static readonly operatorReads = { syncs: OperatorRead.of("ScimSyncState", { actions: ["findMany", "count"] }) }`
beside its secrets. The root scopes the stores' mint to each module's own handles and seals it
after boot, as it does secrets. The handle's client admits only that model and those actions,
refuses writes, other models and raw SQL, and logs each read at info with `{ module, model,
action }` and no row data. Its live repository registry resolves it by requiring the
`operatorReads` member (`operatorReads.into(handle, build)`); the memory twin needs none.
Spec: `specs/server/operator-reads.feature`.
Every store call carries an `Authorization` (Alex, 2026-09-30; [ADR-166](adr/166-grant-scoped-data-access.md)):
`store.as(authorization, { reads })` adds the tenant and any shared condition to the query, Postgres accepts
`own` grants only and ClickHouse span, trace and log reads accept `own` and `shared`; the guard's exceptions are
a shrink-only baseline and Postgres RLS is deferred.

**Main's byte intakes stay for now** (Alex, 2026-09-30). The user avatar and AI tool icon
data URLs, the deprecated multipart dataset routes, bug-report transcripts and inline scenario
media keep main's shapes; each moves to createUpload, PUT and confirmUpload only by its own
ruling. main's signal-focused home (`release_ui_home_signal_focused_enabled`) is not ported;
automation email previews render in the browser, as on main.

**Every Redis cache key expires, and expiry is the only sweeper** (Alex, 2026-10-01). One Redis is the default: one
instance running `noeviction`, because queues, the outbox and locks must never be evicted. So every key a
cache repository (`redis.<subject>-cache.repository.ts`) writes carries a short TTL in the same atomic
command (`SET … EX|PX`, `SETEX`, a `MULTI` or Lua script that expires the key it writes; never a write then
a separate `EXPIRE`), named as a constant beside the repository, and nothing sweeps them but Redis's own
expiry. The classes: at most 60 s for anything that authorises or identifies a request (auth session, share,
GitHub token, gateway agent); 5 minutes for folds, analytics, billing and data retention; never longer than
the source's own expiry (a GitHub token caches for min(its expiry − 60 s, 60 s)); an existing shorter TTL
stays. `packages/architecture-enforcer/tests/redis-cache-ttl.unit.test.ts` refuses a write without one.
A deployment may split cache from durable queues when measured pressure warrants it: expiry bounds a
key's age, not the key count or memory, so headroom alerts are required either way (Alex, 2026-10-01).

**Object storage is a store, like the other three** (ruled 2026-09-24,
ADR-158). The `objectStorage` member is one client over S3, Azure Blob and the
local filesystem. It routes per project inside the client, as the ClickHouse
client routes per tenant, so a module names a project and a key and never a
bucket, account or root. Its settings belong to the stores owner:
`STORED_OBJECTS_BACKEND`, `S3_BUCKET_NAME`, `S3_ENDPOINT`, `S3_REGION`,
`AZURE_BLOB_*`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
`AZURE_FEDERATED_TOKEN_FILE` and `LANGWATCH_LOCAL_STORAGE_PATH`, with
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_SESSION_TOKEN` and
`AZURE_BLOB_ACCOUNT_KEY` as secrets. The memory tier answers it with a memory
twin.

Bodies travel as streams, and every digest is computed over a stream, once.
Nothing holds a whole object in memory to hash it. Modules build repositories
over the member, such as stored-object's files and dataset's chunk content,
and no module composes a storage driver of its own. A client's upload never
passes through a module: it PUTs to a signed URL the member answers, and it is
confirmed afterwards. The filesystem has no URL of its own, so there the URL is
stored-object's signed route, which streams into the member. A stored object's
id is always a fresh KSUID, and its purpose is a field of its record. Neither
is derived from content.

**Resolving is invisible: callers just call the client** (ruled 2026-09-18,
landing): a module holds the `clickhouse` member and queries it — every
query already names `TenantId`, and `@langwatch/clickhouse-client` routes to
the right physical endpoint internally, per call. No resolver type, no
`.resolve()` step, and no adapter exists outside that package; a caller
never thinks about resolution at all. The per-module resolver adapters
(`create<F>ClickHouseResolver`) are transitional and die when this lands.

**The `clickhouse` member exposes its routing table** (Alex, 2026-09-28):
`privateRoutes()` answers the organizations it routes to a private endpoint, parsed once at boot
from main's `CLICKHOUSE_URL__<label>__<orgId>=<url>` family, unchanged for a deployment. The URLs
carry credentials, so the stores declare the family as one `Secret.family("CLICKHOUSE_URL__")`
handle (§6), resolve it through the chain and parse it once at boot into the member, which opens
whenever routes exist even with no shared `CLICKHOUSE_URL`. Nothing reads the environment for a
route and no route URL is printed: a skipped entry is logged by its variable name.
`CLICKHOUSE_PRIVATE_ROUTES` is not read. The tasks runner, which opens no member for its
migration pass, holds the stores' same handle and builds its dataplane from the stores' parse.
A module needing that deployment fact (ops' cohort exclusion,
read through `RoutingTableOrganizationDataplaneService`) reads the member, never a second
declaration of the env family in its own config.

**Routing is folded into the `clickhouse` member** (Alex, 2026-09-28): the member routes every
statement by its tenant's organization itself, so a module hands the member its statement and
never writes a routed-client adapter (ops' replay and event-explorer adapters are deleted). A
statement spanning every tenant names none (`tenantId: ""`) with a written `unscoped` reason, and
the member reads it on the shared server, where main's `"default"` fallback read. A read across one
organization's projects (a gateway budget's ledger) declares its **tenant set** (`tenantIds`) instead:
the tenant guard accepts `TenantId IN (...)` only when the list binds exactly that set, the request's
`tenantId` among them, with no `OR` disjoining it; the member's router resolves every tenant through
the tenant directory it already routes by and refuses a set spanning organizations. One statement,
answered on that organization's server, never an `unscoped` reason (Alex, 2026-09-29). Eventing's replay
reads through the member's own surface (`query`, `stream`, `command`); `stream` yields a large read
batch by batch under the tenant guard and the route, holding no slot and never retried.

**The event tables are eventing's** (Alex, 2026-09-29). Only `packages/eventing` reads or writes
`event_log`, the process-manager tables (`ProcessManagerInstance`, `ProcessManagerInbox`,
`ProcessManagerOutbox`, `ProcessManagerOutboxAttempt`) and the projection checkpoints. A module changes
an aggregate by sending a command, never by appending events itself: the `eventing` member stops
handing modules the whole EventSourcing, so no module reaches `getEventStore().storeEvents` for an
arbitrary aggregate. **Each module gets its own event store handle** (Alex, 2026-10-05): `packages/eventing`
hands each module an append-only event store handle for its own streams, and no module holds the shared
EventSourcing client; identity, ops and scim hold it today. Operator work over those tables (purge, redrive, lease release, an event
explorer) is eventing's surface, called through the member, never SQL or a Prisma delegate in the
calling module. The `eventing-table-access` policy reports raw access by module or application code:
SQL naming a table, a Prisma delegate over one, the table named as a literal, or a direct
`storeEvents`/`getEventStore` call. Today's findings are a shrink-only list with a count per file,
`tests/baselines/eventing-table-access.json`, held by the shrink-only ratchet in `tests/boundary-ratchets.unit.test.ts`.

A check that holds a summary against the facts it was folded from keeps its own record of those
facts, a projection over the same events on its own pipeline, and never reads `event_log`:
governance's cost drift check compares `governance_cost_rollup_charges` with
`governance_cost_rollup_1d` (Alex, 2026-09-30).

**Uniqueness is the exception** (Alex, 2026-09-30): a custom role's name is unique among live roles
only (a partial index, so a deleted role frees its name); a grant or role binding carries no
uniqueness at all, so the same principal, role and scope may be bound twice within the limits, and a
re-assertion that must stay idempotent asks the ledger to `skip` rather than being refused.
`/api/grants` succeeds `/api/role-bindings` (deprecated, same rows): nobody grants or writes into a role more than they hold at that scope, one authz rule every door reaches (Alex, 2026-09-30).
Only that REST family says "role binding": every other name, type, file, tRPC route and UI string
is a grant or a role, and the wire codes and the store keep their names (Alex, 2026-09-30).
**The ceiling runs centrally** (Alex, 2026-10-01): `AuthzApi.attachBindings` and `changeBindingRole` take a
required `caller: AuthzGrantCaller`; authz refuses `grant_exceeds_caller_permissions` beyond what that person
or key holds, an anonymous caller holds nothing, and only `{ type: "system" }` (a consequence of an act already
checked: invite acceptance, SCIM, sign-up) skips it. A door that writes its own rows first (a group, an
invitation, a seat) asks the same rule before writing; adding a group member is bounded by the group's grants.
An organization-key request is bounded by the key itself (service or personal), never by its owner.
Seat-checkout invitations carry who invited (`createPaymentPendingInvites(input, by)`) and are bounded before
they are held; acceptance after payment stays `system` (Alex, 2026-10-01).
Minting a SCIM token is a grant door: only a caller holding everything an organization ADMIN holds may mint
(Alex, 2026-10-01).
Creating a team passes the real caller, never `system`: the creator becoming its own new team's ADMIN is the
one consequence written as `system`; every other initial member is bounded by the creator (Alex, 2026-10-01).
A gateway virtual-key change needs the permission at every scope the key covers, not at one of them
(Alex, 2026-10-01).
**Plans** (Alex, 2026-10-01): built-in roles grant on every plan; any write that assigns a custom role needs
Enterprise on every door, declared on each granting door (`withEntitlement("enterprise", { feature: "RBAC",
when })`), so authz never asks entitlement. `/api/role-bindings`, `/api/organization`, `/api/roles` and
`/api/groups` answer 402 `enterprise_plan_required` below Enterprise, as main.
**The plan gate is declared** (Alex, 2026-10-01): a route or procedure names `withEntitlement(entitlement,
{ feature, when })`; the framework asks after access, only when `when(input)` holds, and refuses 402
`enterprise_plan_required` with `meta.feature`. The process composes the `entitlements` port from
EntitlementApi (api-surface.ts); a module never hand-rolls a plan middleware.
**Grants are the only read** (Alex, 2026-10-01): main's genesis import made Grant complete, so no module reads
the RoleBinding compatibility table; access is read through `AuthzApi` listings, ended grants excluded.
**Platform operators are a grant** (Alex, 2026-10-01; ADR-092): `ADMIN_EMAILS` is gone. A built-in
`platform-operator` role (`ops:view`, `ops:manage`) is granted to users at the PLATFORM tier and asked via
`AuthzApi.can({ scope: platform })`; `ops:*` counts only from PLATFORM grants. Nobody grants it to themselves;
the last holder cannot be revoked; user erasure revokes as `system` with reason `user-erased`, the only
revoke that may remove the last holder. ops owns the seed, bootstrap, recovery task and page. `AuthzApi` carries them as three operations,
`grantPlatformOperator`, `revokePlatformOperator` and `listPlatformOperators`; the org-scoped grant
operations never take a platform scope (Alex, 2026-10-01).
Only ops and identity grant or revoke; listing takes no caller, and user reads it to refuse deactivating the last active operator. The
seed runs once behind a marker, never again because the live list is empty. Authz learns who is
deactivated or erased from user's and identity's facts into its own table, never from the User table
(Alex, 2026-10-01). The page reaches them through three OpsApi pass-throughs (`listPlatformOperators`,
`grantPlatformOperator`, `revokePlatformOperator`) gated `ops:manage`; the seed does not latch while the
install has no users (Alex, 2026-10-01).
**Billing staff read with `ops:view`, write with `ops:manage`** (Alex, 2026-10-01): the connected-billing
overview and the impersonation limit override take `ops:view`; onboard, addCommit, renew, completeRenewal and
markPaidOutOfBand take `ops:manage`. A view-only operator reads and is refused on every write.
**Operator bootstrap** (Alex, 2026-10-01): a one-time upgrade migration grants users named by a still-set
`ADMIN_EMAILS`, else the oldest active org admin on a one-organization install, else nobody (logged; recovery
task). Cloud never bootstraps: staff are seeded at cutover. A set `ADMIN_EMAILS` after that only warns.
A set `ADMIN_EMAILS` never falls back to an org admin: the seed waits, unlatched, until a named verified
user exists. Users with no organization yet also wait; only a decision latches (Alex, 2026-10-01).
Deactivating a user ends their sessions and CLI tokens before user's fact is sent, without an outbox;
user's lifecycle facts carry the database clock. The back office refuses bulk user writes, a deliberate
difference from main (Alex, 2026-10-01).
Each lifecycle fact also names its actor in the grants ledger's shape (older facts have none). The back
office deactivates only through user, so it keeps no picked date (Alex, 2026-10-01).

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
  publishes in `docs/api-reference/openapiLangWatch.json` keeps the names it published (Alex, 2026-09-23),
  `{id}` included: a semantic rename of a main route is drift and is reverted (Alex, 2026-09-25).
  The rest-route rule reads that docs copy as it stands after a spec sync; drift against main is
  apidiff's to catch, not a frozen copy's (Alex, 2026-09-29).
- `/api/<x>` is the main path; `/v1` is optional; `/latest/` and `/<version>/` are supported but hidden from the
  published docs (Alex, 2026-09-25).
- A handler never sets a header to refuse: a `HandledError` carrying `meta.retryAfterMs` is rendered by
  the REST runtime with `Retry-After` (2026-09-23).
- An action that takes no body declares an empty input schema from its contract; the runtime reads an
  absent body as that empty object, so a bodiless call keeps working (2026-09-23).
- A protocol route (SCIM) renders its protocol's error bodies through its protocol response, never a
  `RestErrorHandler`, including refusals raised before the handler, through the renderer the route
  declares (`withResponse("protocol", { refusal })`). A body that does not parse is the handled 400
  `malformed_request` in every family, never a 500. A JSON route never borrows the protocol kind to reach the request: the caller
  arrives as `actor`/`scope` from the runtime's credential authentication (2026-09-23).
- SCIM takes the normal API shape: its routes declare their input schema and its operations take typed
  input; the protocol renderer renders parse and validation refusals in main's SCIM bytes. No operation
  takes raw text (Alex, 2026-09-29).
- A request that cannot be parsed (broken JSON, wrong format) is the 400 `malformed_request`; one that parses but fails its
  schema is the 422 `validation_error`. Query parameters (gateway `?limit`, the spend window), bodiless
  POSTs, saas usage-report and the prompt routes follow the same split (Alex, 2026-09-29).
- The REST framework maps what no feature can know in advance, once, in `canonicalErrorFor`: an escaped ZodError
  is the 422, a Postgres data exception (SQLSTATE 22, such as a NUL byte) is the 422, and an unchecked unique
  violation is the 409 `conflict`. A failure a feature can know is still its own HandledError (Alex, 2026-09-30).
  Prisma running out of Postgres connections (P2024, P2028) is the retryable 503 `DatabaseBusyError` with
  `Retry-After`, promoted the same way by tRPC's `handledErrors` (Alex, 2026-09-30).
- A REST request is authenticated before its body is capped, parsed or validated: a missing or invalid credential
  answers 401/403, never 422 or 413. A door that signs over the body reads the capped raw bytes first. Which project
  the caller acts on is resolved after, from the parsed input (Alex, 2026-09-30).
- The exception is a hidden family, whose 404 comes before the credential or the body: `instance_admin` with no key
  set or on SaaS, and `/api/admin/*` for a caller who is not an admin (as main, 2026-09-30).
- REST runs in three steps: the credential and identity checks that read no body (the door, and a public route's
  credential facts), then the body is parsed and validated, then any authorisation that reads the parsed input.
  A fact that reads the input is declared `source: "input"` and resolves after the validators (Alex, 2026-09-30).
- `GET /api/checkup` keeps the branch's `organization:view` guard; main answers any project key. The drift is
  accepted, since the checkup reads organisation-wide state (Alex, 2026-09-30).
- REST authenticates with API keys only and tRPC with the session (Alex, 2026-09-30); `/api/files` and
  `/api/user-avatar` are key routes, a key pinned to its own project as on main, and the UI reads media through a
  tRPC-minted URL.
- A key-authenticated door's actor carries the key's owner, set by the runtime's credential
  authentication, so no handler or module looks the owner up itself (Alex, 2026-09-25).
- A minted session key (langy's local-control sessions) authenticates at its own door, which puts the actor and
  project on the request; no handler reads the key's headers (Alex, 2026-09-25).
- No key, token or secret is minted while the actor carries an impersonator (Alex, 2026-10-01). An endpoint that mints
  declares `.mintsCredential(permission)` and the tRPC and REST runtime refuses it before the handler; a service
  guard per door stays for callers that are not a transport. Door names are the typed snake_case union `api_key`,
  `scim_token`, `internal_secret`, `instance_admin`, `session_key`, `cli_token`.
- The CLI token door hands a handler `session` beside `actor` (Alex, 2026-10-01): the route declares
  `.withCredential("cli_token", { session: schema })`, the framework parses it (a mismatch answers 401) and types
  the handler by `z.output`. The actor carries authz vocabulary only; logs redact `session.tokenKey` at a fixed path.
- A legacy project key still authenticates but is never returned or displayed: no read, no rotation, no handout.
  It migrates to an `ApiKey` row, hashed and valid until revoked, listed masked and revoke-only under a
  replace-by-deadline banner. The CLI and MCP mint a fresh key instead, a CLI login replacing that device's previous
  one, and a new project gets no customer-facing project key (Alex, 2026-09-30). No engine and no internal caller
  reads `Project.apiKey`: a run calls back with the key minted for it (§10), any other platform caller with a minted,
  ownerless, project-bound key holding only what it needs, and the column goes once nothing reads it
  (Alex, 2026-10-01). The gateway exports a trace project's spans with one hidden, ownerless `traces:create` key,
  minted once, stored encrypted in `GatewayTraceExportKey` and folded into the bundle ETag; it changes only on an
  explicit rotation (ruled 2026-10-01). The key row menu is Revoke only, and a new key expires in 90 days by default, "never"
  allowed (Alex, 2026-09-30). `modules/api-key/adrs/002-project-keys-are-hidden.md`
- A run started by a service key carries that `apiKey` principal, and the run's key is capped by the starting key's
  grants. Only a scheduler-started run acts as `system`; the absence of a person never supplies system authority
  (Alex, 2026-10-01).
- An API key or personal access token is checked in two tiers (Alex, 2026-10-01): Redis, shared by every pod,
  holds the answer for 5 s (an unknown token for 2 s), matched by the token's hash and holding no secret (a key's
  answer sits under its public lookup id, so a revoke can find it); Postgres is the truth. A failed check is never held. A revoke sets `revokedAt` and leaves a 5 s refusal in the held answer that a fill (written only when no entry exists) cannot replace, so the key is dead
  on every pod at once (if Redis cannot take the refusal, within 5 s; this holds only under `noeviction`); no process memory tier and no broadcast. A change deletes the held answer; the answer carries the project's identity. `modules/api-key/specs/auth-check-cache.feature`
- Credential kinds (Alex, 2026-10-01): the old `eyJ...` keys, the format of the project's `apiKey` column
  before December 2024 and matched as opaque strings, are the **legacy API key** kind. `lw_at_` is the
  project-bound (CLI) access token. **Personal access token** means the `sk-lw-` personal key only.
- A socket is declared like a route: a module declares its `WebSocketProtocol`, and the process opens one upgrade router
  and mounts every installed module's protocols, as it mounts REST (coordinator, 2026-09-25; main's connect gateway, pending Alex's review).
- `publicRoute`/raw results only for genuinely non-JSON protocols
  (OAuth device flow, MCP streams, webhook raw bodies) and the documented
  `*-legacy.rest.ts` family, each carrying a one-line reason.
- A branch living in a handler moves into the module as an `*Api` operation carrying that logic
  unchanged; such a one-to-one move is approved in advance. An operation that adds behaviour or a new
  shape is still asked for (Alex, 2026-09-24). `ScenarioApi.launchRun` is such a port, one-to-one with
  main's `launchScenarioRun`, and the scenario canary calls it too (Alex, 2026-09-29).
- A rule on what data may leave is applied by its owner before the data leaves, never by the route:
  one project operation applies the key-visibility and internal-kind rules (main's `internal_governance`
  projects are hidden from `GET /api/projects` only, not from `ProjectApi.listByOrganization`), and the
  route calls it (Alex, 2026-09-29).
- A protocol door whose logic main kept in the handler takes the raw request as one `*Api` op
  (`OtlpDoorRequest`: method, path, headers, body bytes) and returns its outcomes; the handler only renders
  them. Shared door helpers live in the protocol's framework package (`@langwatch/otlp`) (Alex, 2026-09-26).
- A socket that must be handed on unopened (voice media to a scenario child) is a declared raw-socket
  door: a path pattern and a handler given the request, the raw socket and `head`, hosted on its own
  port by the role that owns the children. The module resolves the public address itself, in its own
  app with an async create and a close, in the worker role only; other roles read it as
  `{ unavailable }`. It is never a module writing `process.env` (Alex, 2026-09-28).
- Voice runs in a scenario child, the live "Talk to it" session included: the parent authenticates,
  audits and bounds the session, then hands the socket to a child built for that one session (stripped
  environment, egress policy, that session's credentials). On shutdown the parent admits nothing new
  and each child ends its call cleanly, recorded as interrupted; phone jobs requeue. Every worker opens
  a quick tunnel to the door port alone; nonces live in Redis and upgrades carry Twilio's signature
  (Alex, 2026-09-28).
- The X-Twilio-Signature check on the media upgrade is deferred: the door admits on the nonce alone
  until it returns (Alex, 2026-09-28).
- A protocol whose handler must write the raw Node response itself (hosted MCP's SDK transports) is a
  declared raw HTTP door, `RawHttpProtocol` (`@langwatch/api`): exact paths, prefixes claiming a path and
  everything beneath it, and `open(app)` run once at mount returning `{ handle({ request, response }),
close() }`. The api's `serve()` answers a claimed request ahead of every route, as main's listener did;
  `close` runs at shutdown, before the stores close (Alex, 2026-09-27).
- The API door is bound once, by auth, with `bindApiDoor` in its `withTransportFacts`; the container
  hands installed facts to the surface factory, which opens it ahead of REST and tRPC. None or two
  binders refuse boot by name (`MissingApiDoorError`, `DuplicateApiDoorError`) (Alex, 2026-10-01).
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
- **The OpenAPI document is generated, never committed** (Rogerio, 2026-10-02). The api builds it
  once at boot from the routes it mounts and serves it at `/api/openapi.json`; `pnpm --filter
@langwatch/platform-api openapi:generate` mounts the same declarations on a host whose doors all
  refuse and writes it to `specs/api-reference/openapi-document.json`, which git ignores. The
  document names each route once, at its `/api/v1` address. A published name the declaration no
  longer spells (an `operationId`, a component) is kept with `.withDocs({ operationId })` and
  `.meta({ id })` on the route's own schemas, never by editing output. What is committed is what
  is generated from it: the TypeScript, Python and Go clients and the docs site copy
  (`docs/api-reference/openapiLangWatch.json`, which Mintlify needs in the repository). `make
sync-all-openapi` regenerates all four, and the `openapi-clients` CI job fails on any diff.
- **Middleware never does the framework's work** (Alex, 2026-10-05): middleware doing what the API framework
  does (authentication, JSON body parsing) and a route opened to any authenticated or unauthenticated caller
  are drift, caught by lint rules whose message tells the agent why and what to use instead. Those guard
  rules are among the few that accept a disable with a reason (§17); the guard list is
  `dev/docs/plans/api-framework-bypass-2026-10-05.md`.
- **Framework extensions are shapes first** (Alex, 2026-10-05): for each extension E1 to E8 in that plan, a
  lane writes the signature and one example route, no code, and Alex approves before any is built. The
  raw-body media-type refusal (collector, evaluations-legacy `log_results`) joins them as E9, shapes first
  (coordinator, citing Alex's ingestion-key approval, 2026-10-05). The order: CI green first, then the
  extension designs and the bypass guard rules (Alex, 2026-10-05).
- **E9, a raw body under another media type** (Alex, 2026-10-05): a route that reads its raw body names
  the media type it reads, `.withRawBody("text", { mediaType })`, and any other `Content-Type` is refused
  after the door, with 415 `unsupported_media_type`. The `*-legacy` family and the collector keep main's
  400 `malformed_request` by declaring `mismatch: "malformed_request"`. Their protocol refusal renders
  main's exact 400 body, and its producer may `decline()` a failure, so only `malformed_request` is
  rendered by the protocol and 401, 403 and 413 stay on the family boundary (coordinator, E9 option B,
  2026-10-05). Spec: `packages/api/specs/transport-conventions.feature`.
- **E10, a declared audit target** (Alex, 2026-10-05): a tRPC mutation declares
  `.withAudit({ target: "organization", via: "projectId" })` and the row names the organization holding
  that scope, beside the project. The door's `organizationOf` resolves through `AuthzApi.getScope`, auth's
  existing peer, so there is no auth -> project edge (coordinator, members wave 3, 2026-10-05). A sink
  without `organizationOf` refuses the declaration at mount, naming the procedure. Spec:
  `packages/api/specs/trpc-framework.feature`.
- `POST /api/demo/hotel_bot` is for LangWatch staff only (platform operators) (Alex, 2026-10-05): it moves onto
  the platform-operator door tier (E4) when that lands; until then the route refuses every caller, since
  nothing in the product calls it.
- Contract export names are not wire: `secretReferenceOf` and `queuedThreadIdOf` are renamed as
  `langwatch/fallible-result-naming` says, and `getLatestLocalControlRequest` returns an explicit result
  instead of `null`. The collector and evaluations-legacy routes keep main's 400 body through the framework's
  protocol refusal (`withResponse("protocol", { refusal })`), and the suite routes take one combined REST
  fact (coordinator, citing the lint-findings ruling, 2026-10-05).
- Workflow's contract keeps `Date` for `updatedAt` on the wire, since a `Temporal.Instant` drops the
  milliseconds of whole-second timestamps and a test pins today's JSON; the repository carries Temporal
  (coordinator, citing `langwatch/temporal-only`, 2026-10-05; replaces that day's `Temporal.Instant` wire ruling).
- api-key's `POST /ingestion` moves its two refusals, same order and conditions, into a new in-module
  operation, `createIngestionKey` (Alex, 2026-10-05). Because the route calls `ApiKeyApi`, it is declared on
  the contract (`createIngestionKeyInputSchema`, `ApiKeyApi.createIngestionKey`) (coordinator, citing that
  approval, 2026-10-05).
- **The execute-sync relay (#8429) lives in the workflow module**, beside the engine channel; the project comes
  from the key, never the body (Alex, 2026-10-05). It is one operation,
  `WorkflowApi.relayExecuteSync({ projectId, event, signal })`, declared with today's doors (project
  credential, `scenarios:create`, a 50 MiB body limit, a forwarded response, hidden docs); `projectId` is
  `scope.id`. A timeout answers 504 and a caller
  gone 408; the ceiling is a workflow config member defaulting to 900000 ms; a non-JSON body answers the
  framework's 400 `malformed_request` in place of main's bespoke body (coordinator, L6 R1, citing that ruling,
  2026-10-05). A top-level `projectId` naming another project answers 403 `scope_input_mismatch`, a project
  inside the event is ignored as on main, and a non-object JSON body answers 422. Scenario learns whether the
  deployment has per-project engines through one `WorkflowApi.hasPerProjectEngines()` read;
  `LANGWATCH_NLP_LAMBDA_CONFIG` stays workflow's secret alone, and the `NLP_FETCH_MAX_TIMEOUT_MS` leaf is
  workflow's, which scenario's agent-test deadline reads as `nlpFetchMaxTimeoutMs` from workflow-contract
  (coordinator, L6b R2, citing the same ruling, 2026-10-05). R3: the agent-test turn goes through the
  relay, like every other turn, and the any-project Lambda credential stays in the control plane:
  `AgentTestTurnJob` carries `executeSyncRoute` from the same rule as simulation jobs
  (`WorkflowApi.hasPerProjectEngines`); self-hosted stays direct (Alex, 2026-10-05).
- The instant-eval opt-in procedures `access` and `enable` are declared in trace's contract under
  `traces.instantEval` as two `TraceApi` operations that forward to `InstantEvalApi`, as
  `trace-instant-eval-run.service.ts` already does; instant-eval's process takes `@langwatch/authz-contract`
  (coordinator, L7 R1 and S1, 2026-10-05). `traces.instantEval.enable` is audited against the organization,
  as on main, through E10's declared target (Alex, 2026-10-05); never a hand-rolled audit write.
- Parameters the evaluator overrides are refused everywhere, not on REST only as on main: the monitor service
  refuses them with 422 `monitor_parameters_unused` at every door, so the UI create form must not send them
  (Alex, 2026-10-05).

---

## 9. Eventing

The module declares its whole pipeline once:

```ts
// modules/trace/process/src/eventing/trace-processing-projections.pipeline.ts (abridged)
definePipeline({ name: "trace_processing", aggregate: defineAggregate({ type: "trace" }) })
  .withEvents([spanReceivedEventSchema, …]) // zod schemas, one per event type
  .withClickHouseFoldProjection(TraceSummaryFoldProjection.create({ store, … })) // fold → read model
  .withClickHouseMapProjection(SpanStorageMapProjection.create({ store, … })) // one row per event
  .withPostgresProjection(stateProjection) // load / evolve / store (scim-sync.pipeline.ts)
  .withCommand("assignTopic", EventingTraceTopicAdapter) // validate → append
  .withCommandInstance({ name: "recordSpan", handlerClass, instance, options }) // constructor DI
  .withEventSubscriber("name", { events: [TYPE], handler }) // reaction, no projection state
  .withProjectionSubscriber("name", { fold: "traceSummary", events, handler }) // or `map: "spanStorage"`
  .withPeerSubscriber("name", { eventType, data: schema, handle }) // a peer pipeline's event
  .withProcessManager("retentionSweep", (pm) =>
    pm.state(schema, initial).schedule({ everyMs }).onWake(wake).intent("pass", schema, run),
  )
  .build();
```

Projections, subscribers and process managers run in the worker only.
`modules/trace/process/src/eventing/trace-processing.pipeline.ts` shows a full set of
subscribers, and `enterprise/modules/billing/process/src/eventing/connected-billing.pipeline.ts` a
scheduled process manager. The module installs the result through `defineEventingModule({ pipeline, build,
connect })` and `.withEventing(...)`.

Background work is a scheduled process manager on the module's pipeline, installed with it through
`.withEventing` (Alex, 2026-09-23): `.schedule({ everyMs })` arms a wake on the instance row, the worker
hosts it, it ticks once across the fleet, and `onWake` sends the module's own intent through the outbox.
There is no `.withJobs` and no module-level timer loop. Work that must run in every role (ADR-090's
lease-held writer) is not background work: it stays a service the module owns. `withWorkers` is retired.
A module reacting to a peer's event does it through a subscriber that lives in the reacting module, on
the owner's pipeline events, and sends its own command, so the reaction lands as a durable event on the
reacting module's own pipeline (Alex, 2026-09-25; placement Alex, 2026-09-29).
The subscriber's edge runs from the reacting module to the owner, the same way as any read of it, so
it closes no construction or package-import cycle and needs no pull. Those two graphs must stay
acyclic; event causation may loop (a request and its completion) and idempotency handles it
(Alex, 2026-10-01). Seat changes are the case: billing subscribes to licensing's
seat-raised event and sends its own invoicing command; `LicensingApi.findSeatChanges` and the minute
poll go (Alex, 2026-09-29).
A module reading its own event-sourced state writes optimistically or tolerates eventual consistency
with a pending answer, never a reverse read; identity's history and proposals are read through the
eventing member's surface (Alex, 2026-09-29).
Enterprise `nurturing` shows the subscriber rule (Alex, 2026-09-29): nurturing's own subscribers listen to
each owner's events, which carry ids and the non-personal, point-in-time facts; no owner knows nurturing and
`recordSignal` leaves the owners. No event carries
personal data: where a signal needs some it carries the id (and a revision), and nurturing reads the value from
`UserApi` at delivery and never stores it. Only the email and name leave, to Customer.io, once at sign-up; each
identify sends only the traits that signal changes, once per source event.
With no owner-to-nurturing edges, its `nurturing -> user` read closes no construction or package-import cycle, and the ratchet baseline
carries no exception for it (Alex, 2026-09-29).

The framework's public types carry typed parameters or `unknown`, never `any`: an event, command or
projection state keeps its type from declaration to handler (Alex, 2026-09-24).
A registry holding definitions of different types wraps each typed definition in a closure when it is
registered; callbacks stay properties, never methods whose bivariant parameters would let a handler
narrow its pipeline's event type (Alex, 2026-09-24).
The pipeline builder's type carries each registered fold's name mapped to its state, so a projection
subscriber named by its fold is typed with that fold's state through the name; a sealed projection
exposes a read-only `definition` view beside its `open` closure (Alex, 2026-09-24).
The builder's overload implementation keeps one `any` where the state crosses the name lookup —
callers stay typed; it carries a disable comment naming why. A map projection declares the subset of
its pipeline's events it consumes, which types its key and map functions (Alex, 2026-09-24).
A command declares the exact events it produces, and `withCommand` accepts it only when they belong to
the pipeline. A queued payload is `unknown` until its schema parses it once at dispatch (Alex, 2026-09-24).
A pipeline declares its events with `.withEvents(schemas)` — the contract's zod event schemas, whole and
versioned — and a queued event parses with the schema declared for its type; the queue never needs a
second schema or a cast. Routing (group id, score) is computed from the typed value at send and handed to
the group queue as send options; the queue never reads a payload. A process manager's intents keep their
schema's type through a self-referencing generic and sealed closures, like projections and commands
(Alex, 2026-09-25).
A list mixing definitions of different types holds them as closures over `unknown` payloads, each
parsing with its own schema at the queue boundary — never `any`, never a rule exception (Alex, 2026-09-26).
Per-payload routing (group key, score, coalesce size, dedup id) travels in one reserved `__routing` field on
the job envelope; `withEvents([])` types a pipeline's events as `never`; a command's lane parse is its only
validation, handed to `processCommand` (Alex, 2026-09-27).
A process-manager handler emits intents through the typed accessor `ctx.intent(name, key, payload)`, and
registers with `.on(eventSchema, handler)` (or reads its `.toPayload(schema, map)` view); no cast (Alex, 2026-09-27).
Per-entity calendar work (a report's cron) is a keyed process manager on its owner's pipeline, arming
`nextWakeAt` per entity, not `.schedule` (Alex, 2026-10-01); the eventing `ScheduledJob` scheduler is retired,
its table dropped a release after its code (Alex, 2026-09-26).
Periodic work is a scheduled process manager (`.schedule({ everyMs }).onWake`) on its owner's pipeline;
there are no cron routes. A route under `/api/cron` is refused by
`packages/architecture-enforcer/tests/no-cron-routes.unit.test.ts` (Alex, 2026-09-29).
The system-migration re-drive and an operator's "run a pass now" are one scheduled process manager
on ops' `ops_system_migrations` (Alex, 2026-09-28): the hourly wake asks for a pass only when the
stored state holds a tenant a pass could still move, and the kick is a command whose event asks
the same intent ungated. The kick's tenant is the operator's user, which the event store places on
the shared cluster, and its aggregate is not the scheduled singleton, whose wake an event would clear.
A kick that cannot be sent is logged, never refused: the page is told the pass started, as main's
fire-and-forget kick was, and the hourly wake still re-drives any tenant that could move.
An experiment run executes on its pipeline, never in a request: `StartRun` is a command, a process manager
emits one cell intent per row and target, the worker runs each cell as a command appending its result
events, and projections fold progress that SSE and polling read. Abort is a command the manager honours.
The manager is the concurrency window: it sends N cell intents, then one per finished cell; phase 2 reads
phase 1's outputs from the run's fold; a run without an experiment is keyed by runId (Alex, 2026-09-28).
A cell intent carries only its ordinal and phase: `started` carries the scoped plan, the run's fold keeps
it, and each cell reads its row, target and evaluators from the fold. The comparison set is planned from the
run's configuration at start; each comparison cell decides from its own row's variant outputs whether it runs
or finishes skipped, so the manager stays pure over counts (Alex, 2026-09-28).
A run's live frames are published from its progress fold, which assigns each frame's seq and keeps the
counts, so a reconnect's replay and the live stream cannot disagree; its events carry every detail a
frame shows (an evaluator's error type, traceback, domain error, raw response and cost currency) as
additive fields, never a side channel (Alex, 2026-09-28).
A polled run start or workflow evaluation answers 200 the moment its command is written, never waiting
on the worker; it records the run's start beside the fold, so an early poll reads `running` (Alex, 2026-09-30).
An operator's projection replay runs as a worker process-manager intent, never in a request: the api
takes the Redis replay lock, records the run and sends `requestProjectionReplay` on ops'
`ops_projection_replay`; the intent awaits the whole run, fenced by the lock holder, so a delivery
for a run that no longer holds the lock does nothing. Status, history and cancel stay the Redis keys
every role reads (Alex, 2026-09-28).
A replay reads its projections off the pipelines the process registered: `replayProjectionsOf`
unwraps a `RedisCachedFoldStore` to its durable tier, and a map projection's owner declares the
`targetTable` a rebuild optimizes on its definition. No list outside the owning module names a
store or a table (Alex, 2026-09-28).
A pipeline whose projections write tenant rows declares each tenant's retention itself (Alex,
2026-09-28): `.withRetention(resolver)`, built from its module's own `DataRetentionApi` dependency
(`getResolvedForProject`, a tenant being a project), and registration prefers it to the runtime's.
The eventing member is built before any module, so it holds no late-bound resolver; a pipeline
declaring none leaves each store to stamp the platform default.
Spec: `packages/eventing/specs/pipeline-retention.feature`.

A module may host several pipelines: it calls `.withEventing(...)` once per
pipeline, each a `defineEventingModule` declaration over the same app and
repositories. The process builds, registers and connects them one at a time in
the order declared, so a later pipeline's `build` may read senders an earlier
one's `connect` handed the app. Each still follows the role table below — the
api constructs none of their reactions. A pipeline the module defines but does
not declare this way is registered by nobody; no application line stands in.

A projection over every pipeline's events, not only its own (the SaaS billable-events meter), is
declared on the owning module's pipeline with `.withGlobalMapProjection(projection, subscribers)`;
the runtime registers it onto its global registry when that pipeline registers, in both roles, and
refuses by name one that arrives after the registry started routing. The registry starts routing
when consumers start, or at its first dispatch where none are held, so several modules may declare
global lanes, registered in any order (2026-09-30).

A module reacts to a peer's event with a peer subscriber (2026-09-30), the primitive the subscriber
rule above names: `.withPeerSubscriber(name, { eventType, data, handle })` on its own pipeline,
naming the event by the owner contract's type and data schema, so its one edge is that contract.
It rides the global registry: staged wherever the owner appends, at least once, ordered per
aggregate, re-driven through the hand-off outbox, never replayed; the handler is idempotent and
throws to be retried. Analytics writes a new project's LangWatchQL key-map row from project's
`lw.project.created`; organization's new personal workspace reaches it through project, which
records that project as created from its own side. A peer subscriber writes its own read-model row
directly; it sends its own command only when the reaction is a fact others react to, since the
lane already gives retry safety (Alex, 2026-09-30). A peer subscriber may declare its own enqueue
shaping (`options`: delay, dedup, group lane) and is handed the event's `occurredAt`. Automation
reacts to trace's span and origin events and evaluation's completed and reported events this way,
keeping main's settle windows and reading fold state through `TraceApi.findSummary` and
`EvaluationApi.findRunByEvaluationId`; neither owner knows automation (Alex, 2026-10-01).
Coding-agent reacts to log's received-record and metric's received-point events the same way.
A delivery is not a reaction: a producer still calls a destination kind's `requestDelivery`, and the
destination holds no producer code (Alex, 2026-10-01; [ADR-167](adr/167-outbound-delivery.md)). The runtime's own maintenance
pipelines (blob sweep, process-manager retention) are built by the eventing member where a Redis and a
process store exist, answered by `maintenancePipelines()`, and installed once by the process after the
modules', where the role drains (2026-09-25). The producer role holds the process store too, so
every role reads and writes one process store (Alex, 2026-09-27).

The role selects participation: `container("api")` produces, `container("worker")` consumes and
`container("tasks")` produces (Alex, 2026-09-29). Neither exposes a transport. `boot()` translates the same module
pipeline declaration per role — **api is commands-only,
structurally**:

|                                              | role `"api"`                            | role `"worker"`                    | role `"tasks"`     |
| -------------------------------------------- | --------------------------------------- | ---------------------------------- | ------------------ |
| commands                                     | send (append + return)                  | send                               | send               |
| projections / subscribers / process managers | **never constructed** — nothing to call | hosted, per-aggregate ordered      | never constructed  |
| scheduled jobs                               | never constructed                       | hosted                             | never constructed  |
| eventing supply the role's chain demands     | `EventingProducer` (the type)           | `EventingHost` (consume + produce) | `EventingProducer` |

Two enforcement layers: the reaction half is simply not built in an api
process, and the role types the eventing requirement — an api-role chain
compiles only against a producer handle, so hand-wiring a consumer into it is
a type error.

Worker semantics: delivery is at-least-once, so subscribers are idempotent;
ordering is per aggregate via the group queue, so one poisoned aggregate
retries with backoff without blocking neighbours; a group waiting out its backoff frees its tenant
soft-cap slot and keeps its active lock, so its order holds while it runs nothing (Alex, 2026-09-30);
projections fold from the
same ordered stream; every consumer registers drain-first on the server.
The hand-off from an append to its projections, subscribers and process managers is durable: a
lane that cannot be staged is recorded in the process store's outbox and re-driven, a fold or state
projection by a rebuild job in the aggregate's own ordered lane, so it cannot race live folds, never
logged and dropped (Alex, 2026-09-29). A command job
keys the events it appends on its stable queue job id, so a crash replay collapses onto the first
append (Alex, 2026-09-29).
`packages/group-queue` owns the per-tenant enqueue-rate counter, taken at enqueue, and ops reads it
through the framework; no module scans queues or reads the `gq:parked-tenants` keys directly (Alex,
2026-09-29). A tenant is parked only while
the system is under load; otherwise a tenant may burst past the others (Alex, 2026-09-29).

**A spent trace job dead-letters instead of blocking its group** (Alex, 2026-09-30): order within
a trace is not load-bearing, so trace registrations set `onExhausted: "dead-letter"`; every other
registration blocks. The group queue owns and writes the dead-letter layout; ops lists, redrives
and discards it through the queue's exported helpers. A span that cannot be scrubbed is never
stored unredacted, and disabled DLP never skips redaction: it fails and, on a trace pipeline,
dead-letters, redrivable once analysis is back.

A fact is recorded by its owner; delivery modules are handed it; there is no relay module (Alex,
2026-09-29). Gateway's budget crossings and virtual key lifecycle changes are the case: gateway
detects a crossing after its own debit lands and records it with `recordBudgetCrossing`, keyed by
(budget, bucket, kind, period), on its `governance_events_processing` pipeline (main's stored
names). Webhook subscribes to those facts and builds and delivers the envelope; gateway holds no
`WebhookApi` peer (Alex, 2026-10-05; §5). A failed detection throws and the debit is re-driven. That is
safe because the ledger insert skips any budget the request has already debited.
Each destination kind owns its sending (Alex, 2026-09-30; [ADR-167](adr/167-outbound-delivery.md)):
producers call the kind's `requestDelivery`; retry, dead-letter and redrive are the outbox's; SSRF
and the outbound proxy are egress's. `requestDelivery` is built now, on the outbox, and producers move
onto it (Alex, 2026-10-05); no code spells it yet.

Langy's notifications go through Web Push from the server; the tab is never the sender (Rogerio,
2026-10-02). Web Push is a destination kind, so notification owns it: the browsers a person
subscribed (`WebPushSubscription`), the installation's VAPID key pair (`WebPushVapidKey`,
generated on first use and stored encrypted; cloud and self-hosted take the same path, with no env
var), and the sending, as `send` intents on the `notification_web_push` outbox. Langy reacts to its own
events (a long turn completing, a card waiting, the `notify` tool) and calls
`NotificationApi.requestWebPushDelivery` for the conversation's owner when their `langy`
preference is on, keyed by the event so a redelivery sends nothing new. The service worker skips
a push a visible tab already shows. The open tab notifies only on a device with no working push
subscription (no push support, or subscribing failed), never on one that holds a subscription,
even when a send fails. The panel's reads follow the turn through read hints, not a poll.

Group membership history is organization's fact, not authz's (Alex, 2026-09-30). Organization
records a member added to a group, a member removed and a group deleted as events on its own
pipeline, and the history columns on `GroupMembership` and `Group` (`removedAt`, `deletedAt` and
their reasons) are organization's, folded from those events. The authz grants ledger records grants
only, so membership needs no `AuthzApi` operation. Every write that changes who may do what ends by
retiring the organization's cached grants, through a grant write or `AuthzApi.invalidateOrganization`,
after the row it changes and never before: removing a member deletes the seat, then revokes its grants.

### 9.1 Purge, erase and retention across modules

**Cross-module purge, erase and retention are commanded by the owners** (Alex, 2026-09-29). Work
that removes or rewrites rows in more than one module (a deleted organization's purge, a user's
erasure, a retention change applied to stored rows) is never done by the module that starts it. The
initiator records one fact on its own pipeline. Each module owning affected rows reacts from its own
side and removes or updates only its own rows, idempotently, since delivery is at least once. The
initiator never deletes, updates or `ALTER`s another module's table, inside one transaction or not,
and never loops over a list of other modules' tables. Progress is tracked per owner, so the operator
sees when every owner has finished and which has not. Today's breaks (organization's provisioned
organization delete, user's data erase, data-retention's retroactive rewrite over other modules'
tables) move to this shape in their own changes.

A pinned trace is a bookmark, as on main: retention ignores pins (Alex, 2026-09-29). Until the
branch matches main, ownership moves that change no behaviour wait; they are listed with their
rollout checks in `dev/docs/plans/ownership-after-parity.md` (Alex, 2026-09-29).

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

**Visual parity judges features, not main's inconsistencies** (Alex, 2026-09-30). Where the branch
looks more solid and consistent than main (one section rail, one page header, one back link, one
branded card; main's dark gold sidebar gone), the drift is accepted. A missing control, state or
feature is still a defect. A screen takes the design system's shared piece over a hand-rolled copy.

**The declaration is the module's one browser export that matters** (landed
2026-09-18): a browser package's `exports` map lists `./declaration` only
(§3.4 — every sibling entry is a side door, and 23 packages grew one),
and the declaration file (`<name>.web.ts`, colocated test beside it)
declares screens, drawers and api bindings with the same loader shape —
`{ load }` — for each. The browser runtime (`@langwatch/browser`) stays React-free
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

**A screen declares the grant it needs, and the router guards it** (ruled
2026-09-28). A screen a viewer may be refused names the permission in its
declaration, `.withScreens({ key: { load, requires: "workflows:view" } })`,
and `installedModuleScreens` wraps what that loader resolves in
`withUiPageGuard`, with the shell's one fallback trio, for every module. The
screen never guards itself and the application names no page. The case that
forced it: main wrapped the workflows list in
`withPermissionGuard("workflows:view")`, and the move into
`modules/workflow/browser` dropped it ("chrome/guard no longer travel"), so a
viewer without the grant opened the list. specs/ui/ui-page-composition.feature.
**The seat gate is one gate at the shell route** (Alex, 2026-10-05): `resolveUiPageAccess`, navigation's
shell resolver, refuses a page whose product the seat does not reach with the standard permission alert;
no page gates itself, and the API still refuses the data.

Drawers are URL-routed singletons with a navigation stack, opened through the
host capability, registered through the declaration. The open drawer and its params live in
the URL (`drawer.open`, `drawer.<key>`); the drawers beneath it live in `history.state`, so Back
closes the top one and a reload restores the stack. No module-level drawer store. One tRPC client for the
whole browser.

How a screen is laid out (titles, header actions, containers, drawers, empty and loading
states, front door, chrome placement) is ruled in `dev/docs/design/guidelines.md` §4.

**An in-app link is `@langwatch/browser-host/link`** (ruled 2026-09-29), or a design-system element handed `onNavigate`; a bare anchor or Chakra `Link` with an in-app address reloads the document. specs/ui/in-app-links.feature.

**There are no per-read cache tiers** (Alex, 2026-09-30, amended 2026-10-01): a newer `x-lw-session-version` marks every read stale; no call site sets a `staleTime`. Every read is mirrored to disk by default (§10.2). ADR-170, specs/ui/browser-query-caching.feature.

**The session version is authz's, per user** (Alex, 2026-09-30): `AuthzApi.getSessionVersion({ userId })` backs `x-lw-session-version`, and a browser declaration states `.withApi(api, { contracts })`. A grant or role event bumps only the users it reaches (Alex, 2026-10-01): a role's holders come from its live grants, directly or through a group or team; a holder set that cannot be computed, or that passes 500 principals, bumps the whole organisation, and a failed lookup logs a warning; the tRPC host reads the version once per request (modules/authz/specs/session-version-holders.feature). ADR-170.

**A query never returns a credential** (Alex, 2026-10-01): every tRPC query may be cached, in memory and on the browser's disk, so no query output carries a secret (S3 secret key, project API key, LangWatchQL key, tokens, passwords). A credential comes back only from a mutation, and a mutation is never cached. A form that writes a secret never reads it back: blank means unchanged. A blank secret where none is stored yet is refused. A legacy project key is never read or rotated: its one action, `project.revokeProjectApiKey`, ends it for good and shows no new key; personal access tokens replace it, the CLI included (Alex, 2026-10-01). Admins only (`project:manage`), offered by a deprecation banner with a two-step confirm; `project.getLegacyKeyStatus` answers `{ present }`, same permission. The revoke overwrites the column with `lw-revoked-<ksuid>`, a value that never authenticates, until the column is dropped at sunset; the api-key answer cache may still honour the old value for up to 5 s. Platform paths never hand the legacy key to an engine. A run that calls LangWatch gets a virtual key minted like Langy's, FOR the starting user: it acts as them and is bound to the project. Its permissions are what this run needs (derived from the graph or run kind at mint time) intersected with what the user holds, never an unused one, and it expires after 15 minutes. A user lacking a needed permission is refused before the run starts (Alex, 2026-10-01). A run started with an API key holds no more than that key either: the needed set must sit inside both the person's grants and the key's own, the narrower winning (coordinator, 2026-10-01); a person's access token (CLI, hosted MCP) has no key row, so the person alone bounds its run, and until a later change a run started by an ownerless service key is bounded by what the run needs, not by the key (coordinator, 2026-10-01). The key is reused per (user, project, permission set) while 5 minutes remain, so long runs re-mint and experiments don't mint per cell; expiry is the only end, with no revoke op. A holder with a longer bound asks for a key that outlives it: a Lambda dispatch its 900 s timeout plus a minute, a self-hosted engine's dispatch a full 15 minutes, a scenario child its 15-minute stop; a fresh key then lives that floor plus the 5-minute reuse window, and no holder may ask for more than an hour. `ApiKeyApi.mintRunKey` is the one mint, and a code agent's sandbox gets its own per-run key holding only `agentCache:manage`, since user code reads it (ruled 2026-10-01). A run nobody started (monitors, online evaluations) acts as the system actor, never as the monitor's creator (that would let a creator's grants leak into unattended runs): its key has no owner, is bound to its project and holds only what that run needs (Alex, 2026-10-01). A key LangWatch mints for itself is marked so on its row (`isSystemManaged`); hiding it, refusing a customer's edit or revoke, and the system actor read that mark, never the name, so a customer key already carrying a newly reserved name stays the customer's, and the name only refuses new keys (coordinator, 2026-10-01). A third party's token typed into an HTTP node becomes a project secret on save; the node keeps only the `{{ secrets.NAME }}` reference. A project secret is not bound to an origin: whoever may edit a node may send a referenced secret to the address the node names (Alex, 2026-10-01). A value made only of `{{ secrets.NAME }}` references, optionally after one scheme word, is kept as references, and an agent test call is sent only the secrets its saved config references (Alex, 2026-10-01). The token is never readable through any query and never enters any cache: the browser mirror, any server cache, or Redis and queue payloads (Alex, 2026-10-01). A header is a credential when it is `Authorization`, `X-Api-Key`, `Cookie` or `Proxy-Authorization`, or its name contains key, token, secret, auth or password, case-insensitive; one test decides it for save, read and trace (Alex, 2026-10-01). A copy into another project arrives with every HTTP credential blank for the user to re-enter, and an agent's secrets are named from its id, so names never collide (Alex, 2026-10-01). The CLI, Langy and the hosted MCP sign in with the CLI's existing OAuth device grant, extended with no new routes. The exchange answers access and refresh tokens and the project, never a key; `/refresh` takes an optional project to re-scope; the API door accepts those access tokens as the person, capped at that project. MCP connections re-authorise once (Alex, 2026-10-01). Hosted MCP mints and rotates these sessions only through `AuthApi.issueProjectCliSession` and `refreshCliSession`; the project-tier `POST /api/api-keys/ingestion` (`traces:create`) mints an app's ingestion key from the project-bound access token, never from a key, for one shape only (personal, the caller's own, one binding to that project, `INGESTION_PERMISSIONS`, named after the machine, may never expire); a project login's session is locked to its project; a `/refresh` naming another project forks a child session locked to it and leaves the parent valid, as an MCP connection's session is a child of the person's, and ending or revoking the parent ends its children; an open MCP session adopts a refreshed token only for the same person and project; and a person's MCP session is refused the organization's ingestion-template tools, OTTL rules included, while their own ingestion-key tools still answer (coordinator, 2026-10-01). `login --project` writes a personal API key into the app's `.env`: the person's own key, bound to that project, with the full project permissions, so prompts, datasets, evaluations and simulations work from it as they did on main. The legacy project key (`Project.apiKey`) is never minted or returned. The CLI mints the key with a child session locked to that project and logs the child out afterwards; the stored credential is the key, never that session's access token. The project-tier `POST /api/api-keys/full-access` (`project:manage`) mints it from the project-bound access token, never from a key, for one shape only (personal, the caller's own, one ADMIN binding to that project, `permissionMode` all, named after the machine, may never expire), so it reaches what the person reaches in that project and nothing else. A person without `project:manage` gets the ingestion key instead, and the CLI says that key only sends traces; an older server that answers the project pick with an `api_key` has that key written as it is (founder, 2026-10-02). There is no separate key kind, only the same personal access token with a project scope; it is revocable (Alex, 2026-10-01). A token minted from a setup snippet holds the least its screen needs: ingestion only (`traces:create`) for trace and OTLP snippets, the one permission a prompt, evaluator or workflow snippet calls, and project reads for a coding-agent or MCP setup; it never exceeds what the person holds, a mint beyond that is refused with a message, and the screen says what the token can do (Alex, 2026-10-01). A coding-agent setup mints two tokens: ingestion only for `.env`, project reads for the MCP config. A setup skill that creates something gets its own token holding exactly the create permission it calls. The `/authorize` page mints the device-flow default set, capped at what the person holds, never a full key (Alex, 2026-10-01). The deleted CLI project-key path answers 410 Gone with an upgrade hint for a few releases (Alex, 2026-10-01).

**Query outputs are checked for credentials** (Alex, 2026-10-01): no read is marked "never on disk"; a framework test fails any tRPC query output with a secret-looking field.

**There is no shared server read cache** (Alex, 2026-10-01): none is built until a hot read is measured to need one, and that one is keyed per actor, after authz. ClickHouse stores behind cursor reads flush inserts before acknowledging (`wait_for_async_insert: 1`); the settle window is a per-projection option (default 5 s); session versions are stored durably beside the cursors.

**No request batching** (Alex, 2026-10-01): the browser sends one tRPC call per request and the server refuses batched calls, with no grace window.

**A write makes reads stale through the key** (Alex, 2026-10-01): a cursor-backed read's cache key carries its projection cursor, so a write changes the key and no call site invalidates by hand; a read with no cursor falls back to SSE hints and lifecycle-triggered reconciliation.

**No timer polling** (Alex, 2026-10-01): screens that polled on a timer, ops' 37 included, follow events instead. The "safety refetch" below is lifecycle-triggered reconciliation, not polling and not a staleness bound: the query client's `staleTime` only lets a read older than five minutes refetch when a tab is shown, on mount or on reconnect, and nothing runs on an interval (`packages/browser-host/src/query-sync.ts`). A screen with no server event yet waits for one rather than polling; the backend builds the missing events (Alex, 2026-10-01). The one user-chosen timer, dashboard auto-refresh, is off by default (Alex, 2026-10-01).

**One tRPC call per request over `httpLink`** (Alex, 2026-10-01): each answer carries its own status, session version and schema hash; a slow call never holds another back.

**Projection cursor reads** (Alex, 2026-10-01): a read declared `fromProjection` always answers in full; its cursor decides freshness and keys the cache, never a short answer. The cursor is the event id alone: event ids are KSUIDs, k-sortable with the timestamp first, but the comparison decodes the seconds and is never a plain string compare, and a newer id does not prove
older events applied (`freshnessOf`: an answer carrying the hint's own aggregate cursor can be `fresh`; one carrying the tenant cursor is at most `approximate`). It is stored durably in the Postgres process store per (projection, tenant) and per (projection, key). A hint carries its event id; every read answer carries the newest event id its projection has applied. An answer is fresh when its id is at or past the hint's; otherwise the tab asks again. KSUIDs order only to the second (then by writer instance), so an answer whose id shares the hint's second is fresh only when it equals the hint's id (Alex, 2026-10-01). An event id is identity, not a "caught up"
watermark: an aggregate-scoped read checks that aggregate's applied sequence, and a tenant-wide list is
approximately fresh (Alex, 2026-10-01). Authz, scope and entitlement run first; the caller's session version is folded into the cache key. The settle window (5 s, configurable) only bounds how long the tab keeps asking. Stale hints stay a subscriber on the committed event; the cursor closes the race with a slow projection (Alex, 2026-10-01). A projection that applies events out of id order can leave a cursor past an event it has not applied yet; that gap is accepted as too unlikely to engineer for, and lifecycle-triggered reconciliation covers it (Alex, 2026-10-01). A cursor read touches only its projections, guarded in tests and dev. Hints are sent from the cursor advance; erasure and retention go through events the projection applies; only projections a read names advance a cursor; time-relative reads stay off this path. packages/eventing/specs/projection-cursor-reads.feature.

**Collaborative writes carry an expected entity revision** (Alex, 2026-10-01): a write names the revision it read and gets a conflict outcome when the entity has moved on. No CRDT system is built.

**The server never answers `unchanged`; it always sends the full answer** (Alex, 2026-10-01): no content-hash ETag, 304 or `{ unchanged }` envelope. The browser caches: memory, plus a sealed IndexedDB mirror (every read by default, §10.2); staleness comes from SSE read hints and lifecycle-triggered reconciliation. No shared server-side read cache is built until a measurement asks for one (Alex, 2026-10-01). Reads backed by event-sourced projections answer in full too; their cursor only decides freshness and keys the cache. A contract drives hints with `.query(name, { invalidatedBy: [EVENT_TYPE] })`; `PresenceApi.readHints` streams them on `presence.onOrganizationReadHints` (`organization:view`) and `presence.onProjectReadHints` (`project:view`), which take the organisation (and project) as input and the user from the session, never from the request (Alex, 2026-10-01). The read-hints pipeline publishes on the framework's own channel `eventing:read_invalidated`, never on `broadcast:*`; presence subscribes and fans the hints out to browsers (Alex, 2026-10-01). packages/api/specs/read-hints.feature.

**The mirror is sealed per session and the seal expires** (Alex, 2026-10-01): every row the browser mirrors to IndexedDB is sealed whole with AES-GCM: a fresh 96-bit IV per write and the row's IndexedDB key as associated data. The key comes from the session read (`GET /api/auth/session`): HKDF-SHA256 of the session secret over `lw-query-cache|sessionId|impersonator|epoch`, where the session id is the one the server resolved from the cookie, never one the browser sent. It is derived on every read and never stored. The epoch is seven days on the server's clock (`QUERY_CACHE_EPOCH_MS`); the browser never computes one. The read carries this epoch's key and the last one, both kept in memory only, and the session read itself is never mirrored. A row opens under this epoch's key; failing that, under last epoch's key, and is then re-sealed in the background, which bounds a long sliding session. Otherwise it is a miss: dropped and refetched, as is a row tampered with or moved. A refresh or a new tab in the same session restores. A new session, such as a re-login after expiry, gets a new key, so the old mirror is a miss that is refetched and overwritten; that is accepted. A revoked or ended session derives no key again, so its disk copy is dead. An explicit sign-out also wipes `lw-query:*`. A device-bound key would add nothing: whoever holds the disk also holds the session cookie while it is valid. `useReadFreshness` tells a screen when a read was fetched and whether the network has confirmed a restored copy since.

**Visible tabs talk to the server** (Alex, 2026-10-01): a visible tab is live (hint stream, refetches) whether or not its window holds focus; a hidden tab makes no calls and catches up when shown. A BroadcastChannel carries `{ key, version }` only, never data, after a fetch lands; a receiver whose version differs marks the key stale without fetching. A read without a server version is compared by a hash of its data. There is no leader. specs/ui/browser-query-caching.feature.

**Server events say when a read is stale** (Alex, 2026-10-01): a browser read is cached and refetched when
an SSE event its contract names arrives, with lifecycle-triggered reconciliation (a refetch on focus, mount or reconnect once a read is older than five minutes, never a timer; no staleness bound is promised); modules pick no per-read tier.
There is no `unchanged` answer on any read. Event-sourced progress (experiment runs,
scenarios) follows its events, never a timer. A heavy read is split by fetching the entity and loading its
people when needed, not by a summary procedure. A user-chosen dashboard auto-refresh is the one caller-set
interval. A read refused with 403 refetches the session read once and invalidates nothing else; the
session read's own 403 never does (Alex, 2026-10-01). The browser cache needs no audience in its keys:
its mirror is sealed per session and reads carry their organization or project.

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

**A rail shared by pages of different modules is a design-system frame**
(Alex, 2026-09-28). `@langwatch/design-system/section-navigation-frame` takes
the links and the active one and holds no data; each owning page renders it
with the same entries. The case: main's Authentication rail (Overview,
Identity provider, Connectors) spans organization, sso and scim pages.

**A switcher a page borrows is lent by the module that owns the choice**
(Alex, 2026-09-28): project lends `projectSwitcher` by token, the peer lend (§10.1), and a host mount
answers `projectSwitcher()` from that declaration, never null. It moves off `withCapabilities`, which
§15 deletes for a peer lend (Alex, 2026-10-05); today project still declares it there. The case: settings/secrets lost main's project selector beside
Add Secret because no module lent one.

**A graph a peer borrows arrives already narrowed to the caller** (Alex,
2026-09-28): the owner's service applies its own visibility rule before the
graph leaves, and the borrower never re-filters it. The case: `organization.getAll`
returns only the teams, and their projects, that the caller can open, so the
project switcher lists them as they arrive.

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
  Counted across `defineBrowserModule`'s ten module-facing slots:

  | slot                         | declarers | consumer                                   |
  | ---------------------------- | --------- | ------------------------------------------ |
  | `withScreens`                | 33        | `installedModuleScreens`                   |
  | `withDrawers`                | 11        | `installedDrawerLoaders`                   |
  | `withConfig`                 | 1         | yes                                        |
  | `withApi`                    | 1 of 33   | `installedModuleApis`                      |
  | `withCapabilities`           | 6         | `declared(name)`, both deleted since (§15) |
  | `withFailureInterceptors`    | 1         | `installedModuleFailures`                  |
  | `withFlags` · `withCommands` | **0**     | **none**                                   |
  | `publishSurfaces`            | 13        | **none — superseded, below**               |

  Only the last row is builder surface that does nothing, and only it is
  deleted. The three above it are the opposite case and stay: their consumers
  are built and waiting, and what they lack is declarers. `withSlots` has
  since gone too: slots are deleted, and a core screen renders the
  enterprise module's lent component (§11; Alex, 2026-09-29). The shell runs
  every installed failure interceptor over each failed mutation, so a failure
  a feature answers application-wide is reported once; licensing answers
  limit and Lite Member refusals with its upgrade modal, as main did.

  **`publishSurfaces` is superseded by the closed browser package** (ruled 2026-09-18). It is the
  declaration-side twin of the `./surfaces/*` exports entries §3.4 just closed:
  `organization` publishes `surfaces/department-picker` and
  `surfaces/personal-workspace-features` — the same names its exports map
  opened. Both halves answered the same question, "how does another module
  reach into mine", and the closed package is now the whole answer. 13 modules declare it
  and nothing reads it at runtime, so no behaviour depends on the removal; the
  surfaces travel to the design system or the owner's contract, or they dissolve. Found while correcting
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
  refuses by name — the same way the browser runtime already refuses a screen name two
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
  // packages/browser/src/ui-feature-shell.tsx — the only mount pattern
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
    // packages/browser/src/web-module.ts — names only, nothing to render
    type WebHostDeclaration = {
      readonly requires: readonly string[];
      readonly mounts: readonly string[];
    };
    ```

    `hosts.mounts` is read in exactly one place, `ui-host-mounts.ts`, to decide
    whether a `requires` is satisfied. No code path renders a mount, so
    `mounts` today is a promise about the world, not a thing the browser runtime does.

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
  `createUiModuleHostStack` composes them inside the feature shell, below the
  router, around both the page and the open drawer (`CurrentDrawer`): a drawer
  reads the same hosts its screen does (moved out of the root layout in
  cc00c8a30b, when drawers crashed without `ScenarioHostProvider`).

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

- **A capability travels by declaration** (ruled 2026-09-18). `defineBrowserModule`
  carries a capability slot, and the composition root reaches a module's
  capability implementation through `./declaration` like everything else:

  ```ts
  // modules/organization/browser/src/organization.web.ts
  export const organizationWeb = defineBrowserModule("organization")
    .withScreens({/* … */})
    // "Where they are standing" is organization's to answer, and its one
    // consumer is the composition root, so it is declared, not shared.
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
  browser package closed. It could not be shared code, since its only consumer is the
  composition root, and it cannot be reached directly, because that
  is the side door §3.4 just shut. Exempting the composition root was
  rejected: "composition root" is a door, and doors get claimed by whoever can
  argue they are composing. Declaring it instead completes the sentence this
  section already starts: capabilities are composed by the shell and reach
  modules through a declared `*HostApi`. Data a module's screens fetch comes through that module's `<name>-client` (§3.4).

  **The slot is "what the composition root installs from this module", whether
  or not it fetches** (ruled 2026-09-18). Fetching never decided whether
  something is a capability. Reading the
  slot as fetch-only stranded a whole class: a PURE symbol whose only consumer
  is `apps/ui` could not be a capability or a subpath (§3.4), and the usual remedy — inline or
  duplicate into the consumer — assumes the consumer may hold code, which
  §10.1 says `apps/ui` may not. Measured before ruling: **9 such specifiers
  across 6 modules** (auth, langy, navigation, organization, scenario, trace),
  so it is a class and not a coincidence. Each is a barrel today, and splits
  into fetching and pure halves on inspection; both halves ride the slot, so
  the split costs nothing.

  A theme config still is NOT a capability. It is pure data with consumers
  besides the composition root, so it belongs in the design system — `apps/ui` keeps the
  skin, and `langy-theme` travelling as theme data is the shape. The test is
  the consumer, not the purity: **many consumers → design system; the composition root
  → the slot.**

  **Replicate targets are one capability organization lends** (Alex,
  2026-09-28). The projects a reader could replicate a thing into, each graded
  by the reader's own `authz.effectivePermissions` in that project (main's
  `useProjectsForCopy`), are organization's `copyTargets` capability. The
  shell loads it with `scope` and installs it as `UiCapabilities.copyTargets`
  over the same organization graph; every host's `copyTargets()` projects
  `useUiCopyTargets().targets(permission)` into its own port shape. No answer
  yet is `undefined` on the capability, and `[]` only on an array port. The
  case that forced it: six mounts (workflow, dataset, evaluator, monitor,
  prompt, agent) answered `[]`, so every Replicate dialog offered nothing.

- **A name another module depends on is a token from its owner** (Alex, 2026-10-01). A lent
  component, lent operations, lent hooks, an extension point and a drawer are each declared once as
  a typed token, `uiTokens("<owner>").component<Props>("<name>")` from the light core. Consumers
  read `useLent(Token)`, `useLentAll(Token)` or `openDrawer(Token, props)`. browser-host knows no
  feature, and the compiler checks lender and reader against the one type.

  **The owner lends by token.** `.lends(Token, { load })` and `.drawer(Token, { load })` check the
  loaded default against the token and refuse a token another module owns. An extension token is the
  one any module may lend, read as a list. `createUi` refuses two lenders of any other token, naming
  both. `withCapabilities` keeps only what the composition root installs.

  **A token lives in its owner's contract**: props naming a framework type, or a contract whose
  graph reaches the owner's, are not allowed in it, so the owner makes the props data-only. A drawer only its owner opens keeps
  its token in its own `model/`; an extension token lives with the page that hosts it.

  **Release flags are a host service feature-flag provides.** browser-host holds `UiFlags` (on, off
  or not yet answered, for the current scope) and `useFeatureFlag(flag, { projectId | organizationId })`,
  which keeps its name and is not a §15 deleted spelling (Alex, 2026-10-05). Feature-flag's browser
  implements it from its own client, and the shell composes it beside session (auth) and scope
  (organization). Flags are `ReleaseFlagToken`s from `FrontendFlags` in feature-flag's contract,
  screens' `flags:` included. The session answers no flag.

  **A host service is provided by its owner and resolved by the browser runtime.** browser-host declares
  `hostService<Source>(name)`; the owner declares `.provides(Service, { load })`; `createUi` resolves
  each to its one installed provider, refuses none or two, and runs the sources in the runtime's
  order. apps/ui names no provider.

  **browser-host and browser depend on no module contract.** A feature type in a framework package
  is a central map every browser program compiles: before tokens, 39 packages compiled 14 contracts
  through `declarations.ts`. An enforcer policy holds this, with a shrink-only baseline (§17).

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
  and its own scenarios, not a side effect of a file move. **The knot is untied as its own specced
  change** (Alex, 2026-10-05): permission reads move to the session capability, public shared pages
  get an explicit no-session host, and then the 506 call sites migrate.

- **State defaults to server state**: react-query over the derived tRPC
  client is the normal answer, so cross-module client state is rare and ruled
  case by case. The unit of browser sharing is the **published hook** — the
  owner publishes hooks through its `<name>-client`; shared mutable-state packages are
  not a tier, and client state lives in the one global UI store (§10.2).
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
  `@langwatch/browser`, which is the browser twin of `@langwatch/process` and
  already owns `createUi`. Providers, the router construction, route
  materialisation, page fallbacks, the drawer mount and the error boundary are
  all machinery: none of them is specific to this deployment of the product.

  The measurement that forced the amendment: apps/ui held 75 files across
  `behavior/`, `shell/`, `ui/` and `model/`, while the browser runtime held 6.

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
  yes it belongs in `@langwatch/browser-host` or `@langwatch/browser`, and if
  no it is composition and may stay until it dissolves.

### 10.2 Browser state (ruled 2026-10-01)

**Four tiers, one home each** (Alex, 2026-10-01). (1) Server state lives in React Query
through the tRPC client and is never copied into `useState` or a store (`query-data-in-state`).
(2) Address-bar state (filters, tabs, drawers) lives in the router. (3) Shared client state
is a module's namespaced slice of the one global UI store (below), actions as named functions.
A persisted slice keeps preferences only (panel sizes, toggles, selected tabs), never server
data, keyed to the signed-in reader and forgotten at sign-out (Alex, 2026-10-01).
(4) Local state is `useState`; derive during render, never sync in an effect (`effect-derives-state`).

**One global UI store, namespaced like Redis keys** (Alex, 2026-10-01; supersedes the
module-private store). `browser-host` holds one zustand store. Each module keeps its client state
under its own prefix (`trace:`, `langy:`) and writes only there; any module may read any prefix, so
state is shared without wiring, and data only flows down. App-wide UI state (the Langy panel, the
upgrade modal, theme) sits under `shell:`. Server data never enters it (tier 1).
A module's host actions another module calls are a slice too (`workflow:host`). A context whose
provider and every consumer sit in one module stays a context.
Redux is still not imported (`no-redux`).

**One entity, one key** (Alex, 2026-10-01). Each entity has one canonical id and one detail read;
hints (time window, `full`, `occurredAt`) never enter a key; a list seeds the detail entries of
the rows it returns; a mutation writes the entity in place with `setData`.

The canonical reads are chosen for security (Alex, 2026-10-01): every read takes the opaque id plus
the tenant scope it is authorised against (`projectId` or `organizationId`), never a slug, handle or
other guessable name, and never an id alone. A slug or handle in a URL is resolved to the id once,
at the route, by a read scoped and authorised the same way. Trace `traces.header({ projectId,
traceId })`, with `occurredAtMs` sent outside the key; span `spanDetail({ projectId, traceId,
spanId })`; scenario run `getRunState({ projectId, scenarioRunId })`; experiment
`experiments.get({ projectId, experimentId })` and run `getRun({ projectId, experimentId, runId })`;
prompt `prompts.get({ projectId, promptId })`; dataset `dataset.get` plus `datasetRecord.list({
projectId, datasetId, page })`; evaluator `getById({ projectId, id })`; project: the scope graph;
members `members({ organizationId })` for active members, with deactivated ones in a second key
that needs `organization:manage`; user `user.me()`.

**Reads are mirrored to disk by default** (Alex, 2026-09-30, amended 2026-10-01; supersedes opt-in
persistence and the build-id discard). Each tab keeps its own React Query cache, and every declared
query is mirrored, one sealed row per query keyed by user and query hash (sealing in §10; memory
where IndexedDB is unavailable). A read stays in memory only when it is over the per-row cap or on
the named exclusion list for very high-traffic reads (`UI_QUERY_MIRROR_EXCLUDED` in
`@langwatch/browser-host/cache-tiers`); there is no opt-in. Each user's mirror is LRU-bounded
(25 MB, 500 rows, 2 MB a row: `UI_QUERY_MIRROR_BUDGET`), the least recently read rows first out.
A row carries its read's schema hash: a digest of the contract's input and output schemas and an
optional `revision: n`, bumped when a read's meaning changes and its shape does not
(`schemaHashOf`, `@langwatch/module`). The browser takes the hash from the contract it was
built with and drops a row whose hash differs before painting it; the server's `x-lw-schema`
header on every query answer is the backstop for a tab whose bundle is older. No build id or age
decides it. A mirrored read is restored when first asked for, never all at start-up; the first
page of a paged read is mirrored too, restored as stale and refetched at once. A tab shown again
reads IndexedDB first, then refetches the stale reads it holds, so hints it missed while hidden
are caught up (Alex, 2026-10-01). An answer whose `x-lw-schema` differs from the bundle's hash
drops that row. Not built yet: the lazy restore (rows restore at start-up). ADR-170 (in part),
specs/ui/browser-query-caching.feature.
`CachedView` ships.

**Browser telemetry** (Alex, 2026-10-01). RUM is on by default wherever a collector is configured.
Console errors, uncaught errors and rejected promises go out as `browser.error` spans through our
RUM endpoint, which forwards them to every configured destination: the RUM collector over OTLP
(Grafana, the main one) and PostHog when PostHog is configured. Design-system components restate
contract types structurally, since the design system imports no contract. The global store's typed
read holds its one cast inside `browser-host`. A boot reader needing fields the scope graph lacks
gets its own small read. `no-direct-chakra` turns on once Chakra waves 2-3 are green.

---

## 11. Enterprise

`enterprise/modules/<name>` mirrors the module shape exactly and **exports
modules like any other** — the generated lists (`apps/*/src/{process,browser}-modules.generated.ts`) carry core and enterprise
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
Enterprise is a licence, not a separate app (§3): a core module imports an enterprise contract or client
like any peer's, the enterprise owner refuses per organization, and a core caller never re-checks
entitlement before calling. There are no slots: a core screen renders the enterprise module's lent component directly, and
the shell's upgrade modal (`globalUpgradeModal`) is licensing's declared mount (Alex, 2026-09-29).

**Seat limits are organization's to answer** (Alex, 2026-09-28).
`licenseEnforcement.checkLimit`, `checkAllLimits` and `reportLimitBlocked`
keep their wire path, but the contract and transport are organization's: it
owns the membership rows a seat counts and already reads the plan through
`EntitlementApi`. Licensing cannot depend on entitlement (it is entitlement's
peer), so its members refused every call and `checkLimit` answered 500.
A seat limit reached is organization's event; billing learns it through §9's subscriber, which lives
in billing on organization's events (Alex, 2026-09-28; placement Alex, 2026-09-29).

**Usage warnings: usage decides, billing only sends** (Alex, 2026-09-29). Usage owns all counting
(§3): it takes billing's billable-events meter projection and its table, and counts traces itself.
It counts the month once per project in the organization's meter, decides the crossed threshold and
records it as a usage event with the per-project counts; billing learns the warning from that event,
resolves the admins and project names, sends once per threshold a month and records it. Billing
counts nothing, learns the month's total from usage's `month_counted` event and holds no `TraceApi` peer
for usage; no trace-usage or billing-usage cycle forms (Alex, 2026-09-29). Billing applies explicit
adjustments, so a lower corrected total is never dropped as a stale reading, and `limit_cleared` reaches
the doors promptly after an upgrade (Alex, 2026-10-01).

**Enterprise scim owns the directory-sync state** (`ScimSyncState`, its `scim-sync` pipeline,
guards and ledger); identity keeps none of it, and `ScimApp` builds the sync lifecycle over its
own rows (Alex, 2026-09-28).

**Identity owns the SSO sign-in user resolver** (Alex, 2026-10-01): picking or linking the existing
account after the domain gate is an `SsoAssertionApi` operation over identity's own rows; scim answers
its directory facts (owns the user, inactive, active membership) through `ScimApi`, and auth's
better-auth channel only calls both in order.

**Langy's flag-gated skills are a contract constant** (Alex, 2026-10-01): `LANGY_SKILL_GATES` sits in
the langy contract beside `LANGY_TURN_SKILL_IDS`; the warm and the turn probe carry the same disabled
skills.

**An orgless SSO test sign-in bounces in navigation** (Alex, 2026-10-01): the landing redirect sends a
person with no organization back to their own account; the browser-host scope hook does not redirect.

**Going live twice costs nothing and states nothing** (Alex, 2026-10-05): activating an already-active SSO
connection is a silent no-op; the guard allows ACTIVE -> ACTIVE without a fact, and the spec stands.

---

## 12. Errors

Throw `HandledError` only when the cause is known **and** the caller can act;
declare the `code` on the subclass in the module's contract and register it in
`packages/handled-error/src/app-codes.ts` (`APP_ERROR_CODES`, sorted). Its customer copy goes in the
presentation registry (`packages/handled-error/src/presentation.ts`), and its tips and docs link in the
remediation registry (`packages/handled-error/src/remediation.ts`, spread in as `remediation(code)`). Everything else stays a plain
`Error` and degrades to "unknown" + trace id at the boundary — deliberately.
`message` is customer-safe, never internals; the tRPC wire message is the
code slug, so clients render from the registry and never toast
`error.message`. A 5xx subclass sets `fault` explicitly. Tests assert on
`code`, never prose. A knowable failure surfacing as "unknown error" is a bug
in the feature, not a gap in the error system.
A ported code keeps main's spelling (gateway's `budget_not_found`, never `gateway_budget_not_found`),
and a service throws a `HandledError`, never a `TRPCError` (gateway's virtual-key services with
`routing_policy_*` and `providers_*`) (Alex, 2026-09-29).
A permission denial explains itself where authz denies (Alex, 2026-09-30): authz's own denial path
asks the engine's `explain` for the roles that would grant the permission, best-effort under a 250ms
deadline, and puts the role labels on the `HandledError`'s `meta`; the presentation registry renders
the sentence, and a failed or late explanation leaves the plain denial.
A REST error body carries its fields (`type`, `code`, `message`, …) at the root, never nested under an
`error` key (Alex, 2026-09-30); `GET /api/api-keys` keeps main's `{ data: [...] }` list envelope.
**An undeclared fault at a 5xx is `presumed_platform`** (Alex, 2026-10-05): a `HandledError` whose class
declares no fault at a 5xx status gets the fault `presumed_platform` (ambiguous, presumed platform): logged
at error, reported, retryable where that applies, and its body masked. Below 5xx an undeclared fault stays
`customer`. It goes on the wire as `presumed_platform` too: the published schemas and the generated SDK
clients gain the value, and anything parsing our responses (the MCP server, module envelope readers)
accepts it. A class declaring `fault: "customer"` at a 5xx keeps its body, in `packages/api` as everywhere
(agent connect's `replica_count_unsupported`); undeclared server errors stay masked (Alex, 2026-10-05).
A relayed herr error with no fault and no status stays `customer`: `presumed_platform` applies only when a
status of 500 or more is known (coordinator, citing the ruling's "at a 5xx status", 2026-10-05).
`LangWatchQLFilterRefusal` is a trace contract error (coordinator, citing Alex's ingestion-key approval,
2026-10-05).

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

A raw client (Prisma, ClickHouse, ioredis, Stripe) is never cast into a test: its typed double
lives once in `@langwatch/test-harness`, throwing by name on anything unscripted, and every test
uses that one (Alex, 2026-09-24). A module class with private members is built for real over its
memory twins, or reached through its `*Api` with `createApiFixture` — never cast.
A test proving how code handles a wrong-typed input may cast it, marked `// wrong-typed input: <why>`
directly above; the marker, not the test's name, excuses that one cast (Alex, 2026-09-27).
Production code has no marker: a cast only the compiler cannot prove is listed by file and target,
with its reason, in the stand-in-cast rule's audited boundaries (Alex, 2026-09-28).
A stand-in a test needs is a real fixture or builder, never a new contract type: types do not change
for tests (Alex, 2026-09-29). A test never `vi.spyOn`s a real service; it drives memory twins and
fixtures instead (Alex, 2026-09-29).
A scenario bound from a package's tests counts toward feature parity like one bound from a module's
(Alex, 2026-09-29).
**Feature parity binds every scenario** (Alex, 2026-10-05): every scenario is bound and its tests written
(1461 scenarios in 348 files on 2026-10-05). The method is a matcher first: one lane builds a script that
ranks candidate tests for every unbound scenario; Sonnet lanes then verify and bind in bulk, writing new
tests only where nothing fits (Alex, 2026-10-05).
**A bind proves its scenario** (Alex, 2026-10-05). `check:feature-parity` proves only that a title sits
on a test call; the bind claims the product does what the scenario says. Every Then, and each And after
it, is proven by an assertion. The test runs at the scenario's level: an `@integration` scenario about a
composition is proven by booting it, never by a unit with fakes. A library instance the test builds
proves the library, not the product. One annotation sits on its own line directly above the test call.
A product that disagrees with its scenario is a behaviour question for the coordinator or Alex, never a
bind and never a rewording. The `spec-binding-review` skill keeps the detail.
Every repository has a real memory twin, gateway's included, and unit tests build over the memory
registry; there is no refusing stand-in tier (coordinator, members wave, 2026-10-05).
The "New Experiment" button stays solid primary; its e2e expectation is updated (Alex, 2026-10-05).

The installation test boots the installed list over memory stores, with no server
(`apps/api/src/__tests__/api-installation.fixture.ts`; the worker and tasks have the same). Its
`members` line and `storesBackedMembers` are deleted (§15) conversion debt the fixture still carries
until the no-members migration lands (§16); do not copy them into a new test:

```ts
const runtime = await bootInstalledProcess({
  role: "api", // from @langwatch/process; no server: nothing to tear down
  modules: processModules.map(overMemory), // memory twins for every repository registry
  config: parseProcessConfig({ owners: processConfig(processModules, "api"), environment }),
  secrets: (owner, declared) => resolver.scopeTo(owner, declared),
  members: { ...storesBackedMembers(memoryStores(), stores), close: async () => void 0 },
});

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

`dev/docs/deleted-spellings.json` lists every spelling below with its replacement, and the
`deleted-spellings-in-teaching` and `deleted-spellings-in-code` policies check it (§17); change the
list in the same commit as this section.

Deleted, not deprecated. Writing one new is a defect; reading one marks
conversion debt:

`createProcess` · `withProvided` · `withMemoryRepositories` · `membersFrom` ·
`reads(...)` statics · the `members:` option on `createApp` ·
`withInfrastructure` · `withPersistence` · `.withTransports(hosts)` on the `createApp(...)` process chain
(a process states what it serves through `.expose(...)`; the module installer's own
`.withTransports(...declarations)`, §3.2, is a different call and stays) ·
per-store supply calls (`withRelational`/`withAnalytical`/`withKeyvalue` —
collapsed into `withStores`) · absence classes (`Logged*Absence`, `Absent*`) ·
`ApplicationBuilder`'s public surface · per-process host files · per-module
composition files under `apps/*` · hand-projected per-module config · bespoke
member bags · `*App` classes inside modules · `RestErrorHandler` · error envelopes in
transports · re-exports for backwards compatibility · the ops "backoffice" (now Ops instance admin or Cloud admin, §3.5) · `refusing*` twins ·
`try*`/`require*` method names · `T | null` returns in new code (`find*` =
array; `get*` = one or throws; `list*` = a page, Alex 2026-09-24) · `static readonly configSchema` and its
`*AppConfigSchema`/`*ServerConfigSchema` consts · a module declaring an env
var another owner already declares (`BASE_HOST` anywhere but `processFacts`) ·
`surfaces/` and `screens/` browser folders · any `exports` entry on a browser
package other than `./declaration` · any kit: a `*-browser-kit` package or a shared browser package · `*-openapi.rules.ts` files hand-writing a
route's REST response schema (§8) — migrate the summary/description/tags
into the route's own `.withDocs()` call and drop any hand-written success
body outright; an error keeps only its status and a sentence via `errors`,
and a response that truly needs its own schema goes through
`documentedResponses()`, never raw JSON. · the eventing `ScheduledJob` scheduler
(`PrismaScheduledJobStore`, `computeNextRunAt` on `Date`): a keyed process manager (§9). · slots:
`withSlots`, `UiSlots`/`uiSlots`, `useUiSlot`/`useUiSlots`, `<UiSlot>` and the `slots` host service: a
core screen renders the enterprise module's lent component, and a shell-wide surface is its owner's declared mount (§11;
Alex, 2026-09-29) · a mail member (notification owns mail, §3.3) · `AesGcmSecretEncryptionService` (§6) ·
`composeProcess` / `*ProcessComposition` (renamed `container` / `*ProcessContainer`, Alex 2026-09-29).
· `UiDeclaredCapabilities` / `UiDeclaredName` / `UiDeclared` and `declared("<name>")` · `UiDrawerMap`,
`UiDrawerPropsOf`, `DrawerPropsMapOf`, `DrawersDifferingFromMap` and browser-host's `*-drawers.ts` props
files · `useDrawer<Map>()` and a drawer opened, or its flow callbacks set, by a bare name
(`navigateToDrawer` is the address door) · `withCapabilities` for a peer lend · per-module
`use-feature-flag.ts` copies · `UiSession.featureFlag` / `isFeatureEnabled` (§10.1; Alex,
2026-10-01) · `TrpcCachePolicy` and `cache: { persist }` on a tRPC read (the browser mirrors every read
to disk by default, minus a named exclusion list). While the migration runs the string spellings coexist with their tokens.
· members, every spelling (Alex, 2026-10-01; §3.3): `static readonly reads` in any form,
`setup.members`, `MembersRead`, `ProcessMembers`, `MemberName`, `MEMBER_NAMES`, `MemberSource`,
`storesBackedMembers`, `noMembers`, the generated `serverModuleMembers`, `*.members.ts` files, a
restated member type, and a process fact passed as a member · the `secrets`, `cache` and `telemetry`
members (the Redis cache client itself stays until the Redis TTL work lands) ·
`*-composition.build.ts` files (§5) · `withMember`, supply tokens (`SupplyToken`, `MissingSupply`)
and `.provide` (§4) · a channel registry's `.live.create`/`.memory.create` called by hand in
`create()` or a service (§5) · nested `into` (§6) · `Secret.define` (§6) · a feature leaf or handle
in `packages/config` or `packages/secrets` (§6) · the dev UI's copy of public-config leaves
(`public-app-config.projection.ts`, §6) · `ProcessModuleApp`, `registerProcessDependencies`,
`addProcessDependencies`, `withProcessDependencies`/`withModuleDependencies` and `createProcessApp`,
targets that never landed and are superseded by the container (§5).
· The rename window (Alex, 2026-10-01): `@langwatch/kernel` (its light half is `@langwatch/module`,
the rest `@langwatch/process`), `@langwatch/process-server`, `@langwatch/ui-kernel`,
`@langwatch/api-fixture`, `@langwatch/error-presentation`, `@langwatch/actor`,
`@langwatch/installed-server-modules` and `@langwatch/installed-web-modules`, `packages/audit-log-null`,
`defineServerModule` / `defineWebModule`, `serverModules` / `webModules`, `<id>Server`,
`openProcessStores`, `<f>.server.ts` stems, `<X>App` module classes and `.withApp(...)`.

---

## 16. Renames in flight

This document names the target. **Landed 2026-09-18:** the tree rename
(`modules/*/process`, `*/browser`; package names
`*-process`/`*-browser`; `*/browser-kit` was later removed, see §3.4), `@langwatch/process-stores`,
`@langwatch/browser-host` (+drawer), plan-gate
dissolved into `entitlement-contract`, and `.withStores(stores)` on the
chain. **Landed 2026-10-01 (the rename window):** `@langwatch/module`, `@langwatch/process`,
`@langwatch/browser`, `openStores`, `defineProcessModule` / `defineBrowserModule`, `processModules`,
`<id>ProcessModule`, `XModule` + `.withApi(...)`, `<f>.module.ts` stems (the installer; the module class
lives in `app/<f>.app.ts`, Alex 2026-10-05), `test-harness/api-fixture`,
`handled-error` presentation subpaths, the ledger actor in `@langwatch/authorization`, the generated
per-app module lists, and `audit-log-null` deleted (their old spellings are in §15). The rows below
have not landed: code spells the right column until its row lands, and this record's prose names
the left, the target.

| Target                                                                                   | Today                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| host services (`@langwatch/browser-host`: session, navigation, storage, toasts, drawers) | "capabilities" (§3.5 reserves the word for the four layers)                                                                                                                                                               |
| `enterprise/modules/audit-log` (§4)                                                      | `modules/audit-log`                                                                                                                                                                                                       |
| `processFacts` in `@langwatch/config`, picked by each slice (§6)                         | single leaves in `deployment-facts.ts` picked by name (`publicBaseUrl`, `isSaas`, `nlpServiceUrl`, `serviceVersion`, `otelResourceAttributes`; §6, 2026-10-05); `owner.ts` still holds `nodeEnvironment`, `outboundProxy` |
| store clients reach registries only; `.withChannels(registry)` on the installer (§5)     | `static reads` + `setup.members`; channel registries built by hand in `create()`                                                                                                                                          |
| `secrets.into({ … }, build)` (§6)                                                        | nested `secrets.into(handle, …)`                                                                                                                                                                                          |
| `hostedStores(stores)` (§4)                                                              | `hostedMembers(stores)`                                                                                                                                                                                                   |
| "store client" (`the clickhouse client`)                                                 | "member" in §7, §9 and §13 prose, and `bootInstalledProcess({ members })`                                                                                                                                                 |

`createProcessApp` is no longer a target: the container is (Alex, 2026-10-01). Its previous implementation, the
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
A process composes `processModules` through its container.

Homes for the no-members migration (coordinator, 2026-10-01; the members wave's homes, 2026-10-05, are in §3.3): the logger is `createLogger("langwatch:<module>[:<part>]")` inside the module; the clock is `@langwatch/time`, and memory twins take one in their registry; `processName` is deleted, and refusals name the module and role; `operatorReads` goes to registries like any store client; tests call `XModule.create(setup)` with `createApiFixture` peers and memory registries, and installation tests boot the installed list over memory; a reader takes the owner contract's exported leaf, which supersedes the 2026-09-18 ask-the-owner's-Api rule; `CREDENTIALS_SECRET` and `NEXTAUTH_SECRET` stay shared as `processSecrets` beside `processFacts`; the egress fence and the OTEL endpoint are process facts, and voice loopback is scenario's; the dev UI lifts the config meta tag from the api's own rendered shell; the names `processFacts`, `defineChannels`, `.withChannels` and `hostedStores` stand.

Also open, each a worklist: the no-members migration (process facts, store clients into
registries, container-installed channels, record `into`, owner-held handles, the dev UI projection),
ruled to finish now, before other module work (Alex, 2026-10-05; §3.3); eventing's client for both roles,
and a per-module event store handle (§7); the four process-framework builds (Alex, 2026-10-05): main-loop
stall liveness with metrics proxied to the main thread, a typed shared-secret supply that refuses a
misspelled shared secret where it is written, the `LANGWATCH_TASK_MODULES` task-module loader, and
host-supplied gating for agents, authz, tenancy and eventing in the api process; `browserModules` is
empty (no module exports `./declaration` yet — the browser serves chrome
only); the ClickHouse resolver ruling (§7); background loops main runs that this
branch never starts, each to become a scheduled process manager.

**Open for Alex** (2026-10-05; proposals, not rulings): the E1 to E8 open questions (§8), which Alex answers
by number. Answered that evening (Alex, 2026-10-05): the usage-named files are renamed `annotation-count`,
`dataset-count` and `plan-limit.errors.ts`, with no ownership change (landed); E9 and E10 (§8, built); L6b
R3, the agent-test turn goes through the relay (§8).

**Parked** (Alex, 2026-10-01; do not re-raise): the ingestion stage plan (Alex will redesign it later);
erasure tombstones and owner-complete acknowledgement; deployment audience and subscription rollout
(transport protocol versus audience, cutover and backfill for new durable subscriptions); tenant
placement and regions (one execution region per deployment today); the personal-token "passport" (a frozen
project ceiling), to be expressed through conditional grants (Alex's work in progress).

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
`typescript/no-misused-spread` is off in `packages/*/type-tests/**` only, where the spread is what
the type test asserts (Alex, 2026-09-27).
A policy reads no baseline and reports every finding. A ruled transition may hold a shrink-only list
beside the enforcer's tests (`packages/architecture-enforcer/tests/baselines/`), keyed so that growth
inside a key is refused (a count per key), with a test that also refuses a listed finding that is
gone. Three exist: §7's event-table access (Alex, 2026-09-29); "framework packages depend on no
module contract" (§10.1), baselined on today's edges and shrinking as UI tokens move the feature types
out (Alex, 2026-10-01); and §15's per-spelling count of deleted spellings in code
(`deleted-spellings.json`, 2026-10-05). §5's peer cycles held a third until it was deleted: every cycle is refused now
(Alex, 2026-10-05).
The `service-ceilings` policy is ported to a custom langwatch oxlint rule with the same exact limits
(Alex, 2026-09-29).

**Drift is caught by lint, and the message is a prompt** (Alex, 2026-10-05). Wherever code drifts from
the architecture direction (middleware doing what the API framework does, such as auth or JSON body
parsing; routes opened to any authenticated or unauthenticated caller, §8), a new lint rule catches it.
Its error explains, written to the agent reading it, why the shape is wrong and what to use instead.
Every finding prints what, a one-line why, and fix; `defineRule` refuses a rule with a missing or
multi-line why (Alex, 2026-10-05). The `feature-configuration` policy demands no `*ServerConfigSchema`
(deleted, §15), and `langwatch/package-boundaries` names the peer lend, not `withCapabilities` (Alex,
2026-10-05: the tree follows the record).

**House rules are strict; a disable is very rare** (Alex, 2026-10-05). Most `langwatch/*` rules must not be
ignored: a disable directive naming one is itself an error (`langwatch/suppression-states-why`). Only a few
named rules, where the framework may genuinely not cover a case (API middleware usage, opening a route to
any caller), accept a disable, and only with a reason explaining why the framework cannot be used; a bare
disable is an error. A rule opts in through `defineRule({ escape })` in `packages/oxlint-rules`. This is for
the new rules, not a sweep of old directives. When unsure, ask the human: the message on those few rules
tells the agent that if the case is confusing it stops and asks the human rather than disabling.
`langwatch/id-generation-origin` stays unsuppressible: it allows a visitor id the contract types as a UUID
to be minted with `randomUUID` (a named, tested exception in the rule), and the disable directive in
`modules/feature-flag/browser/src/behavior/anonymous-id.ts` is deleted (Alex, 2026-10-05).

**The lint split and the CI type-aware gate** (Alex, 2026-10-05). oxlint's native rules and the langwatch
plugin run as two parallel oxlint processes; the root `package.json` lint scripts own the split, and CI,
lint-staged and the editor call those scripts. CI runs `node dev/nx/lint.mjs --types` in one process
(affected on a PR via `--base`, all otherwise); the `lint:types` Nx target stays for local per-project runs,
and ADR-150 is amended to say why. The type-aware pass runs only the rules that need types, from its own
config. One unused-suppression check replaces oxlint's across the native, plugin and type-aware processes,
landing in the same change as the split. Because the CI gate is the type-aware run, a directive only a
type-aware rule uses stays (coordinator, citing this ruling, 2026-10-05). The commands: `dev/docs/TOOLING.md`.

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
`typecheck:affected`, `build:affected`, `lint:changed` and `graph`. Repointing
the root scripts at Nx is a separate decision — the current root `test` covers
`packages/`, `modules/` and the enterprise packages and deliberately excludes
the applications, the SDK and the e2e suites, so the two are not the same set.

The cache is local. No Nx Cloud account is configured and `nxCloudId` is
absent, so no source or task metadata leaves the machine.

**The drive on `feat/strict-feature-layout-v0`** (Alex, 2026-10-05). Reviewed slices are committed and
pushed directly to the branch; the first goal is the branch's CI green, and the framework-extension designs
and the bypass guard rules (§8) come after. At most six lanes run at once, their owned paths checked
disjoint at every spawn, and never two lanes in one module. From the main merge
(`dev/docs/plans/main-merge-2026-10-05.md`), the developer seat (#8373) is ported now, the server half on
Opus and the browser half on Sonnet. The webhook deploy drain is an approved operational step: before the
last old worker stops, confirm the two deleted gateway delivery lanes have nothing queued; afterwards
re-send blocked spend through the replay route, and governance is re-requested by hand.

## 19. The dev runtime and the sims

Where the local stack lives; this record does not restate it.

- **The stack** (haven, the one dev process, the no-container setup): `dev/docs/LOCAL_STACK.md`.
- **The sims** (llmsim, mailsim, storagesim, analyticssim, voicesim): the `.claude/skills/sims` skill.
- **haven** (`make haven up`, the orchestrator that names each stack): `tools/thuishaven`.
- **`apps/server`**: the published `npx @langwatch/server` CLI that runs the whole stack locally.

# LangWatch

LLM Ops platform for evaluation, observability, and optimization of AI agents
and pipelines.

## Comments

Don't write pointless comments. Good code explains itself. If it's vital, add it to an ADR or spec file, and link back.

## The three authorities

Everything in this file is a digest. The full truth lives in three places, in
this order of precedence:

1. **The linter.** `pnpm lint` runs oxlint with the `langwatch` plugin, every
   rule at `error`. `pnpm lint:architecture` runs the
   `@langwatch/architecture-enforcer` policy registry; CI gates the policies
   already at zero. When a rule and any document disagree, **the rule is the
   truth** and the document is the defect. Every finding's message carries its
   own fix — read it and do what it says rather than working around it.
2. **`dev/docs/ARCHITECTURE.md`** — the one architecture record. Read it before
   composing a process, writing a module, or citing any shape. §15 lists the
   deleted spellings (writing one new is a defect), §16 the renames in flight —
   some of the record's target names are not landed yet, so when a spelling in
   the record does not exist in the tree, §16's table maps target to today.
3. **`specs/`** — feature files ARE the requirements. `ls specs/`, read the
   scenarios, and if none exists for your task, write one before writing code.
   A scenario enforces nothing until it carries a `@unit`/`@integration`/
   `@e2e`/`@regression` tag AND a `/** @scenario "<title>" */` annotation on
   the covering test — an untagged `.feature` file reports `0/0 bound` and
   reads green. Error paths get scenarios too, beside the golden path.

Operating discipline — what an agent may run and edit, how narrow to scope
checks, how to hand off work — is canonical in **`.claude/skills/core/`**
(`repository-rules.md`, `testing-rules.md`, `handoff-rules.md`). This file does
not restate those rules; follow them.

## Key rules — every change, no exceptions

The architecture below has many rules; these are the ones violated most, so
hold them absolutely:

1. **A module is an isolated microservice.** Treat every `modules/<name>` as
   if it were deployed on its own box: the rest of the world sees its
   contract and calls its `*Api` token, nothing else. Reaching into another
   module's services, repositories, channels, tables or browser package is a
   boundary violation even when the import happens to resolve — the data
   crosses modules only as an `*Api` call.
2. **Complete repository isolation.** A repository belongs to exactly one
   module, takes only its own store, and is called only by that module's own
   services. No cross-module repository access, no repository in a transport
   file, no service holding another subject's repository, and no querying
   another module's tables — ownership of a table is ownership of every query
   against it.
3. **Service-driven, always.** Behaviour lives in `services/` classes over
   repository interfaces and channels — repository = owned state, channel =
   messages to anything the module does not own, service = the behaviour over
   both. A service never opens a conduit itself (HTTP client, queue, bus,
   email — that is a channel) and never touches a raw database client (that
   is a repository). Logic does not live in transports, repositories,
   channels or module classes; they stay thin and the service carries the
   weight.
4. **Comments: five lines, maximum** (delimiters included). At six the linter
   errors and nothing suppresses it. A longer narrative belongs in an ADR
   under `dev/docs/adr/`, a spec under `specs/`, or the architecture record —
   leave one line here linking it. A comment that restates the code is
   deleted, not wrapped (ADR-140).
5. **Format, then lint, after every change.** Scoped to what you touched —
   the root scripts have the whole repo baked in, so the scoped forms are:

   ```bash
   pnpm exec oxfmt --write --disable-nested-config <paths you touched>
   pnpm exec oxlint --quiet --type-aware --config .oxlintrc.jsonc <paths you touched>
   ```

   Fix what fires — each message carries its own fix — and never by
   gaming a name. Once, at the end of the task, run `pnpm lint`, and
   `pnpm lint:architecture --policies <ids you touched>` for the
   whole-tree policies no scoped run can check.

## The product

| Process | Package | What it is |
|---|---|---|
| `apps/ui` | `@langwatch/ui` | The browser application (Vite SPA, :5560) |
| `apps/api` | `@langwatch/platform-api` | tRPC + REST + SSE, serves the browser bundle (:6560) |
| `apps/worker` | `@langwatch/worker` | Queues, schedulers, projections, subscribers |
| `apps/tasks` | `@langwatch/tasks` | One-shot migrations and backfills, run before serve |
| `apps/server` | `@langwatch/server` | The `npx @langwatch/server` CLI |
| `services/aigateway` | Go | Virtual-key data plane (:5563) |
| `services/nlpgo` | Go | Optimization-studio executions and evaluators (:5561) |
| `services/langyagent` | Go | Langy conversation manager (PORT+4) |
| `services/langevals` | Python | Evaluators |

The three long-running processes (ui, api, worker) always run together: a
stack missing one serves pages and quietly processes no jobs, which looks
identical to a healthy stack until a job was expected to have run.

There is no one "app" package, and `langwatch` is the published TypeScript SDK
in `sdks/typescript/`, not the product.

## The shape

The record (ARCHITECTURE.md) is the authority; this is the orientation.

**Applications hold no product code.** An app is a `main.ts` and a
`config.ts`; the product lives in modules, and the machinery (Server,
createApp, transport hosting, stores, lifecycle) lives in framework packages.
A package earns existence by being framework, not feature — feature code in
`packages/` is a defect. The root never grows: a change that needs an app to
grow has found a gap in the primitives; report the gap.

**A module** is one folder owning up to four workspace packages, mapped by
`modules/catalogue.json` (one owning module per subject; enterprise modules
mirror the shape under `enterprise/modules/`):

```
modules/trace/
├── feature.json · specs/ · adrs/
├── contract/       @langwatch/trace-contract      shared by everyone
├── process/        @langwatch/trace-process       the half createApp installs
├── browser/        @langwatch/trace-browser       PRIVATE — the half createUi installs
└── browser-kit/    @langwatch/trace-browser-kit   the ONLY thing other browsers may import
```

The non-negotiables, all lint-enforced:

- **Dependency direction:** apps → `*-process`/`*-browser` → `*-contract`.
  Browser never imports process, process never imports browser, contract
  imports no framework. Another module imports only the owner's **contract**
  and calls through its `*Api` token — never its services, repositories, or
  browser package.
- **The contract** holds Zod schemas with `infer`, portable types,
  `HandledError` subclasses with stable codes, the tRPC declarations, the
  module's config schema, and the callable `*Api` interface + token.
- **Process-half grammar** (the grammar file
  `packages/oxlint-rules/grammar/feature-layout-policy.mjs` is the authority
  on filenames): `services/` (one class per entity, `static create`, private
  constructor), `repositories/` (interfaces on top, `prisma/` and `memory/`
  backends below, registry offering both), `channels/` (messages to anything
  the module does not own — bus, vendor HTTP, queue, email, SSE — with a
  memory twin each), `eventing/` (the pipeline and what it names),
  `transport/` (declarations only), `rules/` (pure functions). No `utils/`,
  `ports/`, `adapters/`, `lib/`, `helpers/`, `domain/`. Repository = owned
  state; channel = unowned messages; service = behaviour over both.
- **No raw clients in module code.** Prisma, ClickHouse and Redis enter a
  module only through a registry or channel factory and arrive as
  repositories and channels. Only `repositories/prisma/**` names Prisma.
- **The four-way rule** — every dependency a module has is one of: derivable
  from supplied stores (build a repository/channel inside the module), another
  module's capability (a peer `*Api` token), a deployment fact (the module's
  declared config schema — module code never reads `process.env`), or an
  availability decision (a declared supply token the process answers). A
  module never defaults its own availability.
- **Transports declare, never implement.** Handlers receive
  `{ input, app, actor, scope, signal }`, call one API operation, and return a
  plain value or throw. No `c.json`, no status branches, no error envelopes,
  no hand-rolled refusals — the framework serialises, and a thrown
  `HandledError` is the refusal.
- **Eventing follows the role:** the api process sends commands only —
  projections, subscribers and jobs are never even constructed there; the
  worker hosts them, at-least-once and per-aggregate ordered, so subscribers
  are idempotent.
- **Config: modules declare, apps compose, the parse refuses by name.** One
  Zod parse per process, derived from the installed module list. Config is
  drilled, never ambient — no DI container, no async context; every function
  receives the narrowest slice as an argument. Secrets are never config
  fields: they resolve through `@langwatch/secrets` (ADR-132) and are injected
  into the constructed collaborator (cipher, client, verifier), which is what
  travels.
- **Browser half:** flat public entries → `model/` (pure) → `behavior/`
  (hooks, api bindings, stores) → `ui/elements|blocks|sections`; elements and
  blocks cannot fetch. A package that outgrows that flat layout nests:
  `features/<name>/` repeats `model/behavior/ui` inside itself, and a feature
  that is one component is a section, not a feature. The tRPC client is
  derived from the contract's declarations, never hand-written. The package's
  `exports` map lists `./declaration` only — `surfaces/` and `screens/` are
  deleted browser folders (§15) — and a module capability the composition
  root needs travels through the declaration's `withCapabilities` slot,
  never a side-door export. Screens read session/navigation through a
  declared `*HostApi` the shell implements from `@langwatch/browser-host`
  capabilities — never the router or host directly; an unmounted `*HostApi`
  is refused by `createUi` at install, by name, before any component
  renders. Drawers are URL-routed singletons with a navigation stack: a
  sub-flow **navigates** (`openDrawer("target", { onSuccess, onClose: goBack
  })`), never mounts a drawer component from inside another drawer.
- **The kit law:** a module's browser package is closed — sharing means moving
  the thing to `*-browser-kit`. A kit is a leaf (contracts, design-system,
  browser-host only), fetches nothing, is a real package not a subpath, and
  by default exists only at three or more consumers — two mint one only
  where the alternative is duplicating a large shared surface.
- **Verbs (new code):** `find*` returns an array (empty, never null);
  `get*`/`getBy*` returns one or throws; `T | null` is not a shape we write
  any more, and `try*`/`require*` prefixes are banned. The linter names the
  right fix per case — do not game it by renaming a parser to `find*`. Full
  vocabulary: ADR-146.
- **Installing a module edits the catalogue**, then `pnpm generate:modules` —
  never a root. Uninstalling one that a peer depends on fails to compile,
  naming the dependent.

## Skills — load before working

| Working on | Load |
|---|---|
| Any process/module/transport/worker/backend-test work | `backend` |
| Any screen, drawer, browser half, kit, component test | `frontend` |
| Which component, theming, UI pattern docs | `design-system` (and `chakra-ui-*` for raw Chakra v3 work) |
| Citing or deciding any shape | `architecture-guide` → `dev/docs/ARCHITECTURE.md` |
| A lint message that is wrong, or a new house rule | `lint-rule` |
| Transactional email | `mail-template` |
| Adding/renaming a feature, REST namespace, UI route, MCP tool | `feature-map` |
| Dev stack won't come up | `haven-setup` |
| Coordinating lanes / picking up the drive | `coordinator` |
| A long conflicted merge of origin/main | `merge-drive` |
| Verifying a feature in a real browser | `browser-test` / `browser-pair` |
| The GitHub project board | `langwatch-kanban` |

Before any non-trivial frontend change, also read the relevant pattern docs
under `dev/docs/best_practices/` (`react.md`, `list-table.md`, `drawers`,
`scope-selector-and-badges.md`, `row-actions-overflow-menu.md`,
`selection-action-bar.md`, `scoped-resources.md`) so you extend existing
patterns instead of reinventing them. Scope selection always uses
`ScopeChipPicker`, never a hand-rolled Select. Copy follows
`copywriting.md`: say what the feature does for the customer, never how it is
built; spell words out ("tokens", not "tok").

## Enforcement

Two linters, and they are the only JavaScript/TypeScript ones:

- **`langwatch` oxlint plugin** (`packages/oxlint-rules`), run by
  `pnpm lint` — per-file rules, registered in one `rules` map in
  `src/index.mjs` and enabled at `error` in one config line each. The
  generated reference is `dev/docs/lint-rules.md` (regenerate with
  `pnpm --filter @langwatch/architecture-enforcer docs`); the file grammar is
  `packages/oxlint-rules/grammar/feature-layout-policy.mjs`. Almost no rule
  has an autofixer, deliberately: the message's `fix` line tells you what to
  write.
- **`@langwatch/architecture-enforcer`** — whole-tree policies (package
  boundaries, cycles, frontend/server graph separation, Prisma/ClickHouse
  table ownership, memory-twin drift, dead exports) folded from one registry
  (`--list-policies` prints it), run by `pnpm lint:architecture`. There are
  no baselines: every finding is reported, a policy whose anchor file is
  missing refuses the run by name, and `pnpm lint:architecture` is not part
  of `pnpm lint` until the tree is clean; CI runs the zero-finding policies
  by id.

Feature/spec parity:
`pnpm --filter @langwatch/architecture-enforcer check:feature-parity` — read
its verdict banner, not per-file ticks.

The frontend boundary is enforced structurally: no value-import chain from
server code may reach a browser-only package (React, Chakra, react-router,
…), and no browser module may value-import server-shaped declarations.
`import type` is always fine — types are erased.

## Commands

From the repo root (which proxies the common scripts — `cd` is rarely needed;
`pnpm --filter <package> <script>` reaches anything else):

```bash
pnpm typecheck                      # whole workspace, one tsc -b — end of work, once
pnpm --filter <package> typecheck   # while iterating — seconds, not gigabytes
pnpm lint                           # oxlint — WHOLE REPO; once at end of task
pnpm lint:architecture              # architecture-enforcer — WHOLE REPO, ~17 s
pnpm format                         # oxfmt — WHOLE REPO; never while others share the checkout
                                    # scoped lint/format after each change: see Key rules above
pnpm --filter <package> test <path> # scoped test run (see core/testing-rules.md)
pnpm start:prepare:files            # regenerate Prisma client + generated types
pnpm generate:modules               # after editing modules/catalogue.json
pnpm sync:references                # after adding/removing a workspace package
```

Nx is the task runner over these same scripts (ADR-150): it infers one project
per pnpm workspace member and one target per package.json script, caches the
results, and derives what a change reached from the `workspace:*` graph.

```bash
pnpm test:affected                  # only the packages this change reached
pnpm typecheck:affected             # same, for tsc -b
pnpm test:all                       # every package's test target, cached
pnpm graph                          # the dependency graph, in a browser
```

A cached target replays in milliseconds, and the cache is correct across
package boundaries: packages resolve each other's TypeScript source, so a
dependency's files are declared inputs to its dependents. `test:integration` is
deliberately uncached — it reads datastores no input declaration describes. The
root `test`, `typecheck`, `lint` and `build` are unchanged and still mean
exactly what they meant; Nx sits beside them, not in front of them.

**Whole-repo checks take a machine-wide slot.** A full typecheck holds
2.3–3.5 GiB and every core, and this machine runs many agents at once, so the
`typecheck` script routes through haven's slot queue (`haven slot run`) in
agent shells. Queued runs say so on stderr — that is a wait, not a hang. A raw
`pnpm exec tsc -b` bypasses the queue and competes with everyone; that is a
reason to use the script, not a loophole. Never set `CHECK_SLOTS` yourself.
For one file while iterating: `tsc --noEmit --ignoreConfig <file>`.

**Go:** `make go-lint` (whole set, slot-queued) or `make go-lint-changed`
(diff vs origin/main) run exactly what CI runs — the pinned golangci-lint
under go.mod's own toolchain. A raw `golangci-lint run` breaks on machines
with a newer Go. Lint catches what build/test/gofmt never will: `misspell`
enforces US spelling (`behaviour` fails in Go code), `nolintlint`,
`testifylint` (`--fix` handles the first two). Before rewriting
`assert.Equal(t, 1.0, …)` to `InEpsilon` because `float-compare` says so,
check whether the expectation can be zero — `InEpsilon(0.0, 0.0)` is always
false; `.golangci.yml` scopes exclusions where `Equal` is correct.

**Installs:** one `pnpm install` at the repo root — single pnpm workspace, one
lockfile (ADR-076). To narrow: `pnpm install --filter "@langwatch/platform-api..."`.
Security `overrides` go in the root `pnpm-workspace.yaml`; a `pnpm` block in a
member package.json is silently ignored.

## Development environment

`.env` lives at the **workspace root**; every application resolves it from
there. haven injects its own resolved values (hostnames, ports, database URLs)
into every process it starts — `eval "$(haven env)"` puts the same set in your
shell.

**Secrets** (`packages/secrets`, ADR-132): every credential-carrying
env var is classified once, and each app's boot seam resolves classified keys
through an ordered chain (env/.env → 1Password when `LANGWATCH_SECRETS_VAULT`
is set → refusal by name) before its Zod parse. Never read `.env` to find a
value and never print one — `haven env` masks every classified key
(`--reveal` for the shell form).

### haven / portless (recommended)

`make haven up` routes every worktree's services through the portless proxy at
stable hostnames — `app|gateway|nlp.<slug>.langwatch.localhost` (`<slug>` =
sanitised worktree directory name). UI and API share one origin: open
`app.<slug>…` for the UI, hit `app.<slug>…/api` for the API. `.localhost`
resolves to loopback natively — no `/etc/hosts`, no sudo, no port collisions
between worktrees.

```bash
make haven up          # start this worktree's stack (bootstraps portless on first run)
make haven install     # go install so plain `haven …` works, then check prerequisites
make haven status      # every stack, service health, shared servers — one shot
haven up +langy        # add a service to this stack, sticky (likewise -gateway, -nlp, -langy)
haven logs nlp -t      # tail one service's logs from any terminal
```

haven supervises two Node lanes — `ui` and `api` — beside one `go` lane
holding the data-plane services. None is individually selectable (`haven up
±api`/`±backend`/`±workers` are refused by name); the api lane hosts the worker
beside the API, so `haven logs api` and `haven logs worker` each show one of
them and `haven logs go` is where the gateway and NLP engine read. Restarting
any of them means restarting the lane.
`https://langwatch.localhost` is the cross-worktree dashboard;
`observability.langwatch.localhost` proxies local Grafana;
`telemetry.langwatch.localhost` fans OTLP out to every running stack. Driving
haven as an agent: add `--agent` (or `HAVEN_AGENT=1`); `haven status --json`
is machine-readable. See `tools/thuishaven/README.md`, and the `haven-setup`
skill when it will not come up.

**No container runtime needed** for the day-to-day loop. With ClickHouse,
Postgres and Redis native (brew / LaunchAgent), point `.env` at them and set:

```bash
LANGWATCH_HAVEN_CH=0   # use .env CLICKHOUSE_URL instead of a managed container
LANGWATCH_HAVEN_OBS=0  # skip the LGTM telemetry stack
```

Postgres and Redis stay haven-managed either way (through brew, not a
container). The langy worker resolves its own host tier without a runtime;
`LANGY_UNSAFE_HOST_ACCESS=0` refuses that, `=1` forces it. Tests follow the
same rule: `pnpm test` never needed a container, and integration suites run
against native services when `LANGWATCH_TEST_CLICKHOUSE_URL` /
`LANGWATCH_TEST_REDIS_URL` / `LANGWATCH_TEST_DATABASE_URL` are set (dedicated
test databases; dev data untouched). `CI=1` forces testcontainers — never set
it locally. What still wants a container: `make observability` and the
sandboxed langy tiers, both opt-in.

### Plain `pnpm dev`

`pnpm dev` (no haven) derives every port from `PORT` (default 5560): ui on
`PORT`, api on `PORT+1000`, worker metrics on `PORT-2561`, gateway on
`PORT+3`, nlp on :5561, langy on `PORT+4`. If ports are held,
`dev/scripts/check-ports.sh` refuses and prints two ready-to-paste options
(a free slot via `PORT=5570 pnpm dev`, or a port-scoped kill). Paste one; do
not reinvent process hunting — `dev/scripts/kill-dev-tree.sh` already does it
correctly.

Locally there are **two Node processes**: the `api` lane runs the api and the
worker in one process (a launcher, not a process role — each still resolves
its own secrets, config and graph; boot is worker then api, shutdown drains
the worker first). Production is unchanged: three Node deployments.

| Script | What runs |
|---|---|
| `pnpm dev` | ui + backend + go (+ langy when selected) |
| `pnpm dev:ui` / `dev:backend` / `dev:go` | one lane alone |
| `pnpm dev:api` + `pnpm dev:worker` | the production process shape — use when a blocked worker job must not read as API latency |

Both lanes restart on change, debounced (`LANGWATCH_DEV_WATCH_DEBOUNCE_MS`,
default 750 ms), the Go lane through `air` on successful builds only. The Go
services auto-start when the toolchain is on PATH and reuse an existing
listener from another worktree; opt out per service with
`LANGWATCH_SKIP_AIGATEWAY=1` / `LANGWATCH_SKIP_NLP=1` / `LANGWATCH_SKIP_LANGY=1`
(plain `pnpm dev` only — under haven the equivalent is `haven up -gateway`
etc., which sticks). Standalone: `make service svc=aigateway` /
`make service-watch svc=nlpgo`. The gateway needs the "AI GATEWAY" block from
`.env.example`; langyagent writes its own `.env` block on first run and needs
the worker binary (`pnpm --filter @langwatch/langyworker build:binary`).

`make quickstart` is the interactive preset picker when you want compose-based
stacks (`all-local`, `all-local-nlp`, `dev-storage`, `dev-infra`,
`frontend-only`, `migration`, `full-local`; `make quickstart-help` for the
reference, `make down` to stop). The old `make dev*` aliases were removed in
#4053. Stateful volumes are shared across worktrees; only one worktree can
have postgres/clickhouse up at a time and quickstart detects collisions.

**Local binaries** land only in `.bin/<name>/<name>` (git- and
Docker-ignored). Release pipelines pass their own `--outfile`.

### Debugging locally

Prefer the observability stack over log files when it is up (haven starts it
by default). Query logs/traces/metrics by attribute with `gcx` (wired by
`make observability-connect`), filtered to your worktree:
`gcx logs query '{service_name="langwatch-app"} | langwatch_worktree="<slug>"' --since 15m`.
See `dev/docs/best_practices/local-observability.md`. Stack down: `pnpm dev`'s
terminal output is the fallback.

## Testing

`.claude/skills/core/testing-rules.md` is canonical; `dev/docs/TESTING_PHILOSOPHY.md`
has the philosophy. The essentials:

- Outside-In TDD: spec → test → code. BDD specs come first, not last.
- Run through the owning package, scoped:
  `VITEST_MAX_WORKERS=2 pnpm --filter <package> test <paths>`. Never
  `npx vitest`, never a hand-rolled vitest config, never the whole repo while
  iterating. Each package owns its vitest config and declares its own
  datastore needs; the root `test:integration`/`test:component` scripts are
  stubs that exit 1.
- Name the level honestly: a test that renders a component is
  `.integration.test.tsx` (with a `// @vitest-environment jsdom` docblock — no
  config sets a global environment, on purpose), not a unit test.
- Doubles come from `@langwatch/test-harness`: `createApiFixture<XApi>({…})`
  throws by name on anything unconfigured; `createTestLogger()` for logging
  assertions. A `{ getById: vi.fn() }` bag is a defect.
- Installation tests run the same chain as production with `memoryStores()` —
  no datastore, no Docker, real peer resolution. See ARCHITECTURE.md §13.
- A regression test for a runtime bug executes the code path and observes the
  crash; string assertions are supplementary.
- Assert on error `code`, never message prose, and never `instanceof` across a
  serialisation boundary.
- Interrupted vitest orphans workers: sweep with `pkill -f "vitest/dist/workers"`.

## Errors

Read `dev/docs/best_practices/error-handling.md` and ADR-045. The rule in one
line: throw a `HandledError` **only** when we know the cause and the caller
can act on it; everything else stays a plain `Error` and degrades to a generic
"unknown" plus a trace id — deliberately, so never dress an infra failure up
as handled.

- A new code goes in `packages/handled-error/src/app-codes.ts` (sorted) with a
  customer-safe entry in `packages/handled-error/src/presentation.ts` in the
  same change — that registry, keyed by `code`, is the words a customer reads.
- `message` is customer-safe: no env vars, hostnames or internal services.
  Since #5984 the tRPC wire message IS the code slug, so a client that toasts
  `error.message` shows the customer `validation_error` — read the handled
  payload (`readHandledError`) and render from the registry.
- A 5xx subclass sets `fault` (`platform`/`provider`) explicitly — the default
  is `customer`, which logs a real incident as routine noise.
- Server validation errors map `meta.fieldErrors` onto the form fields, not a
  toast. `meta` is a client contract, not a scratchpad — name the consumer
  before adding a field.
- A knowable failure surfacing as "unknown error" is a bug in the feature.
  Name expected failures in the spec, each with a tagged, bound scenario.

## Database

Read `dev/docs/best_practices/clickhouse-queries.md` before writing or
modifying any ClickHouse query.

| Rule | Why / how |
|---|---|
| Never edit deployed migrations | Immutable history; new migration instead (unmerged ones may be fixed) |
| Unqualified table names in Prisma migrations | `"Monitor"`, not `"langwatch_db"."Monitor"` — schema comes from the connection string |
| Every ClickHouse query filters `TenantId` first | `WHERE TenantId = {tenantId:String}` — no other ID is unique across tenants |
| Every Prisma query on a project-level model carries `projectId` | The multitenancy middleware rejects queries without it |
| Filter on the partition key (`StartedAt`/`OccurredAt`/`StartTime`) whenever a date range exists | Partition pruning; without it cold S3 partitions are scanned |
| IN-tuple dedup (`GROUP BY key + max(UpdatedAt)`), not `LIMIT 1 BY`, with heavy columns | `LIMIT 1 BY` materialises whole granules of heavy payloads → OOM |
| `argMax(column, UpdatedAt)` for sort keys on deduped tables | `max()` picks stale versions and breaks cursor pagination |
| ClickHouse down-migrations stay commented out | Note: "To roll back, uncomment and run manually" |
| One `ALTER TABLE` per goose `StatementBegin`/`StatementEnd` block | ClickHouse has no multi-statement queries |
| "Cannot find module" for generated files | `pnpm start:prepare:files` from the root |

Migrations are tasks, not the api's job:
`pnpm prisma:migrate` / `pnpm clickhouse:migrate` (both proxy
`@langwatch/tasks`), run before serve by the start script and the deploy
pipeline.

## Traps no tool catches

| Trap | Instead |
|---|---|
| `gh pr edit --body` | `gh api repos/OWNER/REPO/pulls/N -X PATCH -f body="…"` (avoids the Projects deprecation warning) |
| `gh api graphql -f`/`-F` variables | Inline the values in the query string — the flags break on multiline queries |
| Trusting `gh pr checks` alone | `gh run list --branch <branch>` — pr checks dedups by name and masks failing runs |
| Branch names | Issues: `issue123/slug`; features: `feat/slug` |
| `form.watch()` in a child component receiving `form` | `useWatch({ control: form.control, name })` — `form.watch()` does not re-render children; only the form owner watches |
| Duplicating Zod and TS types | Zod + `infer` when both validation and types are needed; `as const` for internal constants |
| `pnpm test -- path` | No `--`: `pnpm test path` — pnpm adds it |
| Importing the compiler API from `typescript` | TS7's root export is a version constant; the API lives behind `typescript/unstable/*`, sessions via `src/test-utils/tsAst.ts` (ADR-099) |
| A package tsconfig without `incremental` + its own `tsBuildInfoFile` | Every package sets both, `dist/tsconfig.<stem>.tsbuildinfo` — beside the output, never under `node_modules` |
| Inline `import(…)` | Top-level `import`/`import type` (lint-enforced). One exception: the SDK CLI startup path, where lazy import is load-bearing and pinned by a boot test |
| Positional parameters | Named parameters via object destructuring: `fn({ a, b })` |
| Repeating a docs page's frontmatter `title` as its first heading | The frontmatter renders as the H1 and lede — give the first section its own name |
| Dogfooding agent-usage features with `claude -p` | Drive a real interactive session in a sub-tmux (`new-session -d`, `send-keys`, `capture-pane`); headless mode skips the lifecycle these features observe. Verify the data landed in the product |
| Spawning a subagent without naming model, effort and context size | Every spawn states all three plus one clause why — routing table in `.claude/coordinator/COORDINATOR.md` §3 |

## Structure

```
apps/                ui · api · worker · tasks · server (the npx CLI)
modules/<name>/      contract · process · browser · browser-kit (+ specs/, adrs/)
modules/catalogue.json   the one map of subjects to owning modules
enterprise/modules/  same shape, entitlement-gated at runtime, always mounted
packages/            framework only — never feature code
services/            aigateway · nlpgo · langyagent (Go) · langevals (Python) · simulators
sdks/                python · typescript · go
mcp/typescript/      MCP server
specs/               BDD feature specs
tools/               thuishaven, apidiff, dev-runtime, …
.bin/<name>/<name>   every locally built binary (ignored)
```

Key references: `dev/docs/ARCHITECTURE.md` (the record) ·
`dev/docs/CODING_STANDARDS.md` · `dev/docs/TESTING_PHILOSOPHY.md` ·
`dev/docs/lint-rules.md` (generated) · `dev/docs/best_practices/` ·
`dev/docs/adr/` · `.claude/skills/core/` (operating rules).


<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

> This section below the marker is generated by `rtk init`. Its Golden Rule has
> been edited to match this repository, where rtk is **optional**; re-running
> `rtk init` will restore the unconditional wording, so re-apply this if it does.

## Golden Rule

**Prefix with `rtk` when it is installed, and drop the prefix when it is not.**
rtk is an optional prerequisite here — `haven install` offers it, nothing in the
repository requires it, and on a machine without it `rtk git status` is
`command not found`, which costs a turn to recover from and produces no output
at all. Check once (`command -v rtk`) and prefix from then on, or just leave it
off; every command below works unprefixed.

What *is* always safe is the prefix itself, once the binary exists: where rtk
has a filter it shrinks the output, and where it has none it passes the command
through unchanged.

**If you use it, use it consistently**: each command in a chain needs its own
prefix.
```bash
# ❌ Wrong
rtk git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
rtk uv run <cmd>        # Compact uv project command output
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%). Format flags (-c, -l, -L, -o, -Z) run raw.
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

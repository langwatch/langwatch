# Generated READMEs: one page per app, module, half and package

Date: 2026-10-06. Status: proposal, waiting on Alex's answers to section 9.

## 1. What and why

Every directory an agent edits in gets a `README.md` that says what lives there, who owns
it, how it is called, and what it exposes. The facts come from the code, by static
analysis, so they cannot drift: CI runs the generator in `--check` mode and fails when a
README is stale. A short hand-written description sits above the generated part.

Agents use the pages for one question above all: **whose is this?** Today the answer is
spread across `modules/catalogue.json`, `static dependencies`, `prismaTables(...)` claims,
goose SQL, route builders, pipelines and `*.web.ts` files. The README puts it on one page,
next to the code.

Layout follows the bloefish service READMEs (title, description, base URL, transport,
versions, then each endpoint with a line of prose and a TypeScript contract), extended
with the sections this repo needs: ownership, peers, workers and installation.

## 2. Where READMEs go

| Path                                                            | Count                                           | Kind                                                  |
| --------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| `apps/README.md`                                                | 1                                               | index: every app, its port, what it installs          |
| `apps/<app>/README.md`                                          | 13 (6 product apps, 7 `*-web` consoles)         | app page                                              |
| `modules/README.md`                                             | 1                                               | index: every module, subjects, halves, classification |
| `modules/<id>/README.md`                                        | 53                                              | module page: owns, peers, facts, halves               |
| `modules/<id>/process/README.md`                                | 52                                              | API, REST, tRPC, sockets, workers, tasks, config      |
| `modules/<id>/browser/README.md`                                | 37                                              | screens, drawers, lends, hosts, client calls          |
| `packages/README.md`                                            | 1                                               | index: every package by group, with its description   |
| `enterprise/README.md`                                          | 1 (exists, stale: says `{contract,server,web}`) | index of enterprise modules and packages              |
| `enterprise/modules/README.md`, `enterprise/packages/README.md` | 2                                               | indexes (your `enterprise/*`)                         |
| `enterprise/modules/<id>/{,process,browser}/README.md`          | 12 + 11 + 7                                     | same shape as core (question Q1)                      |

About 230 files. `modules/<id>/contract/` and `client/` get no page of their own: the
contract is printed on the process page, where it is served (question Q2).

**Existing READMEs.** 15 module roots, 4 module halves, 19 packages and `enterprise/` have
hand-written READMEs, several stale (workflow and suite still describe `server/` and
`web/`). The generator keeps everything outside its markers, so these survive as the
hand-written description. A one-off lane trims the stale parts.

## 3. Page anatomy: hand-written head, generated body

```markdown
# slack

<!-- Hand-written: what this module is for, in a paragraph. The generator never touches it. -->

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

...tables...
<!-- readme:generated:end -->
```

A page with no hand-written description fails the check with "describe slack in a
paragraph above the generated block", so every page says what it is for in human words.

## 4. Examples

The examples use today's code. Values in them are real unless marked `…`.

### 4.1 `modules/README.md` (index)

```markdown
# Modules

One feature per directory. Other code sees a module's contract and calls its `*Api`
token; nothing else crosses the line (ARCHITECTURE.md §3). The map of subject to owner is
`modules/catalogue.json`; enterprise modules live in `enterprise/modules/`.

<!-- readme:generated:start -->

| Module                       | Class | Subjects                                    | Halves                       | Owns tables                            | Peers                        |
| ---------------------------- | ----- | ------------------------------------------- | ---------------------------- | -------------------------------------- | ---------------------------- |
| [agent](agent/README.md)     | core  | agent                                       | contract · process · browser | …                                      | project, scenario, …         |
| [auth](auth/README.md)       | core  | auth, cli-bootstrap, cli-session, cli-token | contract · process · browser | …                                      | user, identity, sso          |
| [slack](slack/README.md)     | core  | …                                           | contract · process · browser | SlackIntegration, SlackConnectionClaim | project, organization, authz |
| [webhook](webhook/README.md) | core  | …                                           | contract · process           | …                                      | gateway, …                   |
| … 65 rows …                  |

**Who owns a subject?** Search this table, or `modules/catalogue.json`. A subject with no
row is unowned: add it to the catalogue before writing code for it.
<!-- readme:generated:end -->
```

### 4.2 `modules/slack/README.md` (module page)

```markdown
# slack

A project's Slack connections: the bot tokens automations post with, and the claims
that keep two automations from fighting over one channel.

<!-- readme:generated:start -->

## At a glance

|                |                                                                                        |
| -------------- | -------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                        |
| Halves         | [contract](contract/src) · [process](process/README.md) · [browser](browser/README.md) |
| Api token      | `SlackApi` = `moduleApi<SlackApi>()("slack")`, `contract/src/slack.api.ts:71`          |
| Installed by   | api, worker, tasks (process); ui (browser)                                             |

## What slack owns

| Kind            | Name                                                                              | Declared at                                                                      |
| --------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Postgres table  | `SlackIntegration`                                                                | `process/src/repositories/prisma/prisma.slack-connection.repository.ts:59`       |
| Postgres table  | `SlackConnectionClaim`                                                            | `process/src/repositories/prisma/prisma.slack-connection-claim.repository.ts:21` |
| Stores required | prisma, encryption                                                                | `process/src/repositories/prisma/prisma.slack.repositories.ts:17`                |
| Secrets         | `fingerprintKey` (CREDENTIALS_SECRET), `fingerprintKeyFallback` (NEXTAUTH_SECRET) | `process/src/app/slack.app.ts:38`                                                |
| Facts published | none                                                                              |                                                                                  |

Anything else slack needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name          | Token             | Module                                    |
| ------------- | ----------------- | ----------------------------------------- |
| projects      | `ProjectApi`      | [project](../project/README.md)           |
| organizations | `OrganizationApi` | [organization](../organization/README.md) |
| authorization | `AuthzApi`        | [authz](../authz/README.md)               |

## Who depends on slack

automation (peer), ui (browser: settings and automation open the `slackConnection` drawer).
<!-- readme:generated:end -->
```

### 4.3 `modules/slack/process/README.md` (process half)

````markdown
# @langwatch/slack-process

The server half of slack: the `SlackModule` behind `SlackApi`, its repositories and its doors.

<!-- readme:generated:start -->

## Installation

`defineProcessModule("slack").withRepositories(slackRepositories).withApi(SlackModule)
.withTransports(slackIntegrationTrpcTransport, slackRest)`, `src/slack.module.ts:8`.
Listed in `apps/{api,worker,tasks}/src/process-modules.generated.ts` by `pnpm generate:modules`.

## Module API (`SlackApi`)

Peers call these through the token; nothing else in this package is public.

#### `listSlackConnections`

**Contract**

```typescript
interface Request {
  projectId: string;
  actorId?: string;
}
type Response = SlackConnectionList; // contract/src/slack.ts:…
```

#### `createSlackConnection` · `updateSlackConnection` · `deleteSlackConnection` · `getUsableSlackConnection` · `findUsableSlackSecret` · `findOrCreateSlackConnectionForSecret` · `claimConnection` · `releaseConnection`

(one block each, as above)

## REST transport

### Base URL

`/api/slack-connections` (dated family; also `/api/slack-connections/2026-08-07` and `/latest`, hidden)

### Versions

- `2026-08-07` (`MANAGEMENT_API_VERSION`)

### Endpoints

#### `GET /` · `getApiSlackConnections`

Lists the project's Slack connections. Permission `project:view`.

**Contract**

```typescript
type Request = null;
type Response = SlackConnectionRestResponse[];
```

## tRPC transport (`slackIntegration`)

| Procedure                 | Kind     | Permission   | Input               | Output                   |
| ------------------------- | -------- | ------------ | ------------------- | ------------------------ |
| `slackIntegration.list`   | query    | project:view | `listInputSchema`   | `SlackConnectionList`    |
| `slackIntegration.create` | mutation | project:view | `createInputSchema` | `SlackManagedConnection` |
| `slackIntegration.update` | mutation | project:view | …                   | …                        |
| `slackIntegration.delete` | mutation | project:view | …                   | …                        |

## Workers

None: slack declares no pipeline, process manager, subscriber or task.

## Configuration

| Leaf                    | Source                                        |
| ----------------------- | --------------------------------------------- |
| secret `fingerprintKey` | `credentialsSecret` from `@langwatch/secrets` |

<!-- readme:generated:end -->
````

Note what the page surfaces: three slack **mutations are gated by `project:view`**. That
is exactly the kind of fact a reviewer misses in a 70-line transport file and sees at once
in a table. (It is reported to Alex as a likely defect, not changed here.)

### 4.4 `modules/webhook/process/README.md`, workers section (worker-heavy example)

```markdown
## Workers

### Pipeline `webhook_delivery` (aggregate `webhook_spend_delivery`)

Built in `src/eventing/webhook-delivery.pipeline.ts:51`; installed by `.withEventing(webhookDeliveryEventing)`.
Its queue is the group queue `webhook_delivery`; job keys are `webhook_delivery:<jobType>:<name>`.

| Kind            | Name                                                                                                                                      | Handles                                                             | Roles       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------- |
| command         | `requestSpendDelivery`                                                                                                                    | → `webhookSpendDeliveryRequested`                                   | api, worker |
| command         | `requestGovernanceDelivery`                                                                                                               | → `webhookGovernanceDeliveryRequested`                              | api, worker |
| process manager | `webhookDelivery`                                                                                                                         | intents: … (outbox), wakes: …                                       | worker only |
| process manager | `governanceEvents`                                                                                                                        | …                                                                   | worker only |
| peer subscriber | `gatewaySpendAdmittedDelivery`                                                                                                            | `lw.gateway.spend.admitted` from [gateway](../../gateway/README.md) | worker only |
| peer subscriber | `gatewaySpendConfirmedDelivery` · `…FailedDelivery` · `…SettledDelivery` · `gatewayBudgetCrossingDelivery` · `gatewayVkLifecycleDelivery` | gateway facts                                                       | worker only |

"api" builds the reduced pipeline (commands only): `if (!input.deliveryProcess …) return pipeline.build()`.
The worker builds the whole graph.
```

A process manager with a schedule shows its period resolved from the constant, for example
billing's `seatInvoicing`: `every 60 s (SEAT_INVOICING_INTERVAL_MS = 60 * 1000)`.

### 4.5 `modules/slack/browser/README.md` (browser half)

```markdown
# @langwatch/slack-browser

<!-- readme:generated:start -->

Declared in `src/slack.web.ts:5` (`defineBrowserModule("slack")`), exported at `./declaration`,
installed by `apps/ui/src/browser-modules.generated.ts`.

## Screens

None.

## Drawers (the name is the wire: `?drawer.open=<name>`)

| Drawer            | Opens                                     | Opened by            |
| ----------------- | ----------------------------------------- | -------------------- |
| `slackConnection` | `ui/sections/slack-connection-drawer.tsx` | settings, automation |

## Calls

tRPC `slackIntegration.*` (see the process page). No lends, no hosts.
<!-- readme:generated:end -->
```

A screen-heavy module (annotation) gets a table of `page key · URL · within · label ·
permission · flags`, the URL joined from the screen's `path` or from
`apps/ui/src/shell/ui-route-table.ts`.

### 4.6 `apps/README.md` and `apps/worker/README.md`

```markdown
# Apps

An app is `main.ts` and `config.ts`; no product code (CLAUDE.md). ui, api and worker always
run together: a stack missing the worker serves pages and silently processes no jobs.

<!-- readme:generated:start -->

| App                                        | Package                 | Port                            | Installs                              | Role                                                             |
| ------------------------------------------ | ----------------------- | ------------------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| [api](api/README.md)                       | @langwatch/platform-api | `API_PORT` (6560)               | 63 process modules                    | serves tRPC, REST, SSE, sockets, the UI bundle; the one migrator |
| [worker](worker/README.md)                 | …                       | `WORKER_METRICS_PORT` (2999)    | 63 process modules                    | consumes queues, runs projections, process managers, subscribers |
| [tasks](tasks/README.md)                   | …                       | –                               | 63 process modules + 7 built-in tasks | migrations and backfills, run before serve                       |
| [ui](ui/README.md)                         | @langwatch/ui           | `PORT` (5560), API at PORT+1000 | 45 browser modules                    | the SPA                                                          |
| [server](server/README.md)                 | @langwatch/server       | `PORT_BASE_DEFAULT` 5560        | –                                     | the `npx @langwatch/server` CLI                                  |
| [scenario-child](scenario-child/README.md) | …                       | –                               | –                                     | …                                                                |
| 7 `*-web` consoles                         | …                       | served by the Go sims           | –                                     | haven and simulator consoles                                     |

<!-- readme:generated:end -->
```

```markdown
# worker

<!-- readme:generated:start -->

## Boot

`Server.create(…).withConfig(processConfig(processModules, "worker")).container("worker").boot()`,
`src/main.ts:…`. Start: `pnpm --filter … start` (no migration; the api migrates).

## Installed modules (63, from `src/process-modules.generated.ts`)

| Module                                                        | Pipelines        | Process managers       | Peer subscribers | Scheduled | Tasks |
| ------------------------------------------------------------- | ---------------- | ---------------------- | ---------------- | --------- | ----- |
| [webhook](../../modules/webhook/process/README.md)            | webhook_delivery | 2                      | 6                | –         | –     |
| [billing](../../enterprise/modules/billing/process/README.md) | …                | seatInvoicing (60 s) … | …                | 1         | …     |
| …                                                             |

## Adding a module

Add it to `modules/catalogue.json`, run `pnpm generate:modules`; the worker picks it up from
the generated list. Nothing is registered by hand.
<!-- readme:generated:end -->
```

### 4.7 `packages/README.md`

```markdown
# Packages

Framework only: feature code here is a defect (CLAUDE.md).

<!-- readme:generated:start -->

| Group           | Package                                             | What it is (package.json `description`) | Used by            |
| --------------- | --------------------------------------------------- | --------------------------------------- | ------------------ |
| Core vocabulary | [@langwatch/process](process/README.md)             | …                                       | every process half |
| Core vocabulary | [@langwatch/api](api/README.md)                     | …                                       | every transport    |
| Raw clients     | [@langwatch/prisma-client](prisma-client/README.md) | …                                       | repositories only  |
| … 42 rows …     |

<!-- readme:generated:end -->
```

Package pages themselves stay hand-written (19 exist); the generator only checks that each
package has one and that its first paragraph matches the `description`.

### 4.8 `enterprise/README.md` and `enterprise/modules/README.md`

Same as the modules index, filtered to `classification: enterprise`, plus a column for the
gate: every `.withEntitlement("enterprise", { feature })` the module declares (71 routes
today; 4 are `webhook_endpoints`), and a line that gating is per route, never per mount.

## 5. How the generator reads the code

### 5.1 Split of work

A pure-Go parser cannot read this codebase faithfully: values sit one hop away (56 of 67
pipeline names are imported constants, `everyMs` is arithmetic in another file, paths are
template literals and `.map()` families), and `*Api` contracts are TypeScript interfaces
over zod schemas. So the tool copies the pattern `tools/apidiff` already uses:

| Part                                           | Language                | Does                                                                                                                                                       |
| ---------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/readmegen` (`cmd/readmegen`)            | Go                      | walks the tree, reads the catalogue, package.json files, `schema.prisma`, goose SQL, the filename grammar; runs the extractor; renders Markdown; `--check` |
| `tools/readmegen/extract/*.mts` (`//go:embed`) | TypeScript, run by node | reads declarations with the TypeScript compiler API, **syntactically, without booting anything**, and prints one JSON manifest                             |

The extractor reuses code that is already tested for the same job:
`createWorkspaceModuleResolver` and `walkValueImportGraph` (packages/architecture-enforcer
`module-graph.ts`) for imports and constants, the peer-edge reader from `peer-cycles.ts`,
the claim readers from `prisma-table-ownership.ts`, and the table and view readers from
`clickhouse-table-ownership.ts`. For REST it can also mount routes the way
`apps/api/src/openapi-document.ts` does and read `allRegisteredRoutes()`, which gives the
exact served addresses; the syntactic read and the mounted read are compared and must agree.

If you want Go only (question Q3), the alternative is tree-sitter. That needs cgo (devscripts
build with `CGO_ENABLED=0`), means re-implementing the resolver and constant folding in Go,
and still cannot see runtime values such as `resolveRequestBound(...)` body limits.

### 5.2 The manifest (Go side)

```go
// tools/readmegen/manifest.go
type Manifest struct {
	Modules  []Module  `json:"modules"`
	Apps     []App     `json:"apps"`
	Packages []Package `json:"packages"`
}

type Module struct {
	ID, Root, Classification string
	Subjects                 []string
	Token                    Located[string]  // "SlackApi", contract/src/slack.api.ts:71
	Operations               []Operation      // interface members, printed signatures
	Peers                    []Peer           // static dependencies: name, token, module
	Owns                     Ownership        // prisma claims, ClickHouse writes, stores, secrets
	Rest                     []RestRoute
	Trpc                     []TrpcProcedure
	Sockets                  []Socket         // websocket, rawhttp, rawsocket
	Pipelines                []Pipeline
	Tasks                    []Located[string]
	Browser                  *BrowserModule
}

type RestRoute struct {
	Method, Path, OperationID string
	Addresses                 []string // dated, /latest, v1 twin
	Permission                Policy   // permission, any-of, public(reason), service, none(reason)
	Entitlement               string
	Hidden                    bool
	Input, Output             Schema   // JSON Schema from zod
	At                        Location
}

type Pipeline struct {
	Name, Aggregate  string
	Commands         []Located[string]
	Events           []string
	ProcessManagers  []ProcessManager // name, schedule (ms, resolved), intents, roles
	PeerSubscribers  []Subscriber     // name, eventType, owning module
	RolesBuilt       map[string][]string
}
```

### 5.3 Reading routes and workers from the code

Each shape is matched as a builder chain on a known receiver, and every argument is folded
to a value through the resolver:

| Source shape                                                                                                                              | Read as                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defineProcessModule("slack").withApi(SlackModule).withTransports(a, b)`                                                                  | module id, the class to read statics from, the transport values to follow                                                                               |
| `static readonly dependencies = { projects: ProjectApi }`                                                                                 | peer `projects`; `ProjectApi` resolves to `moduleApi<…>()("project")`, so module `project`                                                              |
| `defineRestRouter(SlackApi).withNamespace("slack-connections").withVersion(V).get("/", "op").withPermission("project:view")`              | one route; full addresses from a Go port of `basePathOf` / `addressesOf`                                                                                |
| `defineTrpcContract("slackIntegration").query("list").withInput(s)` + `defineTrpcRouter(SlackApi, c).procedure("list").withPermission(p)` | one procedure, joining the contract half and the process half by name                                                                                   |
| `definePipeline({ name: N }).withCommand(…).withProcessManager(P, pm => pm.schedule({ everyMs: E }))`                                     | pipeline, commands, process managers with their resolved period; a chain split by `if (...) return pipeline.build()` records which roles get which part |
| `.withPeerSubscriber("x", { eventType: T })`                                                                                              | subscriber; `T`'s defining package names the publishing module                                                                                          |
| `readonly name = "trace-destination-report"` in a `*.task.ts` named by `.withTasks(...)`                                                  | task                                                                                                                                                    |
| `defineBrowserModule("slack").withDrawers({ slackConnection: … })`                                                                        | drawer; screens likewise, URLs joined with `ui-route-table.ts`                                                                                          |
| `z.object({...})` reached from a `withInput` / `withOutput` / `z.infer` alias                                                             | JSON Schema via the zod import, printed by Go as a TypeScript interface                                                                                 |

A value the folder cannot resolve is printed as its source text with a `≈` mark and listed
in a `--strict` report; the CI check fails on a new unresolved value, so the pages never
show a guess as a fact.

### 5.4 Commands and CI

- `pnpm generate:readmes` runs `go run ./cmd/readmegen --write` (via `dev/scripts/devscripts.sh`,
  like `generate:modules`).
- `pnpm check:readmes` runs `--check`: exit 1 and a diff when a page is stale, or when a page
  lacks its hand-written paragraph.
- CI: a step in the `generated` job of `go-ci.yaml` and in `langwatch-app-ci.yml`'s `lint` job,
  added to `.github/actions/prepare-generated-files` inputs. `ciguard` asserts the job shape.
- Golden tests in `tools/readmegen/testdata/` over a small fixture tree, as `generatemodules.go` has.

## 6. Skills and rules that use the pages

| Name                                                                        | New or changed                                                                 | What it makes an agent do                                                                                                                                                                                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/rules/module-readme.md`                                            | new path-scoped rule (`modules/**`, `enterprise/**`, `apps/**`, `packages/**`) | loads automatically when an agent opens a file there: "read the nearest README first; the Owns and Peers tables decide where a change goes; never edit inside the generated markers, regenerate"                                      |
| `ownership`                                                                 | new skill                                                                      | "Where does this change belong?": find the owning module from `modules/README.md`, refuse a cross-module edit, and name the `*Api` operation, fact or new operation to ask for instead; used before any edit that touches two modules |
| `readmes`                                                                   | new skill                                                                      | maintaining the generator: adding a section, adding an extractor shape, fixing an unresolved value, the hand-written paragraph rule                                                                                                   |
| `module`, `repo-tree`, `architecture-guide`                                 | changed                                                                        | point at `modules/README.md` and the per-module page instead of describing the layout in prose                                                                                                                                        |
| `api-transports`, `eventing-and-worker`, `process-module`, `browser-module` | changed                                                                        | "after adding a route, pipeline, task or screen, run `pnpm generate:readmes`; the page is the review artefact"                                                                                                                        |
| `module-dependencies`                                                       | changed                                                                        | read the Peers and "Who depends on" tables before adding a peer edge; a new edge that closes a cycle shows up there first                                                                                                             |
| `architecture-review`                                                       | changed                                                                        | compare a diff's touched paths with the Owns tables; a write to a table another module owns is a finding                                                                                                                              |
| `coordinator`                                                               | changed                                                                        | a lane manifest's owned paths cite the module page; lanes get "read these three READMEs" instead of long briefs                                                                                                                       |

How this changes what agents read: today an agent asked to touch Slack posting reads
`slack.app.ts`, the transport files, the catalogue and guesses at ownership from imports.
With the pages it reads `modules/slack/README.md` (about 60 lines) and has the owner, the
peers, the doors and their permissions. Pages are tables, not prose, and long schemas link
to `file:line` instead of inlining, so a page stays under about 300 lines; a size budget in
`--check` keeps it so.

## 7. Plan

| Step | Work                                                                                                                                                                               | Size |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| R1   | Go skeleton: walker, catalogue, package.json, filename grammar, Markdown renderer, markers, `--check`, golden tests; index pages (`modules/`, `apps/`, `packages/`, `enterprise/`) | M    |
| R2   | Extractor: module statics, peers, ownership (reusing enforcer readers), `*Api` operations                                                                                          | M    |
| R3   | Extractor: REST (syntactic plus mounted cross-check), tRPC, sockets                                                                                                                | M    |
| R4   | Extractor: pipelines, process managers, subscribers, tasks, roles                                                                                                                  | M    |
| R5   | Extractor: browser declarations, screens joined with the route table                                                                                                               | S    |
| R6   | zod to TypeScript printer, request/response blocks                                                                                                                                 | M    |
| R7   | Hand-written paragraphs for ~230 pages (lanes per area), trim stale existing READMEs                                                                                               | M    |
| R8   | Rule, new skills, skill edits, CI wiring                                                                                                                                           | S    |

About 10 to 14 lane-days; R1 and R2 first, then R3 to R6 in parallel lanes.

## 8. Risks

- **Fidelity.** A syntactic read can be wrong where control flow decides (role-reduced
  pipelines, factory-built transports). The mounted REST cross-check and the `≈` marker keep
  wrong facts out; the rest is caught in review of the golden tests.
- **Install cost.** The extractor needs an installed workspace with generated files, as
  apidiff and `openapi:generate` do; CI already prepares them.
- **Churn.** Every route or pipeline change regenerates a page. That is intended: the page is
  part of the diff a reviewer reads. GitHub cannot mark half a file as generated, so the pages
  show in diffs in full.
- **Ownership gaps.** Prisma claims name 48 of 169 models today. The page shows the rest as
  "accessed, not claimed"; making every model claimed is a follow-up the pages make visible.

## 9. Questions for Alex

- Q1. Enterprise modules get the same three pages as core (`enterprise/modules/<id>/{,process,browser}`)?
- Q2. Contract and client halves: no page of their own (printed on the process page), or a page each?
- Q3. Go plus an embedded TypeScript extractor (recommended), or Go only with tree-sitter (cgo, lower fidelity)?
- Q4. Existing hand-written READMEs: keep above the marker and trim, or replace?

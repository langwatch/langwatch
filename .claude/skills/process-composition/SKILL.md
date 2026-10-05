---
name: process-composition
description: "Compose a LangWatch process (apps/api, apps/worker, apps/tasks): main.ts and config.ts, the Server preamble (withEnvironment, withConfig, withSecrets, withTelemetry, withMetrics, start), server.container(role), exposeTransports, boot(), serve and run; what boot() does with stores, registries, peers, config slices and roles; config declared at its owner and parsed once (Config.define, processConfig, one env var one owner); secrets as handles resolved through into and sealed after boot; stores, the live and memory tiers, and migrations as tasks; installation tests that prove a composition. Use when someone says 'compose a process', 'edit main.ts', 'add to config.ts', 'boot refused', 'needs surface', 'config collision', 'ConfigClaimsSecretError', 'secret sealed', 'preflight failed', 'config parse refused', 'install a module in the api', 'generate:modules', 'run on memory stores', 'LANGWATCH_STORES', 'migration before serve', 'installation test', 'bootInstalledProcess', or opens apps/*/src/main.ts, apps/*/src/config.ts or an *-installation test."
user-invocable: true
---

# Process composition: main.ts, boot(), config, stores

Record: `dev/docs/ARCHITECTURE.md` §4 (a process, whole), §5 (what `boot()` does), §6 (config and
secrets), §7 (stores, the tier, migrations), §13 (the installation test). Deleted spellings are §15;
target names that have not landed are §16. Search the record by heading: numbers move. This skill
teaches the shape the tree has, names the check behind each rule, and says where no check exists.

Not here: a module's own class, services and registries (`process-module`); routes and procedures
(`api-transports`); pipelines, subscribers and process managers on the worker
(`eventing-and-worker`); what a module may demand and how it declares config, secrets and peers,
and cutting a peer cycle (§3.3, §6; `module-dependencies`). This skill takes over where the
declaration ends: how the process parses, resolves, seals and boots it.
The `backend` skill is the map; this skill is the depth for §4-§7.

## The shape in the tree

An app is `src/main.ts` plus `src/config.ts`, and holds no product code (§1, §4).

- `apps/api/src/config.ts` and `apps/worker/src/config.ts` hold one export, `processEnvironment`:
  the one place `process.env` reaches the preamble (§4, §6).
- `apps/api/src/main.ts:22-50`: `Server.create("langwatch-api")`, then `.withEnvironment`,
  `.withConfig(processConfig(processModules))`, `.withSecrets(...)` (env, file, 1Password),
  `.withTelemetry`, `.withMetrics` and `.start()`; then `server.container("api")`,
  `.exposeTransports(...)` selecting tRPC, REST and the bundle, `.boot()` and `server.serve(app)`.
- `apps/worker/src/main.ts:19-37`: the same preamble with `processConfig(processModules, "worker")`,
  then `server.container("worker").boot()` and `server.run(app)`. No `exposeTransports`: it exists
  only on the api container (`packages/process/src/process-container.ts:65`).
- `apps/tasks/src/main.ts`: migrations by hand; `apps/tasks/src/module-task.ts:29` boots
  `server.container("tasks")` to run a module's task (§4 "Tasks").
- `processModules` is generated from `modules/catalogue.json` into each app's
  `process-modules.generated.ts` by `pnpm generate:modules` (§5).

`withProcessOwnership` and the `ownsTelemetry` switch exist for the one-process dev lane
(`tools/dev-runtime`, ADR-168, Proposed); they are not part of the record's chain.

## The rules

1. **The chain names no module.** There is no `withModules` and no `withPipelines`; the container
   takes the owners handed to `withConfig`, and the role decides pipeline participation (api and
   tasks produce, worker consumes) (§4, Alex 2026-09-29).
2. **Installing a module edits the catalogue, never a root.** Then `pnpm generate:modules`. The
   root never grows: a change that needs it to grow has found a gap in the primitives; report it
   (§5).
3. **No deployment-choice lines.** The chain wires nothing conditionally; a module decides its own
   availability from its config and secrets (§4, §6, §3.3 rule 4).
4. **The container answers stores and peers, nothing else.** No members, no `.provide`, no
   `withMember`, no supply tokens (§4, §5, Alex 2026-10-01). Stores go only to a module's
   repository and channel registries; peers (`*Api` tokens) only to the module class.
5. **`boot()` refuses by name** (§5): a store a registry requires and the process did not open, a
   missing required config value (`github.appId ← GITHUB_APP_ID`), a missing required secret.
   Never a runtime fallback, a logged absence or an absence class.
6. **No lifecycle in main.** Transport hosts, eventing consumers and module services register their
   own drain phases on the server; no app writes a shutdown phase or a signal handler (§4).
7. **Config is declared at its owner, in the contract** (`<name>.config.ts`, one `Config.define`),
   attached on the module class as `static readonly config`, parsed once by the generated
   `processConfig`, and drilled as an argument; nothing reads it ambiently (§6).
8. **One environment variable, one owner.** A second claim refuses the parse by name. A fact several
   modules read is one picked leaf, never a re-declaration (§6).
9. **A secret is a handle you may only pass through.** `Secret.load(id)`; resolve in a record
   `secrets.into({ a, b }, build)` at the construction site, so only the built collaborator travels.
   No `get()`, no `Secret.define`, no nested `into`. The resolver seals after boot (§6).
10. **Connection strings are the stores' secrets**, and store clients appear in exactly one place:
    the chain. A module never names a URL or opens a client (§6, §7).
11. **Migrations are tasks, run before serve**, never by the api (§7). A module's in-place system
    migration is its own, answered through its `*Api`; ops runs them (§7).
12. **Composition is proven by booting it.** The installation test boots the installed list in a
    role over memory stores with no server (§4 last paragraph, §13). A unit test with fakes proves
    a module's behaviour, never that the process composes.

## Backed by

"Boot refusal" is a check too: the installation tests run the same parse, preflight and boot, so a
refusal there fails CI. Rows marked unbacked feed the lint-rule backlog below.

| Rule (section)                                                                                    | Lint rule / enforcer policy or test                                                                                                                              | Notes                                                                                                        |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| An app holds no product code (§1, §4)                                                             | policy `application-boundaries` (`composition-source`)                                                                                                           |                                                                                                              |
| Only `config.ts` reads `process.env` (§4, §6)                                                     | `langwatch/environment-boundaries`                                                                                                                               | Partial: the rule also admits `src/main.ts`; `apps/tasks/src/main.ts:124,127` reads it                       |
| An app names no module's process package (§4, §5)                                                 | `langwatch/package-boundaries` (`compositionRoot`)                                                                                                               |                                                                                                              |
| `processModules` is the catalogue, the same in api/worker/tasks                                   | enforcer test `packages/architecture-enforcer/tests/generated-module-lists.unit.test.ts`                                                                         |                                                                                                              |
| `main.ts` within 50 lines (§4)                                                                    | unbacked                                                                                                                                                         | `apps/api/src/main.ts` is 54 lines today                                                                     |
| No signal or fatal handler outside the Server (§4)                                                | `langwatch/no-boot-hook-outside-guard`                                                                                                                           |                                                                                                              |
| No raw `{ name, start, stop }` component literal (§4)                                             | unbacked                                                                                                                                                         |                                                                                                              |
| `exposeTransports` only on the api (§4)                                                           | typecheck (`ApiProcessContainer` alone has it)                                                                                                                   |                                                                                                              |
| No `withMember`, `.provide`, supply tokens (§4, §15)                                              | unbacked                                                                                                                                                         | `ProcessContainer.withMember` still exists (`packages/process/src/process-container.ts:59`); no app calls it |
| No store client in an app; clients only in registries (§7)                                        | `langwatch/store-containment` (`storeInApplication`, `storeNamed`, `storeClientValue`); test `packages/architecture-enforcer/tests/redis-ownership.unit.test.ts` |                                                                                                              |
| Peer cycles refuse (§5)                                                                           | policy `peer-cycles`; `packages/architecture-enforcer/tests/boundary-ratchets.unit.test.ts` expects no edge                                                      | Red until the last cycle is cut (ruled); the boot refusal is not built; cutting one: `module-dependencies`   |
| A required store, config value or secret missing refuses by name                                  | boot refusal: `ConfigParseError`, `SecretsPreflightError`; `apps/api/src/__tests__/api-config-refusal.unit.test.ts`                                              |                                                                                                              |
| Config drilled; a callee never resolves its own (§6)                                              | `langwatch/service-loads-its-own-config`                                                                                                                         |                                                                                                              |
| One env var, one owner (§6)                                                                       | policy `feature-configuration`; boot refusal `ConfigCollisionError` (`packages/config/src/config.errors.ts:13`)                                                  |                                                                                                              |
| A config leaf and a secret never share a name (§6)                                                | boot refusal `ConfigClaimsSecretError`, `SecretClaimedTwiceError`                                                                                                |                                                                                                              |
| Feature secret handles live in the owner's contract (§6)                                          | unbacked                                                                                                                                                         | `modules/github/process/src/app/github.app.ts:220` declares them in the process half                         |
| Resolve after boot refuses (§6)                                                                   | runtime `SealedSecretsError` (`packages/secrets/src/secrets.errors.ts:4`)                                                                                        |                                                                                                              |
| No nested `into`, no `Secret.define` (§6, §15)                                                    | unbacked                                                                                                                                                         | `packages/process-stores/src/open-stores.ts:141` still nests (§16 row)                                       |
| Migrations run before serve, never in the api (§7)                                                | tests `packages/architecture-enforcer/tests/system-migrations-start-order.unit.test.ts`, `apps/api/src/__tests__/start-path.unit.test.ts`                        |                                                                                                              |
| A module's in-place migration reads Prisma only through its own private migration repository (§7) | policy `prisma-migration-access`                                                                                                                                 |                                                                                                              |
| Only `packages/eventing` touches the event tables (§7)                                            | policy `eventing-table-access` (shrink-only baseline `packages/architecture-enforcer/tests/baselines/eventing-table-access.json`)                                |                                                                                                              |
| Every Redis cache key expires in the writing command (§7)                                         | enforcer test `packages/architecture-enforcer/tests/redis-cache-ttl.unit.test.ts`                                                                                |                                                                                                              |
| Composition proven by an installation test (§13)                                                  | `pnpm --filter @langwatch/architecture-enforcer check:feature-parity` binds `specs/platform/process-installation.feature`                                        | Partial: nothing refuses a composition scenario bound to a unit test with fakes                              |
| `*.members.ts`, `*-composition.build.ts` deleted (§5, §15)                                        | unbacked                                                                                                                                                         | the grammar still accepts both (`packages/oxlint-rules/grammar/feature-layout-policy.mjs:135,140`); 36 files |

### Unbacked: the lint-rule backlog

Each is a proposal for the `lint-rule` skill, not a ruling; the deleted-spellings guard
(`dev/docs/plans/architecture-teaching-2026-10-05.md` step 2) may cover the §15 rows.

1. **50-line entry point**: oxlint `max-lines` override at 50 on `apps/*/src/main.ts`, after api's
   `main.ts` is cut back (54 today).
2. **Raw lifecycle literal**: a `langwatch/*` rule refusing an object literal with `name`, `start`
   and `stop` passed to the server; the message names the spoken factories.
3. **Container members**: delete `ProcessContainer.withMember`, or a per-spelling ratchet on
   `withMember`, `.provide`, `SupplyToken`, `MissingSupply`.
4. **Secret handles in the contract**: extend policy `feature-configuration` to `Secret.load` and
   `Secret.family` outside `modules/*/contract/src/*.config.ts` and framework owners.
5. **Nested `into`, `Secret.define`**: a ratchet with a count per file, shrink-only.
6. **Members and composition files**: remove the two patterns from `PROCESS_PATTERNS`, holding the
   36 files in a shrink-only baseline.
7. **`config.ts` is the seam only**: narrow `environment-boundaries` to `src/config.ts`, and refuse
   any export but `processEnvironment` in api's and worker's `config.ts`.
8. **Composition bound by booting**: `check:feature-parity` refuses a scenario in
   `specs/platform/process-installation.feature` bound to a test that never calls
   `bootInstalledProcess`.

## Worked example: a module gains a deployment value

The question: "github needs the host of a GitHub Enterprise Server. Where does it go, and does any app
change?"

1. **Declare it at the owner, in the contract.** `modules/github/contract/src/github.config.ts:9-13`
   is the shape: one `Config.define`, one `c.env("GITHUB_LANGY_HOST", z.string().optional())` leaf.
   This file is the only one that names the variable (§6).
2. **Attach it on the module class.** `static readonly config = githubConfig`
   (`modules/github/process/src/app/github.app.ts:219`). `create()` receives the parsed slice and
   passes the narrowest piece to the service that needs it (§5 "Registry resolution ends at create").
3. **No app changes.** `processConfig(processModules)` already reads every installed owner's schema:
   `main.ts` and `config.ts` stay as they are. If the edit seems to need one, the root is growing:
   stop and report the gap (§5).
4. **A credential is a handle, not a leaf.** A private key is `Secret.load(...)` beside the config
   (`github.app.ts:220` today; the record wants it in the contract), resolved inside `create()` or
   a registry through `secrets.into`, so only the built client escapes (§6).
5. **Prove it composes.** Run the installation tests for each role the module boots in:
   `VITEST_MAX_WORKERS=2 pnpm --filter @langwatch/platform-api test src/__tests__/api-installation.integration.test.ts`,
   then `@langwatch/worker` and `@langwatch/tasks` likewise. A required leaf with no value refuses
   there by name; give the fixture's synthetic environment a harmless invented value
   (`apps/api/src/__tests__/api-installation.fixture.ts:33-38`), never one read from `.env`.

A brand-new module adds its catalogue entry first, then `pnpm generate:modules`; the
`generated-module-lists` test proves the three lists agree.

## Traps

- **A composition scenario proven by a unit test with fakes.** Hand-built peers and a stub container
  prove a module's logic, not that the process boots. Bind composition scenarios to an
  `*-installation.integration.test.ts` that boots the installed list (`api-installation.fixture.ts`,
  `apps/worker/src/__tests__/worker-installation.integration.test.ts`,
  `apps/tasks/src/__tests__/tasks-installation.integration.test.ts`). The `spec-binding-review` skill judges
  such a bind.
- **Extending the fixture's `members` bag.** The fixtures hand `bootInstalledProcess({ members })`
  built by `storesBackedMembers`, with process facts as members: §15 deletes those spellings and §16
  lists them as today's names. Add no new member; a missing one is a module needing a registry.
- **Copying the record's sample chain verbatim.** The tree adds `withEnvironment` and
  `withMetrics`; the record names `processFacts` and record `into`, which have not landed (§16).
  Write what compiles today and link §16.
- **Splitting `processModules` to appease TS2589.** Cost grows with chain length, not list size;
  do not split the list (§5).
- **A fallback for an absent store or credential.** Absence refuses by name; the module answers its
  own availability (§5, §6).
- **Running migrations from the api, or DDL from a module.** Tasks own migrations (§7).

## Known disagreements between the record and the tree

Prefer the tree for names, the linter for rules; report, do not fix a record you do not own.

- §7's `LANGWATCH_STORES` knob is not in the code, and `packages/process/src/tiers.ts:3` says
  absence selects memory, the opposite of §7's "absence always refuses". No §16 row.
- §4 D3 says a process skips a module's declaration for an unselected surface; the api container
  still refuses `<module> needs surface.<protocol>` (`process-container.ts:83`), as a plain `Error`.
  §4's earlier paragraph ("an omitted declared transport refuses boot by name") matches the tree
  and contradicts D3 inside the record.
- §4 says `main.ts` stays within 50 lines; `apps/api/src/main.ts` is 54.
- §16 rows still open: `processFacts` (today `owner.ts`, `deployment-facts.ts`), record `into`
  (today nested), `hostedStores` (today `hostedMembers`), "store client" (today "member").

## Checks

While working: `tsc --noEmit --ignoreConfig <file>`, scoped `oxlint` on the paths you touched, and
the installation test of each role touched. At the end, once:
`pnpm --filter <package> typecheck`;
`pnpm lint:architecture --policies application-boundaries,feature-configuration,peer-cycles,prisma-migration-access,eventing-table-access`;
`pnpm --filter @langwatch/architecture-enforcer check:feature-parity`.

## Links

`dev/docs/ARCHITECTURE.md` §4-§7, §13, §15, §16 · `specs/platform/process-installation.feature` ·
`dev/docs/adr/147-compiler-checked-process-supply.md` · ADR-132 (secrets) · `dev/docs/lint-rules.md` ·
skills `architecture-guide`, `module-dependencies`, `process-module`, `testing`,
`spec-binding-review`, `architecture-review`, `lint-rule`, `linting`.

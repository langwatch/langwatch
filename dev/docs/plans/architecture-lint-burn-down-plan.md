# Architecture-lint burn-down plan

**Written:** 2026-09-03. **Audited:** 2026-09-03 against the working tree.
**Input then:** one full `pnpm --filter @langwatch/architecture-lint lint` run
(2,946 violations across 41 policies) plus one `review:comment-blocks` run
(20,137 blocks over the limit in 7,476 files). **Companion:**
`architecture-lint-review-2026-09-03.md`.

**Every count in this document predates R1–R6.** Those rule changes removed
roughly 90 false positives and re-tiered the comment scan, so the first step
for any resumed slice is a fresh `pnpm --filter @langwatch/architecture-lint
lint > before.log 2>&1` and a re-derivation of that policy's rows. Use the
tables below for the *transformation* to apply, not for the number of rows.

Lanes that own parts of this surface and are referenced, not re-planned:
**I** = `install-composition-review-2026-09-03.md` (landed; its `./install`
export follow-up is still queued behind the api-map lane); **T** =
`trpc-flatten-design.md` (steps A and B landed, C and D open); **K** = the
tasks launch interface (`tasks-launch-interface-and-saas.md`); **ID** = the
identity ADR-129 refactor.

## Landed

- **R1–R5** (`793dcd22c4`, "Tier comment-block limits and scope the boundary
  rules to what they guard"): comment-block tiers with the changed-file warn
  print and `src/comment-block-roots.json` (root-keyed, shrink-only,
  expiring); `prisma-boundaries` accepts composition/mount/adapter files in
  applications and enterprise compositions; `api-transport-boundaries` scopes
  the api application to `src/app-trpc/**` and `src/app-rest/**`;
  `eventing-roles` classifies a process manager by `processes/` rather than by
  suffix; `frontend-ui-boundaries` accepts `@langwatch/design-system`,
  `@langwatch/ui-drawer` and `@langwatch/ui-host` as UI platform packages and
  exempts `ui.entrypoint.tsx` from `ui-root-catch-all`.
- **R6** (same commit): `testing.ts` may export a memory/null/stub/fake
  repository or store or a `*.test-fakes.ts` module, and nothing else.
- **R9, first item** (same commit): `legacy-feature-fragment-baseline.json`
  deleted.
- **A4** (`f723164a16`, "Delete the private runtime exports nothing outside
  their package reads"): 43 `private-runtime-export` rows with zero consumers
  deleted outright, plus 5 rows whose only consumers were the owning package's
  own `__tests__` (repointed to relative imports). `private-runtime-export`
  went 99 → 56. `packages/enterprise/features/webhook` was NOT touched — it is
  consumed.

## In progress (a live lane owns these — do not start them)

- **W1/W2** — `packages/ui-host` exists in the working tree, uncommitted, and
  `workflow-web/src/studio-host/` is already gone; `workflow-web`'s `exports`
  map is down from 65 entries to 44. Check with that lane before touching
  `workflow-web`, `design-system` or `ui-host`.

## Open — decisions first

- **R7 — a `rules/<subject>.rules.ts` layout kind.** Not implemented; no
  `rules/` pattern exists in `src/feature-layout.ts`. ~100 of the layout
  violations are pure functions with no home. Alex's ruling requested; see
  decision 1 in `open-decisions-2026-09-03.md`. If refused, L2 folds each
  `.rules.ts` into the service that calls it — the same 100 files, a different
  destination; the slice list does not change.
- **R8 — the boundary edge baseline.** Not implemented; no
  `src/boundary-edge-baseline.json` exists. It must be bootstrapped *after*
  W1–W3 so the `workflow-web` grab-bag never enters it. See decision 2 in
  `open-decisions-2026-09-03.md`.

## Ground rules (unchanged, still in force)

1. **A finding is one of three things.** (a) the code is wrong: fix it, in a
   slice an agent can run without judgement; (b) the rule is wrong or
   redundant: change the rule; (c) the rule is right and the target is out of
   reach this week: a baseline is allowed only when it is **shrink-only, keyed
   by the thing that must go to zero (an edge, a file, a root), fails the gate
   when it grows or expires, and never exempts a changed file**. "Baseline the
   current output and move on" is not one of the three.
2. **Generated shape is fixed, not baselined.** Grab-bag `exports` maps on web
   packages, flat `src/` trees in server packages, re-exported repositories on
   server roots: all category (a).
3. **Repositories never reach a server package's surface.** Not from
   `index.ts`, not from `testing.ts` (§4). The door is an adapter static:
   `PostgresAuthzAdapter.createReader({ database })`.
4. **Comments help read the code.** Over 3 lines is reviewed, 5 is the
   maximum, history goes to an ADR. A JSDoc block is a comment.
5. **Agents move, they do not redesign.** Where a file does not fit the named
   class, the agent reports it and stops; it does not invent a placement.
6. **Diff the violation list, not the total.** Every slice ends with
   `pnpm --filter @langwatch/architecture-lint lint > after.log 2>&1; diff
   <(grep '^\[' before.log) <(grep '^\[' after.log)`; a slice that adds any
   line is not done.
7. The root session runs the typecheck named per slice
   (`pnpm --filter <pkg> typecheck`), never a whole-tree one. Agents run the
   test command named per slice and nothing wider. No `git stash`, `restore`,
   `checkout --`, `reset`, `clean`; commit by explicit pathspec.

## Open code slices

Every slice: fresh `before.log`, the transformation, the named tests, then the
diff in ground rule 6. Import repointing uses `tslsp` rename/move where the
target is a symbol or a file; `vi.mock` path strings are swept by grep
afterwards.

### Enterprise and application wiring

**A1 — apps/api stops depending on enterprise feature packages.** Files:
`apps/api/package.json` (the `enterprise-*` rows), the seven
`apps/api/src/app/*.composition.ts` roots that import them,
`apps/api/src/app-rest/app-rest.process-features.ts`, the three
`apps/api/src/features/enterprise/*.mount.ts`,
`apps/api/src/tasks/openapi-document/openapi-document.surface.ts`;
`packages/enterprise/composition/api/src/**`. Transformation: every
`import … from "@langwatch/enterprise-<f>-server"` / `-contract` in apps/api
moves into `@langwatch/enterprise-api` as a named export of
`EnterpriseApiComposition` (or a sibling file under
`composition/api/src/<feature>/`), and apps/api imports that.
`@langwatch/enterprise-plan-gate` follows the same door. Test:
`pnpm --filter @langwatch/platform-api test:unit run src/app`,
`pnpm --filter @langwatch/enterprise-api test`.

**A2 — apps/worker and the two compositions.** Files:
`apps/worker/package.json`, the ten `apps/worker/src/app/worker-*.composition.ts`
roots, `packages/enterprise/composition/worker/src/governance/governance-ingestion-pull.host.ts`,
`packages/enterprise/composition/api/src/governance/*.adapter.ts`.
Transformation: (1) the governance adapters the worker imports from
`@langwatch/enterprise-api/governance/*` move to
`composition/worker/src/governance/` (or to
`enterprise-governance-server/src/adapters/` when both compositions need
them); (2) apps/worker imports only `@langwatch/enterprise-worker`; (3)
`enterprise-api` adapters that construct core services take them as
constructor parameters typed by the core contract, supplied from
`apps/api/src/app/*.composition.ts`.

**A3 — application leftovers.** (1) `apps/api/package.json`: delete
`"@langwatch/ui": "workspace:*"` (no source import exists). (2)
`packages/enterprise/plan-gate` → `packages/enterprise/features/plan-gate/server`
via `pnpm --filter @langwatch/architecture-lint rename-package`. (3)
`apps/api/src/features/agent-cache/*` → `packages/features/agent/server/src/{repositories/redis,services,transport/api-rest}/`,
errors to `agent-contract`. (4) `apps/api/src/features/evaluation/custom-evaluators.ts`:
the `PrismaClient` parameter becomes the evaluator-server port it actually
needs.

### Repositories off the surface

**A5 — adapter doors for the consumed private exports.** After A4 the
remaining `private-runtime-export` rows are all genuinely consumed. Per name:
find the consumer (an `apps/*/src/app/*.composition.ts` or a feature
transport); read what it builds from the repository; add
`static create<Thing>({ database | clickhouse | redis })` to the feature's
`adapters/<tech>.<subject>.adapter.ts` returning the **service or port-typed
instance** the consumer needed; the consumer calls the static; the export is
deleted. The repository class name never appears outside its package
afterwards. Split by owner: **A5a** trace (the largest cluster), **A5b**
identity + ops + hosted-mcp, **A5c** automation + stored-object + webhook.
Opus. **This is the resume point for the next agent on this plan.**

### Prisma behind the port

**A6 — `PrismaClient` named outside the seam.** Groups: **A6a gateway** (six
`services/*.service.ts`, four `adapters/*.adapter.ts`,
`transport/api-rest/gateway-internal.api.ts`); **A6b auth + enterprise
transport** (auth's two REST apis and two better-auth adapters, governance's
three transports and one service, billing's three services, the enterprise
gateway-debit adapter); **A6c rest** (identity sso-connection backoffice,
trace's two services and its legacy-read repository, evaluation's cost
recorder, dataset's content-backfill task). Transformation: the Prisma calls
move into `repositories/prisma/prisma.<subject>.repository.ts` behind
`ports/<subject>.port.ts` (abstract class, `Port` suffix); the file takes the
port; `adapters/postgres.<subject>.adapter.ts` binds them. Transports take the
service, never the port. Opus.

**A7 — Prisma enums and model types in ports and services.** Identifiers
include `OrganizationUserRole`, `BugReport`, `TeamUserRole`, `Organization`,
`GatewayBudget`, `PricingModel`, `Subscription`, `Currency`, `CostType`.
Transformation: the contract package for that subject declares (or gains) the
zod enum / type; the port or service imports the contract type; the repository
maps Prisma ↔ contract at the seam (a `.mapper.ts` beside the repository when
the mapping is more than a cast). Opus.

**A8 — remaining transport imports after R3.** `hosted-mcp` transports (redis
repository), `ops/transport/api-rest/bug-report.api.ts`, `organization`'s two
transports (generated Prisma), and the ops mount in apps/api. Folded into
A5b/A7 by owner; listed so nothing is dropped.

### Naming

**A9 — fallible-result-naming.** The rule is right and stays. Per method:
`X(): Promise<T | null | undefined>` → `tryX` via `tslsp` rename (renames port,
implementations, callers); the `try*` methods returning a non-nullable drop the
prefix. **Behaviour is not changed**: no throw is added, no `!` is added. If
both `x` and `tryX` exist on one class, the agent stops and reports. **A9a
trace**, **A9b organization + identity + auth**, **A9c ops + gateway + billing
+ the singletons**. Mechanical; independent of R7.

### Feature source layout

Class table the agents apply; a file matching no class is reported, not placed.

| Class | Pattern today | Destination |
| --- | --- | --- |
| A | `api/<x>/<subject>.api.ts` | `transport/api-rest/<subject>.api.ts` (`transport/api-trpc/` when it builds a router) |
| B | `ports/<subject>.repository.ts`, `ports/*.ports.ts`, `ports/*.sink.ts`, `ports/*.service.ts`, `repositories/prisma/*.port.ts` | `ports/<subject>.port.ts` exporting one `abstract class <Subject>Port`; a file holding several interfaces becomes several port files |
| C | `*.schemas.ts`, `*.types.ts`, `*.errors.ts`, `*.constants.ts`, `*.vocabulary.ts`, `*.trpc-context.ts`, `*.wire.ts` | the feature's **contract** package as `<subject>.{queries,commands,errors}.ts`; server-only error classes stay as `<subject>.errors.ts` **in the contract** (the client presentation registry needs the code) |
| D | pure functions: `*.rules.ts`, `*.canonicaliser.ts`, `*-guards.ts`, `*-id.ts`, `*.codec.ts`, `*.policy.ts`, `query-builders/*`, `clickhouse/*translator.ts`, `crypto/*`, `*.tripwire.ts`, `*.resolver.ts` | `rules/<subject>.rules.ts` (R7); if R7 is refused, private methods of the calling service |
| E | `*.openapi.ts`, `*.routes.ts`, `*.gates.ts`, `*.read-back.ts`, `*.error-handler.ts`, `*.tools.ts` and friends under `transport/<surface>/` | folded into the `<subject>.api.ts` they serve (private functions), or class C/D when they are schema or pure |
| F | flat `src/<x>.service.ts` / `.repository.ts` / `.ts` | `services/`, `repositories/<tech>/<tech>.<subject>.repository.ts`, `stores/`, `adapters/<tech>.<subject>.adapter.ts` by what the file is |
| G | `stores/*.bag.ts`, `repositories/clickhouse/*.{row,types,codec}.ts`, `repositories/*-parser.ts`, `*.clickhouse.mapper.ts` | `repositories/<tech>/<tech>.<subject>.mapper.ts` (a bag is the in-memory collector → `stores/memory/memory.<subject>.store.ts`) |
| H | `jobs/*.job.ts`, `workers/*.contribution.ts`, `adapters/*.{installer,command,registry,runtime}.ts`, `*.generated.ts` in services | `tasks/<subject>.task.ts`, `adapters/<tech>.<subject>.adapter.ts`, `intents/<subject>.intent.ts`; generated files move under `generated/` |

**L1 — classes A, B, C, G across all packages + the `feature-source-subject`
renames.** **L2 — class D, after R7** (split L2a trace, L2b analytics +
metric, L2c identity + rest). **L3 — identity's flat tree, class F**
(coordinate with ID: ID owns the projections and processes; L3 owns placement
only). **L4 — analytics, classes F/H.** **L5 — langy streaming, ops flat,
stored-object adapters, organization/dataset helpers, class E transport
folds.** **L6 — `hosted-mcp/server` has no `services/<subject>.service.ts`;
`trace/contract/src/trace-list.repository.ts` is a repository interface in a
contract.**

### Service quality

**Q1 — line length only.** Split the string or expression at the natural seam;
oxfmt does not wrap strings. **Q2 — longest method only.** Extract private
methods at the existing blank-line seams; no behaviour change; the extracted
names are nouns of what the block computes. Opus. **Q3 — module length.** Add
each file at `max(default, current)` to `service-quality-baseline.json` — the
rule's own instruction — and open one split lane per file over 900 lines.
`experiment-run-orchestrator.service.ts` (3,956 lines) is the `mv` Alex asked
for, so its split is a separate decision, not part of this burn-down.

### Web packages

**W1 — `workflow-web` grab-bag → `@langwatch/design-system`** (components,
three hooks, the `utils/*` helpers, two `ui/elements/*`). `git mv` keeping file
names, add the export row on `design-system`, repoint every consumer, delete
the row from `workflow-web`. Anything in the moved set that imports tRPC, the
router, or a feature package is **not** design-system material and goes to W2.
**W2 — `studio-host/*` → `packages/ui-host`.** *In progress in the working
tree.* **W3 — `workflow-web/model/prisma-types` and the remaining export
rows.** Each consumer's Prisma type becomes the contract type for that subject
(same table as A7).

**A12 — private layout in three web packages** (enterprise billing-web,
enterprise licensing-web, navigation-web): `model/`, `behavior/`,
`ui/{elements,blocks}/`. **A13 — layer direction**: a `ui/elements/*` or
`ui/blocks/*` file importing `../../behavior/*` moves to `ui/sections/`; the
three `behavior/*` files importing `ui/*` return data and let the caller render
(CLAUDE.md "hooks never return JSX"). **A15 — package cycles, after W1–W3**:
re-run the lint; cut one edge per surviving cycle. **A16 — screens using
browser capabilities directly**: the value comes from the host object the
provider fold left behind. **A17 — apps/ui feature-to-feature imports and
`react-router` in features**: `chrome`, `drawers`, `navigation` move to
`apps/ui/src/ui/` or reach consumers through `uiPage`.

**A18 — cross-feature server→server edges.** Per edge: if the import is a type
(port or result), the abstract capability moves to the target's contract and
the dependency becomes `-contract`; if it is a service class value, the
importer takes it as a constructor parameter typed by the contract and the
composition root supplies it. **A18a** read-side edges, **A18b** the rest.

**A19 — the singletons.** `architecture-record` (three packages lack `adrs/`);
`test-quality` (5 sites); `strict-port-module` (two ports become
`abstract class …Port`); `layer-class`; `overload-by-literal`
(`use-public-env.ts` → two hooks); `ui-surface-closure` (prompt-web);
`ui-web-screen-leakage`; `ui-web-public-boundary-leakage`;
`api-transport-builder` (`otlp-path-alias.api.ts` is a path-rewrite
middleware, not an endpoint — it moves to
`apps/api/src/app/api-trace-ingest.composition.ts`).

### Held for their owners

`eventing-durable-event-path` and `eventing-process-purity` in
`identity/server/src/{projections,processes}` → ID. `application-layout`
(`apps/tasks`) → K adds `{ path: "tasks", name: "@langwatch/tasks", role:
"tasks" }` to `APPLICATION_PACKAGES`. `ui-screen-owner` /
`ui-screen-declaration` / `ui-web-capability-declaration` and the `./drawers`
and `/chrome` export rows → the `./install` export queued behind the api-map
lane. Edge baseline entries → the surfaces design.

## Ruling: repositories and `testing.ts` (in force, implemented as R6)

**A test-only entrypoint may export doubles, never a real repository.**
`testing.ts` is a package surface like `index.ts`; the rule's reason (a
repository reaching a consumer is how the port stops being the seam) does not
weaken because the consumer is a test. Allowed: `repositories/memory/**`,
`stores/memory/**`, `memory.*` / `null.*` / `stub.*` / `fake.*` repositories
and stores, `*.test-fakes.ts`, `fixtures/`. A characterisation suite in another
package that needs real persistence gets it the way production does, through
the adapter door — `PostgresLangyAdapter.createConversationService({ database })`
— which returns the service or port-typed instance, never the repository class.
A suite that genuinely needs the concrete class lives in the owning package and
imports it by relative path.

## Order and dependencies

```
 now                          next                          after
 ─────────────────────────    ──────────────────────────    ─────────────────────────
 A5a A5b A5c adapter doors    A6a A6b A6c  PrismaClient
 (resume point)               A7  enum/model → contract
                              A8  (folded)
 A1 api enterprise door ─┐
 A2 worker + compositions ┴─▶ A3 leftovers, plan-gate
 R7 rules/ (DECISION) ─▶ L1 classes A,B,C,G ──▶ L2a L2b L2c rules/ ──▶ L3 identity (with ID)
                                                                    ──▶ L4 analytics
                                                                    ──▶ L5 rest, L6 singles
 A9a A9b A9c try* renames   (independent of R7; after L1 so paths are final)
 Q1 line length ──▶ Q2 methods ──▶ Q3 ratchet + split lanes
 W1 design-system ──▶ W2 ui-host (IN PROGRESS) ──▶ W3 prisma-types
                                                └──▶ R8 edge baseline (bootstrap)
                                                └──▶ A15 cycles
 A12 web layout, A13 layers  (independent of W)
 A16 screen capabilities, A17 apps/ui features
 A18a A18b server edges      (after A5, A6: same files)
 A19 singletons              (any time)
 C0 branch's blocks ──▶ C1 apps ──▶ C2 servers ──▶ C3 webs + contracts ──▶ C4 shared ──▶ C5 sdks/mcp/tools
```

A4 before A5 kept the door work to the consumed names only, which it did. L1
before L2 so `rules/` moves start from a tree whose contracts already hold the
schemas the rules import. W1 before R8's bootstrap so the grab-bag never enters
the baseline. C after the structural slice for the same root so comment edits
are not made in files about to move.

## Comment-block burn-down

### What an agent does with one block

Comment-only edits, plus ADR/doc appends. No code moves, no renames. Per block:

1. **History → delete.** "used to", "before #NNNN", "the old", incident
   narrative, the reasoning that led to the current shape. If the paragraph
   records a decision that still governs and no ADR states it, append a dated
   section to the nearest ADR (`packages/features/<f>/adrs/` for a feature,
   `dev/docs/adr/` for repo-wide; never a new ADR number without checking for
   collisions) or to the matching `dev/docs/best_practices/*.md`, and the
   comment becomes one line.
2. **Restating the code or the types → delete.**
3. **The invariant a reader needs to not break the code → keep, ≤3 lines,
   directly above the statement it guards.**
4. **JSDoc on an exported symbol → one summary line.** Examples and long
   parameter prose move to `docs/` for the SDK, or are deleted for internal
   code.
5. **`@scenario` blocks, lint directives, licence and generated headers →
   untouched** (already exempt).
6. **`TODO`/`FIXME` → one line with the issue number, or delete.**

Then `pnpm --filter <package> test` for the touched package (some suites read
source text, so a comment edit can fail a test and that is a real signal) and
the lint diff.

### Waves and slice sizing

200 blocks per slice (≈ 40–60 files). Slice `C<w>.<n>` = the `n`-th 200-block
page of the wave's file list, produced by
`grep '^\[comment-block-size\] <root>' /tmp/comment-blocks-all.log | sed -E 's/:[0-9]+$//' | sort | uniq -c | sort -rn`
(regenerate with `pnpm --filter @langwatch/architecture-lint review:comment-blocks`).
The file list is the slice; the agent does not choose.

| Wave | Roots | Blocks (2026-09-03) | Slices |
| --- | --- | ---: | ---: |
| C0 | the branch's own changed-file set | 671 | 4 |
| C1 | `apps/api` · `apps/worker` · `apps/ui` (the composition roots carry the worst narrative) | 2,564 | 13 |
| C2 | `packages/features/*/server` + `packages/enterprise/features/*/server` | ~6,300 | 34 |
| C3 | `packages/features/*/web` + `*/contract` | ~7,600 | 40 |
| C4 | shared packages (`eventing`, `api`, `group-queue`, `architecture-lint`, `clickhouse-client`, …) | ~1,900 | 10 |
| C5 | `sdks/typescript` · `apps/server` · `mcp` · `skills` · `dev/`, `tools/` | ~1,650 | 9 |
| | | **20,137** | **~110** |

C0 and C1 go first because they are the files this branch and the three
applications own. C2 before C3 because server files are moving in L1–L6 and the
C slice for a root is scheduled right after its L slice. `sdks/` last: it is
published and its blocks are the most JSDoc-shaped.

### Gate behaviour

`pnpm lint` fails on any 6+ block in a changed file, prints 4–5 line blocks in
changed files as review items, and fails on any 6+ block in a root that is not
in `comment-block-roots.json` or whose entry has expired. Each C slice ends by
deleting or lowering its root's entry. **`comment-block-roots.json` was
bootstrapped at 169 package-root entries with expiries `apps/*` 2026-09-17,
`packages/features/*` and `packages/enterprise/features/*` 2026-10-01,
everything else 2026-10-15.** An expired root fails the gate, which is what
turns the schedule into a promise — the first tier expires in two weeks.

The shrink-only growth comparison runs only when a reference file is passed
(`--comment-block-roots-reference` or `--baseline-reference-dir`), which CI
supplies from the merge-base. A plain local `pnpm lint` enforces the tier logic
and per-entry expiry, not growth — matching how the other debt inventories
already behave locally.

## Slice count

Rule slices: 2 left (R7, R8), both waiting on a ruling. Code slices: ~37 open.
Comment slices: ~110. Held for other owners: 4.

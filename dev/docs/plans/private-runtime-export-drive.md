# Private runtime export drive: the migration plan

**Status:** planned, 2026-09-15. Companion to
[`web-package-boundaries-migration.md`](./web-package-boundaries-migration.md)
(the web `cross-feature` drive) — this plan owns the **837
`private-runtime-export` rows** of `boundary-edge-baseline.json`; the 78
web → web and 18 server → server `cross-feature` rows are the other two drives
and nothing here touches them. Every count below was measured on this tree
today; commands in the footnotes. Lane manifests live in
`.claude/manifests/pre-1-*.md` … `pre-18-*.md`.

**The deadline:** all 933 baseline entries expire **2026-10-01** with
`enforceExpiry: true` — 16 days from today. The register may only shrink
(`shrinkCheck` against the merge base); adding entries and moving expiries
later are both refused by the policy itself
(`packages/architecture-enforcer/src/policies/boundaries/boundary-edge-baseline.ts:60-69`).
Postponement is refused and is not proposed anywhere in this plan.

---

## 1. The exact condition that clears a row

A row's key is `private-runtime-export|<entry file>|<specifier>`. The violation
is produced by `lintPrivateServerExportsForEntry`
(`packages/architecture-enforcer/src/policies/feature-layout.ts:629`), which
runs over every **package entrypoint** — `src/index.ts` plus every `.ts`/`.tsx`
target of the package.json `exports` map (`feature-layout.ts:315-329`; this is
why 31 rows name `testing.ts`, one names governance's
`src/__tests__/testing.ts`, and one names langy's
`src/services/langy-turn.service.ts`).

The private-path test, `feature-layout.ts:277`:

```ts
const PRIVATE_SERVER_EXPORT = /(?:^|\/)(?:app|projections|repositories|rules|services|stores)(?:\/|$)/;
```

Within an entrypoint, only **export declarations** are examined, and type-only
ones are skipped up front (`feature-layout.ts:657`):

```ts
if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
```

A violation with `specifier = <module specifier>` is emitted when
(`feature-layout.ts:664-696`):

- `export … from "<spec>"` where the resolved path (relative to `<pkg>/src`)
  matches `PRIVATE_SERVER_EXPORT` (`feature-layout.ts:670-671`) — unless the
  entry is named `testing.ts` **and** the target matches the doubles allowance
  (`TESTING_ENTRY_DOUBLE`, `feature-layout.ts:282`: `repositories/memory/**`,
  `memory|null|stub|fake.*.repository|store.ts`, `*.test-fakes.ts`);
- `export *` / `export * as ns` from a **non**-private file that transitively
  exposes a private runtime value (`fileExposesPrivateValue`,
  `feature-layout.ts:613`) — this is how
  `modules/gateway/process/src/index.ts|./adapters/clickhouse.gateway-open-admissions.adapter.ts`
  fired even though `adapters/` is not in the regex;
- a named list whose elements resolve to private origins — with
  `specifier = the export name` for local `export { X }` lists (the one such
  row: `modules/automation/process/src/testing.ts|AutomationPersistCapService`).

**Therefore a row clears when, on that entry file, no non-type-only export
declaration with that specifier (or that name) resolves — directly or
transitively — into `app/`, `projections/`, `repositories/`, `rules/`,
`services/` or `stores/`.** Concretely: delete the runtime names from the
export (keeping `export type { … }` is always legal — line 657), or stop the
transitive star leak.

**And the baseline entry must then be deleted**, or the run fails anyway: a
fixed edge becomes a *stale* row, its own violation
(`boundary-edge-baseline.ts:56-59` — "Boundary edge baseline entry … no longer
exists. / Delete the stale entry so the checked-in baseline only shrinks.").
Fix + row deletion travel in the same collected commit.

There is **no per-package enforcer mode**: the check is
`pnpm --filter @langwatch/architecture-enforcer lint` (whole workspace,
slot-queued). Lanes therefore verify with `pnpm typecheck:one <pkg>` + per-row
greps; the coordinator runs the enforcer at each collection point.

## 2. The measured anatomy of the 837[^counts]

- **46 server packages** (40 in `modules/`, 6 in `enterprise/modules/`), from
  trace's 136 rows down to six packages with a single row.
- By specifier: **456 `services/`**, **261 `repositories/`**, **67 `rules/`**,
  **44 `app/`**, 4 `stores/`, 2 `projections/`, 2 transitive/other, 1 local
  named export. The brief's framing "index.ts exporting its own repositories"
  under-describes the population: services outnumber repositories 1.7 : 1, and
  the `rules/` rows are largely constants and pure functions, a different fix.
- By entry file: 806 on `src/index.ts`, 30 on a `testing.ts` entry, 1 on a
  langy `services/` subpath entry.

### Classification: deletion vs seam[^classify]

Each row was classified by whether any file **outside the owning package**
imports one of the row's runtime binding names from that package's entrypoint
(root and subpath imports both scanned; no namespace imports of these packages
exist anywhere):

| Class | Rows | Meaning | Job |
|---|---|---|---|
| DELETE | 569 | no external importer of any runtime name on the line | delete the runtime names (keep `export type` members); re-check self-imports[^self] |
| TYPE-ONLY | 5 | external usage is type-position only | convert to `export type { … } from`, flip importers to `import type` |
| VALUE-USED | 256 | ≥1 external file constructs/calls the binding | seam work: importer rewired through the package's factory, then export deleted |
| GONE | 7 | export already absent in this working tree (live lanes / recent commits) | baseline row deletion only — coordinator |

The classifier is a regex approximation of the TS graph. **Every lane
re-verifies each row before acting**: grep the runtime names repo-wide (the
manifests give the command) — a hit outside the package moves the row to
seam handling; zero hits proves the deletion safe.

The 256 VALUE-USED rows concentrate in exactly the places the house rule says
they should not exist: **63 files under `apps/`** (worker process compositions
above all, then the tasks catalogue and backfills, then two api platform
files), **12 files under `enterprise/packages/composition/`** (the enterprise
composition root), 4 other-feature server files, and ~55 test files. 145
importer files in total.[^importers]

## 3. The fix pattern, worked on real packages

### 3a. Pure deletion — `modules/auth/process` (8 rows, verified end to end)

`src/index.ts` exports `AuthApp`, `SignUpVerificationService`,
`CliDeviceSessionService`, `Auth0PasswordService`, four repository classes and
more from `app/`, `services/`, `repositories/`. Grepping each runtime name
across `apps modules enterprise packages` finds **zero references outside
`modules/auth/process`**[^authgrep] — the module's own installer wires them
internally through relative imports. Fix: remove the runtime names from those
export lines; where a line mixes types (`export { AuthApp, type
AuthInfrastructure } from "./app/auth.app.ts"`), the surviving form is
`export type { AuthInfrastructure } from "./app/auth.app.ts"`. Eight rows
clear; nothing else in the repo changes.

### 3b. Single seam — `modules/user/process` + `apps/tasks` (1 row)

`GdprUserDataEraseRepository` (from `repositories/prisma/…`) is imported by
`apps/tasks/src/tasks.catalogue.ts:26` and constructed at `:92` as
`GdprUserDataEraseRepository.create({ database: host.requirePrisma() })`. The
same barrel line's neighbours `runGdprUserDataErase` / `UserDataEraseTask` come
from `./tasks/user-data-erase.task.ts` — and `tasks/` is **not** a private
segment. Fix: the task file (already legal surface) gains the factory — e.g.
`createGdprUserDataEraseRunner({ database })` building its repository
internally — the catalogue calls it, and the repository export is deleted. The
private class never crosses the boundary again; the composition root names no
repository class (the standing house rule).

### 3c. Type-only — `enterprise/modules/billing/process` (1 of 5 such rows)

`BillingSubscription` (a class in `repositories/subscription.repository.ts`)
is only ever used in type position outside billing. `export type {
BillingSubscription } from …` clears the row (line 657's bypass); the
importers switch to `import type`.

### 3d. Where the simple patterns do NOT apply

- **Process-graph compositions** (trace 44 V-rows, governance 35, automation
  22, model-provider 16, scenario 12…): `apps/worker/src/app/*.composition.ts`
  and `enterprise/packages/composition/**` construct dozens of a feature's
  services/repositories with process substrates (Prisma, ClickHouse, Redis,
  eventing stores). A per-class factory would rename the problem, not fix it.
  These need a **designed** factory per feature — one exported build function
  in a non-private file (`src/<feature>.composition.ts` or similar) taking the
  substrates and returning the feature's contribution behind interface types
  (`export type` from private paths is legal glue). This is the seam the
  service-repository-adapter-port doc and the annotation reference both point
  at; full annotation conversion is out of scope, the factory is the
  incremental step.
- **`rules/` constants and pure functions that are really contract**
  (`WEBHOOK_DELIVERY_PROCESS_NAME`, `settlementGraceMs`,
  `TEST_FIRE_TRIGGER_ID_SENTINEL`, `eventMatches`,
  `trimAttributesForAnalytics`, `resolveSpanCommandShardCount`, error classes
  like `ClickHouseUnavailableError`): a factory for a constant is absurd.
  The correct fix is **relocation to a legal home** — the module's contract
  package when it is genuinely cross-feature vocabulary, otherwise a
  non-private server file. Relocation is allowed *narrowly*: constants, error
  classes, pure predicate/derivation functions. Moving a service or repository
  out of its directory to dodge the regex is forbidden.
- **Repository registries** (`traceRepositories`, `webhookRepositories`,
  `PostgresScenarioRepositories`): the annotation reference is explicit that
  the bundle stays private ("Repositories are never exported from
  `index.ts`"). Compositions receive the *built* bundle from the feature's
  factory instead of building it themselves.
- **`testing.ts` rows** (30): the entry may keep doubles
  (`TESTING_ENTRY_DOUBLE`), so `memory.*.repository.ts` exports are already
  legal — the flagged rows export *real* repositories and services to other
  packages' tests (langy 11, governance 9, trace 4, analytics 1, gateway 1,
  automation 1). Fix per row: export the memory/fake double instead, or give
  the consuming test what it actually needs through the factory, or move the
  test into the owning package. Judgement, not sweep.
- **Cross-drive overlap, named**: `modules/auth/process/src/app/better-auth.build.ts`
  imports identity's `SignInMethodPolicyService`, and `auth → identity-server`
  is one of the 18 server `cross-feature` rows owned by the other drive. That
  drive closing the edge behind a port removes the import; our identity row
  then becomes a pure deletion. The pre-1 lane must coordinate through the
  coordinator rather than invent a second seam. (The other three
  module-to-module composition imports — organization→entitlement,
  gateway→webhook/analytics, monitor→analytics/evaluator — are *not* among
  the 18 and stay in this drive.)

### 3e. Forbidden workarounds (each "clears" the checker and betrays the rule)

1. **No new `exports`-map subpaths into private directories.** The rule only
   reads export declarations, so a package.json key like
   `"./composition/x": "./src/repositories/prisma/x.repository.ts"` silences
   it — `modules/gateway/process` already carries several such keys and
   `worker-gateway-spend.composition.ts` deep-imports one. That precedent is
   grandfathered, not license; a lane adding one has failed the lane.
2. No re-export shims "for backwards compatibility"; importers are updated
   directly (CLAUDE.md doctrine).
3. No `as X` casts or `@ts-ignore` to survive a type break; no renaming domain
   concepts in flight.
4. No edits to `packages/architecture-enforcer/**` or
   `packages/oxlint-rules/**` — the policy code is another live lane's
   territory, and changing the regex is a policy decision (§6), not a fix.

## 4. Baseline-row deletion protocol

`packages/architecture-enforcer/src/boundary-edge-baseline.json` is one shared
file inside a directory a live lane (web-1) owns, and every lane's fixes
require deletions from it. **No lane edits it.** Each lane's handoff lists the
exact keys it cleared; the coordinator deletes those rows serially at each
collection, in the same commit as the lane's collected diff (a fix without its
row deletion fails `boundary-edge-baseline-stale`, `boundary-edge-baseline.ts:56`;
a row deletion without its fix fails nothing but lies). The 7 GONE rows are
deleted at the first collection that includes the live-lane work that cleared
them.

## 5. Lanes

Two kinds. **Package lanes** own their feature packages: they clear DELETE and
TYPE-ONLY rows immediately, and for VALUE-USED rows they build the factory
seam *while keeping the old exports alive* (still baselined until 10-01),
publishing a rewire map (old import → seam call) in the handoff; when the
coordinator confirms every importer of a given export has been rewired, the
same lane deletes the export, clearing the row. **Rewire lanes** own disjoint
sets of `apps/**` importer files and apply the published maps; they clear no
rows themselves. Importer files that live inside a module (experiment's
workflow-using services, gateway.app's webhook import, tests) are rewired by
the lane owning that module, gated on the exporting lane's seam.

Waves: wave 1 = pre-1 … pre-11 in parallel (all free today); pre-12/13/14
start when their blockers lift; wave 2 = pre-15/16/17 as seams land; wave 3 =
pre-18 last. Models: sonnet where the work is verified deletion sweeps plus
small pattern-following seams; opus where a real composition seam must be
designed.

| Lane | Model | Packages (owned globs) | Rows | D/T/V | Blockers |
|---|---|---|---|---|---|
| pre-1 identity-organization-auth | sonnet | modules/{identity,organization,auth}/server | 92 | 89/0/3 | identity's auth-row: coordinate with server cross-feature drive (§3d) |
| pre-2 langy | sonnet | modules/langy/process | 58 | 51/0/7 | — |
| pre-3 ops-authz-log-metric | sonnet | modules/{ops,authz,log,metric}/server + modules/share/process (rewire-only) | 67 | 53/0/14 | log/metric V-rows are consumed only by worker-production (pre-18 gates their deletion); share's test rewire gates on this lane's own authz seam; log's trace-importing test waits on pre-14 |
| pre-4 experiment-cluster | sonnet | modules/{experiment,prompt,topic,coding-agent,github,presence,agent}/server | 58 | 45/0/13 | experiment/coding-agent phase-2 rewires wait on pre-8 (workflow) and pre-14 (trace) seams |
| pre-5 evaluation-model-provider | opus | modules/{evaluation,model-provider,evaluator}/server | 46 | 19/1/26 | evaluation's workflow-importing service waits on pre-8 |
| pre-6 automation-notification | opus | modules/{automation,notification}/server | 44 | 17/0/27 | — |
| pre-7 gateway-webhook | opus | modules/{gateway,webhook}/server | 42 | 30/0/12 | gateway.app's analytics import waits on pre-8 |
| pre-8 analytics-workflow | opus | modules/{analytics,workflow}/server + modules/{monitor,dashboard}/server (rewire-only) | 45 | 32/0/13 | monitor build's evaluator import waits on pre-5 |
| pre-9 dataset-stored-object | sonnet | modules/{dataset,stored-object}/server | 36 | 21/0/15 | — |
| pre-10 small-tails | sonnet | modules/{api-key,entitlement,data-privacy,platform-health,user,role,hosted-mcp,feature-flag,data-retention}/server | 35 | 23/0/12 | — |
| pre-11 enterprise | opus | enterprise/modules/{governance,billing,licensing,sso,scim,managed-provider,audit-log}/server + enterprise/packages/composition/** | 120 | 71/1/48 | composition rewires of webhook names wait on pre-7 |
| pre-12 project | sonnet | modules/project/process | 10 | 4/0/6 | **BLOCKED**: uncommitted work in this checkout under modules/project/process |
| pre-13 scenario-suite | opus | modules/{scenario,suite}/server | 41 | 25/0/16 | **BLOCKED**: live idempotency lanes own both trees |
| pre-14 trace | opus | modules/trace/process | 136 | 89/3/44 | **BLOCKED**: a different human's session owns modules/trace |
| pre-15 rewire-tasks-api | sonnet | apps/tasks importer files, 3 apps/api files, prisma seed | 0 | rewires only | seams: pre-1,3,5,8,9,10,11,12,13 |
| pre-16 rewire-worker-trace | sonnet | the ~28 apps/worker files that import trace/scenario/suite | 0 | rewires only | seams: pre-4,5,6,8,9,13,**14** |
| pre-17 rewire-worker-platform | sonnet | every other apps/worker importer file except worker-production* | 0 | rewires only | seams: pre-1..pre-11 as each lands |
| pre-18 rewire-worker-production | opus | worker-production.composition.ts + its 2 tests | 0 | rewires only | seams from **17 packages** — last lane standing |
| coordinator | — | boundary-edge-baseline.json (serialized), GONE rows | 7 | 0/0/0 +7 stale | web-1 lane owns the directory |

Row coverage: 92+58+67+58+46+44+42+45+36+35+120+10+41+136 = 830 in package
lanes, +7 coordinator = **837**. (Each manifest also *lists* its packages'
GONE rows so nothing is invisible; acting on them stays the coordinator's.) Rewire lanes own zero rows by design — every
row belongs to exactly one package lane, so none is orphaned by a rewire lane
failing; it is merely delayed.

## 6. Every row mapped

Each row's key names its package; each package belongs to exactly one lane.
The per-package totals (D/T/V/G as measured today[^classify]):

| Package | Rows | D | T | V | G | Lane |
|---|---|---|---|---|---|---|
| modules/trace/process | 136 | 89 | 3 | 44 | 0 | pre-14 |
| modules/identity/process | 64 | 61 | 0 | 2 | 1 | pre-1 (G→coord) |
| enterprise/modules/governance/process | 60 | 25 | 0 | 35 | 0 | pre-11 |
| modules/langy/process | 58 | 51 | 0 | 7 | 0 | pre-2 |
| modules/ops/process | 52 | 45 | 0 | 7 | 0 | pre-3 |
| enterprise/modules/billing/process | 44 | 34 | 1 | 9 | 0 | pre-11 |
| modules/automation/process | 34 | 12 | 0 | 22 | 0 | pre-6 |
| modules/scenario/process | 30 | 18 | 0 | 12 | 0 | pre-13 |
| modules/experiment/process | 27 | 25 | 0 | 2 | 0 | pre-4 |
| modules/model-provider/process | 27 | 9 | 1 | 16 | 1 | pre-5 (G→coord) |
| modules/analytics/process | 24 | 18 | 0 | 6 | 0 | pre-8 |
| modules/gateway/process | 22 | 16 | 0 | 6 | 0 | pre-7 |
| modules/organization/process | 22 | 20 | 0 | 1 | 1 | pre-1 (G→coord) |
| modules/stored-object/process | 22 | 13 | 0 | 8 | 1 | pre-9 (G→coord) |
| modules/workflow/process | 21 | 14 | 0 | 7 | 0 | pre-8 |
| modules/webhook/process | 20 | 14 | 0 | 6 | 0 | pre-7 |
| modules/evaluation/process | 17 | 8 | 0 | 9 | 0 | pre-5 |
| modules/dataset/process | 15 | 8 | 0 | 7 | 0 | pre-9 |
| modules/suite/process | 12 | 7 | 0 | 4 | 1 | pre-13 (G→coord) |
| modules/api-key/process | 11 | 7 | 0 | 4 | 0 | pre-10 |
| modules/notification/process | 10 | 5 | 0 | 5 | 0 | pre-6 |
| modules/project/process | 10 | 4 | 0 | 6 | 0 | pre-12 |
| enterprise/modules/licensing/process | 9 | 5 | 0 | 3 | 1 | pre-11 (G→coord) |
| modules/coding-agent/process | 9 | 8 | 0 | 1 | 0 | pre-4 |
| modules/topic/process | 9 | 7 | 0 | 2 | 0 | pre-4 |
| modules/auth/process | 8 | 8 | 0 | 0 | 0 | pre-1 |
| modules/entitlement/process | 8 | 4 | 0 | 4 | 0 | pre-10 |
| modules/authz/process | 7 | 4 | 0 | 3 | 0 | pre-3 |
| modules/github/process | 7 | 2 | 0 | 5 | 0 | pre-4 |
| modules/data-privacy/process | 6 | 3 | 0 | 3 | 0 | pre-10 |
| modules/log/process | 5 | 3 | 0 | 2 | 0 | pre-3 |
| modules/platform-health/process | 5 | 5 | 0 | 0 | 0 | pre-10 |
| enterprise/modules/scim/process | 3 | 3 | 0 | 0 | 0 | pre-11 |
| enterprise/modules/sso/process | 3 | 2 | 0 | 0 | 1 | pre-11 (G→coord) |
| modules/evaluator/process | 3 | 2 | 0 | 1 | 0 | pre-5 |
| modules/metric/process | 3 | 1 | 0 | 2 | 0 | pre-3 |
| enterprise/modules/managed-provider/process | 2 | 1 | 0 | 1 | 0 | pre-11 |
| modules/agent/process | 2 | 2 | 0 | 0 | 0 | pre-4 |
| modules/presence/process | 2 | 1 | 0 | 1 | 0 | pre-4 |
| modules/prompt/process | 2 | 0 | 0 | 2 | 0 | pre-4 |
| enterprise/modules/audit-log/process | 1 | 1 | 0 | 0 | 0 | pre-11 |
| modules/data-retention/process | 1 | 1 | 0 | 0 | 0 | pre-10 |
| modules/feature-flag/process | 1 | 1 | 0 | 0 | 0 | pre-10 |
| modules/hosted-mcp/process | 1 | 1 | 0 | 0 | 0 | pre-10 |
| modules/role/process | 1 | 1 | 0 | 0 | 0 | pre-10 |
| modules/user/process | 1 | 0 | 0 | 1 | 0 | pre-10 |
| **Total** | **837** | **569** | **5** | **256** | **7** | |

A lane regenerates its exact row list from the baseline with the one-liner in
its manifest; the seven G rows are listed by key in §4's coordinator note and
in the manifests of the lanes whose packages they name.

## 7. Sequencing constraints (live right now, in this checkout)

- `modules/trace/**` — a different human's session. pre-14 (136 rows, the
  largest lane) and every pre-16 rewire of a trace-importing composition wait.
  **This is the drive's critical path**: if trace is not free by ~2026-09-22,
  its 136 rows plus the trace-gated rewires cannot land by 10-01.
- `modules/suite/**`, `modules/scenario/**` — live idempotency lanes. pre-13
  waits; one suite GONE row is already theirs.
- `packages/architecture-enforcer/**`, `packages/oxlint-rules/**` — the web-1
  declaration-seam lane. Nobody here edits either; all baseline deletions go
  through the coordinator, sequenced against web-1's own edits to the same
  directory.
- `modules/project/process/**` — uncommitted work sits in this checkout (also
  flagged by the web plan §8). pre-12 starts only after the coordinator
  collects or clears it.
- The `pnpm build` greening lane — unknown paths; the coordinator sequences
  collections so its diffs and ours never interleave within a commit.

## 8. Feasibility, stated honestly

The arithmetic: 574 rows (DELETE + TYPE-ONLY) are verified-mechanical and
parallelise across ten free lanes — at the concurrency this checkout has been
sustaining (4-6 lanes with coordinator collection between waves) that mass
lands comfortably inside the first week. The 256 VALUE-USED rows are a
different animal: ~20 real factory seams, 145 importer files, and a final
serialized rewire of `worker-production.composition.ts` against 17 packages'
new seams. That half fits in the remaining ~9 days **only if all three of
these hold**: (1) `modules/trace` is released by its owner by ~09-22, (2) the
scenario/suite idempotency lanes land this week, and (3) opus lanes pre-5/6/7/8/11
produce seams the rewire lanes can apply without redesign. Any one failing
strands 40-180 rows past the expiry.

If the owners judge those conditions unlikely, the coherent move is the one
the web plan already flagged (§4E of the options analysis, restated in
`web-package-boundaries-migration.md` §6): the enforcer's owners **split
`private-runtime-export` into its own register with its own reviewed dates
assigned at creation** — a deliberate new policy decision made once, by the
policy's owners, not a postponement of the existing rows. The clean cut, if
taken: the 574 mechanical rows stay on the current register and are cleared by
this plan's wave 1 regardless; only the seam-requiring remainder moves to the
new register with dates that reflect designed work. The decision point is
**2026-09-22**: wave 1 collected, trace's status known, seam velocity
measured. This plan proposes no change to any existing row's expiry under any
outcome.

## 9. Deliberately not in this pass

- **The 78 web → web and 18 server → server `cross-feature` rows** — the other
  two drives own them; the single overlap (auth → identity) is coordinated,
  not duplicated (§3d).
- **Annotation-shape conversion** of any module. The factory seam is the
  incremental step the conversion later subsumes; no lane converts a module.
- **Closing the exports-map loophole** (`packageEntrypoints` not flagging a
  subpath that aliases a private file). It should be closed — gateway's
  `./composition/*` keys and langy's `./services/*` keys walk through it —
  but that is enforcer work in a directory another lane owns. Logged for the
  enforcer owners; lanes are merely forbidden to widen it (§3e).
- **Deleting the grandfathered deep exports** (gateway `./composition/*`,
  langy's service subpaths, licensing `/seeding`). Removing them needs its own
  importer sweep; out of scope, and no current baseline row names them.
- **The worker `app/*.composition.ts` layer itself.** Rewiring it to call
  factories leaves it in place; folding it into worker feature installers is
  the follow-up the module conversion owns.
- **Test-architecture cleanups** beyond what row-clearing forces (e.g. moving
  cross-package integration tests into their owning packages wholesale).
- **`services/langy-turn.service.ts` as an entrypoint** and langy's broad
  subpath surface: only its one flagged row is fixed; rationalising langy's
  export map is separate work.

---

[^counts]: `python3 -c "import json,collections;d=json.load(open('packages/architecture-enforcer/src/boundary-edge-baseline.json'));e=[x['key'] for x in d['entries']];import re;pre=[k for k in e if k.startswith('private-runtime-export|')];print(len(e),len(pre));print(collections.Counter(k.split('|')[1].split('/src/')[0] for k in pre))"` → 933 entries, 837 private-runtime-export, 46 packages. Specifier buckets: same file, categorize `k.split('|')[2]` by first private segment → services 456, repositories 261, rules 67, app 44, stores 4, projections 2, other 2, named 1. Expiry: every entry `2026-10-01`; policy `enforceExpiry: true` (`boundary-edge-baseline.ts:45`).

[^classify]: Method: (1) parse every flagged package's `exports` map to resolve subpath → entry file; (2) scan every git-tracked `*.ts`/`*.tsx` for `import [type] { … } from "@langwatch/<pkg>[/subpath]"`, keeping named bindings and whether the import is type-only, excluding files inside the owning package; (3) for each row, resolve the export declaration's runtime names (star exports resolved through the target file's declarations) and intersect with the external imports of that entry. Namespace imports of these 46 packages: zero, so named-intersection is complete. Full script preserved in the coordinator handoff; re-run reproduces 569/5/256/7.

[^self]: 18 of the 46 packages also import their **own** barrel by package name (trace 28 files, langy 14, scenario 10, evaluation 9, gateway 6, …). A deletion that breaks a self-import is fixed in the same lane by switching that file to a relative import — mechanical, inside the lane's own glob.

[^importers]: Importer-file census over the VALUE-USED rows: 145 files — 63 `apps/` production files (worker compositions dominate; `worker-production.composition.ts` alone imports private names from 17 packages), 17 `apps/` test files, 12 `enterprise/packages/composition/` files, 4 other-feature server production files, ~49 module test files. The full file→packages table is in the coordinator handoff and each manifest carries its slice.

[^authgrep]: `for n in AuthApp AuthUnavailableError SignUpVerificationService PrismaAuthDirectoryRepository CliDeviceSessionService Auth0PasswordService; do grep -rln --include='*.ts' --include='*.tsx' "\b$n\b" apps modules enterprise packages | grep -v '^modules/auth/process'; done` → empty.

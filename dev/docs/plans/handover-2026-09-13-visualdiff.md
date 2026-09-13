# Drive: get `visualdiff` to report a visual and usage diff against `origin/main`

Written 2026-09-13, end of the visualdiff session. Companion to
`handover-2026-09-12-apidiff-4.md`, which covers the same night from the API
side; the two drives ran in parallel in one checkout and coordinated over a
channel throughout.

Branch `feat/strict-feature-layout-v0`. Read that file's **pattern list** first —
it is the most transferable thing either of us produced.

## The verdict, stated plainly

**Neither application process boots on this branch, so visualdiff cannot produce
a report and apidiff cannot probe.** That is not a tooling problem and no amount
of work on either tool changes it.

- `apps/api` — stops at `MissingMemberError: Module "model-provider" reads the
  "credentials" member` (apidiff's wall 8). Its recovery is a 266-line deleted
  composition plus a decision about where the codec belongs.
- `apps/worker` — stops on the first of **26** value imports that cannot resolve
  at ESM link time.

  > **A number in an earlier draft of this file was wrong.** It said 163. That
  > was my own detector over-reporting, in three ways, and it is worth reading
  > before trusting any count in this document. (1) The `@langwatch/` scope is
  > not the same as "in this workspace": `@langwatch/ksuid` and friends are
  > published catalog dependencies whose exports live in node_modules, so every
  > import of one read as absent — about 111 of the 163. (2) The declaration
  > pattern allowed `declare`, `abstract`, `class`, `const`, `function` and
  > `enum`, but not `async`, so every `export async function` read as
  > undeclared. (3) A two-word name stripped of its last word left a one-word
  > stem that matched every symbol in its module, turning a proposal into a
  > 300-name dump. 163 -> 52 -> 26. Both false-positive classes are now
  > fixtures in the detector's self-test.
  >
  > A detector that over-reports costs a lane exactly what one that
  > under-reports costs it. This one nearly sent someone to work through 137
  > defects that were not there.

visualdiff needs BOTH: haven's backend lane runs the api and the worker in one
process (CLAUDE.md, "Two local processes, no switch"), so either failure takes
the lane down, the stack never reaches ready, and the run times out with nothing
captured. The `-no-haven` path does not rescue it — that path still needs the
candidate's api.

**So the next action for this drive is not a visualdiff flag. It is the worker
and api composition lane.** `.claude/manifests/worker-composition-green.md`
already exists and is the right home for it.

## What was cleared, in order

Each wall was invisible until the one before it was fixed. This is the
single most important property of the whole night: **every one of them was
hidden behind an earlier one**, so no amount of static review would have
enumerated them in advance.

1. **The portless CA.** Three handovers recorded "a person must run
   `security add-trusted-cert`" as a hard blocker. Not true: `portless trust`
   does it non-interactively and exits 0, writes `~/.portless/ca.trusted`, and
   haven's `ensureTrusted` then skips the step forever. Nobody needed asking.
2. **`@langwatch/mail` would not build** — `ensure-built.mjs` builds THREE
   packages (`langwatch`, `@langwatch/mcp-server`, `@langwatch/mail`), so gate 1
   opening on the SDK was necessary but not sufficient. Fixed in `f754346275`
   with the coupled `copy-types.sh` half; see "the 3 -> 134 trap" below.
3. **110 extensionless relative imports** in server source (UNEXTENDED, below).
4. **A stale `exports` entry**: `@langwatch/evaluation-server/workflow-evaluation`
   pointed at `./src/adapters/workflow-evaluation.adapter.ts`, deleted by
   `f054ab2baf`; the symbol lives in `./src/services/workflow-evaluation.service.ts`.
5. **19 interfaces imported in value position**, converted to `import type`.
6. **35 symbols renamed by `f054ab2baf`** — each an interface now, so the fix is
   three coupled edits: rename, `import type`, and `extends` -> `implements`
   with its `super()` removed.

## The four defect classes, and the two detectors that find them

The earlier handover named REPOINT / RENAME / DROPPED WHOLE. This session adds
two more, and both are invisible to `pnpm typecheck`:

**UNEXTENDED** — `from "./agentListing"` with no extension. TypeScript accepts
it; Node ESM under `--experimental-transform-types` does not, and both
`apps/worker` and `@langwatch/dev-runtime` run exactly that way (no bundler).
3,930 exist repo-wide but nearly all are harmless — `sdks/typescript` is bundled
by tsup, `apps/ui` by Vite, tests resolve through vitest. Only server source
boots under Node ESM: 110, all fixed.

**ERASED** — `class X extends Y` where Y is bound type-only, so the binding is
erased and the class definition throws `ReferenceError` at BOOT. Reproduced
directly:

    import { somethingReal, type Broadcast } from "./base.ts";
    class Adapter extends Broadcast { constructor() { super(); } }
    -> ReferenceError: Broadcast is not defined   (at adapter.ts:2:23)

**56 remain**, all in `apps/worker`, behind the 163 link-time failures — they
cannot even be reached yet. `dev/scripts/find-erased-extends.mjs` finds them.

**NOT-EXPORTED** — a third kind, and the one that cost the most to find. A name
the package **declares** but its entry does not **re-export**.
`CodexAccountService` is a real exported class in its own file; its package's
`index.ts` re-exports that file through an explicit `export { … }` list that
omitted it. "Is it declared anywhere" answers yes, and the process still dies
with `does not provide an export named CodexAccountService`. Declared-somewhere
and exported-by-that-package are different questions, and only the second one
decides whether an import links.

Two detectors were left in the tree, both of which **run a self-test before every
scan and refuse to scan if it fails**:

    dev/scripts/find-erased-extends.mjs        56 sites
    dev/scripts/find-unresolvable-imports.mjs  27 sites (24 ABSENT + 3 NOT-EXPORTED),
                                               with a rename proposal per site

**A known gap, not covered by either.** A repository `requires` entry naming a
member that DOES exist but whose type is wrong. `"secrets"` resolves — and hands
the tier the process's `SecretResolver`, whose `read`/`find` is nothing like the
`encrypt`/`decrypt` an endpoint signing secret wants. An unsatisfiable claim
refuses at boot, loudly; a satisfiable claim of the wrong type does not refuse at
all, and surfaces weeks later as customer-visible signature-verification
failures nowhere near the cause. Both detectors ask "does this name resolve"
rather than "does what it resolves to fit", so neither can see it. That is the
third sibling worth writing.

The self-tests are not ceremony, and the record is worth stating plainly because
it is the strongest argument in this document for anything:

- The erased detector's first draft understood only `import type { X }` and
  returned a confident **zero** across 15,003 files. Every real instance used
  the inline `import { …, type X }` spelling.
- The unresolvable detector's first draft reported **163**. Judging published
  catalog packages it cannot see, and a declaration pattern missing `async`,
  accounted for 137 of them.
- Its export-surface pass reported **5,020** on first run — `export *` targets
  resolved to absolute paths while the source map is keyed by the relative
  paths git reports, so every surface came back empty and the whole tree read
  as broken. One `path.resolve` where the map wanted a relative key.

Every one of those numbers was confident, specific and wrong, in both
directions. The fixtures are now the defects each tool missed and the false
positives it produced, and a tool that cannot pass them refuses to run.

## The 3 -> 134 trap — read this before reverting anything

`f754346275` takes `pnpm typecheck` from 3 errors to 134, and a previous session
reverted the identical change on the strength of that number. **It is unmasking,
not breakage**, and the evidence is threefold:

- Both sides exit 1. `pnpm typecheck` does not pass on this branch either way, so
  no gate changes colour.
- All 134 are in `modules/scenario`, none in the files changed; 110 of them are
  dangling `~/` monolith imports.
- `git grep -l 'from "~/' HEAD -- modules/scenario/contract/src/` finds **82
  dangling lines across 22 files at HEAD**, with no edit in the tree. Two added
  contract dependencies cannot author those.

The mechanism: a package's `typecheck` is
`typecheck:declarations --project . && tsc --noEmit`, and the declarations walk
stops at the first unresolvable import. Fix 3 and it reaches 131 more.

**And the larger finding underneath it**: the applications' own `tsc` has never
run. `apps/api` and `apps/worker` both fail the declarations pre-pass, so the
`&&` short-circuits and `tsc --noEmit -p tsconfig.test.json` is never reached —
the "134" is one set of 67 counted once per application. Everything in
`apps/api`, `apps/worker` and `apps/ui` is currently unchecked and reads as
checked. That is why the ERASED and unresolvable-import backlogs could
accumulate at all.

**Run directly, bypassing the `&&`, both applications report in the hundreds:**

    pnpm exec tsc --noEmit -p apps/api/tsconfig.test.json      ->  477
    pnpm exec tsc --noEmit -p apps/worker/tsconfig.test.json   ->  615

    api     71 TS7006 implicit any     61 TS2304 cannot find name
            47 TS2741 missing property 40 TS2307 cannot find module
    worker  64 TS2689 cannot extend an interface   62 TS2741
            59 TS2304  56 TS2353  50 TS7006

**The worker's 64 TS2689 are the ERASED class, confirmed by the compiler**:
`Cannot extend an interface 'AutomationClock'. Did you mean 'implements'?`
That is independent corroboration of what `find-erased-extends.mjs` reports
from the other end — a regex found 56 sites, tsc names 64 of the same shape,
and neither measurement depended on the other. It also settles the question
that had been parked as "a counting exercise": these are real compiler errors,
not a detector's opinion.

That is the standing cost of the short-circuit, and none of it is visible to
`pnpm typecheck` today. Fixing the declarations pre-pass does not just unhide
67 errors in one contract package — it unhides these too, so whoever closes
that chain should expect the number to jump again and should not read the jump
as a regression.

*(A footnote on measuring it, because it caught me twice in one session:
`grep -c "error TS"` over tsc's own output returns **0**, because ANSI colour
codes sit between the two words. Strip them first — `sed 's/\x1b\[[0-9;]*m//g'`
— or the count silently agrees with whatever you hoped.)*

## What visualdiff itself gained

- **Gateway secrets** (`tools/visualdiff/gateway_secrets.go`). The gateway's trio
  is checked all-or-none at 32+ characters and this machine's `.env` carries
  12-character placeholders, which correctly refuses the api's boot. visualdiff
  now substitutes throwaway values **into the copied `.env` of its own worktrees
  only** — never the developer's file, never their data, since haven gives each
  slug a database created and seeded from scratch. Only when a value is absent or
  too short: a present-but-WRONG secret is left alone and its refusal reaches the
  report, because that is a real finding. Both stacks derive from one seed, so a
  substituted secret can never be why two screens differ. Every substitution is
  announced on the run log. Four bound `@unit` scenarios; the feature file reports
  21/21 bound.
  **Owed**: the announcement reaches the run log but not `report.html` /
  `findings.json`, which have no warnings channel. A reader of the report alone
  cannot currently see that a secret was manufactured.
- **Four routes added** to `visualdiff.yaml` — see the route-surface finding below.

## The route-surface gap — the one parity finding that landed

Full method and results in `dev/docs/plans/route-surface-parity-2026-09-12.md`.

Four addresses `origin/main` serves as real pages have no page, no contributed
route and no redirect on this branch, so they fall through to the catch-all and
404: **`/governance/agents`, `/governance/analytics`, `/governance/insights`,
`/governance/signals`**.

This class is invisible to both tools — not a documented API operation, so
apidiff cannot see it; not in `visualdiff.yaml`, so visualdiff was not rendering
it. They are now in the route list. Whether they were retired deliberately is a
governance decision nobody has recorded; elsewhere on this branch a retired
address got a redirect entry (`/me/devices`, `/ops/queues`) rather than a 404.

That file also lists **sixteen addresses that redirect by design** and will
classify as `changed` in any visualdiff report. Read it before triaging one.

## Exact next actions

1. **The composition lane.** `node dev/scripts/find-unresolvable-imports.mjs`
   gives **26** sites with a proposal each. They are not 26 separate problems:

       14  *TrpcApi symbols across three enterprise trpc compositions — one
           cluster, almost certainly one cause
        2  createTrpcService
        2  featureFlagService
        1  startStandaloneApi  — the backend lane's api half, see below
        7  individual renames, each with a candidate the tool proposes

   Each wants a decision — rename, repoint, or port from
   `git show b383462d96^:<path>`. The tool prints "nothing declared; port it
   from history" when it has no candidate, which is the honest answer rather
   than a guess.

   **`startStandaloneApi` is the one that matters most for visualdiff.**
   `tools/dev-runtime/src/backend.entrypoint.main.ts:3` imports it and calls it
   at :83; nothing exports it. b383462d96 deleted it with
   `apps/api/src/app/api-standalone.executable.ts`, but three of that file's
   four dependencies survive — `api.executable.ts`, `api.main.ts` and
   `api.signal-handlers.ts`. Only `ApiStandaloneComposition` is gone, and that
   is exactly what b383462d96 replaced with `bootApiProcess`. So the port is
   "rebuild the seam on what is real now", the same shape as apidiff's wall 8,
   not a restoration. Note it does **not** block apidiff, which starts the api
   through `bootApi()` and never touches this seam.
2. **Then** `node dev/scripts/find-erased-extends.mjs` — 56 sites, which only
   become reachable once link time succeeds. Mechanical `extends` -> `implements`
   is right only where the base carried no behaviour; apidiff's `apps/tasks` fix
   needed three different answers across four defects.
3. **Then** apidiff's wall 8 (`model-provider` / `credentials`) for the api.
4. **Then** `visualdiff run -keep -agent -boot-timeout 40m`. It gets as far as
   preparing both worktrees today — install, generated files, and all three
   ensure-built packages on the candidate — and dies waiting for a stack that
   cannot come up.
5. **Unblocked and worth doing independently**: `apps/worker` names
   `@langwatch/audit-log-null` in its package.json and does not install it, so
   expect the same `MissingProviderError` apidiff fixed for `apps/api` once link
   time succeeds.

## The worker's last link-time blocker is a design question, not a rename

`worker-ops.composition.ts` imports `UsageStatsClickHouseClient` and
`UsageStatsClickHouseClientResolver` from `@langwatch/ops-server`. Neither
exists, and no rename will produce them, because the ops module **deliberately
stopped having them**. `ClickHouseUsageStatsRepository`'s own docblock says why:
"An organization's usage, counted over the process's one ClickHouse client …
the client routes a statement by the tenant it names." Per-organization client
resolution was removed on purpose.

`OpsWorkerAdapterOptions.usageStats.clickhouse` is now a `ClickHouseQueryClient`
— "the process's one ClickHouse client, which routes each read itself" — and
that is also exactly what the platform member `clickhouse` is
(`packages/infrastructure/src/members.ts:121`).

The catch: `worker-production.composition.ts` is hand-wired and never touches
process members, so nothing in the worker holds a `ClickHouseQueryClient`. It
holds a `ClickHouseConnection`. The only place one is built is `buildClickHouse`
in `@langwatch/infrastructure`, whose `routingDriver` is module-private.

So the question — the same one apidiff answered three times today, "what does
this actually want, and which real member can build it" — is one of:

  a. export `routingDriver`, and let the worker's ClickHouse infrastructure
     expose a `ClickHouseQueryClient` over the connection it already has;
  b. have that infrastructure use `buildClickHouse` instead of hand-rolling its
     own connection, which is the real convergence and a larger change;
  c. give the worker composition access to process members, which is where
     b383462d96's intent was heading anyway.

Not guessed at here. One `as never` already sits at
`worker-production.composition.ts:980` where someone papered over this exact
type mismatch, which is worth knowing before choosing.

## Latent, found but not fixed

Three `exports` entries point at files that do not exist. None has an importer
today, so none can break a boot — but each is a link-time failure waiting for its
first consumer:

    modules/langy/server      ./ports/langy-turn-runtime          -> ./src/app/langy.infrastructure.ts
    modules/trace/server      ./composition/trace-processing-producer -> ./src/adapters/trace-processing-producer.adapter.ts
    modules/identity/server   ./adapters/better-auth-identity-birth   -> ./src/adapters/better-auth.identity-birth.adapter.ts

Also unexplained: `server-module-members.generated.ts` says `"model-provider": []`
while that module's repository `requires` names two members, and the older
handover flagged the same staleness for `suite`. Nothing appears to regenerate
that file in CI.

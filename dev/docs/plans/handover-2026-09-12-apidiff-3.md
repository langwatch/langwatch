# Drive: get `apidiff` to report no behavioural difference against `origin/main`

Written 2026-09-12, end of the third session. **This is the ENTRY POINT.** It
supersedes `handover-2026-09-12-apidiff-2.md`, which is now a reference for how
the diagnosis was reached, not for what to do next — several of its "what to do"
sections describe a gate that is now open.

Branch `feat/strict-feature-layout-v0`, HEAD `dbc7f57afe`, tree clean.

## Gate 1 is OPEN. That is the headline.

    pnpm --filter langwatch build    ->  exit 0, ESM + CJS + DTS all emit

For the whole life of this drive that command failed and `apidiff` could not
boot the branch. It now succeeds, and `sdks/typescript/dist` finally carries
type declarations — which also cleared the `packages/observability` errors that
had been failing `pnpm typecheck` all along.

**`apidiff` has still never been run.** That is the next action and it is now
unblocked.

## Exact next action

    .bin/apidiff/apidiff run -no-haven -main-ref origin/main -json -report <file>

Exit 1 with a findings report is SUCCESS for this step — it means the tool ran
and is telling you what differs. Exit 0 would be the end of the drive. Exit 2
means it could not complete, which is where the last two sessions lived.

It needs no person and no trusted CA: with `-no-haven` and no
`-pg-url/-ch-url/-redis-url` it brings up its own compose stack from
`dev/compose.dev.yml` under the `apidiff` compose project, and Docker is
available on this machine. **The `security add-trusted-cert` line in the older
handovers is a visualdiff prerequisite only.**

Before you run it, read "Coordinate with the visualdiff session" below — another
agent may be using the same machine and the same checkout.

## Measured state

    SDK build       exit 0
    generator       286 declared routes / 64 families / 268 operations
                    (was 186 / 48 / 170 at the start of session two)
    openapi-check   removed 0, added 0, changed 0
    pnpm typecheck  3 errors, 2 files — see "The one known regression" below
    apidiff         never run

`openapi-check` reporting 0/0/0 means the published contract and the installed
module declarations finally say the same thing. It does NOT mean the branch
serves everything it should — see the next section.

## What apidiff will probably report, and why

**70 documented operations are served by nothing.** They are listed, grouped by
namespace, in `dev/docs/plans/unserved-documented-operations-2026-09-12.md`.
That file exists because refreezing the document made `openapi-check` stop
reporting them: once the document is generated from the declarations, an
operation nothing declares is simply absent rather than "removed". apidiff
re-finds them independently, because it probes the union of the operations BOTH
instances document and main still documents all 70.

The root cause of nearly all of it is one commit:

    b383462d96  the api process boots on createProcess and 447 files go:
                api-production drops from 4,989 lines of hand wiring to 161

It deleted **184 composition and mount files** (84 `*.composition.ts`, 100
`*.mount.ts`). The REST families survived; the wiring that supplied their
collaborators did not. **This is the recovery source**: for any blocked family,
read `git show b383462d96^:<path>` — the original names every collaborator the
handlers expect, which beats reconstructing a shape from call sites.

Two ports out of it landed this session and both worked (`21d4639b9d`
experiment, `619b61e5e1` traces), so the method is proven. Two traps it taught:

- The file to read may be the **mount**, not the composition — `traces-rest.mount.ts`
  was the caller, and the composition never called `createTracesRest`. Find the
  caller with `git show --diff-filter=D --name-only b383462d96`.
- **Publishing a path is not enough.** The traces family first published both
  paths with a 200 and NO content, which types every body `undefined` in a
  generated client — exactly what the experiment family still does.
  `withRawResponse` cannot carry a schema, so the answers go through
  `withDocs({ responses })`.

## The one known regression, and the trap behind it

`pnpm typecheck` reports 3 errors in 2 files, both in `modules/scenario/contract`:

    evaluator-attachments.ts:29   ~/components/variables/VariableMappingInput
    scenario-run-evaluators.ts:26 ~/server/evaluators/evaluator.service
    scenario-run-evaluators.ts:100 (implicit any, a consequence of the above)

Dangling monolith imports, both `import type`. They predate this session and are
committed.

**Do not fix them the obvious way without reading this.** I tried: repoint
`EvaluatorWithFields` to `@langwatch/evaluator-contract`, declare the two
mapping shapes in the contract instead of reaching into `modules/prompt/web`,
add the two contract dependencies. It typechecks those two files — and takes
the tree from **3 errors to 67**, because the new dependencies pull the whole
`modules/scenario/contract/src/evaluations/` directory into the compiled graph,
and every file in it carries its own dangling `~/` imports
(`~/server/tracer/*`, `~/generated/prisma/client`,
`~/server/evaluations/evaluators.generated`, and more across 16 files).

So the 3 are the visible edge of a ~67-error cluster. Fixing them means fixing
`evaluations/` as a unit — a lane-sized job — not a two-line repoint. I reverted
rather than leave the signal worse than I found it.

Note also: `@langwatch/mail` does not build for the same reason
(`pnpm --filter @langwatch/mail build` hits the same dangling imports), which
blocks `pnpm --filter @langwatch/platform-api test:unit` through its
`ensure-built` pretest hook.

## Coordinate with the visualdiff session

Another Claude session is driving `tools/visualdiff` **in this same checkout**.
As of this writing it is holding, waiting for a ping before it boots anything.

- It owns `tools/visualdiff/**`, `.visualdiff/**`,
  `specs/tooling/visualdiff*.feature`.
- This drive owns `apps/api/src/features/discovery/openapi-document.json`,
  `sdks/typescript/**`, and `modules/**`.
- **Resource interlock**: a visualdiff run is 2 fresh worktree installs + 2
  haven stacks; an apidiff run is 2 more. Do not run both at once. Tell it
  before you start, and it will do the same.
- It was gated on the same gate 1 — `dev/scripts/ensure-built.mjs` builds the
  `langwatch` SDK first, so while that build was red its candidate stack could
  never come up. It can boot now, against `dbc7f57afe` or later.
- It is asking the user for the portless CA trust itself, as a visualdiff-only
  prerequisite. Do not duplicate that ask.

Its offer, which is worth taking: it will send the set difference both ways
between its `restore-gap` findings (a screen that renders while its endpoint
404s) and the 70 unserved operations. A restore-gap NOT in the 70 is an
operation the document never documented; an unserved operation with NO
restore-gap is a screen that lost its data path silently.

One thing it flagged that the older handovers get wrong: visualdiff CAN boot a
monolith base now (`tools/visualdiff/haven.go:20`, bound scenarios at
`haven_test.go:453` and `:489`), so `origin/main` being the monolith is fine.

## Open decisions, not yet made

1. **Does the published document include enterprise surface?** scim's 19 routes
   and governance's 7 are absent because `dev/scripts/generate-modules.mjs`
   emits the core tier by default. Both main's document and the old frozen one
   published scim, which argues yes. But the enterprise tier is **broken at
   dependency resolution**, not merely unset: `LANGWATCH_BUILD_TIER=enterprise`
   writes 48 module imports and the generator then dies on
   `Cannot find package '@langwatch/enterprise-licensing-server'`, because
   `modules/package.json` declares 44 dependencies and no enterprise one.
   Tested and reverted this session.
2. **`modules/experiment` declares `dependencies: {}`** (`experiment.server.ts:15`,
   unchanged since before this drive), so `ExperimentApp` is built from
   `setup.members` and cannot answer its own service collaborators at runtime —
   for the three families it already registered as well as the eight added in
   `21d4639b9d`. Compare `trace.server.ts`, which declares 12 dependencies and
   needed no App surgery. That contrast is the evidence that `dependencies: {}`
   is a bug rather than a pattern.
3. **`specs/scenarios/scenario-fields.feature` binds 9 of 10.** The tenth wants
   suite-field cross-validation; `readScenarioFieldValues` exists and is tested
   but is wired to nothing. Where that validation belongs is a design decision.

## Things that cost previous sessions real time

- **The v1-versus-bare document difference is deliberate, not a regression.** A
  `dated` family serves bare, dated and `/latest` plus each `/api/v1` twin
  (`addressesOf`, `packages/api/src/rest/addressing.ts`); only the DOCUMENTED
  spelling moved to the twin, on purpose. Do not "fix" it.
- **Compare PASSING test counts, not failing ones.** Clearing a load error makes
  previously-uncollected tests run, so failures can rise while nothing
  regressed. A file that cannot load reports zero tests, not failures.
- **A generated file that disagrees with its source is hiding a real failure.**
  `server-module-members.generated.ts` said `suite: []` while `SuiteApp`
  declared `reads("clickhouse")`; regenerating it made a test start refusing at
  boot that had been passing on stale data.
- **Read a lane's "wire difference" line carefully.** One lane changed the SDK
  to send `version` as a string to match the document; the document was the side
  that had drifted, and the fix was the declaration. Left alone it would have
  shipped a silent change of wire format as a type fix.

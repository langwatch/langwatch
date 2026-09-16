# Handover: the lint-to-zero drive — 2026-09-16

**ENTRY POINT for the successor coordinator.** Read this, then
`.claude/coordinator/LANES.md` for roster conventions. Every number here was
measured this session, not inherited. Branch `feat/strict-feature-layout-v0`.

## The goal, as the user set it

**Every finding to zero.** Not the CI gate, not errors only — zero. Both halves
of `pnpm lint` count: `lint:oxlint` **and** `architecture-enforcer lint`.

## Scoreboard

| | drive start | wave 6 | wave 7 | wave 9 | wave 10 |
| --- | ---: | ---: | ---: | ---: | ---: |
| oxlint total | 24,022 | 9,878 | 9,357 | 8,932 | **7,255** |
| - of which `comment-block-size` | 6,168 | 1,170 | 662 | 659 | **464** |
| - of which the fallible family | - | - | - | 1,719 | **1,555** |

Wave 10 collected four lanes:

    decl-ts2883        the declaration build, and with it every package's typecheck
    fallible-gateway   156 -> 47 in modules/gateway/server, 109 cleared, 69 files
    fallible-trace     215 -> 189 in modules/trace, 20 renames, 28 files
    comment-w10        195 -> 0 across eleven packages, 111 files
    fallible-langy     116 -> 102 in modules/langy/server, under the NEW convention

**Read this before judging langy's 14 against gateway's 109.** The langy lane
first produced a 69-file slice under the old convention, renaming nullable
lookups to `find*`. The coordinator then destroyed it with
`git checkout -- modules/langy/server` on unstaged work - the lane's output was
unrecoverable, and that was a coordinator error, not the lane's. It was redone
under the convention above, and the second pass is far smaller **because doing
it correctly is slower**: converting `T | null` to one-or-throw needs every
caller read to decide whether absence there is a failure or a legitimate answer.
Two conversions passed that test. The other 102 findings did not, and are named
in the lane's handoff rather than bulk-renamed.

That ratio - 109 mechanical renames against 2 real conversions - is the honest
cost of the new convention, and it is the number to plan the rest of the family
with.

### DECISION, 2026-09-16: what `find` and `get` mean from here on

Taken by the user, and it is forward-looking only.

    find*          returns an ARRAY (0..n)
    get* / getBy*  returns exactly ONE, or throws
    T | null       is no longer a shape we write

**The existing 1,217 `find*` methods that return one-or-null are NOT being
converted.** That was considered and deliberately deferred: it is a behaviour
change to every one of them plus every caller that branches on absence, and it
would reverse three collected waves. They stay. Do not open a lane for them, and
do not "tidy" one while passing.

So the tree will hold two conventions at once for a while. That is accepted. New
code follows the rule above; old code is left alone until someone decides
otherwise.

**One place the linter will fight the new convention, and it needs fixing before
anyone writes a repository under it.** `fallible-result-naming` carries
`REPOSITORY_SERVICE_VOCABULARY = /^(get|list)([A-Z]|$)/` and fires on any
`get*` or `list*` method in a repository file, **whatever it returns**, with
"repositories answer `find*`, services answer `get*`". A new repository method
`getById(): T` that throws is exactly right under the decision above and the
linter will tell you to rename it `findById`. The check needs to stop firing when
the method is not nullable, or repositories need an explicit carve-out.

Nothing else collides: the remainder of the rule only governs methods that can
answer with absence, and the new convention has none.

### Two documents still teach the old convention - they were not editable

`de197cba63` made the new convention followable: `fallible-result-naming` no
longer refuses a repository `get*` whose declared result is neither nullable nor
an array, which is exactly the one-or-throw shape. Spec, rule and tests moved
together; 66 findings closed and none opened. `CLAUDE.md` now states the rule.

**Still stating the old convention, because another session holds them dirty:**

    .claude/skills/architecture-guide/references/server.md:97
      "Absence is a `find*` method returning `undefined`, and only a `find*`
       method may carry a nullable result."
      and :111 "Repositories use `findAll` / `findById` / ..."

    dev/docs/lint-rules.md   (the rendered rule reference)

The first is the one that matters: it is what the `module` and `architecture-guide`
skills put in front of every lane, so until it is corrected a lane is told the
superseded rule by the guide and the corrected rule by CLAUDE.md at the same
time. Fix it the moment that file is free.

Note the rule change does **not** flip the family. Enforcing the new convention
outright would turn all ~1,217 existing nullable `find*` methods into findings,
which is the opposite of the decision. The rule still prescribes `find*` for a
nullable result; it simply stops blocking `get*` where absence is impossible.

### The decision wave 10 raised, and it is not a rename

`modules/trace` is the inverse of `modules/gateway`. Gateway's findings were
almost all genuine lookups and a careful lane cleared 70% of them. **182 of
trace's remaining 189 sit on total conversions over untrusted span
attributes** - `parseBase64DataUri`, `pcm16ToWavBase64`, `stringifySpanIO`,
`extractTextFromMessages`, `redactSpanPatch`, the whole content-part dispatcher,
the whole `rules/` folder.

Neither half of the rule's message fits them. `find*` would be exactly the
`findSafeRegex` / `findJsonArray` mistake that was reverted, because a parser is
not a lookup. And making them throw would break the **deliberate fail-soft
ingestion contract**: a malformed span attribute would start failing ingestion
instead of degrading, which is the opposite of what that code is for.

So the question is whether `langwatch(fallible-result-naming)` should fire on
total conversions at all. Until that is answered these findings are not work,
and any lane sent at them will either game the rule or break ingestion. Expect
a similar population in every other ingestion path.

**1,309 of the last drop was not lane work.** `plugins/langwatch/scripts/
session-context.mjs` is a vendored bundle - 412 KB of minified output on one
237,525-character line - and it alone carried 14.7% of the repository's
findings. Nobody could ever have fixed one: the plugin ships the artefact and
builds it elsewhere. `8ac2a4ac40` adds it to `ignorePatterns` on exactly the
reasoning already written there for generated files, and the same commit
collapses a **duplicated `ignorePatterns` key** that would have made an edit to
the first block silently lose to the second.

Measure before sweeping. A seventh of this drive's remaining work did not exist.

### The visible number is about half the real one

`packages/architecture-enforcer/src/oxlint-baseline.json` holds **6,925
baselined `rule|file` pairs** against 7,623 visible findings. Reaching zero
visible leaves the larger half suppressed. The biggest:

    no-port-vocabulary .... 1,432      condition-shape ........ 500
    stand-in-cast ......... 955        test-description ....... 336
    cognitive-complexity .. 773        feature-source-layout .. 309

`stand-in-cast` is the largest of these after `no-port-vocabulary`: enabled as
`error`, reporting 43 findings while suppressed in **955 files, 792 of them
tests**, against 430 `as unknown as <X>Api|Service|Repository` casts in tests
and only 175 uses of `satisfies`. Worth un-baselining on its own merits.

**It did not, however, cause either regression on this drive, and an earlier
draft of this handover said it did.** The SCIM doubles that carried the
`UserApi` one contain no casts at all - they are typed returns,
`(): ScimUserProvisioning => ({ ... })`, over a type built from
`Pick<UserApi, ...>`. TypeScript checks that completely: after the rename,
`Pick<UserApi, "tryFindById">` is a TS2344 and the missing method is another
error beside it. Both regressions were ordinary type errors that `tsc` catches
in a second, and both survived for one reason only - `tsc` was not running.
Rank the fixes by that: a check that cannot run costs more than any rule that
was never written.

### Typecheck is now part of the goal, and the gate was not running

The user added it this session: zero typecheck failures beside zero lint.

Every package's script is `typecheck:declarations && tsc --noEmit`. The
declarations build failed on six TS2883 errors in `modules/analytics/server`, so
the `&&` short-circuited and **`tsc --noEmit` had stopped running for every
package in the repository**. `typecheck:one <anything>` exited 1 having compiled
nothing, and that exit code was being read as "that package is broken".

`66735bd90a` fixes it: the five analytics REST routers write their type out the
way `modules/organization/server/src/transport/team.rest.ts` already did.

Baseline once it ran: **1,156 distinct errors across 439 files** (a floor -
package-relative `src/...` paths collide across packages). 665 in source, 491 in
tests. The raw figure is 3,169, but fourteen `*-web` packages each report the
same 102 errors because each compiles the shared web graph, so the raw number
counts single defects up to fourteen times. TS2339 206, TS2322 141, TS2307 105.

**Three things will make you misread the typecheck number. All three bit this
session.**

1. **`pnpm typecheck:all` bails on the first failing package.** It is
   `pnpm -r`, which stops at the first non-zero exit, so the count it gives is
   "errors up to the first broken package", not the repository's. Add
   `--no-bail` for a measurement.

2. **Running `npx tsc --noEmit` inside a package floods TS6305.** 76 of the 105
   errors in `modules/analytics/web` were `TS6305 output file has not been
   built`, which is an unbuilt project reference, not a defect. The package's
   own `typecheck` script builds declarations first and reports **zero** of
   them. Direct `tsc` is the wrong instrument now that the gate works; if you
   must use it, exclude TS6305 and TS6059 before comparing anything.

3. **Whole-repo typecheck cannot be measured while lanes are running.** The
   declaration build aborts with "Declaration inputs changed during
   compilation" whenever a lane writes a watched file. Measure when the tree is
   quiet, or the number is a race, not a reading.

Corrected baseline after all three: **1,137 real distinct errors** (1,156 minus
19 TS6059 build artefacts), 665 source / 491 test. The 3,169 raw figure counts
single defects once per dependent package.

### What the dead gate hid, and how to find the rest

`467c68f065`. Renaming `tryGetVisibilityCutoffMs` to `getVisibilityCutoffMs`
updated the trace module and the interactive path beside it, but not
`apps/worker/src/app/worker-automation-settlement-reads.composition.ts`, which is
outside the module and so outside the slice. `this.window` is properly typed, so
`tsc` would have caught it in a second - and `tsc` was not running.

It would not have crashed, either. The call sits inside a `catch` that fails
closed, so the `TypeError` would have been swallowed and the function would have
returned the free-tier cutoff, on the path that decides which aged customer
content stays visible. Silently wrong, on a privacy path, indefinitely.

This is the second regression of this shape on this drive; the first was
`UserApi.tryFindById` across six modules. Both leaked **out of the renaming
module into `apps/*`**, which no lane owns. The check that finds them, and which
found this one, is called-but-nowhere-defined:

    for each try* identifier your commits removed:
      defs   = declarations of that name anywhere in the tree
      calls  = `.name(` call sites anywhere in the tree
      defs == 0 and calls > 0  ->  orphan

Run it across the whole repository after every rename wave, not per slice. A
rename is verified by running the tests of everything that depends on the
symbol; "it compiled" is not evidence, and while the gate was dead it was not
even that.

### The sweep is not a ratchet, and this is now measured

Wave 4 cleared 578 findings and the tree fell by 566. The missing 12 are **new
findings that appeared while the wave ran**, in roughly an hour:

- 9 in files the other session has uncommitted — `packages/api/src/trpc/throttle.ts`
  (3, untracked), `packages/infrastructure/src/redis-members.ts` and its test,
  `packages/api/src/rest/declaration.ts`, `modules/auth/server/src/app/auth.app.ts`,
  `apps/api/src/app/api-production.composition.ts`;
- 3 in **committed** files under `modules/trace`, an area swept to zero in wave 1
  — `tracked-event.rest.declaration.unit.test.ts` (2) and
  `tracked-event-span.service.ts` (1).

The last three deserve care, because the obvious reading is wrong. Neither file
is a regression of swept code: `git cat-file -e` confirms **neither existed** at
the trace sweep commit `e2bbe50397`, and both were created afterwards by
`2722423f6f`. They are new code that arrived carrying over-budget comments.

That is the finding. Nothing stops new code from adding `comment-block-size`
findings, because the rule cannot gate anything while 10,840 findings already
fail it. So the drive is filling a bucket with a hole in it — small, currently
about a dozen an hour of concurrent work, but it means "reach zero" and "stay at
zero" are two jobs and only the first is planned. Whoever finishes the sweep
should land the gate in the same change, or the count starts climbing the day
after.

Typecheck held at its **114-error / 40-file** baseline throughout; verify
against that number, not zero, and compare the error-code distribution and the
erroring file set, not just the count.

## Decisions the user made — do NOT relitigate

1. **Target is every finding, not the CI gate.**
2. **`vitest/require-mock-type-parameters` is off** (ADR-142 amendment). 11,741
   findings, test-only, no possible codemod — the type argument has to be the
   mocked signature itself.
3. **Comment blocks keep the 5-line maximum, and the warning tier is gone.**
   The user rejected raising the max (to 8, then to 6) twice, with the reason:
   *"what comments need to be 5+ lines? if it's that important, ADR it."* So
   6+ lines now ERRORS. This converted 5,212 warnings into errors and is why
   the error count went up. `@lint-keep` had **zero** uses in the entire tree —
   the escape hatch ADR-140 built was never used once.
4. **Lint runs from the repository root** (`oxlint .`), not a path list. That
   list excluded 25 packages, including `plugins/langwatch` (a published plugin,
   1,331 findings) and `packages/oxlint-rules` — the linter's own rules.
   `**/*.generated.ts` is ignored, because the fix for a generated file is in
   its generator.
5. **Event sourcing is one folder** (ADR-137 amendment): 259 files out of
   `projections/`, `intents/`, `processes/`, `subscribers/`, `stores/eventing/`.

## Three traps that will cost you a day each

**A path-keyed baseline does not survive a rename, and fails silently.** The
registers in `packages/architecture-enforcer/src/*baseline.json` are keyed
`rule|path`. A row matching nothing says nothing — the rule re-reports accepted
debt as new. The eventing move appeared to add 208 findings across six rules;
all of it was 325 orphaned keys. After ANY move: re-key the rows, **re-sort**
(codepoint order — a rename reorders them), then verify row counts preserved,
zero duplicate keys, and each affected rule back to its prior count.

**Autofix is exhausted, and one tier is harmful.** `oxlint --fix` clears 0.
`--fix-suggestions` clears 129, of which 10 break tests: it rewrites
`const x = expect(p).rejects…` into `const x = await expect(p).rejects…` in 8
files that defer the await deliberately (one carries a comment saying so),
which hangs them. Do not re-run that tier without re-excluding those.

**The enforcer's 2.76 GiB is a parse cache whose `WeakRef` collects nothing.**
`new WeakRef(t)` adds `t` to the current job's kept-alive list and a lint run is
one synchronous job — measured 14,158 trees cached, 14,158 alive after two
forced GCs, 0 collected; one event-loop yield freed 1.9 GiB. Two fixes were
tried and REJECTED on measurement (a bounded LRU is straight time-for-memory; an
uncached whole-repo walk made it *worse* at 3.39 GiB because the other 54
policies refill the cache). The peak is the union of every tree anything parses,
so no single-policy fix moves it. The only real fix is walking the tree once.
Full numbers in `dev/docs/plans/lint-to-zero-2026-09-15.md`.

## The work, sliced into lanes

### Wave 1 — the comment sweep (6,168 findings, 3,585 files)

**Progress: 3,483 of 6,168 cleared — 56%.** 1,813 by the first five lanes,
136 by a correction to the rule itself (`@integration`, `@vitest-environment`
and `@regression` were counted as prose though no author can delete them), 765
by the second tranche and 769 by the third.

Areas now at zero: `sdks/typescript` 550, `modules/analytics` 408,
`modules/trace` 381, `modules/scenario` 279, `modules/gateway` 204,
`packages/eventing` 194, `modules/ops` 172, `modules/automation` 166,
`modules/identity` 163, `modules/model-provider` 156, `modules/prompt` 154,
`modules/coding-agent` 150, `dev` 144 of 147,
`enterprise/modules/governance` 121, `modules/auth` 117.

One lane per area, largest first:

| lane | paths | findings |
| --- | --- | ---: |
| `comments-sdk-typescript` | `sdks/typescript` | 550 |
| `comments-analytics` | `modules/analytics` | 408 |
| `comments-trace` | `modules/trace` | 381 |
| `comments-scenario` | `modules/scenario` | 279 |
| `comments-enterprise` | `enterprise/modules` | 209 |
| `comments-gateway` | `modules/gateway` | 208 |
| `comments-eventing-pkg` | `packages/eventing` | 200 |
| `comments-ops` | `modules/ops` | 176 |
| `comments-automation` | `modules/automation` | 174 |
| `comments-model-provider` | `modules/model-provider` | 169 |
| `comments-identity` | `modules/identity` | 166 |
| `comments-coding-agent` | `modules/coding-agent` | 159 |
| `comments-prompt` | `modules/prompt` | 154 |
| `comments-langy` | `modules/langy` | 123 |
| `comments-auth` | `modules/auth` | 120 |
| `comments-apps` | `apps/worker`, `apps/api`, `apps/ui` | 283 |
| `comments-tail` | the remaining 78 areas | 2,021 |

Split `comments-tail` by package when you get to it; do not give one lane 78
areas. **Lanes must not run `pnpm format`** — it rewrites ~1,300 unrelated files.

### Wave 2 — the fallible-naming family (2,103, one coherent job)

`fallible-result-naming` (1,346) + `no-try-prefix` (757). **Opus, high effort** —
this is not a rename. A `try*` or nullable-returning method renamed to `find*`
must **narrow its catch to the absence case**; a blanket catch behind a `find*`
name is a worse bug than the lint it silences. One lane per module, and the lane
must show the narrowed catch in its handoff, not just the rename.

### Wave 3 — layout and boundaries

- `feature-source-layout` 320 — **173 are `services/` subdirectories**; layout v0
  wants `services/<name>.service.ts` flat, no subdirectory, no qualifier.
- `package-boundaries` 394, `zod-object-composition` 403, `temporal-only` 415,
  `condition-shape` 543, `service-classes` ~301. **Sonnet, medium.**
- **Six crowded `eventing/` folders** (identity 24 files, experiment 18, trace
  17, scenario 17, governance 15, coding-agent 13, against a 12 budget). The
  grammar already supports the nested form
  `eventing/<pipeline>/<subject>.<kind>.ts` — see `feature-layout-policy.mjs`.
  Two pre-existing `crowded-folder` baseline rows were re-keyed, not dropped.

### Wave 4 — the newly-linted region (~2,884, previously invisible)

`plugins/langwatch` (1,331), `packages/clickhouse-client` (127),
`packages/ksuid` (120), `packages/oxlint-rules` (113), `skills/_tests` (84),
`packages/redaction` (83), `dev/` (274), and the rest. Nobody has ever linted
these. **Sonnet, medium**, one lane per package.

### Wave 5 — the enforcer's 2,761

Separate from oxlint and untouched this session. `unused-module-export` 373,
`boundary-signature-mirrors` 282, `api-transport-handler-shape` 247,
`api-transport-handler-boundary` 200, `private-runtime-export` 171. Also 178
stale baseline rows to clear. **Opus for the boundary policies, Sonnet for the
rest.**

## Process

- Lanes do not commit; the coordinator collects per-lane with **scoped**
  `git add`. Do not use `git add -A` at the repository root: it swept 29 files
  of a concurrent session's work into a commit this session, and unpicking it
  needed a soft reset.
- **Another session is live on this checkout** (haven TUI work in
  `tools/thuishaven`, plus ~46 dirty files from earlier drives). Leave them
  alone; `git stash list` has one entry that is not yours.
- `git stash` is banned in lanes. To compare against HEAD use
  `git show HEAD:<path>` into a temp file.
- Re-measure with
  `npx oxlint --config .oxlintrc.jsonc --format=json . > out.json` and count by
  `code` — do not trust `pnpm lint`'s own output for a total, it runs `--quiet`
  and hides every warning.

## Next action

Collect the six lanes in flight (roster in `.claude/coordinator/LANES.md`), then
slice the next tranche from a **fresh** whole-tree measurement — never from a
stale `.tsv`, because the rule's discount list changed mid-drive and the old
slices name findings that no longer exist.

Areas still untouched, largest first, from the measurement above:
`apps/worker` 110, `modules/organization` 108, `modules/langy` 105,
`modules/authz` 97, `modules/api-key` 86, `packages/architecture-enforcer` 85,
`apps/api` 82, `apps/ui` 81, `modules/dataset` 81, `modules/experiment` 77,
`packages/clickhouse-client` 77, `modules/workflow` 69, `packages/api` 68, then
a long tail.

### Fifty-three inert `biome-ignore` comments — a decision, not a task

Found while clearing `modules/prompt`'s last three findings. **Biome is not in
this toolchain**: no `biome.json` anywhere, no `@biomejs/biome` in any
`package.json`, no script invoking it. CLAUDE.md is right that oxlint and oxfmt
are the only JavaScript linter and formatter here.

So every `// biome-ignore lint/...` comment in the tree is read by no tool that
runs. There are **53** of them, concentrated in `modules/ops/server` (9),
`modules/analytics/web` (7), `modules/trace/web` (5) and
`enterprise/modules/governance` (5). Verified on the prompt file: oxlint reports
no empty-function finding there with or without the directive, and oxlint does
not parse `biome-ignore` syntax in any case.

They matter to this drive only where one is over 100 columns and so trips
`comment-block-size` itself. Three were; they were shortened to fit rather than
deleted, because **deleting 3 of 53 is a policy decision in disguise** and this
is the user's call, not a sweep lane's:

- **Delete all 53** — they assert a suppression no tool honours, and a reader
  reasonably believes a `biome-ignore` is load-bearing. Cheapest to reason about.
- **Keep them** — they document *why* a block is intentionally empty, which is
  real information even with the rule name attached to a dead linter.
- **Convert them** to the oxlint equivalent where the rule exists here, and
  delete the rest. Most work, most honest result.

Note that several sit on genuinely empty function bodies that oxlint does not
currently flag, so converting is not a mechanical rewrite — it needs a rule to
convert *to*, and for some there is not one.

### The mop-up nobody should forget

**Was 24 findings inside already-swept areas. Nine are now cleared** (`47f42c4ca7`),
leaving **15**, none a lane's work:

- **12 blocked behind another session's uncommitted files** — gateway 4,
  identity 3, auth 3, ops 1, model-provider 1. They cannot be swept while
  someone else is mid-edit in them; re-measure once that session commits.
- **3 the two `dev/scripts` headers**, below — a decision, not a task.

The nine that are gone were over-long comment *lines*, not oversized blocks, and
eight of the nine were `biome-ignore` directives. A directive cannot be wrapped
without breaking it, so the fix was to move each explanation to a prose line
above and leave a short reason on the directive — except where the directive sat
flush against a JSDoc close, since an inserted line merges into that block and
trades a column violation for a length one. Both shapes are in `47f42c4ca7` if
you need the pattern again.

**Measure residuals with an exact path boundary.** `startswith("modules/auth")`
also matches `modules/authz` and reports 100 findings where there are 3. Match
on `area + "/"`. This produced one wrong count in this drive already, and the
wave-4 manifest for `modules/langy` + `modules/authz` had to say so explicitly.

### The two `dev/scripts` headers — a decision, not a task

`dev/scripts/check-queue.mjs` (58 lines) and `dev/scripts/dev-supervisor.mjs`
(140 lines, plus a 132-column line). The `w3-dev` lane deliberately left both and
escalated, which was correct: these are not narration.

- `check-queue.mjs` documents the **environment contract** every agent in this
  repo passes through — `CHECK_SLOTS`, `CHECK_QUEUE_HELD`, `CHECK_PRESSURE`,
  including the rule that an agent shell may not gate the queue off. Much of it
  is restated in CLAUDE.md, and the script already has `--explain`.
- `dev-supervisor.mjs` carries a **PID table** showing an abandoned stack's
  process group. The table *is* the argument for why the supervisor exists;
  compressed to three lines it becomes an assertion nobody can check.

Neither belongs in a 5-line budget, and neither should be deleted. The options:
a `dev/docs/` page each with a one-line pointer (cheapest, keeps them readable);
an ADR for the supervisor's process-group design plus `--help` text for the
queue's environment contract (most correct, most work); or an explicit,
documented exemption. **This is a writing task, not a sweep task** — Fable's
band, once someone picks the destination.

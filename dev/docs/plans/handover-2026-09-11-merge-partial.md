# Handover: the main merge, mid-flight

Written 2026-09-11 ~17:10, session ending. Alex is finishing this on the move.

## Resume from the live merge, not from a commit

The working tree still holds the merge: `MERGE_HEAD`, the staged resolutions and
the conflict stages are all intact and persist across sessions. **That is the
state to continue from.** Committing it would discard stages `:1:`/`:2:`/`:3:`,
and those are what make the remaining 754 tractable.

A two-parent backstop exists at `refs/wip/merge-partial-2026-09-11`
(`878b589a2a`, parents `026bb5be82` + `dd6aa6efd3`). No branch points at it. Its
tree contains 67 files with literal conflict markers - recovery only, never a
build.

The one command that destroys the work: `git merge --abort`. Also `git reset`.

## Counters

```
unmerged   1282 -> 754        markers 67        rerere cache 2,755 entries
done       docs, sdks, modules/scenario, modules/analytics (99 -> 0)
open       platform/app 305, enterprise/modules 145, enterprise/packages 78,
           dev/scripts 27, modules/authz 21, modules/trace 19, apps/ui 18
```

## The method that matters most

To ask "what did main actually change here", diff **`:1:` (base) against `:3:`
(theirs)**. Diffing ours against theirs conflates this branch's restructure with
main's change and makes every file look rewritten - that is how an earlier lane
reported 19 analytics files as safe "took ours" when only 2 were.

```bash
git show ":1:$f" > /tmp/b; git show ":3:$f" > /tmp/t; diff -u /tmp/b /tmp/t
```

A **took-ours** (worktree identical to `:2:`) is the shape worth auditing, because
rerere replays it silently and it is what drops main's work with no marker to see.
Repo-wide audit of the remaining conflicts found 8; 7 are real and listed below.

Counter-lesson, learned by getting it wrong: "main added a line we lack" is NOT
the same as "we lost the behaviour". `infra/docker/Dockerfile` looked like a drop
for two COPY lines; this branch does `COPY modules ./modules` wholesale and both
files live under `modules/scenario/contract/src/`. Already satisfied. Staged ours.

## Exact next actions

1. **enterprise/governance ingestion-sources - 5 took-ours with real main work**,
   the highest-value unresolved items because they will not announce themselves:

   ```
   model/ingestion-source-catalog.ts                  95+   9-   retired/deprecated/sample flags
   __tests__/pull-cadence-field.integration.test.tsx  82+  13-
   ui/elements/pull-cadence-field.tsx                 45+  36-
   __tests__/trace-destination-field.integration...   40+  34-
   ui/elements/trace-destination-field.tsx            27+  52-
   server/src/services/__tests__/ingestion-pull-worker.deadline.unit.test.ts  5+ 1-
   ```

   All under `enterprise/modules/governance/web/src/features/ingestion-sources/`.

2. **enterprise is one task, not two.** Its lane established that all 224 paths
   are governance-dashboard related, so `enterprise/` and the "governance port"
   are the same body of work. Manifest `.claude/manifests/merge-enterprise.md`
   needs that premise corrected before a lane is spawned against it.

   Watch for the failure mode that area specialises in: conflicts that merge
   **cleanly** while importing components deleted with the monolith
   (`FieldInfoTooltip`, `ScopeChipPicker`). One put JSX into a `.ts` model file.
   A marker grep says nothing about any of it.

3. **platform/app 305 DU** - classifier resumed at row 53,
   `platform/app/src/app/api/projects/[[...route]]/app.ts`. Inventory and
   verdicts in `dev/docs/plans/main-merge-2026-09-11/platform-du-*.tsv`,
   handoff `.claude/handoffs/platform-du-classify.md`. Measured: 28,529 lines,
   **zero files main created after the fork**, 38% is the governance port,
   4,430 lines is one generated file.

4. `packages/clickhouse-client/src/tasks/ttl.reconciler.ts` - a genuine logic
   merge, wants its own lane.

## Landed this session, so it is not redone

`modules/analytics` 99 -> 0, on Alex's ruling **"follow what's on main"**:
workbench dropped (37), ChartGrid + self-hosted-provisioning landed (28), 9
took-ours reversed to theirs, 2 duplicate tests dropped after confirming all 32
and 14 of main's test titles exist in ours.

Three real defects fixed while resolving, each of which read as green:
- the `period_*` -> `dashboard_context_*` reserved-parameter rename was
  **half-applied** - contract and migration had it, three test files still
  asserted the old literals, so they pinned names the code no longer emits;
- `analytics-registry.getMetric` threw a raw `TypeError` on an unknown group
  (main returns `undefined`); both call sites already handled undefined, so
  widening the type cost nothing;
- a `@scenario` title rename left a test **vacuously bound** - our feature files
  already carried main's titles. Binding audit now reports zero unbound in the
  module.
- `graph-card-menu` kept an Edit item pointing at the workbench route deleted in
  the same merge. A dead link the merge itself would have introduced.

`enterprise/.../governance-anomaly-rules.screen.tsx` 1021 -> 35, taking main's
shim. Verified first that our `AnomalyRulesTab.tsx` is 1,079 lines with no
declaration missing against main's - the consolidation target is fully present.

## Lane in flight

`merge-analytics-port` (opus), manifest `.claude/manifests/merge-analytics-port.md`,
handoff `.claude/handoffs/merge-analytics-port.md`. Repointing main's ChartGrid
and LWQL provisioning imports off the monolith layout. Analytics conflicts are
zero; this is the port they were staged ahead of, same class as `modules/scenario`'s
TS2307s.

**Its overriding constraint, from Alex: keep the LangWatchQL code SUPER similar
to main - Drew wrote it days ago and is still working in it.** Transpose, do not
improve. The existing transposition is already faithful (`assertNames(names)` ->
`this.assertNames(names)` and a class wrapper, bodies and doc comments verbatim),
and the port must match it.

If the lane's row is still `active` in `.claude/coordinator/LANES.md` with no
handoff on disk, its work died with the session - re-spawn from the manifest.

## What the analytics-port lane found (it reported, then stopped early)

It stopped on a wrap-up instruction at 56 of 160 tool calls, not at budget.
Handoff: `.claude/handoffs/merge-analytics-port.md`. Four things outrank the
rest:

1. **`packages/clickhouse-client/src/tasks/ttl.reconciler.ts` has 12 live
   conflict markers and it blocks EVERY typecheck in the repo**, because the
   shared declarations prebuild runs before any package is reached
   (`TS1185: Merge conflict marker encountered`). Nothing can be verified until
   this one file is resolved. It was already on the list as "a genuine logic
   merge, wants its own lane" - it is now the **first** thing to do, not a
   later one.

2. **Main's `LWQL_SELF_PROVISION` capability is dead code here.** The
   provisioning files landed, but base->main also added 298 lines to
   `platform/app/src/tasks/provisionLwql.ts` (`selfProvisionAll`,
   `redactSecrets`, explicit mode selection, advisory-lock wrapping). Our
   `modules/analytics/server/src/tasks/lwql-provision.task.ts` is 296 lines
   against main's 462 and mentions none of `selfProvision`, `manage-role` or
   `LWQL_MANAGE_POSTGRES_READER`. Nothing imports `selfProvisioning`,
   `selfProvisionLock` or `postgresReaderStatementsFor`. **Issue #6635 is a
   feature port needing its own lane, not an import repoint** - and it is the
   `unused-config-object-is-a-wiring-bug` shape: present, compiling, unreachable.

3. **`chartGrid.ts` has a placement question the port cannot route around.** It
   landed under `analytics/server/src/repositories/` but is imported by five
   files in `analytics/web` and by `modules/trace/server`. Only
   `@langwatch/analytics-contract` is reachable from all three. Needs a call
   before the ChartGrid half can finish.

4. Two imports left deliberately broken rather than guessed, both crossing into
   another lane's paths: `featureFlagService` in `dashboard-widgets/access.ts`
   (the obvious fix changes `customChartPlaygroundEnabled`'s signature, whose
   caller is in `modules/trace/server`), and `dashboardBelongsToProject`, which
   exists only in main's monolith while the behaviour lives in
   `modules/dashboard/server` - which analytics may not import.

Two shared-file requests it could not perform itself:
- `pnpm install` at the repo root - it added `@langwatch/prisma-client` and
  `nanoid` to `modules/analytics/server/package.json`; unlinked until then.
- delete `modules/analytics/server/src/langwatch-ql/provisioning/index.ts` (the
  dead barrel; `rm` was refused by the permission classifier).

Its edits are uncommitted in the worktree and ARE included in the
`refs/wip/merge-partial-2026-09-11` snapshot.

## Continuing on a DIFFERENT machine

Only commits travel. The conflict stages (`:1:`/`:2:`/`:3:`) and the 2,755-entry
`.git/rr-cache` are local to the machine that ran the merge and do **not** push.
So the `:1:` vs `:3:` method above does not work from a fresh clone as-is - you
have to regenerate the stages first.

The recipe that gets both the stages and this session's work:

```bash
git fetch origin wip/merge-partial-2026-09-11
git checkout feat/strict-feature-layout-v0

# 1. regenerate the conflict stages locally (rerere will NOT replay here,
#    which is a feature - nothing is answered silently on this machine)
git merge origin/main          # expect ~1282 conflicts, the full set

# 2. lift every path this session already resolved, out of the snapshot
git checkout FETCH_HEAD -- modules/analytics modules/scenario sdks docs \
    enterprise/modules/governance/web/src/ui/sections/governance/governance-anomaly-rules.screen.tsx \
    infra/docker/Dockerfile

# 3. and the plans + coordinator state
git checkout FETCH_HEAD -- dev/docs/plans .claude/handoffs .claude/manifests
```

Step 2 is safe precisely because those paths were taken to zero unmerged here;
everything still conflicted is untouched by it and keeps its stages.

`.claude/handoffs/` and `.claude/manifests/` are **gitignored**, so they are in
the snapshot only because it force-added them. Do not expect them from a normal
clone or a later ordinary commit.

What you lose on the other machine and cannot get back: the rerere cache. That is
mostly good news - 199 of its replays were silent, and 2 dropped real work. A
fresh merge asks you every question instead of answering some of them for you.

## E9 - anthropic-admin-puller carries a bug main already fixed

`enterprise/modules/governance/server/src/services/anthropic-admin-puller.service.ts`

An earlier pass classified main's module-level `parseCursor` as one of seven
duplicates of our statics, to be dropped. **That was wrong.** The name is the
same; the behaviour is not.

Main splits one field into two, and the comment on the change says why:

> "The look-back was being computed and then thrown away: every request went
> out at `cursor.startingAt`, so the repair window existed on paper and never
> once reached the provider."

- `startingAt` - the position ON RECORD, what a cut-off run writes back.
- `requestStart` - the instant this run ASKS from, which for a **drained cost
  cursor** sits a few days behind it, via `costRequestStart({ stored, config })`.

The look-back is applied only when `config.report === "cost" && parsed.page ===
null`. Mid-window with a page token in hand the ask must stay exactly what that
token was minted against, or the provider refuses it.

Our `AnthropicAdminPullerAdapter.parseCursor` returns
`{ startingAt, page, watermark }` and nothing else, so **this branch still ships
the bug**: cost restatements inside the repair window are never re-read.

To port: add `requestStart` to the static's return type, bring
`costRequestStart` across, and wire the call sites that main's hunks 4, 6, 7 and
8 touch (`requestStart` for the ask, `positionOnRecord` for the floor). Keep our
`AdminUsageReportAdapter` abstraction and our `logger`; convert `Date.parse` /
`Date.now` to `toEpochMs` / `nowInstant()`.

### Verified classification of main's 24 helpers

Produced by extracting each function from `:1:` and `:3:` and comparing bodies,
not by reading names. Two of my earlier "duplicate" calls were wrong.

| verdict | count | helpers |
| --- | --- | --- |
| drop - unchanged since base, our statics are faithful | 7 | `cacheWriteTokens` `centsToUsd` `defaultStartingAt` `encodeCursor` `fetchPageError` `queryIdentity` `reportUrl` |
| drop - pre-dates the split, we have an equivalent | 3 | `dimension` `dimensionPath` `safeResponseText`, all three now `AdminUsageReportAdapter` statics (verified present) |
| **modify - shared name, main changed the body** | 2 | `parseCursor`, `staleCursorRestart` - both gain `requestStart` |
| **port - new in main since base** | 11 | `amountSignature` `assertRowsAreDistinguishable` `collidingRowsByKey` `costRequestStart` `differingFieldNames` `emittedHint` `hasSpentDeadline` `laterInstant` `newestBucketStart` `parsedRawPayload` `unfinishedWindowStart` |

Of the 11, `laterInstant` and `newestBucketStart` are **mandatory**: code already
sitting on our side of the file calls them, so without them the file does not
run. That is the half-landed-feature class arriving through the clean merge.

On a rewind or a usage restart `requestStart === startingAt` - no look-back is
stacked on a rewind. Only a drained cost cursor gets it.

**The general lesson, which applies to the other pullers too:** a main helper
that shares a name with one of our statics is not therefore a duplicate. Diff
`:1:` against `:3:` for that helper before dropping it - a same-named function
whose body changed is exactly how a fix disappears in a restructure merge.

## Reserved decision added - voice agent host interface

`modules/agent/web/src/ui/sections/agent-type-selector-drawer.tsx` is resolved
keeping our props-driven structure, with main's voice-agent feature **not**
ported: it needs a host-interface decision. This joins the existing reserved
voice decisions (the ~22 voice runtime modules in `modules/scenario/contract`,
and the vendored scenario SDK that main needs at `voice7` against this branch's
`^1.3.0` catalog pin).

### E9 status: resolved and verified

`anthropic-admin-puller.service.ts` is staged. 12/12 unit tests pass, including
`rewinds stale cost cursors to the configured repair window without moving a
backlog forward`, which is the behaviour the fix exists for.

Two things the resolution proved, both worth carrying to the sibling pullers:

- **The clean merge had already delivered the uses without the definitions.**
  The run method's call site read `startingAt: requestStart` and `readPage`
  computed `watermark: newestBucketStart(...)`, while `requestStart` was never
  declared and `newestBucketStart` did not exist. The file could not have run.
  `DispatchError` / `parseRetryAfterMs` were the same: used at four call sites,
  imported nowhere.
- **Running it is what found that.** Both gaps parsed clean and both were
  invisible to marker counting; the unit test named them in one line each.

### Follow-up: two lint rules now fire across the governance services

`service-classes` and `service-does-not-open-a-channel` fire on both
`anthropic-admin-puller.service.ts` and `http-poller.service.ts`, and neither is
in the baseline. They are a consequence of main's code landing on our
`services/` path, not of any one resolution - `openai-admin-puller.service.ts`
is clean, so the shape is reachable. This needs one conformance pass over the
module once the merge is resolved; it is not a per-file fix and must not be
papered over with baseline entries, since the register may only shrink.

## E10 - billing's UsageWarningService may have no implementation at all

Surfaced by the `merge-tail-rest` lane while resolving
`modules/organization/.../prisma.organization-membership.repository.ts`, and
outside its ownership, so it is recorded rather than fixed.

`findWithAdmins`, `updateSentPlanLimitAlert` and `findProjectsWithName` are
declared on `BillingUsageLimitOrganization`
(`enterprise/modules/billing/contract/src/billing-types.ts`) and called by
`enterprise/modules/billing/server/src/services/usage-warning.service.ts` - but
**no adapter implements that interface anywhere in the tree**, and no
composition root wires `UsageWarningService.create`.

Four more declared methods - `getPricingModel`, `getStripeCustomerId`,
`findByStripeCustomerId`, `findNameById` - are not referenced anywhere at all.

So `UsageWarningService` is either dead code or is waiting on a wiring lane, and
which one it is decides whether plan-limit warning emails are currently being
sent. Worth answering before the merge lands: this is a customer-visible
behaviour whose absence nothing would report.

### E8 now has a failing test pinning it

`anthropic-admin-puller.behavior.unit.test.ts` is resolved and staged: zero
markers, our imports, our `AnthropicAdminPullerAdapter` name (main's test body
used the pre-restructure `AnthropicAdminPuller` at 19 call sites), Temporal
instants rather than `new Date`, and the two half-landed definitions restored
(`GOV_PROJECT_ID` and the `inspect` import were each used on our side with the
definition stranded in main's half of a conflict).

**It fails 26 of 47, and that is the correct result.** Main's assertions read
`record?.costNanoMinor` (9 references); our contract
(`contract/src/pulled-usage.events.ts`) still declares only `costNanoUsd`. So
the test now reports the ADR-128 multi-currency gap instead of hiding it.

Porting E8 means the contract, `PulledUsageRecordService`, the commands and the
projections together - not this file. Do not "fix" the test by rewriting its
assertions back to `costNanoUsd`: that would delete the only thing currently
holding the gap visible.

## E11 - the governance screens are blocked on a component port, not on markers

Measured, not estimated: every `~/` and `@ee/` import across the five remaining
governance screens, resolved against the real file list with hyphen-insensitive
matching (our tree kebab-cases what main wrote in camelCase - matching on the
raw name overstates the gap badly, so do not repeat that).

- **44 of 63** resolve to a file that already exists here. Those are import-path
  rewrites, nothing more.
- **19 do not exist anywhere in our tree.** Two of them - `withFeatureFlagGuard`
  and `withPermissionGuard` - are *deliberately* absent: this branch exports
  plain unguarded components and guards at the route, which an earlier lane
  already confirmed. So the real figure is **17 unported modules.**

The nine that matter most are one family: `PeopleTable`, `UnifiedPeopleTable`,
`PeopleFilterBar`, `peopleFilters`, `peopleRows`, `peopleSummary`,
`samplePeople`, `departmentRows`, `AssignDepartmentDialog`. Main has 100 files
under `platform/app/src/components/governance`, all in the PORT-OR-DROP class,
and this family is the part two screens cannot render without.

The other eight: `sample`, `empty`, `targeting`, `inventorySummary`,
`governanceHeroGround`, `governanceHomeSections`, `sourceHealthDisplay`,
`confirmArchiveSource`.

### What this means for sequencing

`governance-users.screen.tsx` is **resolved and staged** - it turned out not to
need the family at all. Main extracted its panel into the shared `PeopleTable`;
this branch still has the panel inline as `UserSpendPanel`, so keeping our
structure and dropping main's extraction is the correct read of "ours is the
restructure, theirs is the feature". All four hunks were checked individually
rather than blanket-resolved.

Not taken, and worth a decision: main **renamed the screen's subject from users
to people** ("All people by ...", `SPEND_SORT_LABEL`). This branch carries a
users screen *and* a people screen, so adopting that copy here would leave two
screens both called people. Main's users-into-people consolidation is unported.

`governance-people.screen.tsx` is the opposite case and should not be attempted
before the family lands: it currently holds **two separate `function
PeoplePage()` definitions** (lines 128 and 346) and imports nine modules that do
not exist. Its eight markers badly understate it.

### E11 continued - the three remaining screens are three different problems

Measured as conflict-region line counts, ours against theirs:

| screen | hunks | ours | theirs | what it means |
| --- | --- | --- | --- | --- |
| overview | 6 | 1055 | 75 | main **collapsed** our inline page into components we do not have |
| inventory | 26 | 326 | 584 | main **added** substantially; ours is the smaller side |
| ingestion-source | 8 | 157 | 57 | ours is larger, divergence is modest |

**overview** is a redesign, not a refactor. Main replaced ~1000 lines of inline
sections with `GovernanceHero`, `GovernanceHeroGround`, `GovernanceHomeSections`
and `QuarantineFillAlert`, and added an insights gate on
`release_ui_governance_billed_cost_enabled`. Keeping ours keeps the working old
page and silently drops that redesign; taking theirs needs four unported
modules. The insights flag gate is separable and portable on its own.

**inventory is the dangerous one.** It is the only screen where main's side is
*bigger* than ours - 584 lines against 326 across 26 hunks. A resolution that
keeps ours here is a ~584-line silent revert of main's work, and it would look
finished. Do not resolve this one by taking a side; it needs hunk-by-hunk
classification the way the Anthropic puller got.

**ingestion-source** is the tractable one: modest divergence, and only two
absent modules (`sourceHealthDisplay`, `confirmArchiveSource`).

### The decision this needs

Whether to adopt main's governance-home redesign - which means porting 17
modules out of `platform/app/src/components/governance` - or to keep this
branch's screens and consciously drop main's UI work on them. That is a product
call, not a merge mechanic, and it governs overview, people and users together.
Recorded rather than guessed.

## Integration queue - branches waiting on this merge

Nothing here can land while `MERGE_HEAD` is live. Reviews were read-only.

### 1. haven install prerequisites - VERIFIED, zero collision

`feat/haven-install-prereqs` and `origin/feat/strict-feature-layout-v0` are the
**same commit**, `7c55e0becf` - not merely an ancestor. Zero divergence is true.

42 files, +5021/-280: a `haven install` prerequisite-check subsystem in
`tools/thuishaven` (domain/prereq.go, app/install.go, a TUI picker, a registry
persisting "never install this" decisions), replacing the old
`dev/scripts/haven-install-path.sh` with a Go port, plus two new spec files.

**Zero overlap with the 530 unmerged paths.** Confirmed by intersecting its 42
changed paths against the unmerged set.

**Two things to carry forward:**

- **"PR #7536" is misattributed.** That PR is the 11,294-file architecture
  refactor (head `feat/strict-feature-layout-v0`, base `main`). There is no PR
  for `feat/haven-install-prereqs` - `gh pr list --head` returns empty. The work
  rode in as the tail six commits of the big branch, so it has **no independent
  review record**. That is a process gap, not a code defect; the diff itself
  reviewed clean.
- **It rewrites the RTK rule in CLAUDE.md** from "always prefix commands with
  `rtk`" to "rtk is optional, check `command -v rtk` first", because rtk becomes
  an offered prerequisite rather than an assumed tool. Any agent instruction
  that assumes rtk is present needs to follow.

### Sequencing consequence - this merge is running on a stale ref

Verified directly: local `feat/strict-feature-layout-v0` is **0 ahead / 6 behind**
origin, and the merge-base *is* local HEAD (`6436e4668c`). So the whole merge is
being conducted on a ref six commits behind its own origin, and those six are
exactly the haven work.

Right now local would fast-forward. **The moment this merge is committed it will
not** - local gains a unique commit, so integrating origin/v0 becomes a second
merge. It should be trivial (zero path overlap), but it is a required step and
it is easy to forget:

    finish the merge -> commit -> merge origin/feat/strict-feature-layout-v0 -> push

Do not attempt the second merge first. Merging anything while `MERGE_HEAD` is
live is not possible, and a `git checkout` to try would destroy the stage data.

## E12 - databricks-genie-puller (SUPERSEDED BY THE CORRECTION BELOW)

`enterprise/modules/governance/server/src/services/databricks-genie-puller.service.ts`
(19 markers, ours 3222L against theirs 4240L)

Main added a paid-Genie-billing feature - 16 functions, roughly a thousand
lines. The clean merge delivered **the entire call graph without a single
definition**. Measured against our side with the conflict regions' `theirs` half
stripped out, these are already called here and do not exist:

| symbol | call sites on our side |
| --- | --- |
| `concat_ws` | 2 |
| `configuredSinceMs` | 1 |
| `paidGenieBill` | 1 |
| `paidGenieBillChunk` | 1 |
| `paidGenieBillEvent` | 1 |
| `paidGenieBillHeld` | 1 |
| `paidGenieBillParameters` | 2 |
| `readPaidGenieBill` | 2 |
| `startOfDayMs` | 2 |
| `walkPaidGenieBillChunk` | 1 |
| `walkPaidGenieBillPieces` | 1 |
| `withoutZeroPrice` | 2 |

Twelve of sixteen. Only `nextPaidBillPosition`, `runNotices`,
`isDatabricksWorkspaceOrigin` and `mergeWarehouseCost` are unreferenced.

**This settles the question of whether to take main's work here: there is no
choice.** Resolving these 19 hunks by keeping ours leaves a file that cannot
run. It is the same class as E9 on the Anthropic puller and the same class the
behaviour test exposed - and it is the third independent instance, so treat
"the clean merge delivered uses without definitions" as the default expectation
for every remaining governance server file, not as a surprise.

The method that works, in order: extract the function inventory from `:1:`,
`:2:` and `:3:`; diff bodies for every shared name rather than trusting the
name; strip the `theirs` half of each conflict and grep the remainder for calls
to symbols that do not exist. That last step is what finds this class, and
nothing about marker counts hints at it.

### 2. vitest poolOptions migration - fix is sound, two of three claims are false

**The code change is real and correct.** `poolOptions` was removed in vitest 4;
the installed version here is 5.0.0 and nothing downstream reads the key, so
replacing it with the top-level `maxWorkers: 1` is the only setting vitest now
honours. A pre-existing doc/test drift was also correctly reconciled: the code
had `const resolvedIsolate = isolate ?? false` for every kind, while the comment
and unit test still claimed jsdom kept isolation on. 12/12 unit tests pass.

**But the reported claims do not survive checking:**

| claim | verdict |
| --- | --- |
| "silently inert" | **false.** vitest prints a bold DEPRECATED banner via `console.error` whenever the dead key resolves. The change's own doc edit says "vitest only warns" - the summary contradicts the diff it describes. |
| "across all 127 package suites" | **wrong.** Real reach is ~27: 26 configs via the shared `moduleVitestTestOptions` helper plus one standalone. No repo metric lands on 127. |
| "restoring a 30% speedup" | **unsupported.** No benchmark anywhere in the diff or docs, and since the old key was already doing nothing, the plausible true effect is ~0%. It is a fix from broken-and-ignored back to as-intended, not a recovered gain. |

Coverage of the fix is complete - zero live `poolOptions` / `maxThreads` /
`maxForks` / `singleFork` uses remain outside comments. It is the *description*
that was wrong, not the work.

**Landing risk, and this one is ours to manage:** the change is **uncommitted
and unstaged** (` M`) in *this* working tree, mid-merge:

    packages/test-harness/src/vitest-config.ts
    sdks/typescript/vitest.governance-e2e.config.mts
    packages/test-harness/src/__tests__/vitest-config.unit.test.ts
    dev/docs/best_practices/testing-speed.md

Unstaged work is not swept into a commit of the index, so the merge commit will
not silently absorb it - but **any `git add -A`, `git commit -a`, or `git
checkout` of those paths would**, and it would land inside the merge commit with
no separate review. The `UU`-only salvage sweep used on this drive does not
touch them. Commit them as their own slice before or after the merge, never as
part of it.

## E13 - CORRECTED: not a blocker. Measured with the rule, it is 2 findings in 1 file

From the `wt/lint-config-slim` review. The branch is clean in itself - 2 commits
ahead, contained nowhere else, contract-complete, baseline untouched, zero path
collision with the 525 unmerged files, and it even repairs stale generated
`dev/docs/lint-rules.md` (the base listed three rules the registry no longer has
and omitted three it does).

**The problem is sequencing.** Its new rule `langwatch/legacy-monolith-path`
bans string literals starting `~/` or containing `platform/app`, at `error`,
with an empty baseline - correct, because at that ref it finds zero hits.

Against **this merge's result** it finds **592 specifiers across 199 files**
(143 `A `, 36 `UA`, 11 `UU`, 1 `DU`, 8 `M `), concentrated in
`enterprise/modules/governance` (52), `enterprise/packages/composition` (38) and
`modules/scenario/{web,contract,server}` (54). Those are exactly the port work
this drive is producing, and they exist on neither parent.

So the moment this merge commits, `pnpm lint:architecture` fails ~592 times.
Three ways out, cheapest first:

1. **Land the rule after the merge and use it to drive the `~/` sweep.** It is a
   precise worklist for the 440-file STALE-IMPORT class this drive already
   tracks - the rule and the remaining work are the same thing.
2. Land it now with 199 baseline rows seeded deliberately, noting the register
   shrinks as the port completes. Costly and noisy.
3. Fix all 592 during the merge. Largest, and it enlarges an already long merge.

**Recommend (1).** Do not merge `wt/lint-config-slim` before this merge lands.

Two small defects to fix either way:
- `MONOLITH_PATH`'s anchor is **untested**. The "merely ends in platform" scenario
  uses `cross-platform/notes.md`, which contains no `platform/app` substring, so
  it passes with or without the boundary class. The real near-misses
  (`cross-platform/app/...`, `platform/apps/...`) are never exercised.
- `LEGACY_PATH = /^~\//` has a latent false positive on home-directory strings
  such as `"~/.config/..."` in CLI code (`apps/server` and `sdks/typescript/src`
  are both in the linted set). Zero hits today, but the message would be wrong
  and the only escape is a baseline row.

## E14 - governance-web has no jest-dom, and 11 test files assume it

Found while resolving `tool-catalog-editor-starter-pack.integration.test.tsx`:
the assertion failed with `Invalid Chai property: toBeInTheDocument`.
`@langwatch/enterprise-governance-web` configures no jest-dom setup file, yet
**11 test files in the package call `toBeInTheDocument`**. They came across from
a monolith that did configure it.

Resolved this file by keeping main's corrected copy ("starter tools" - verified
against the component, which says exactly that, so our "starter tiles" was
stale) with our working `toBeTruthy()` matcher. That is theirs-for-content,
ours-for-infrastructure, and it passes.

**The real fix is the package's vitest setup, not ten more matcher swaps.** Add
a jest-dom setup file to `enterprise/modules/governance/web/vitest.config.ts`
and the other 10 files start working as written. Until then they fail on any
assertion that reaches the matcher.

### Loose end from the ai-tools resolution: a workspace link exists only on disk

`tool-catalog-editor.tsx` needed `TileIcon`, which this branch had already moved
to `modules/user/web/src/ui/elements/tile-icon.tsx` but never exported. Resolved
by mirroring the existing `@langwatch/authz-web/surfaces/scope-picker` pattern:

- `modules/user/web/package.json` gains a `./surfaces/tile-icon` subpath export;
- `enterprise/modules/governance/web/package.json` gains
  `"@langwatch/user-web": "workspace:*"`.

Both are staged. The edge is precedented (governance-web already depends on
`authz-web` and `coding-agent-web`) and creates no cycle - user-web depends on
nothing enterprise.

**But `pnpm install` has NOT been run.** `pnpm-lock.yaml` is itself a conflicted
file mid-merge (`MM`), and an install would rewrite it in a way nobody could
review against the merge. So the `node_modules` link was created by hand to
verify the resolution, and the test passes. **Run `pnpm install` at the repo
root after the merge commits and before pushing** - otherwise CI resolves the
new dependency against a lockfile that does not list it.

Note `ToolCardFigure.tsx` in the same package still imports `TileIcon` from the
old `~/components/me/tiles/TileIcon` path. It is in the STALE-IMPORT class and
should be pointed at the new subpath export in the same sweep.

### E13 correction - measured, not estimated

The section above was written from the `wt/lint-config-slim` review and **its
headline number is wrong, as was my restatement of it.** Corrected here rather
than edited away, because the reasoning error is the useful part.

**What is actually true:**

1. `langwatch/legacy-monolith-path` is **already in this merge's working tree** -
   enabled at `error` in `.oxlintrc.architecture.json`, rule file staged (`A `),
   plugin and baseline modified. Neither parent has it (`HEAD` and `MERGE_HEAD`
   both return 0), so it arrived from the `/lint-rule` work earlier in this
   drive. The `wt/lint-config-slim` branch carries a byte-identical rule file.
2. Its baseline is **not empty here: 275 rows**, seeded when the rule was added.
3. Measured by running the rule over the linted path set
   (`apps packages modules enterprise sdks/typescript/src mcp/typescript/src`):
   **2 findings, 1 file.** Not 592, not 199 files.

**Why both estimates were wrong, and it is the same mistake twice.** The rule
fires on `Literal` nodes only. Counting `~/` and `platform/app` by grep also
counts them in **comments and prose** - the first "offender" I checked,
`modules/api-key/web/src/api-keys.ts`, matched on the phrase "the one
`platform/app`" inside a doc comment. My grep said 633 files; the rule says 1.

**The lesson, which the lint-rule skill already states:** measure a rule by
running the rule. A grep for its pattern is not a proxy for it, and neither is a
reviewer's count of import specifiers, because neither consults the baseline or
the AST.

**The one real finding** is
`enterprise/modules/governance/server/src/services/__tests__/ingestion-pull-worker.deadline.unit.test.ts`,
which still mocks the monolith: `vi.doMock("~/server/db")` and
`vi.doMock("~/server/app-layer/app")`, 4 `vi.doMock` calls over 227 lines. Its
sibling `ingestion-pull-worker.dispatch.unit.test.ts` was already converted to
the DI/port harness (`TestHttp`, `createWorkerService` from
`../../__tests__/support/puller-test-ports.ts`) - that file is the exemplar and
this one needs the same conversion. It is the last thing standing between this
merge and a clean `legacy-monolith-path`.

So `wt/lint-config-slim` is **not** blocked by 592 lint failures. What remains
true from that review: land it after the merge (its config-split collides with
root-cleanup, see below), and its two small rule defects are worth fixing.

## E15 - root-cleanup (PR #8087) renames the lint packages this merge is editing

`feat/root-cleanup` = `bebe0ec7f6`, 10 ahead of our pre-merge tip and branched
off it exactly, so no drift. Only 3 commits are its own; the other 6 are
`feat/haven-install-prereqs` folded in whole. PR **#8087**, open, mergeable.

It renames two packages wholesale:

- `packages/architecture-lint/**` -> `packages/architecture-enforcer/**` (~170 files)
- `packages/lint-core/**` -> `packages/oxlint-rules/**` (~140 files)

and splits `.oxlintrc.architecture.json` (1219 lines) three ways into
`.oxlintrc.jsonc`, `packages/architecture-enforcer/oxlint.architecture.jsonc`
and `dev/lint/oxlint.baseline.jsonc`.

### The dangerous collision

**This merge is editing `.oxlintrc.architecture.json` right now** - it is where
`"langwatch/legacy-monolith-path": "error"` was added (see E13). Root-cleanup
rewrites that same file into three. Git tracks only one rename pairing, and it
picked the **debt-override** leg, not the rules leg. So a later 3-way merge will
try to apply our rule-toggle hunk to the wrong destination: a loud conflict at
best, a silent misplace at worst.

Second, this merge has staged **new files at the pre-rename paths**:
`packages/lint-core/src/rules/legacy-monolith-path.rule.mjs` (+ its test) and
`packages/architecture-lint/tests/{localDevLicense,scenario-annotation-binding.guard}.unit.test.ts`.
None exist under the new names. Directory-rename detection should carry them,
given ~170 and ~140 files establish the mapping - but that must be **verified,
not assumed**, and the new rule needs registering in the plugin at its new path.

### Landing order

1. **Finish this merge first.** Resolving the rule addition and the new test
   files while they are still at their pre-rename paths is a plain
   base-versus-theirs port; reconstructing where a rule belongs across three
   already-split destinations is not.
2. Then rebase/merge `feat/root-cleanup`.
3. Then verify by hand: (a) `legacy-monolith-path` ended up in `.oxlintrc.jsonc`
   and not in the baseline file; (b) the four new rule/test files landed under
   `architecture-enforcer` / `oxlint-rules` rather than orphaned; (c) regenerate
   `pnpm-lock.yaml` rather than trusting an auto-merge - and note this is the
   same install the `@langwatch/user-web` dependency needs; (d) sweep the ~150
   stale `architecture-lint` / `lint-core` prose references in CLAUDE.md,
   AGENTS.md, CODEOWNERS, CI workflows and `.claude/skills/*`. None break the
   build; all become factually wrong the moment root-cleanup lands.

Deletions check out: `apidiff` (a 9.8MB binary committed by accident) and
`dev/scripts/haven-install-path.sh` (superseded by the Go port) have no live
references. Three marketing media files under `assets/` are deleted with no
stated reason while their siblings are relocated - a documentation gap, not a
risk. No pnpm override or workspace member is dropped.

### E13 closed - the rule is now clean across the whole linted tree

The one finding is resolved. `ingestion-pull-worker.deadline.unit.test.ts` had
four `vi.doMock` blocks left over from the monolith, two naming `~/server/db`
and `~/server/app-layer/app`, two naming repository paths that **do not exist on
this branch at all**. All four were dead: the file already imports the DI
harness (`createWorkerService`) and its `runIngestionPull` helper calls the
`vi.fn()` stubs directly, so nothing resolved through the mocked modules.
Removed the blocks; the 14 stub references the test actually uses are untouched.

Re-measured over the full linted path set: **0 findings.** The rule now passes
tree-wide, so it is no longer a merge blocker in any form.

The test cannot be *run* yet, but for an unrelated reason: it imports
`databricks-genie-puller.service.ts`, which still holds 19 conflict markers
(E12). It parses clean and lints clean. Run it once E12 lands.

### E12 corrected and fully classified

**The earlier table overstated it the same way E13 did.** That "12 of 16
mandatory" count came from stripping the `theirs` half and grepping for calls to
symbols that appeared undefined. Two errors in that:

- `concat_ws` is **SQL inside a query string** (`concat_ws(',', sort_array(...))`),
  not a TypeScript symbol at all.
- Most of the paid-billing feature **is already defined in clean regions** - the
  clean merge brought it in. `paidGenieBill`, `paidGenieBillChunk`,
  `walkPaidGenieBillChunk`, `walkPaidGenieBillPieces`, `paidGenieBillEvent`,
  `paidGenieBillParameters`, `readPaidGenieBill`, `withoutZeroPrice` and
  `paidGenieBillRowSchema` are all present already.

#### The verified inventory

Function bodies extracted from `:1:`, `:2:` and `:3:` and compared, not matched
by name:

| class | count | members |
| --- | --- | --- |
| module fns in base, all converted to statics on our side | 26 | - |
| **changed by main** (shared name, different body) | 6 | `nextCursor` `parseCursor` `readUnsuccessfulWarehouseCost` `resolveWorkspaceToken` `spaceWalkPlan` `sweptUpTo` |
| new module fns in main | 8 | `configuredSinceMs` `nextPaidBillPosition` `paidGenieBillEvent` `paidGenieBillParameters` `readPaidGenieBill` `runNotices` `startOfDayMs` `withoutZeroPrice` |
| new instance methods in main | 5 | `paidGenieBill` `paidGenieBillChunk` `paidGenieBillHeld` `walkPaidGenieBillChunk` `walkPaidGenieBillPieces` |

**Actually still missing, measured by references from our+clean side:**

| symbol | refs | note |
| --- | --- | --- |
| `unreadable` | **46** | main's refusal-tracking flag, threaded everywhere |
| `paidGenieBillHeld` | 1 | private method, absent from our file and from every hunk |
| `startOfDayMs` | 2 | in a theirs-hunk |
| `configuredSinceMs` | 1 | in a theirs-hunk |

Not needed (0 refs): `paidBillWindow`, `runNotices`, `nextPaidBillPosition`,
`isDatabricksWorkspaceOrigin`, `mergeWarehouseCost`. `WarehouseCostChunkOutcome`
and `GENIE_FREE_USAGE_SKU_MARKER` already exist here.

#### Per-hunk plan (19 hunks)

| hunk | action |
| --- | --- |
| 1 | take theirs' added import names, against **our** `../rules/warehouse-cost.rules.ts` |
| 2 | keep ours (theirs is monolith import paths) |
| 3 | drop - `isDatabricksWorkspaceOrigin` has 0 refs |
| 4 | update our `resolveWorkspaceToken` static with main's body |
| 5 | drop dups (`unpricedFloor`, `warehouseCostObserved`, `readWarehouseCost`, `warehouseAnswerCutShort`); update `readUnsuccessfulWarehouseCost` |
| 6 | drop `startOfHourMs`/`endOfHourMs` dups; port `startOfDayMs` |
| 7 | drop `nextWatermark`/`withoutOrphanedResume` dups; port `configuredSinceMs`; update `parseCursor` |
| 8 | update `spaceWalkPlan` and `sweptUpTo`; drop `conversationWalkPlan`/`stoppedAt` dups |
| 9 | keep ours (`GenieHttpError` + our class name `DatabricksGeniePullerAdapter`) |
| 10 | take theirs' `unreadable` destructure and paid-bill branch; keep our `this.warehouseCosts.costReadFloor` and `nowInstant()` |
| 11 | keep ours (Temporal); `paidBillWindow` has 0 refs |
| 12, 15 | take theirs' `WarehouseCostChunkOutcome` return type; keep our `this.warehouseCosts.pieces` |
| 13, 14 | add `unreadable: false`; keep our `DatabricksGeniePullerAdapter.unpricedFloor` |
| 16 | keep our Temporal formatting; add `unreadable` - **see the blocker** |
| 17 | keep ours (our inline `genieGet`) |
| 18 | drop `withWarehouseCost` dup |
| 19 | keep our 20 statics; update `nextCursor`; `runNotices`/`nextPaidBillPosition` have 0 refs |

#### The blocker: two variable vocabularies coexist in clean regions

Main renamed our `refused` to `walked.heldAt` and hung `walked.unreadable` off
it. **Both survive the clean merge**: `walked` 9 refs, `heldAt` 21, `refused`
26, all in regions git did not mark. So the file is a hybrid of two naming
schemes, and the last hunks cannot be resolved without picking one and sweeping
it across ~56 unconflicted references.

That is why this file is not mechanical and should not be handed to a lane as
one. It wants a single focused pass that (a) picks `walked.heldAt` (main's, since
`unreadable` hangs off it and has 46 refs), (b) rewrites our `refused` sites to
match, (c) applies the table above, (d) ports `paidGenieBillHeld` from `:3:`.

`warehouse-cost.rules.ts` is clean and does **not** know `unreadable`; check
whether the threading needs it before assuming this file is self-contained.

## E12 RESOLVED - databricks-genie-puller.service.ts is staged

0 markers, 0 stale imports, 0 `Date.now`/`Date.parse`/`new Date`, parses clean.
Resolution followed the classification above:

- 19 hunks resolved by the per-hunk table (ours for structure, theirs for the
  `unreadable` feature and the paid-bill branch).
- `parseCursor` patched to emit main's two new cursor fields
  (`paidBillReadThroughMs`, `paidBillHeldSinceMs`) via `configuredSinceMs` -
  the cursor schema in the clean region **requires** them, which is what the
  ZodError in the first test run was reporting.
- `nextCursor` gained main's `paidBillWindow` parameter and the
  `nextPaidBillPosition` fold, and the call site now passes `paidBill.window`.
- Three statics ported from `:3:`: `startOfDayMs`, `configuredSinceMs`,
  `nextPaidBillPosition`.
- `resolveWorkspaceToken` was **left as ours**: main's version throws
  `ProviderSignInError` and calls `ssrfSafeFetch`, neither of which exists on
  this branch, and `ProviderSignInError` has 0 references here.

### Three mistakes worth not repeating

1. **Brace-matching from the first `{` splices the wrong region.** A function
   with destructured parameters opens a brace in its signature, so "find the
   body brace" must count from the declaration line and stop when depth returns
   to zero - not seek the first `{`. The first attempt spliced
   `resolveWorkspaceToken` into the middle of another function.
2. **A negative lookbehind of `(?<![\w.@$])` silently skips spread calls.**
   `...withWarehouseCost(` is preceded by `.`, so the prefixing pass missed it
   and left a bare call that resolved to nothing. Symptom: the test returned
   zero events rather than crashing.
3. **Replacing a whole helper because its name matched is the E9 error again.**
   Main's change to `resolveWorkspaceToken` was only `Error` ->
   `ProviderSignInError`; taking the whole body dragged in `ssrfSafeFetch`.
   Diff base against theirs, port the *change*, not the function.

### Still blocked, and it is a sibling, not this file

`pnpm --filter @langwatch/enterprise-governance-server test:unit
src/services/__tests__/databricks-genie-puller.unit.test.ts` cannot run:

    Cannot find module '~/utils/ssrfProtection'
    imported from .../services/genieSpaces.ts

`genieSpaces.ts` is a **clean-add resurrection** (`A `) carrying main's
`ssrfSafeFetch` import. Our puller does not need it - `walkGenieSpaces` takes a
`readPage` callback and gets our injected `GovernanceHttpClient` - but
`genieGet` in the same module does, and `databricksScimUsers.ts` (another
resurrection) imports `genieGet`.

**This needs a decision, not a swap.** `@langwatch/egress` exports
`fetchValidatedDestination`, but it takes a pre-validated `SsrfValidationResult`
and is not a drop-in for `ssrfSafeFetch(url, init)`, and the governance server
package does not depend on egress. The branch's own answer everywhere else is
the injected `GovernanceHttpClient`, so the likely right move is to give
`genieGet` the same seam - which changes `databricksScimUsers.ts` too.

Baseline note: the file's only pre-existing row is `no-port-vocabulary`.
`unbounded-loop` fires on a `for (;;)` that is present in **both** parents, so
it is pre-existing rather than introduced here; `service-classes` is the same
module-wide finding recorded for the other pullers.

## E16 - the genieGet seam decision, taken

**Decision: `genieGet` takes the injected `GovernanceHttpClient`.** Not
`ssrfSafeFetch` (monolith, gone) and not `@langwatch/egress`.

Why this and not egress: the seam already exists and matches exactly - both
take `(url, { method, headers, signal, followRedirects })`, and
`GovernanceHttpResponse` already carries `ok`, `status`, `statusText` and
`json()`. The `followRedirects` field is even documented as "forwarded to the
SSRF-safe process adapter for secret-bearing calls", so SSRF policy stays in
one place, the adapter. `@langwatch/egress`'s `fetchValidatedDestination` takes
a pre-validated `SsrfValidationResult` and is not a drop-in, and the governance
server package does not depend on egress. Every other puller on this branch
already injects its client.

Applied to `genieSpaces.ts` (`genieGet`, `listGenieAgents`) and
`databricksScimUsers.ts` (`listDatabricksPeople`), all threading `http`.

### Result: databricks-genie-puller is now test-verified

`databricks-genie-puller.unit.test.ts` **11/11**, and with
`databricks-warehouse-cost.service.unit.test.ts` **38/38**. Getting there needed
four more fixes beyond the seam, each worth knowing:

1. **`get()` was truncated.** Taking ours for hunk 17 kept our URL/signal/budget
   logic but dropped the tail - the `response.ok` check and `return await
   response.json()` lived in main's half. The method fetched and returned
   `undefined`, and the sweep's `spacesPageSchema.parse(undefined)` threw into a
   catch that logs and returns `{ events: [], cursor: options.cursor }`. Symptom:
   every test saw zero events and a null cursor, with the real error swallowed.
   **A `catch` that logs is why this took four rounds to find** - a temporary
   `console.error` in that catch named it in one run.
2. **The spread-call bug, a second time.** `...runNotices(` was still bare;
   the earlier fix only caught `withWarehouseCost` because `runNotices` was not
   yet a static when that pass ran.
3. **Five constants never ported** - `WAREHOUSE_COST_UNREADABLE`,
   `PAID_GENIE_BILL_UNREADABLE`, `ONE_DAY_MS`, `PAID_GENIE_BILL_LINE`,
   `PAID_GENIE_BILL_SETTLING_LAG_MS` - all in hunks dropped as duplicate-bearing.
4. **`warehouseCostChunks` -> `this.warehouseCosts.chunks`**: one more of main's
   module helpers that this branch moved onto the rules object.

### A behaviour change adopted, and why it is not a test being bent to pass

Four tests asserted `cost_usd: "0"` on an unpriced question. Main **removed**
that, and the clean merge had already applied the removal - our file now carries
main's comment verbatim:

> "No amount at the point the message is built - not zero. [...] a zero here is
> indistinguishable from a question that genuinely cost nothing: the record seam
> reads `cost_usd` as the reported amount when the hint names none, so a "0"
> would land on the ledger as a measurement."

So the tests encoded the old behaviour. They now assert `costUsd` is
**undefined**, which keeps each test's intent (an untrustworthy billing answer
must not produce a priced figure) against the stronger new rule. This is
"theirs is the feature" applied to a deliberate, documented change - not an
assertion relaxed to get green.

### What the seam change leaves for the resurrection sweep

Four callers now need an `http` argument. **All four are already-broken clean-add
resurrections**, so nothing regressed - `agentListing`/`peopleListing` fail today
on an unrelated missing module (`./dataverseEnvironment` from `copilotBots.ts`):

- `enterprise/packages/composition/api/src/governance/agentDiscovery.service.ts`
  (also imports a `./pullers/genieSpaces` path that does not exist here)
- `enterprise/packages/composition/api/src/governance/personListing.service.ts`
- `.../__tests__/agentListing.unit.test.ts` and `peopleListing.unit.test.ts`,
  which `vi.mock("~/utils/ssrfProtection")` - a **string**, so a `from "~/`
  grep does not see it. Worth remembering when auditing stale imports.

The three `databricksGenie*.unit.test.ts` files are main's own tests, resurrected.
Their imports are now repointed at our module and symbol names, which moves them
from "cannot load" to "loads and fails on main's fixtures". Porting their
harness is a separate task; our own puller test already covers the feature.

## E17 - governance-ingestion-source.screen.tsx resolved, and one module moved

Resolved 8 hunks: **theirs** for main's real fixes, **ours** for the empty pane.

Two customer-visible fixes of main's that would have been lost by keeping ours,
and are the reason this screen was not just "take ours":

- **The status badge lied.** Main replaces our inline `STATUS_META` lookup with
  `sourceBadge({ status, errorCount, completeness })`. Its own comment says why:
  *"A run stopped by a page limit reports no error, so without this the badge
  reads Active on a source collecting a fraction."*
- **Archiving asked inconsistently.** `confirmArchiveSource` exists because the
  detail page asked before archiving and the table's row menu did not - so the
  same destructive action cost two clicks on one screen and one on the other,
  and the cheaper one had no way back.

Also took main's neutral restyle of the "Heads up" callout and its tooltip hint.

### The module move, and why

`sourceBadge` lives in main's `sourceHealthDisplay.ts`, which imports
`deriveSourceHealth` from `@ee/governance/services/pullers/sourceHealth`. On
this branch that logic sat in **`server/src/services/sourceHealth.ts`**, and a
web file value-importing it would trip `web-imports-server-shaped-value`.

The file has **zero imports** - it is a threshold constant and a comparison, not
a service - so it moved to `contract/src/source-health.ts` and is exported from
the contract barrel. This is exactly CLAUDE.md's prescription: move the shared
value into a framework-free module both sides import. One consumer (its own
test), repointed, 5/5 passing.

**Baseline checked before and after**: neither the old nor the new path carries
a row, so the move creates no shrink-only violation. The 5 `temporal-only` /
`fallible-result-naming` findings on that file are **pre-existing content debt**
- verified by linting the identical content at the old server path, which
produces the same 5. Worth fixing, but not by this change.

Ported alongside it, both framework-free:
`web/src/features/ingestion-sources/model/source-health-display.ts` (140 lines)
and `.../confirm-archive-source.ts` (18 lines).

### Deferred deliberately: main's empty-pane restructure

Hunks 5 and 7 keep **ours**. Main replaces our `EmptyEventsHint` with
`EmptyEventsState` / `EventsSetupPopover` from `SourceEventsSetup.tsx`, which is
itself a resurrection importing `~/components/governance/empty`
(`GovernanceEmptyState`) and `~/components/ui/popover`. `Popover` exists here as
`@langwatch/design-system/popover`, but **`GovernanceEmptyState` does not exist
in this tree at all** - `agents.tsx` imports it from the monolith too.

So this is deferred, not dropped: our empty pane works and is self-contained.
Porting `GovernanceEmptyState` unblocks it, `agents.tsx`, and the two
`SourceEventsSetup` tests together - a good next unit of resurrection work.

The 23 failing suites under `ui/sections/governance/__tests__/` are all that same
chain (`~/components/governance/sample`, `~/server/api/rbac`,
`~/components/WithFeatureFlagGuard`, `../inventory`, ...), none of them this file.

## E18 - a real ingestion bug fixed: zero-valued OTLP attributes were being dropped

`modules/trace/server/src/services/ingestion/otlp-trace-request.service.ts`

`intScalar` and `doubleScalar` guarded with **falsiness**, not absence:

    if (!("intValue" in v) || !v.intValue) return void 0;

So a span attribute sent as `intValue: 0` or `doubleValue: 0` was discarded as
though it had never been sent - "zero errors" and "errors never measured" became
the same trace. `boolScalar` was already correct (`=== null`), which is why only
the two numeric paths were affected.

Main had already fixed this (`!= null` in its legacy
`traceRequest.utils.ts`); the fix was never ported. Both guards now test for
absence, with a comment saying why.

**Our own tests asserted the bug.** They were named `drops intValue 0 due to
falsy check` and carried `// BUG:` comments describing it. Main's replacements
(`keeps intValue 0`, bound to the scenario *"A neutral vote is kept as the value
it was sent as"*) are now in place, with `TraceRequestUtils` mapped to our
`OtlpTraceRequestService`. **53/53 passing.**

This is the clearest case yet of why "keep ours" is not a safe default on this
drive: ours was self-consistent, green, and wrong.

## E19 - scenario-contract was missing an export its own consumers already used

`modules/scenario/contract/src/index.ts` re-exported `./suite-fields.ts` but not
`./evaluator-attachments.ts`, while already-merged
`modules/scenario/web/src/ui/sections/agent-testing/run/plan-scope.ts` imports
`parseEvaluatorAttachments` from `@langwatch/scenario-contract`. Added the
export; no name collides with `suite-fields.ts`.

## E20 - suite-wire-v1.rules.ts still needs three decisions (not mechanical)

`modules/suite/server/src/rules/suite-wire-v1.rules.ts`, 4 hunks, left
unresolved with markers intact. Hunk 1 and part of 2 are mechanical (main's
`~/` imports are already covered by our contract imports). The rest is not:

1. **`"voice"` in the target-type enum.** Main's hunk 2 adds it, but the enum
   now lives in `modules/suite/contract/src/suite.ts` (`suiteTargetTypeSchema`)
   and does not carry it. This is coupled to the **reserved voice decisions** -
   the ~22 voice runtime modules in `modules/scenario/contract`, the vendored
   scenario SDK pinned at `^1.3.0` against main's `voice7`, and the voice-agent
   host interface from `agent-type-selector-drawer.tsx`. Adding the enum value
   alone would accept a wire shape nothing here can service.
2. **Where `toRunPlanWire` / `toTestSuiteWire` / `readTargets` belong.** They
   read `SimulationSuite` straight from the generated Prisma client, which under
   the typed-Prisma-seam convention does not belong in a `rules/` module. That
   is an architecture call, not a merge call.
3. Hunks 3-4 also carry `evaluatorAttachmentSchema` / `suiteFieldDefinitionSchema`
   / `parseSuiteFieldDefinitions`, which now live in `modules/scenario/contract`.
   With E19 fixed these resolve, so once (1) and (2) are answered the hunks are
   mostly import rewrites.

## Unrelated finding worth a look

`modules/trace/server/src/services/offload/__tests__/trace-cold-scan-detector.service.unit.test.ts`
fails: `governance_cost_rollup_1d` is partitioned by a time expression but is
not listed in `TIME_PARTITIONED_TABLES`, so its unpruned reads are never
flagged. Nothing to do with the OTLP change - it is a new governance table that
arrived with the merge and was not registered with the cold-scan detector.

## E21 - DECISION TAKEN: voice is accepted (Alex, 2026-09-12)

The reserved voice decision is answered: **adopt main's voice feature.** What
that unblocked, and what it now costs.

### Done

`"voice"` added to `suiteTargetTypeSchema` in `modules/suite/contract/src/suite.ts`.
It flows automatically into `suiteTargetBaseSchema` and `suiteTargetSchema`.

**It forced a second decision immediately**, which is the useful part: the enum
is consumed by an exhaustive `switch` with a `never` guard in
`modules/suite/server/src/rules/suite-target.rules.ts`, so adding a member broke
compilation until `"voice"` was classified. Main's answer is in
`useFilteredScenarioTargets.ts`, whose `SCENARIO_AGENT_TYPES` set contains
`voice` - so a voice target **is** an agent target, and `isAgentTarget` now says
so. Taken from main rather than guessed. 58/58 rules tests pass.

`suite-wire-v1.rules.ts` is resolved and staged as a result. Its four hunks were
**not** duplicates, contrary to a first reading: `testSuiteCreateInputSchema`,
`toRunPlanWire`, `toTestSuiteWire` and `readTargets` appear in the file only
*inside* the conflict block, so our clean side had none of them. Took theirs for
hunks 3-4, ours for hunk 2 (`suiteTargetSchema` already lives in our contract),
and rewrote main's 15 monolith imports onto our packages - 6 were already in our
import block, the rest resolve to `@langwatch/scenario-contract` (via E19),
`@langwatch/suite-contract` and `@langwatch/prisma-client/generated`.

**Watch for this pattern:** `grep -c "export function X"` on a conflicted file
counts definitions inside the `theirs` half too. Strip the conflict regions
before asking what our side actually has.

### The bill: 8 port-vocabulary violations, and they are a build failure

Main's voice code speaks the older "port" vocabulary this branch bans.
`langwatch/no-port-vocabulary` is at `error` with a **shrink-only** baseline, and
these files carry **zero baseline rows**:

    modules/scenario/contract/src/voice/voice-session.ports.ts
    modules/scenario/contract/src/voice/whole-call-audio.ports.ts
    modules/scenario/contract/src/voice/__tests__/voice-session.ports.unit.test.ts
    modules/scenario/contract/src/voice/__tests__/voice-session.service.unit.test.ts

All three `*.ports.*` files are staged clean-adds (`A `). A lane is renaming them
to role names (`voice-port-vocabulary` manifest); the fix is a rename, never a
baseline entry.

This is the same question raised at the top of the session - whether the repo
still lints against ports. It does, it is the largest baseline class in the
repository (1,433 rows), and accepting voice is what turned it from trivia into
a blocker.

### Still open: voice is in the wrong package

`modules/scenario/contract/src/voice/` holds **23 files, 12 of which import
server or monolith paths** (`~/server/app-layer/app`, `getApp()`). A contract
package composing production services from the app is backwards -
`whole-call-audio.ports.ts` literally builds readers out of `getApp()`.

This is the "~22 voice runtime modules in `modules/scenario/contract`" item from
the reserved list. Accepting voice does not answer it: the feature is in, the
placement is still wrong, and the server half belongs in
`modules/scenario/server`. Worth doing as its own move once the rename lands,
because moving files that carry baseline rows re-reads their findings as
additions.

The scenario SDK pin needed a real check - see E24, which corrects the claim
made here.

## E22 - langy skill gating is deferred, and the palette now offers every skill

`modules/langy/web/src/features/langy/ui/elements/langy-composer-palette.tsx`

Main gates mutually-exclusive skills - `lwql-charts` against
`playground-widgets` on `release_custom_chart_playground` - through
`isSkillAvailable({ skill, isFlagEnabled })`, reading `skill.featureFlag` and
`skill.excludedByFlag`.

**Neither field exists on this branch**, on `LangySkill`
(`modules/langy/web/src/model/shared/langy/langy-skills.ts`) or in the
`SKILL.md` front-matter the generated catalogue is built from - verified, both
greps are empty. So the gate could not be ported as part of the file's
resolution, and the palette currently offers **every skill unconditionally**.

No crash, but it is a real behaviour gap: two skills that main treats as
mutually exclusive are both offered. Porting it is a pipeline change, not a
one-liner:

1. add `featureFlag` / `excludedByFlag` to the `SKILL.md` front-matter of
   `skills/_compiled/native/{lwql-charts,playground-widgets}`
2. teach `modules/langy/server/scripts/generate-langy-skills.ts` to carry them
   into `langySkills.generated.json`
3. add the two optional fields to `LangySkill`, plus an `isSkillAvailable`
   export
4. filter in the palette the way main does

A `TODO(merge)` at the exact spot names all four steps. It describes what is
missing rather than claiming behaviour the code does not have, which is the
right shape for a deferral marker.

### The tail lane finished cleanly

`tail-langy-nav-agent`: 10 assigned files plus 2 directory-rename dependency
fixes (`HeroAskField.tsx`, `AskChip.tsx`), all staged, all verified here at zero
markers and zero stale imports. Tests green where they exist: navigation
24/24 and 8/8, langy composer 6/6, project home 96/96.

## E23 - DECISION TAKEN: localDevLicense now lives in the licensing module

The reserved `localDevLicense` placement decision is answered, because
`packages/prisma-client/prisma/seed.ts` could not be resolved without it -
`resolveSeedLicense` is called 3 times and `LOCAL_DEV_ENTERPRISE_LICENSE_KEY`
twice from the file's **clean** regions, so the clean merge had delivered the
uses without the definition. Same class as E9, E12 and E18.

Main kept it at `platform/app/scripts/localDevLicense.ts` (55 lines, never
ported). It is licensing logic, and the seed already depended on
`@langwatch/enterprise-licensing-server`, so it landed at
`enterprise/modules/licensing/server/src/seeding.ts` behind a new `./seeding`
subpath export.

**One adaptation, not a copy.** The monolith imported free functions
`parseLicenseKey` / `verifySignature`. On this branch they are methods on
`NodeLicenseCryptographyAdapter`, whose constructor is private - so the port
goes through `NodeLicenseCryptographyAdapter.create({ publicKey })`, built
**once per resolve** rather than per candidate, because construction
canonicalises the PEM.

`PUBLIC_KEY` mapped to `DEFAULT_LICENSE_PUBLIC_KEY` from
`@langwatch/enterprise-licensing-contract`, which is now a `devDependency` of
`packages/prisma-client`. `hashSecret` needed nothing - it only appears in a
comment, which a naive import sweep would have "fixed" into a real import.

## Voice port-vocabulary rename: verified clean

The lane reported 8 -> 0 and it holds independently: the rule reports **0**
violations under `modules/scenario/contract/src/voice/`, no `*.ports.*` file
remains anywhere, and **no `no-port-vocabulary` row was added** to the baseline.

Renames: `whole-call-audio.ports.ts` -> `whole-call-audio.infrastructure.ts`,
`voice-session.ports.ts` -> `voice-session.infrastructure.ts`, the `*Ports`
types to `*Infrastructure`, and the two test files to match.

### The baseline's 1100 staged insertions are legitimate

Checked rather than assumed, because a shrink-only register showing +1100 looks
alarming. Every added row is `legacy-monolith-path` (275 of them, 0 removed, 0
`no-port-vocabulary`). `oxlint-baseline-check.ts` supplies a `seeds` predicate
to `shrinkCheck`, and it returns true when the rule appears **nowhere** in the
merge base:

> A rule that did not exist in the merge base cannot have shrunk from anything,
> so its first measurement is a seed rather than growth.

`legacy-monolith-path` is new in this drive, so its rows are seeds. Growth of a
rule the merge base already knew is still refused.

## Down to 3 conflicted files

Only the governance screens remain: `governance-inventory.screen.tsx` (26),
`governance-people.screen.tsx` (8), `governance-overview.screen.tsx` (6). All
three wait on the governance-home redesign decision recorded in E11.

Also worth noting: `specs/ai-gateway/governance/ui-contract.feature` has 22
scenarios and only 6 carry a binding tag. Taking main's side improved it (1 -> 6)
rather than regressing it, but 16 scenarios still bind nothing and read green.

## E24 - CORRECTION: "voice7 appears nowhere" was wrong

Alex caught this. The earlier claim came from grepping three files, which is not
a search. `voice7` **does** appear:

    platform/app/package.json:117
      "@langwatch/scenario": "file:vendor/langwatch-scenario-1.7.0-dev.voice7.tgz"

That file is `DU` - main modified it, this branch deleted the monolith - so
main's vendored pin lands nowhere. Which is correct, but it is a fact to state,
not one to miss.

### What is actually true, measured

- **The tarball is gone.** `platform/app/vendor/` in this tree holds only a
  `README.md`; the `.tgz` files exist solely in an unrelated worktree
  (`.claude/worktrees/identity-auth`).
- **That README is stale in main too.** It documents `1.7.0-dev.voice4` while
  main's `package.json` pins `voice7` - they disagreed before the merge.
- **The catalog pin is sufficient.** Our voice code reads exactly two members
  off the SDK's voice namespace, `scenarioVoice.openTwilioTunnel` and
  `scenarioVoice.twilioAgent`. Both `1.3.0` and `1.6.0` export `index as voice`
  and both carry those two symbols. So `^1.3.0` resolves the voice imports.

So the conclusion held, but it was reached carelessly and stated as if the
absence of a string proved it. The right evidence is the export list, not a grep
for a version tag.

### The real defect this surfaced: a phantom dependency

`modules/scenario/contract` imports `@langwatch/scenario` in **6 files** -
including the voice transports - and **did not declare it**. It resolved only
because a sibling package hoisted it. Added as `"@langwatch/scenario":
"catalog:"`, matching `modules/scenario/server`, `modules/trace/server`,
`apps/ui` and `apps/worker`.

This was resolved rather than left open - see E25.

## E25 - DECISION TAKEN: the voice tarball is vendored from origin/main

Alex: pull main's tarball and pin to it. Done.

`vendor/langwatch-scenario-1.7.0-dev.voice7.tgz` at the **workspace root**,
byte-for-byte from `MERGE_HEAD:platform/app/vendor/` (1.9 MB, sha256
`d0adcf874ec0ff8396253f396a43b3313b9eb1093c011561c2f5ee20630169b7`). The old
home went with the monolith; the root is where every consumer can reach it, and
all five use `catalog:`, so the catalog entry is the single point of change:

    '@langwatch/scenario': file:./vendor/langwatch-scenario-1.7.0-dev.voice7.tgz

Verified the artifact carries what the code needs: `index as voice`,
`openTwilioTunnel`, `twilioAgent`, `AgentRole`, `AgentAdapter`.

### The filename lies, and it is load-bearing

The file is called **voice7**. The `package.json` inside declares
**`1.7.0-dev.voice6`**. That mismatch came with main's artifact - its sibling
`voice4` tarball is self-consistent, so it is specific to this one.

It would be a footnote except that `pnpm-workspace.yaml` carries an override
keyed on the **exact** scenario version:

    "@langwatch/scenario@<version>>langwatch": "workspace:*"

and its own comment records what happens when that key stops matching:

> The version in this key MUST be bumped together with the vendored tarball
> version below, in the same change, or the crash returns. It was previously
> pinned to `@langwatch/scenario@1.3.0`, and when scenario was bumped 1.3.0 ->
> 1.6.0 the pinned key silently stopped matching, so the override no longer
> applied and the child bundle fell back to the published npm langwatch (whose
> `NoopLoggerProvider` crashed the run at module init).

The key said `1.7.0-dev.29dea33`. It is now **`1.7.0-dev.voice6`** - keyed on
what the tarball declares, not what the file is called. Keying it on `voice7`
would have reproduced exactly the silent-unmatch failure the comment describes.

Confirmed the override is still needed: the vendored SDK declares
`langwatch: ">=0.16.1 <2.0.0"`, so without it the child bundle resolves the
published copy and crashes at module init.

`vendor/README.md` records the sha, the provenance and the name/version
disagreement.

Checked and clear: the root `vendor/` creates no gitleaks exemption - the
`toolCards` allow-pattern is anchored `^...$` precisely so a prefixed path like
`vendor/platform/app/...` is not swallowed, which that file's own comment says
was confirmed by scanning rather than by reading docs.

### Install still outstanding

`pnpm install` has not been run - the lockfile is a conflicted file mid-merge.
Four changes now depend on one install, and they should land together:

1. the catalog repin + override key above
2. `@langwatch/user-web` for governance-web (E17 area / TileIcon)
3. `@langwatch/scenario-web` for agent-web (agent-test-panel parameters)
4. `@langwatch/enterprise-licensing-contract` for prisma-client (E23)
5. `@langwatch/scenario` declared by `modules/scenario/contract` (E24)

The `node_modules` links for 2-4 were made by hand so the tests could run. The
install is what makes them real for CI.

## E26 - DECISION TAKEN: adopt main's governance redesign (Alex, 2026-09-12)

The governance-home redesign question from E11 is answered: **take main's.** Both
Overview and People are replaced deliberately.

Measured before asking, because the first estimate ("17 unported modules") was
wrong by 3x on the inventory screen and I did not want to repeat that:

| screen | ours | theirs | modules to port |
| --- | --- | --- | --- |
| overview | 1,123 lines inline | 142 lines delegating | 3 (`GovernanceHero` 262, `GovernanceHeroGround` 120, `GovernanceHomeSections` 325) |
| people | 1,289 lines (Departments era) | 1,524 lines (People rewrite) | 9 (`PeopleTable` 587, `UnifiedPeopleTable` 628, `peopleRows` 328, `samplePeople` 185, `departmentRows` 167, `AssignDepartmentDialog` 132, `PeopleFilterBar` 115, `peopleFilters` 59, `peopleSummary` 56) |

Both our sides are **self-contained** - zero stale imports - so keeping them
would have worked. They are being dropped because Alex chose main's design, not
because ours was broken. That distinction belongs in the commit message.

Two lanes are running, one per screen. Both are told to report **anything our
version did that main's does not**: a silently dropped behaviour is the one
failure this drive exists to prevent, and a redesign is exactly where one hides.

## E27 - governance-inventory resolved, and it cost more than its own file

The previous lane resolved the 26-hunk inventory screen: zero markers, zero
stale imports, oxlint clean, and `inventory-tab-shell.integration.test.tsx`
**passes 5/5 where it could not previously load**.

It ported six shared modules (`sample-data-controls`, `governance-empty-state`,
the three `governance-summary-*`, `governance-sample-mode`, `inventory-summary`)
and had to repair **ten further files** the screen reaches transitively, all
carrying stale `~/`/`@ee/` paths: `DashboardSelect`, `IngestionSourcesTable`,
`sampleIngestionSources`, the two `environments/*`, and five under
`toolCatalog/`.

**Its judgement call is the part worth keeping.** Main's Catalog tab is a
simpler grid/list card view; this branch has `ToolCatalogPanel`, a
drag-reorder editor with an Ingestion Templates tab, and an existing test names
it. The lane ported main's version first, **watched it fail 4 of 5**, then
reverted that tab specifically while keeping everything else main added. That is
the right shape: it tested the assumption instead of asserting it, and the test
made the decision rather than taste.

## E28 - ZERO CONFLICT MARKERS. What "finish the merge" now means

Every text conflict is resolved: `git grep '^<<<<<<< '` returns **0 files**, and
`UU` is **0**. The last one was `governance-people.screen.tsx`.

What remains is two different things, and neither is a conflict.

### 1. The index still holds 488 unmerged paths

    DU 312   main modified a file this branch deleted (all under platform/app)
    UA 116   main added a file this branch does not have
    UD  60   main deleted a file this branch still has
    DD   2   both deleted - trivial

The 312 `DU` are **not** the 206 in `merge-monolith-newwork.paths.txt`; those
were main's *new* files. These are main's *edits* to monolith files. Measured
against the merge base: **57 carry >=100 changed lines**, 248 are 1-99, 7 are
no-ops. The 57 are where real main work would hide and want triage; the rest are
mostly incidental.

**Do not blanket `git rm platform/app`.** It would look finished and would be the
largest silent revert in the drive.

### 2. The tree does not build, and the number is 406

Measured with the repo's own `langwatch/dangling-barrel-export` rule over
`apps packages modules enterprise`:

| | count |
| --- | --- |
| **repointable** - a file of that name exists elsewhere, the path is just stale | **347** |
| **genuinely absent** - nothing of that name anywhere | **52** |

Concentrated in `modules/scenario` (127), `enterprise/packages/composition` (91),
`enterprise/modules/governance` (52), `modules/analytics` (36).

The absent 52 cluster on a few modules, so porting them is smaller than 52
pieces of work: `governanceIdentity.repository` alone accounts for 14
references, `evaluators/attachment-rules` 6, `useOpenScenarioEvaluatorEditor` 3,
`../inventory` 3.

### Three unblocked by hand while measuring

- `modules/scenario/contract/src/{simulation.events,result-atoms}.ts` imported
  `./scenario-evaluation-result.ts`, which **never existed**. The symbols
  (`scenarioEvaluationResultSchema`, `ScenarioEvaluationStatus`) live in
  `./schemas/event-schemas.ts`. This one file had blocked five separate things -
  the scenario-contract suite, suite-server, merge-tail-rest, agent-web and the
  openapi task.
- `suiteRunState.regrade.unit.test.ts` imported `../../../../domain/tenantId`;
  `createTenantId` is exported from `@langwatch/eventing`.
- The SDK's generated OpenAPI client was regenerated from the canonical
  document. It did **not** fix the `fields`/`evaluators` errors, because
  `apps/api/src/features/discovery/openapi-document.json` is **deliberately
  frozen** - three routes serve it and all three SDKs generate from it, so
  nothing writes it automatically. Refreshing it is a reviewed, by-hand step
  (`make sync-all-openapi` prints what to look at). Until it is refreshed, the
  SDK CLI cannot typecheck, and `packages/observability` cannot resolve
  `langwatch`'s types, which is what blocks every `typecheck:one`.

### The People screen has no backend - confirmed, not speculation

The adopted screen calls four procedures: `api.governancePeople.{list,
suggestions, runMatch, confirmSuggestion}`. They appear **nowhere** in
`enterprise/modules/governance/{web,server}` or `apps/api`. Main has them, in
the monolith:

    platform/app/ee/governance/routers/governancePeople.ts             72 lines
    platform/app/ee/governance/services/governancePeopleScreen.service.ts  185
    + two integration tests                                          447 lines

So the port is ~257 lines of source. Until it lands, the People screen renders
against procedures that do not exist.

## E29 - THE MERGE INDEX IS CLEAN

    unmerged paths    588 -> 0
    conflict markers   87 -> 0
    staged files          1,950
    MERGE_HEAD        intact (5db424be79)

The merge is committable. What each class cost:

| class | count | resolution |
| --- | --- | --- |
| `UU` | 87 -> 0 | resolved by hand and by lane, every one |
| `DU` monolith | 303 | deletion accepted - recorded in `merge-monolith-edits.paths.txt` with per-file change size, 57 of them >=100 lines named explicitly |
| `DU` elsewhere | 6 | **kept main's** - all live (4 and 8 importers; two specs carrying 118 scenarios) |
| `UD` docs | 23 | main retired them, our only edits were list formatting - deletion accepted, `llms.txt`/`llms-full.txt` regenerated, notice test 5/5 |
| `UD` ours | 37 | kept ours - our ported modules, paired against monolith originals by rename detection |
| `UA` | 92 | 68 clean, 24 taken with package mappings applied |
| `DD` | 2 | removed |

### A directory-rename misdetection, caught and fixed

All **19** files in `modules/authz/contract/src/__tests__/` came from main's
`platform/app/src/pages/governance/__tests__/`. Git's rename detection had put a
whole governance test batch into an unrelated package; one reached five levels up
to import a `.mdx` doc. Moved to
`enterprise/modules/governance/web/src/ui/sections/governance/__tests__/`.

Worth knowing because it will happen again on the next restructure merge: the
tell was not the imports failing, it was **19 `UA` files in a package whose name
had nothing to do with their content**.

## E30 - the build: 406 -> 121 dangling imports

| step | count |
| --- | --- |
| measured | 406 |
| unambiguous + same-package, applied automatically | -128 |
| lane: `modules/scenario` | 80 -> 24 |
| lane: analytics/authz/workflow/trace/api | 68 -> 22 |
| lane: `enterprise/*` | 52 resolved |
| **remaining** | **121** |

### The measurement was checked, not trusted

A lane warned that oxlint's text reporter caps at ~100 diagnostics and that
counts were unstable. Re-run with `-f json`: **455** diagnostics - but 334 of
those are oxlint's own default rules (`no-unused-vars` 193,
`no-unsafe-optional-chaining` 67), which the scratch config does not disable.
Filtered to `langwatch(dangling-barrel-export)` the JSON reports **121**, exactly
matching the text reporter. **The count stands.** Worth recording so the next
person does not re-open it.

### What the 121 are

- ~52 modules never ported. They cluster, so it is fewer than 52 jobs:
  `governanceIdentity.repository` alone is 14 references,
  `evaluators/attachment-rules` 6.
- 71 stale imports inside the 24 `UA` files taken above - main's new work
  (health canaries, voice, dashboard widgets) still speaking monolith idioms
  (`~/server/db`, `~/server/app-layer/app`). Real ports, not path rewrites.
- The scenario lane left `// DANGLING:` comments in place at each residual site
  rather than deleting the import, with the reasoning in its handoff.

## Still open after the merge commits

1. **`pnpm install`** - already run once here, but five dependency edges were
   added during the drive and the lockfile is part of the commit.
2. **The frozen OpenAPI document.** `typecheck` cannot pass until it is
   refreshed, and that is deliberate - see E28. `make sync-all-openapi` prints
   what to review.
3. **The People backend** - ~257 lines, E28.
4. **The second merge**: local is 6 commits behind `origin/feat/strict-feature-layout-v0`
   (the haven work). Trivial, zero path overlap, but required.

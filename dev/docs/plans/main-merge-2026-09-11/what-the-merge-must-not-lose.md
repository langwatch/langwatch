# What this merge must not lose

Main shipped work after the fork that the branch's rewrite does not carry. Some of
it is a feature, some is a bug fix, and one is a gate that is currently absent
rather than merely renamed. Each entry below was **verified against the branch**,
not inferred from a report.

Sources: `platform-du-verdicts.tsv` (52 of ~252 monolith `DU` files classified -
the whole high-risk tier, everything over 100 lines) and the enterprise lane's
handoff.

## Confirmed by direct search, zero occurrences on this branch

| Missing | Verified | What it is |
| --- | --- | --- |
| `assertVoiceTargetsAllowed` | **0 files** | server-side gate refusing a `voice` suite target when `release_voice_agents_enabled` is off |
| `VoiceAgentsDisabledError` | **0 files** | the refusal it raises |
| voice nonce handoff wiring | registry defined, **no callers** | `registerVoiceNonceHandoffListener` / `getVoiceNonceRegistry` are never called from the child-spawn path |

**The voice gate is the one to fix first.** `modules/suite`'s wire schema accepts
`"voice"` as a target type and nothing checks the flag before create or update, so
the capability is reachable on a deployment that has not enabled it. That is a
missing authorisation check, not a missing feature.

The nonce registry is the [[unused-config-object-is-a-wiring-bug]] shape exactly:
the module exists, it type-checks, and nothing calls it, so the handoff it
implements never happens.

## Behaviour main fixed that this branch still has wrong

| Where | What |
| --- | --- |
| `modules/annotation/.../prisma.annotation-queue-item.repository.ts` | still pages the review queue with plain `skip`/`take`. Main replaced that with seek-based walking (`queueWalkOrder`, `queueWalkNeighbourhood`) **because offset paging skipped and duplicated items** as the queue mutated under the reviewer. There is no next-item walk method here at all |
| `modules/navigation/web/src/ui/sections/shell-page-body.tsx` | alert banners render straight into a plain `VStack`. Main wrapped them in a positioned `zIndex="docked"` layer because page content - a z-indexed container, the home hero's bloom - was washing the banner text out |
| `modules/analytics/web/src/ui/sections/graph-card-header.tsx` | no add-alert or edit-alert bell wired to the automations drawer, plus no inline widget rename. **This branch's own code comment says so**: "THE ALERT BELL DID NOT TRAVEL" |

That comment is worth dwelling on. Someone noticed the loss, wrote it down in the
code, and it still shipped that way - which is the argument for this whole
verification pass rather than a second pair of eyes on the diff.

## Test coverage main had and this branch does not

Four integration/unit suites covering evaluator attachments (#7867) and the
saved-workbench-charts endpoint have no equivalent here. The domain logic was
ported into `modules/suite/contract/src/suite-evaluators.ts` and unit-tested in
isolation; **no transport-level test exercises creating or updating a suite with
evaluator attachments**, and no test proves evaluators run after a scenario run.

Lower priority than the gate and the two bugs, but it is the coverage that would
have caught the voice gate going missing.

## enterprise/ is the governance port

The enterprise lane's finding, and it invalidates this plan's earlier split:
**all 224 conflicted paths under `enterprise/` are governance-dashboard related.**
Every `UA` traces back to `platform/app/ee/governance/**`. The manifest's premise -
178 mechanical placements plus 45 ordinary conflicts - was wrong; there is one body
of work, not two.

So `enterprise/` and the "governance port" named in
`directory-rename-split-decisions.md` are the same task and should be one lane.

### The trap inside it

Several conflicts in that subtree merge cleanly while pulling in main's use of
shared components **that no longer exist anywhere in this checkout** -
`FieldInfoTooltip`, `SmallLabel`, `DashboardSelect`, `ScopeChipPicker`, all deleted
with `platform/app` and never re-created. One such merge put JSX into a `.ts` model
file with no import.

A clean marker grep says nothing about this. It is the same lesson as the rerere
check and the hunk-splitting bug: **the merge's dangerous failures all look
finished.**

## Still unclassified

200 of ~252 monolith `DU` files, all under 100 lines. The tier above them is done.
Resume with a fresh classifier at row 53 of the size-sorted list -
`platform/app/src/app/api/projects/[[...route]]/app.ts` - per
`.claude/handoffs/platform-du-classify.md`.

## Known-unfinished, staged deliberately

`modules/scenario` is staged marker-free, but `pnpm typecheck:one
modules/scenario/contract` reports ~80 `TS2307` from files placed out of the
monolith that still import `~/components/...` and other monolith aliases. Staging
it keeps the remaining-conflict count meaningful; the import repointing is a
follow-up pass, not a resolution that was skipped.

`modules/analytics` keeps 2 markers on purpose, in the self-provisioning subtree
its lane proposed dropping - held pending the ChartGrid decision below.

## The product decision: RESOLVED - follow main (2026-09-11)

Alex: "Follow what's on `main`." Option 1 below. Executed at the merge level;
`modules/analytics` is 99 conflicts -> 0. What that meant in practice:

- **37 `UD` dropped** - the LangWatchQL workbench UI, as main deleted it.
- **6 `DU` kept deleted** - flat `provisioning/*.ts`, superseded by our
  `services/langwatch-ql-*.service.ts`; all four replacements verified present.
- **2 duplicate tests dropped** at main's flat paths. Checked first: every
  `describe`/`it` title in main's copy (32 and 14) is present in ours. Nothing lost.
- **28 `UA` landed** - the ChartGrid/dashboard-widgets cluster and the
  self-hosted LWQL provisioning cluster.
- **9 took-ours reversed to theirs** - see below.

### The lane's took-ours rationale did not hold

19 of the 24 `UU` were "took ours". The lane's handoff explains them all as
main pointing at flat paths we no longer have. Diffing main's OWN change
(`:1:` base against `:3:` theirs, not ours against theirs) shows that is true
for exactly two files. The rest dropped real work:

| Dropped | What it was |
| --- | --- |
| `report-grid` / `draggable-graph-card` / `graph-card-menu` / `analytics-reports.screen` | the #7870 ChartGrid rewiring itself - placements replacing the size-option dnd model |
| `graph-card-menu` | removal of the Edit item pointing at the workbench route **we just deleted** - keeping ours leaves a dead link |
| `lwqlTimeWindow` / `lwqlGranularity*` | the `period_*` -> `dashboard_context_*` reserved-parameter rename |
| `analytics-registry` | unknown group returned a raw `TypeError` instead of `undefined` |
| `no-background-work` | `@scenario` title rename - ours was pointing at a title no feature file carries |

Two of those are worth stating plainly. The **parameter rename was half-applied
on this branch**: the contract already declared `dashboard_context_*` and carries
main's migration, while three test files still asserted the old literals - so the
tests pinned names the code no longer emits. And the `@scenario` rename left a
test **vacuously bound**, the trap CLAUDE.md names explicitly: our feature files
already carry main's new titles, our tests still cited the old ones. A binding
audit across `modules/analytics` now reports zero unbound annotations.

**Method note for the remaining areas.** Comparing ours against theirs conflates
the branch restructure with main's change and makes every file look rewritten.
Only `:1:` against `:3:` answers "what did main actually do here". Applied to
enterprise and platform, it is the difference between a merge and a silent revert.

### Still to do: the port (does not block the merge commit)

Both landed clusters import main's flat monolith layout and will not compile:
`~/server/analytics/chartGrid`, `~/components/analytics/*`,
`~/features/custom-chart-playground/*`, `../catalog/types`, `./accessModel`.
`provisioning/index.ts` is a dead barrel - nothing imports it, and three of its
re-export targets are now class methods on services. Manifest:
`.claude/manifests/merge-analytics-port.md`. Same class as `modules/scenario`'s
TS2307s: staged deliberately, not a skipped resolution.

## The superseded option list

Main deleted the LangWatchQL workbench UI (PR #7870) and replaced it with
ChartGrid / dashboard-widgets. The analytics lane proposes dropping **both** the
old workbench (37 files this branch modified) and main's replacement (19 files),
which would leave the module with neither.

Three options, and the third is the one to avoid:

1. **Follow main** - drop the workbench, port ChartGrid. Coherent with main's
   product direction; costs a feature-port lane for 19 files.
2. **Keep the workbench** - resolve the 37 as ours, drop ChartGrid. Preserves a
   working UI for free; diverges from main and defers the adoption.
3. Drop both. Leaves a hole.

This branch retains 173 analytics web files including its own chart and widget
model, so option 2 is not a cliff. It is a product call, not a merge resolution.

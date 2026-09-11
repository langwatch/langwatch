# Handoff: cv2-worker-root-classification

Status: complete
Manifest: .claude/manifests/cv2-worker-root-classification.md
Updated: 2026-09-11 (single pass)

## 1. Identity

First lane on this task. Analysis only, one attempt, not resumed.

## 2. Objective

Classify every construction in `apps/worker/src/app/worker-production.composition.ts`
(2,530 lines) against the a/b/c/d rubric, to settle whether the worker composition
root mostly builds things its modules should own or mostly does genuine process
wiring. Report counts and evidence; the coordinator decides what to do.

## 3. Owned paths

.claude/handoffs/cv2-worker-root-classification.md (this file only)

## 4. Shared paths - do not edit

Everything else. No source file was touched.

## 5. Work completed - THE RE-DERIVED COUNT DIFFERS FROM 153

**Re-derived total: 200 constructions, not 153 - a difference of 47, over the
manifest's own ~20 stop threshold.** Method: `grep -oE` over the file for five
literal patterns the rubric itself names - `new X(`, `X.create(` (the dominant
static-factory idiom in this codebase), bare `createX(`, bare `tryCreateX(`, and
`buildX(`/`makeX(` - occurrence count, not line count (one line held 2 matches
in one case). Breakdown: `new X(` = 37 (10 are `new Error(...)` guard throws),
`X.create(` = 111, bare `createWorkerXxx(` = 43, bare `tryCreateWorkerXxx(` = 8,
`buildX(` = 1, `makeX(` = 0. Sum = 200.

A **narrower** count - `new X(` + `X.create(` only, excluding the 51 bare
`create`/`tryCreate` delegate-function calls that hand off to sibling
`worker-*.composition.ts` files - comes to **148**, within 5 of the
coordinator's 153 and plausibly what the original grep measured. The 52-point
gap between 148 and 200 is entirely the bare `createWorkerXxx(...)` /
`tryCreateWorkerXxx(...)` calls, which the rubric's own wording ("`createX(...)`
... and factory call") explicitly includes. I classified using the broad (200)
total, since it is the literal rubric reading, and flag the methodology choice
here rather than silently picking one.

**Structural finding that shapes the whole classification:** this file is not
only a composition root. Lines 1-413 are imports/option-shape types; lines
414-1665 are the single `WorkerProductionComposition.create()` method (the
actual wiring, 1,252 lines); lines 1666-2054 are small static helper/guard
methods; **lines 2055-2530 (476 lines) are full class *implementations*** -
`PrismaGovernanceOldestTeamAdapter`, `PrismaAutomationOrganizationPricingAdapter`,
`WorkerProductionLifecycle`, `WorkerGroupQueueBlobSweep`, `WorkerFeatureAppsInstaller`,
and thirteen `LoggedWorker<Module>Absence`/`Absent<Module>Xxx` classes - defined
inline in the composition file rather than in their owning module.

### Bucket counts (occurrences, sum = 200)

- (a) bag construction: **127** - overwhelmingly `<Module>WorkerFeatureInstaller.create({ installer, eventing })` (27 distinct per-module classes, one call each) plus the module-named `Prisma*Repository/Adapter`, `*Service`, `*Pipeline` constructions and `createWorkerXxx`/`tryCreateWorkerXxx` delegate calls that all get passed as the `installer:` field of one of those bags. Traced by inspection of the enclosing statement for each.
- (b) module-owned collaborator, built inline: **4** - `PrismaGovernanceOldestTeamAdapter` and `PrismaAutomationOrganizationPricingAdapter`, each counted twice (once for the `new X()` inside their own `static create()` factory body at lines 2093-2207, once for the external `.create()` call site). Both classes are fully implemented in this file, not just constructed here.
- (c) genuine process wiring: **37** - the 10 `new Error(...)` guard throws, `LocalFeatureApis` (x4, local peer resolution), `WorkerEventingRuntime.createProduction`, `EventingKillSwitchAdapter`, `EventingAuthzCommandDispatcherAdapter`, `WorkerInfrastructureAdapter`, `WorkerRuntime`, `WorkerApplication`, `WorkerProductionLifecycle`/`WorkerProductionComposition`, `WorkerGroupQueueBlobSweep`, `BlobSweeper`, `WorkerFeatureAppsInstaller`, `createFromPorts` (the 189-line method that resolves prisma/clickhouse/redis/aws from `ProcessConfig` - textbook canonical-member resolution), `createEventingPersistence`, `createProduction`, `EnterpriseWorkerComposition`, `createWorkerFoundationApps`, `createWorkerObservabilityApps`, `createWorkerGithubRedis`, `postgres`.
- (d) unclassifiable: **32** - thirteen `LoggedWorker<Module>Absence`/`Absent<Module>Xxx` classes (each counted at both its `new` and its `.create()` call site) plus `WorkerAutomationClock` (x2), `AdminAccessService`, `buildProcessing`. These are a *shared shape duplicated per module* (report that an optional dependency is missing, name the module in the log) - genuinely ambiguous between "belongs in the module" and "process-level observability." Do not force these into (a)/(b) or (c); the ambiguity is itself informative given how large this bucket is (16% of all constructions).

### Line split (2,530 lines accounted for exactly)

- (a) 728 lines, (b) 115 lines, (c) 364 lines, (d) 449 lines, non-construction
  (imports/types/pure data-shaping glue between constructions) 874 lines.
  728+115+364+449+874 = 2530.
- Among the three decisively-classified buckets only (a+b+c = 1,207 lines):
  **(a)+(b) = 843 lines (70%), (c) = 364 lines (30%).**
- Among all constructions by count (a+b+c = 168): **(a)+(b) = 131 (78%), (c) = 37 (22%).**

### Largest five constructions by line count

1. `createFromPorts` static method, 189 lines (1866-2054) - **(c)**: resolves
   prisma/clickhouse/redis/aws clients from raw `ProcessConfig` - the file's
   single largest construction, and it is genuine canonical-member wiring.
2. `PrismaAutomationOrganizationPricingAdapter` class body, 85 lines
   (2123-2207) - **(b)**: a full automation-module repository adapter
   implemented inside the composition root.
3. `trace = TraceWorkerFeatureInstaller.create({...})`, 77 lines (1389-1465) - **(a)**: per-module bag.
4. `automation = AutomationWorkerFeatureInstaller.create({...})`, 75 lines (1141-1215) - **(a)**: per-module bag.
5. `codingAgent = CodingAgentWorkerFeatureInstaller.create({...})`, 31 lines (562-592) - **(a)**: per-module bag, with a `PrismaCodingAgentActivityRepository.create(...)` nested inside it.

### One-line verdict

Both the count-based and the line-based views agree in direction and land in a
similar band (roughly 2.3:1 to 3.5:1) once the two clearly-ambiguous buckets are
set aside: **the evidence points to mostly bag-and-module construction, not
mostly genuine process wiring** - but the re-derived total (200, or 148 on the
narrower reading) does not reproduce 153 under any single defensible
methodology I found, and 449 lines / 32 constructions (the absence-reporting
classes) are honestly ambiguous rather than supporting either side.

## 6. Files changed

None. Analysis lane; no source file touched.

## 7. Checks completed

None required by the manifest (no code changed). No checks run.

## 8. Current failure

None.

## 9. Exact next action

Decide, with the coordinator, whether "153" in the proposal should be corrected
to 200 (broad, rubric-literal) or 148 (narrow, `new`/`.create()` only) before
the proposal's headline is edited - the direction of the conclusion (mostly
bag-and-module) does not change either way, only the exact number does. If the
proposal is rewritten, it should also note the 476-line block of module-specific
class *implementations* (not just constructions) sitting in this file at lines
2055-2530, which is a stronger and cleaner piece of evidence than the raw
construction count.

## 10. Shared-file requests

None.

## 11. Risks

- The (a) vs (b) split inside the 127+4 "bag or module-owned" total is
  approximate: most of the 127 were classified (a) because they trace into a
  `<Module>WorkerFeatureInstaller` bag, without opening the sibling
  `worker-*.composition.ts` files that ~51 of the calls delegate to (out of
  scope per the manifest's read-only list). If the coordinator wants a precise
  a-vs-b split, those files need reading too.
- Bucket (d)'s 32 constructions / 449 lines are large enough that resolving the
  ambiguity either way would move the headline ratio by roughly 10-15 points.
  I did not force a call - see manifest instruction not to.
- Not a bug I fixed, just noted: `PrismaGovernanceOldestTeamAdapter` and
  `PrismaAutomationOrganizationPricingAdapter` are fully implemented (not just
  instantiated) inside the composition root, which the module-review skill
  would likely flag on its own if pointed at this file.

## 12. Unfinished work

1. If exact (a) vs (b) attribution matters, read the ~15 sibling
   `apps/worker/src/app/worker-*.composition.ts` files each of the 43
   `createWorkerXxx`/8 `tryCreateWorkerXxx` delegate calls names, and check
   whether they build module-specific collaborators inline (→ b) or further
   delegate (→ a still).
2. Decide the true construction-count figure to cite in the proposal (200 vs
   148) and update `dev/docs/plans/worker-composition-proposal.md` accordingly
   - not done here, out of this lane's owned paths.

## 13. Completion status

Complete for what the manifest asked: a re-derived total (with the discrepancy
from 153 flagged, as instructed), four bucket counts summing to it, a line
split summing to 2,530, the top five constructions by line with bucket and
reason, and a one-line verdict. The verdict is a finding, not a recommendation.

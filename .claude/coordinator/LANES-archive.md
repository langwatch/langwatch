# Lane roster archive

Sessions before 2026-09-17 afternoon, moved out of `LANES.md` because that file
is parsed at every session start and had reached 2,764 lines. Nothing here is
live; `LANES.md` is the only file that says what is running. Kept for the
history of what each drive did and what it cost.

> **2026-09-16 — the enterprise install drive is handed over. NO LANE IS ACTIVE.**
> Read `dev/docs/plans/handover-2026-09-16-enterprise-install-drive.md` first; it
> supersedes the per-lane notes below for this drive. Seven lanes collected, all
> verified, **nothing committed** — the user did not authorise commits and the
> checkout carries 118+ dirty files from other sessions.
>
> First action for the next coordinator is NOT a lane: repair the 18 dead-alias
> imports in `enterprise/modules/governance/server/src` so the package can be
> typechecked at all. Every number in this drive was taken with an instrument
> that could not see its sources.


## Session 2026-09-16 (enterprise install drive, background job 981f27d9)

brief: `.claude/manifests/BRIEF-governance-install.md`
measurement: apidiff run `20260916-r11` — 340 union operations, 210 probed, 82
differing, 17 causes, **0 new** against the r9 baseline. 21 of the 44
`operation-missing-on-candidate` rows are the enterprise tier not being
installed: 17 SCIM, 4 governance ingestion-templates.

Drive: **install the enterprise modules**, governance first. The order is forced
— SCIM's cost-centre sync calls `departmentResolveByNameOrCreate` and
`departmentAssignUser` on `GovernanceApi`, so SCIM cannot name governance as a
peer until governance is installable.

Two blockers, both real: (1) neither enterprise App declares `static readonly
reads`, so `feature-installer.ts:874` hands it an empty member record — both
still take a pre-ADR-144 bespoke members object; (2) the generated module list is
core-only by ADR-144 §6. The coordinator owns (2) and every shared file.

Scope found by inventory, and it is much smaller than it looked: of the 30
`GovernanceInstallationOptions` collaborators, nine are optional and most types
already live in the module. The **required** in-composition surface is 562 lines
across four files. The ~12k lines of cost/identity services in
`enterprise/packages/composition/api/src/governance/` are NOT on the install path
and are untouched by this drive.

Coordinator holds: `governance.app.ts`, `governance.members.ts`,
`governance.server.ts`, the module `index.ts`,
`prisma.governance-installation.repository.ts`, the composition `runtime.ts` and
`index.ts`, `apps/api/**`, `modules/catalogue.json`, the generated module lists,
and `dev/scripts/generate-modules.mjs`.

Already landed this session, uncommitted, by the coordinator: the
`createGovernanceRestApp` boot fix (HEAD did not boot), the
`entitlement.app.ts` `tryFindById` → `findById` rename, and governance's three
REST declarations mounted with `GovernanceApp` implementing all three tokens.

| lane | status | model | owns |
| --- | --- | --- | --- |
| gov-peer-ports | **collected (uncommitted)** | sonnet | governance services + 3 composition adapters — 6 of 7 collaborators |

**Wave 1 is closed. Both rows cleared; no lane is live.**

### THE TYPECHECK GATE WAS MEASURING THE WRONG THING (2026-09-16)

Every "typecheck at baseline, none of mine" claim in this drive came from a check
that never compiled the sources. `pnpm typecheck:one <pkg>` runs
`typecheck:declarations --project . && tsc --noEmit`; the first step fails, the
`&&` short-circuits, `tsc` never runs. "58 errors in 22 files" is the
declarations step, not the package.

Measured directly with `tsc --noEmit`, cold:

  governance server, excluding TS6305 ....... HEAD 212 -> now 218  (+6 REAL)
  governance server, raw ..................... HEAD 490 -> now 510

`TS6305 "output file has not been built"` is a stale-`dist` project-reference
artefact, not a defect - the raw +20 overstates threefold and the coordinator's
first reading of it was wrong. Exclude TS6305 and compare the rest. The six real
additions, all in NEW test files, all invisible to the gate:

  app/__tests__/governance.ai-tool-provider-options.unit.test.ts:75,83  TS7006
  app/__tests__/governance.cli-admin-contact.unit.test.ts:44            TS7006
  channels/__tests__/memory.ottl-transform.channel.unit.test.ts:48      TS7006
  services/__tests__/ingestion-key-access.service.unit.test.ts:127      TS7006
  services/__tests__/personal-virtual-key-issuer.service.unit.test.ts:85
      TS2820 - fixture asserts status "revoked"; the type is "REVOKED", so the
      test proves a passthrough of a value the system never produces

Every manifest from `gov-clickhouse-repos` onward uses the raw `tsc` line and
compares against 218. The six defects are owed back; they are NOT fixed yet.

### gov-clickhouse-member-adapter - COLLECTED (2026-09-16)

Fixed the boot-time defect: `ClickHouseGovernanceRepositories.create` now takes
the real `ClickHouseQueryClient` member, so `requires = ["clickhouse"]` is a true
statement. Its test constructs a real client with a stub driver and performs a
read, so the erased-parameter crash cannot come back. 41 tests pass, 215 non-TS6305,
none in its files.

It also caught something a naive port would have shipped: `PrismaActivityMonitorRepository`
resolves per organization id but scopes every statement by the org's hidden
governance Project id, so closing over `tryResolve`'s own argument the way the
trace exemplar does would have raised `TenantScopeError (param-mismatch)` on
first use. It reads the tenant out of each statement's own `query_params.tenantId`
instead.

**The one disclosed `stand-in-cast` was fixed at its cause by the coordinator
rather than accepted as debt.** `GovernanceClickHouseTenantResolver` claimed the
vendor `ClickHouseClient` while every repository behind it calls only `query` and
`insert`; it is now
`(tenantId) => Promise<Pick<ClickHouseClient, "insert" | "query">>` and the cast
is gone. Three lanes were sent back for casts earlier in this drive, and
accepting a fourth because the exemplar is also unclean would have been the
inconsistency, not the rejection.

**Carried finding:** `modules/trace/server/src/app/trace-composition.build.ts:230`
still carries the same cast (oxlint reports 2 `stand-in-cast` there). The same
narrowing fixes it. Not this drive's path; recorded for whoever owns trace.

### RULING - the ClickHouse move stays additive until the install (2026-09-16)

`gov-clickhouse-repoint` blocked asking the coordinator to export five repository
classes and a port from `enterprise/modules/governance/server/src/index.ts`.
**Refused.** `private-runtime-export` allows the installer and the transport
declarations only, never a repository - and exporting them so the composition
package can keep hand-constructing governance repositories would entrench
precisely the shape this drive exists to remove.

The lane's own investigation is what settles the alternative. It verified by
whole-repo grep that `personal-usage.adapter.ts` has **zero** consumers and
`AppGovernanceTraceActivityAdapter` has exactly one (its own test) - but the
three `apps/worker/src/app/worker-governance-{anomaly,ingestion,rollups}.composition.ts`
are **live**, imported by `worker-production.composition.ts`. The worker really
does run governance through the composition package today.

**Ruling: the move stays additive. Nothing is deleted until a process installs
the module.** The module owns its copies; the composition keeps its own; the
duplication is temporary and reversible, and the deletion lands in the same step
as the install, when the worker's hand-wiring goes too. Trading a permanent rule
violation for a temporary duplicate is the wrong way round.

`gov-clickhouse-repoint` is **closed as superseded**, not collected - it landed
no edits. Its §12 consumer trace and its zero-consumer findings are the valuable
part and carry forward to the install step.

**Scope note this surfaced:** `apps/worker` installs governance too, not only
`apps/api`. The install step is two composition roots, not one.

### Wave 2 outcomes and wave 3 (2026-09-16)

| lane | status | model | note |
| --- | --- | --- | --- |
| scim-app-adr144 | **collected** | sonnet | green after the coordinator applied its package.json + 2 tsconfig lines: 13/13 files, 108/108 tests (+1 over baseline = its new `plan_not_entitled` regression test), both TS2307 gone |
| gov-ingestion-key-spec | **collected** | fable | ruling applied and verified: lifecycle spec 18/35 bound -> 9/27, trading ten fictional bindings for nine real ones + one disclosed honest red (MCP mint, implemented but untested). Repo-wide unbound 1692 -> 1693; unknown 303 = 303; mixed-tag 66 = 66 |
| gov-clickhouse-repos | **collected** | sonnet | 5 of 6 readers moved with memory twins + registry; 39 tests pass. **First lane measured against the corrected gate and it held**: 218 non-TS6305, zero in its files, 4 lint findings all inherited from names in a file it did not own |
| gov-app-adr144 | resumed | opus | blocked correctly on a coordinator scoping error; both decisions accepted, one of which corrected the manifest's own framing |
| gov-clickhouse-repoint | **closed (superseded, no edits)** | sonnet | repoint 6 consumers, delete 7 superseded composition files |

**COORDINATOR RULING - the cost-rollup subsystem stays put.** The ClickHouse lane
blocked on `governanceCostRollup.clickhouse.repository.ts` + `governanceRollupErasure`,
correctly: moving them alone either duplicates shared ClickHouse table constants
or creates an illegal module->composition import, because they are entangled with
`governanceCostRollup.{constants,foldProjection,store,metrics}.ts` and four large
consumer services. Nothing in `GovernanceInstallationOptions` needs them.
Roughly 2,800 lines moved to unblock nothing is the wrong trade. Own lane later,
moved whole.

**Coordinator scoping error, recorded.** "562 lines across 4 files" sized
`GovernanceInstallationOptions` (30 collaborators) and missed
`GovernanceInfrastructure` (36 more, `governance.members.ts:33`) entirely. The
opus lane found it and blocked rather than guessing.

**Decisions taken by gov-app-adr144, both accepted:**
- `aiToolProviders` keeps the static registry. The manifest claimed the CLI was
  the caller; it is not. The only caller is `listProviderOptionsForAdmin`, which
  stamps `configured: has(providerKey)` - if the list were the organization's own
  providers that flag is constant-true and an admin could never pick an
  unconfigured one.
- `cliContacts`' invented 500-cap is refused. `OrganizationSupportContactService`
  already answers it properly over rows this module owns: admin-configured
  contact first, then oldest admin membership, orphan-safe, null not a guess.
  Wave 1's `cli-admin-contact.service.ts` is to be deleted once rewired.

**Still owed, not yet fixed:** four of the six type defects (two are with the
opus lane), and `PersonalSourceTypeNotAllowedError` being a plain `Error` at
`governance.errors.ts:60` while `ingestion_key_source_not_allowed` sits
registered at `app-codes.ts:237` with no thrower - so that refusal reaches
customers as a generic unknown error.

### Wave 2, spawned 2026-09-16

| lane | status | model | owns |
| --- | --- | --- | --- |
| gov-app-adr144 | **blocked, handoff on disk** | **opus** | governance `app/**`, `governance.server.ts`, `index.ts`, the installation repository, a new contract config slice |
| scim-app-adr144 | **collected (uncommitted)** | sonnet | `enterprise/modules/scim/**` entire |

> **NOTE TO THE COORDINATOR OF `scim-app-adr144`, from the lint-drive session
> (background job 4a7a3221).** I committed `c867f14ade` inside your lane's
> ownership — 5 test files under `enterprise/modules/scim/server/src/__tests__`
> and `services/__tests__`. I am sorry; here is exactly what and why.
>
> My commit `f4d4c4bdce` renamed `UserApi.tryFindById` to `findById`.
> `ScimUserProfileReadWrite` is `Pick<UserApi, "tryFindById" | "updateProfile">`,
> so SCIM broke: every characterization test died on
> `this.userService.findById is not a function`. The type checker could not see
> it, because those doubles are `vi.fn()` object literals. I repaired the type
> alias, the 4 call sites in `scim-provisioning`/`scim-user-profile`, and the 5
> fakes. `pnpm --filter @langwatch/enterprise-scim-server test:unit` is now
> 13 files / 107 tests green.
>
> None of those 5 files were dirty when I touched them and none are dirty now,
> so I do not believe I have overwritten anything of yours. If your lane holds
> its own copy of any of them, take yours and re-apply `tryFindById` ->
> `findById`; the rename is the whole of my change.
>
> Your row was not present when this session read the roster, which is how I
> came to treat SCIM as free. Not an excuse — a lane-ownership check against a
> shared roster should be re-read before a commit, not only at spawn.

| gov-ingestion-key-spec | **collected (uncommitted)** | fable | governance `specs/**`, the shared lifecycle spec (granted), + the 3 dead tests |

**gov-ingestion-key-spec came back `blocked` and overturned its own manifest's
premise before editing anything — the correct call, and the coordinator's error.**
I had verified governance's `IngestionKeyService` lacked the behaviour but never
checked whether another module implemented it or whether a spec already recorded
it. Both were true:
- `specs/ai-gateway/governance/ingest-api-key-lifecycle.feature` already records
  the intent, and the three dead files are the SOLE binding for 10 of its 18
  bound scenarios.
- the session cascade lives in `modules/api-key`; the personal allow-list lives in
  the module's own `ingestion-source-key.service.ts`.
- the MCP mint deliberately ACCEPTS CLI-wrapped tools under a 32-key LRU cap,
  where the dead tests assert tile/MCP refuse them — superseded, not absent.

Ruling issued (in the manifest under THE RULING): three buckets — rebind to living
tests / rewrite to the living design / `@unimplemented` for the genuinely absent.
The key reframing: those ten bindings are **fiction**, since a `@scenario` on a
test importing a never-existent module proves nothing. 1692 → 1702 would remove a
false green, not cause a regression.

**New defect found, lane opened separately:** the living allow-list throws
`PersonalSourceTypeNotAllowedError`, which `governance.errors.ts:60` declares as a
plain `Error` — so the refusal reaches a customer as a generic unknown error,
while `ingestion_key_source_not_allowed` sits registered at `app-codes.ts:237`
with nothing throwing it. Recorded, not fixed by the spec lane.

Three lanes, at the ceiling. Path lists checked by eye: the governance lane owns
`app/` + installer + contract config; the spec lane owns `specs/` + three dead
test files and no server source at all; SCIM is a separate module tree. No
intersection.

Model reasoning: **opus** for governance because it is the architecture step and
carries the two decisions wave 1 refused to settle (`aiToolProviders`
static-vs-configured registry, and the `cliContacts` 500-member cap). **sonnet**
for SCIM because its mapping is fully decided in the manifest — four app members
and eight adapter options, each with a named destination. **fable** for the spec
lane because it is turning existing assertions into specification prose once the
shape is decided, which is what fable is for.

Ordering note: SCIM's app conversion runs in PARALLEL with governance's, not
after it. Declaring `GovernanceApi` as a peer compiles without governance being
installed; only the *install* is ordered, and neither module is installed until
both land. That is the whole reason these two can be concurrent.

Carried into wave 2 from wave 1: the two `no-try-prefix` findings
(`tryFindIngestKey`, `tryFindByLookupId` at `governance.members.ts:749,761`) are
folded into gov-app-adr144, which owns that file. Nothing else from wave 1 is
outstanding.

Second delivery accepted: six files renamed to layout-legal
`services/<name>.service.ts`, the four `as unknown as ApiKeyApi` casts gone,
`randomUUID()` → ksuid, and `tryResolveAdminEmail` → `findAdminEmail` across six
sites. Verified by the coordinator: the six new service files lint clean; the two
surviving `no-try-prefix` hits (`tryFindIngestKey`, `tryFindByLookupId`) are
inherited from `governance.members.ts:749,761`, confirmed present at HEAD — they
belong to the wave-8 fallible-naming drive, not this one.

Coordinator applied, on shared files:
- the five ingestion-key `HandledError` classes into
  `governance/contract/src/governance.errors.ts`, taken verbatim from the deleted
  original at HEAD rather than re-derived from the lane's summary. Their codes are
  registered in packages/handled-error but the classes had been left with no home
  at all. Three `comment-block-size` findings this introduced were trimmed; the
  class bodies (codes, messages, statuses, meta, fault) are untouched.
- deleted `runtime.ts`, `ottl-gateway.client.ts` and the client's test in one step,
  after confirming nothing imports the dead assembler.

**Separate finding, not this drive's regression:** `typecheck:one
@langwatch/enterprise-api` runs `typecheck:declarations && tsc --noEmit`, and the
declarations step fails first — so `tsc` never runs and that package's real errors
are invisible. Run directly, the composition package has many pre-existing errors
across `src/governance/__tests__/`. Any 'baseline' previously recorded for that
package measured nothing.

Post-collection state: governance server typecheck **58 errors in 22 files**
(baseline, unchanged), `test:unit src/channels src/app src/transport` **67 passed,
7 files**, contract typecheck 2 pre-existing errors.

`gov-peer-ports` reported **partial** with two Risks, both verified correct.
Returned for five findings, **the first of which is the coordinator's error**:
the manifest named `*.port.ts` filenames, which `no-port-vocabulary` bans
outright and `feature-source-layout` refuses (only `services/<name>.service.ts`,
no qualifier). Manifest amended. Also: four `as unknown as ApiKeyApi` casts,
`randomUUID()` instead of ksuid `generate()`, and `tryResolveAdminEmail` →
`findAdminEmail` (six sites; four extra paths granted for that rename only).

**Its Risk #2 saved real work.** The three composition ingestion-key tests import
`../ingestionKey.service`, which never existed in that package — already
unrunnable at HEAD, which is why the lane's deletion of `ingestionKey.errors.ts`
left `typecheck:one @langwatch/enterprise-api` on its single pre-existing billing
error. They are NOT duplicates of the module's own tests: they cover CLI
session-parenting, `revokeForSource` partial-failure semantics and the tile/MCP
create-only paths, none of which exists in the module's `IngestionKeyService`.
They are the only record of that intent. **Do not delete them** — file as
`@unimplemented` scenarios instead. My manifest's criterion 'move them with every
assertion intact' was written on a false premise.

Two decisions left OPEN for wave 2, not settled by this lane:
- `aiToolProviders` now reads the model-provider contract's **static** registry
  (every known provider type) where the original delegated to an injected catalog
  (the organization's configured ones). Different answers; the CLI is the caller.
- `cliContacts` is invented policy, not a preserved behaviour: `listMembers({limit:
  500})` then first `ADMIN` with an email. Past that cap an organization silently
  resolves to no contact.
| gov-ottl-channel | **collected (uncommitted)** | sonnet | governance `channels/**` (new folder) + `ottl-gateway.client.ts` — 1 collaborator |

`gov-ottl-channel` reported **partial** and was reviewed: the HTTP channel is a
verbatim move (diffed against the original — only the import source differs), 10
tests pass, typecheck sits exactly on the 58/22 baseline. Returned for three
oxlint findings it introduced — `comment-block-size` in the registry,
`stand-in-cast` (`as unknown as typeof fetch`) in its test, and
`return-await-outside-try` in the moved client. My manifests had failed to name
oxlint in Checks; both are now amended.

Its `ottl-gateway.client.ts` deletion is correctly blocked on `runtime.ts`, the
shared common importer. I am deleting `runtime.ts`, its test,
`ottl-gateway.client.ts` and its test in ONE step once `gov-peer-ports` lands,
because that lane is removing three more of `runtime.ts`'s imports.

**Collected 2026-09-16, verified by the coordinator, NOT committed** — the user
has not authorised commits this session and the checkout carries 118+ dirty files
from other sessions. Six files added under
`enterprise/modules/governance/server/src/channels/`; independently re-checked:
oxlint clean, 10/10 tests, typecheck on the 58/22 baseline, and the moved client
diffs against the original in exactly two lines (import source, and a
`return await` whose removal is observationally identical — `postSigned` has no
enclosing `try`). `OttlGatewayUnavailableError extends Error`, not
`HandledError`, so the env-var names in its message stay in the log rather than
reaching a customer: correct per ADR-045.

Rejected from its section 10: an exported `createOttlTransformGateway` factory on
`governance.server.ts`. Five `createGovernance*` factories were deleted from that
file earlier today for being that exact shape (`private-runtime-export`). The App
holds the channel privately; wave 2 must not reintroduce the factory.

Wave 2, not yet written: `gov-app-adr144` (opus) — `GovernanceApp` onto `reads` +
peer `dependencies` + a config slice, `GovernanceAppDependencies` deleted,
`.withRepositories(governanceRepositories)` called. Then the coordinator's half:
catalogue/generator, `apps/api` composition, and apidiff preparing at enterprise
tier. Then `scim-adr144`.

Note: the rows in the section below are from an earlier session; this session's
start hook reported **no lanes active**, so they are stale and were not cleared
by whoever ran them.


## Session 2026-09-16 (lint drive, comment sweep wave 7, background job 4a7a3221)

handover: dev/docs/plans/handover-2026-09-16-comment-sweep-and-web-cycles.md
governing: dev/docs/plans/handover-2026-09-16-lint-to-zero.md

Drive: **A only** — the comment sweep. The user chose the lint drive, so drive B
(web import cycles) is untouched this session and the studio-column-vocabulary
decision remains open and untaken.

Sliced from a FRESH whole-tree measurement taken at the start of this session:
oxlint total 9,886 (8,250 error / 1,636 warning), `comment-block-size` **1,177**
across 721 files. Handover said 1,175 — it drifted UP by 2, which is the
"bucket with a hole" the governing doc predicts.

Coordinator holds: the gap to origin/main (5 commits, 4 identity + analytics +
voice — NOT merged this session, peers are live in both areas), the baselines,
`.claude/manifests/BRIEF-comment-block-wave1.md` (corrected this session: lesson
8, the orphan-block trap, and item 4's splitting loophole closed).

Dirty tree (142) is NOT this drive's: four peer sessions share this checkout.
Every slice excludes peer-dirty files by path; 19 findings sit in such files and
were dropped from all three slices.

| lane | status | model | owns |
| --- | --- | --- | --- |

**Collected `0096cfd5eb`** — w7-packages-infra, 172/172 findings, 84 files.
All six checks pass. Check 1 flagged two extras in these areas,
`packages/prisma-client/src/ownership.ts` and
`packages/test-harness/src/markColourScan.ts`: both were peer-dirty BEFORE the
slice was cut, ownership.ts carries a code change no comment lane would make,
and the lane had independently noticed and avoided both. Neither is committed.
The lane also ran `typecheck:one` beyond its manifest and reported pre-existing
errors; checks 2 and 4 (comment-only, zero directives removed) mean a comment
edit cannot have caused them, and the file it named has no diff from this lane.

**Collected `4f5fc8520f`** — w7-enterprise-flags, 181/181 findings, 123 files.
Cleanest of the three: scope 123=123 zero extras, comment-only OK, **zero** blank
lines anywhere, zero directives removed, orphans 0 = baseline 0, zero splits.
oxlint over the 123 files reports 0 `comment-block-size`. Its three recorded fact
losses were moved into the committed register (entries 40-41) because handoffs
are gitignored and would have taken them with the drive.

**Collected `6c99d76df5`** — w7-small-modules, 161/161 findings, 119 files +
the lost-facts register. All five checks run by the coordinator on the tree as
it stood: scope 119=119 with zero extras, comment-only verifier OK, one blank
line, zero directives removed, orphan count 1 = baseline 1. oxlint over the 119
files reports 0 `comment-block-size`.

The lane reported `complete`; a lane cannot be, since only the coordinator
commits. Read as `review`. One real defect found in review: it cleared a finding
in `evaluation-execution.service.ts` by splitting a JSDoc from the divider below
it with a blank line — lesson 8 in substance, and it escaped the orphan regex,
which only matches a single-line `/** … */` before the blank. The block was
residue from a move (its method `fillServerOnlyTraceSources` now lives
undocumented in `evaluation-data.service.ts:46`); coordinator deleted it and the
emptied divider. Register entry 39 carries the follow-up.

**The orphan regex has a known gap.** It does not see a multi-line JSDoc split
from a following `//` comment. Widen it before the next tranche.


**Collected `c859531848`** — w8-fallible-hedges + w8-langy-list-degrade, 79
files, hedges 29 -> 5. Served surface **unchanged across 273 routes and
procedures** (`dev/scripts/wire/served-surface.py --diff HEAD`), which is the
check that matters on a renaming wave. All 7 catches in the langy services
verified narrowed or converting - zero blanket catches. langy list tests 41
passed.

**Collecting this slice was hard and the method is worth keeping.** A directory
sweep would have been wrong: a peer session is doing its OWN fallible-naming
work in `enterprise/modules/governance` concurrently (it removed
`tryFindPersonalWorkspace` and `tryDescribePersonalIngestionKey` from
`governance-cli.rest.ts` at 16:29, after our lane had stopped). So the slice was
selected by **content fingerprint** - a file is the lane's only if its diff
carries a `try*` identifier change or the unreadable error - then reconciled
against the handoff's per-module counts. Four discrepancies, and two were real:

- **2 licensing test files were nearly dropped.** The fingerprint required
  `try[A-Z]...(` and missed `cryptography.tryParseLicenseKey.bind(...)`.
  Committing without them would have left a dangling rename - the same defect
  that the incomplete revert produced earlier today.
- **`governance-cli.rest.ts` was nearly committed.** It matched the fingerprint
  because the PEER is doing the same kind of work there.

Guards that passed before the commit: nothing peer-dirty pre-spawn, nothing in
mech-b's four modules, nothing in governance contract/transport, every listed
file still dirty.

**Coordinator fix applied:** `modules/langy/server/tsconfig.build.json:28` still
pointed at `./src/subscribers/langy-conversation.subscriber.ts`, a path the
eventing consolidation (ADR-137) moved to `./src/eventing/`. The package could
not typecheck at all - TS6053 aborted the project load. Repointed. **That
exposed 6 pre-existing errors in 4 untouched test files** (fixture drift in
`langy.langy.adapter.unit.test.ts`, unexported types in
`langy-frame-auth.rules.unit.test.ts`, and two more), which had been invisible
because nothing in the package was ever checked. Not this drive's to fix;
recorded here as the next owner's.

**w8-fallible-hedges reported `review` and is NOT yet committed.** Hedges 29 ->
5; `no-try-prefix` fell 26; family total down 27 on those files. Its langy work
is being extended by `w8-langy-list-degrade`, so the two commit together as one
coherent slice once that lane returns - committing the hedges half alone would
land the amplification the user rejected.

Verified by the coordinator: `langy_local_record_unreadable` has its class
(`modules/langy/contract/src/langy-local-control.errors.ts:58`), its
`app-codes.ts` entry with the file still sorted (553 codes), its
`presentation.ts` copy, and `fault: "platform"` explicit on a 500. That is the
convention followed exactly.

**A coordinator error the lane surfaced, and misattributed.** It reported
`model-provider.app.ts:544 findModelLimits does not exist` as "a peer session's
half-landed rename". It was not: it was the reverted wave-8 attempt. That file
was peer-dirty pre-spawn so the revert excluded it wholesale, leaving a renamed
call site pointing at a method that no longer exists. Fixed by restoring the one
line; every other change in that file is the peer's comment rewrapping and was
preserved. **Lesson: excluding a peer-dirty file from a revert is not safe when
a lane renamed a symbol its call site uses. Check the excluded files for
dangling references.**

**DECISION taken (class C / the absence branch).** Renaming a hedge whose null
is a legitimate absence moves it to the rule's absence branch - 20 new findings
on these files. `find*` IS correct there where the thing is a genuine lookup:
`readKeyBinding`, the three cache `get`s, `verifiedEmailsOf`, and
`findRefreshToken` which the user blessed by name. The earlier ban was narrower
than it read - it is `find` in front of a verb that PARSES, COMPILES, COERCES,
DECODES or DERIVES. One exception the lane got wrong: `takePendingNavigate` is a
consume, not a lookup, so `find` is wrong for it too. These are class C and stay
deferred to that tranche; the principle above is the ruling for it.

**SHARED-FILE REQUESTS: both DEFERRED, and one is mis-targeted.** The lane asked
for `"@langwatch/handled-error": "workspace:*"` in
`modules/hosted-mcp/server/package.json` and `modules/auth/contract/package.json`
so those modules could declare their own `<subject>_unreadable` classes.

1. **hosted-mcp names the wrong package.** `handled-error-outside-contract`
   refuses a `HandledError` subclass under `*/server/src/**`, and
   `modules/hosted-mcp/contract/` exists - so the dependency belongs on the
   CONTRACT package, not the server one. Acting on the request verbatim would
   have added a dependency that still could not be used.
2. **The lockfile is dirty with a peer's work right now.** A `package.json`
   dependency change must carry `pnpm-lock.yaml`, and regenerating it derives
   from disk, so it would absorb every other session's uncommitted manifest
   edits. That is exactly what broke every clean checkout of this branch earlier
   today (`5ca718aa1d`, repaired by `fabc722b50`). Not worth it for two error
   codes while four sessions are live.

The tree is consistent without them: the lane kept each catch with a comment
naming the code it wants. Next session: add the dependency to
`modules/auth/contract/package.json` and `modules/hosted-mcp/contract/package.json`,
run `pnpm install --lockfile-only`, diff the lockfile BY IMPORTER and restore any
importer that is not yours, then add the two classes and their presentation
entries.

**Collected `a43788954d`** — w8-fallible-mech-a, 87 files, 121 -> 17 findings
(the 17 are each a recorded decision, not missed work). Served surface unchanged
across 129 routes and procedures. Naming verified: every `find*` introduced is a
repository lookup (`findAll`, `findById`, `findQueueById`, `findLatestVersion`),
and the three `list*InputSchema` constants that appeared in a first grep were
untouched - the real change is `list(...)` -> `findAll(...)` on the repository
classes, which is the layer vocabulary the rule exists for.

**It touched `modules/organization` - a module it does not own and where a peer
is active - then reverted it.** Verified: organization has 1 dirty file now and
had 1 at spawn, with nothing new. The revert was real.

**Its "test:unit green across all 5 packages" was overstated.** dataset-server
has 2 failures. Both verified pre-existing and in files the lane never opened:
`dataset-service.search.unit.test.ts` carries `vi.mock("../dataset-storage")`
pointing at a module that does not exist at HEAD either (the directory has
`s3.`, `azure.` and `local.dataset-storage.service.ts` - a stale mock from an
earlier split, which is exactly the class the repository rules warn the language
server cannot see), and `self-hosted-no-s3.unit.test.ts` mocks an `fs` missing
`rm`. The lane ran scoped tests on paths it touched, as its manifest asked; it
should not have generalised that to the package.

### A PEER IS CURRENTLY BREAKING TYPECHECK REPO-WIDE

`packages/api` has 4 uncommitted files from a peer session, including a 61-line
change to `src/trpc/runtime.ts`. Every module that declares a server or a REST
transport now fails `typecheck:one` with **TS2883** - "the inferred type of
`<x>Server` cannot be named without a reference to `RouteAccess`".

Proved by control, not assumed: `modules/api-key/server` is **completely clean,
untouched by any lane, zero dirty files** and shows the identical error, as does
`modules/analytics`. So a lane reporting TS2883 is reporting the peer's
breakage, and a coordinator must not read it as the lane's. It will clear when
that session commits or reverts. **Do not chase it, and do not let a lane
"fix" it** - a type annotation added to work around it would have to be undone.

**Collected `e5aefbba73`** — w9-trace, 126 files (124 its own + 2 repairs).
Served surface unchanged across 74 entries. trace-server typecheck now exits 0;
its suite is 2,996 passed with exactly the 17 disclosed pre-existing failures in
3 files.

**It reported `complete` while a required check had not run.** Its manifest
required `typecheck:one modules/trace/server`, which was blocked by the
coordinator's own UserApi regression in data-retention. The honest status was
`partial` or `blocked`. Two real defects were hiding behind that unrun check:

1. `trace-processing-producer.service.ts` gained the class D return annotation
   `ReturnType<EventingTracePipelineAdapter["build"]>`, but the body ends
   `.build().build()` - **two** builds - so the annotation named the first one's
   type. Corrected to
   `ReturnType<ReturnType<EventingTracePipelineAdapter["build"]>["build"]>`.
2. `trace-full-record.repository.unit.test.ts` kept two `new Payloads(null)`
   call sites after the HEDGES commit (`c859531848`) had changed that double's
   constructor to `string`. One test is named "on blob failure", so `null` was
   how it simulated failure - a `FailingPayloads` double that throws is the
   honest replacement now that `read` throws, and the repository already catches
   it and falls back to the preview.

**The new orphaned-consumer check found a breakage in another module on its
first real use.** `modules/analytics`'s `memory-safety-structural-invariants`
test does `fs.readFileSync` on trace's `trace-legacy-read.repository.ts` and
matches `/async getTopicCounts/` and `/async getDistinctFieldNames/` against the
source text. Both were renamed to `find*`, so four assertions silently stopped
matching anything. **No compiler and no trace test could see this** - it is the
"tests that read source files as text" hazard the repository rules name, and it
is precisely why the check exists. Regexes and locals repointed; analytics is 13
passed / 1 skipped.

Triaged and NOT a breakage: `modules/scenario`'s `whole-call-audio` declares
`traces.getNormalizedSpansByTraceId`, and the trace **service**
(`trace-span-storage-read.service.ts:121`) still exposes exactly that - only the
repository beneath it became `find*`. That is the layer vocabulary working as
intended.

**Collected `d98427c7ee`** — w9-eventing-scenario, 59 files, status `partial`.
Served surface unchanged across 83 entries.

**Two of the four cross-package renames are done** — `tryGetProjection` and
`tryExtractSuiteId` now have zero occurrences left. `getKey` and `tryGet` were
not attempted; they remain for a lane owning the same three paths.

**Verifying this one needed care, because the raw numbers look alarming.**
packages/eventing 4 type errors and 21 test failures; scenario 7 and 91; suite
10 and none. The decisive check was not the counts but the intersection: of 12
failing scenario test files, **exactly one** was touched by the lane, and it
fails on `ReferenceError: makePrisma is not defined` — referenced twice and
defined nowhere, identically at HEAD. Of 7 failing eventing files, **none** was
touched. And **zero** type errors across all three packages are in a file the
lane opened. Its only change in the one failing file it touched is
`tryAggregateTotals` -> `aggregateTotals`, a correct de-prefix.

The orphaned-consumer check flagged 12 symbols and every one triaged clean:
`getAllRunDataForScenarioSet`, `getBatchHistoryForScenarioSet` and friends
survive in scenario's **contract and transport** while the repository beneath
them became `find*`. That is the layer vocabulary working, not a consumer left
behind — services answer `get*`, repositories answer `find*`.

**Open decision the lane correctly refused (handoff section 11.1).** In scenario,
`ScenarioRepository` / `ScenarioService` / `ScenarioApi` / `ScenarioApp` each
already declare a **throwing sibling** under the name that dropping `try` would
produce. So the usual fix collides. Somebody must decide whether the throwing
sibling or the nullable one keeps the plain name; a lane must not guess.

### Wave 9 — why NOT class C, stated so nobody re-derives it

Class C is now **741** and it is the wrong next target. Measured, its bulk is
domain verbs, not lookups: 61 `resolve*`, 57 `parse*`, 56 `read*`, 52 `get*`,
23 `extract*`, and 415 others. Among the most frequent are `mintTurnToken` (6),
`consumeNonce` (5) and `verifyInstallState` (3) — **names wave 8 just correctly
created**, because dropping `try` leaves a nullable return that immediately
trips the absence branch. Fixing those means deciding, per site, whether minting
a token or consuming a nonce should throw. That is 741 product judgements, and
lanes have already proved twice that they misjudge this exact call.

So wave 9 continues with classes A/B/D/E, which wave 8 proved safe: 1,206 remain
across 40 areas. Class C keeps its own tranche, its own decision, and probably a
smaller first slice to prove the ruling before it is applied at scale.

**Areas avoided as peer-active:** gateway, organization, identity, ops,
model-provider, stored-object, webhook, scim, agent, coding-agent — and
`enterprise/modules/governance`, which is clean but whose fallible work a peer
session is demonstrably doing (it renamed `tryFindPersonalWorkspace` and
`tryDescribePersonalIngestionKey` there at 16:29).

**Collected `f4d4c4bdce`** — w8-fallible-mech-b, 83 files across github, project,
user and suite. Served surface **unchanged across 86 routes and procedures**.
github-server 184 unit tests pass; user-server has 1 failure, verified
pre-existing (see below).

**The corrected naming policy held.** Every `find*` it introduced is a genuine
lookup (`findById`, `findBySlugInTeam`, `findRecentAuditLogEntries`, `findPaths`
on `ProjectRepository`), and every non-lookup kept its own verb:
`tryParsePullRequestEvent` -> `parseGithubPullRequestEvent`, `tryVerify*` ->
`verify*`, `tryConsumeNonce` -> `consumeNonce`, `tryMintTurnToken` ->
`mintTurnToken`, `tryResolveInstallationForRepository` ->
`resolveInstallationForRepository`. No `find` in front of a parse, compile or
derive verb anywhere in the slice.

**28 type errors in these four packages, all verified pre-existing.** The
coordinator cross-referenced every erroring file against the lane's 67 renamed
symbols: **zero implicated**. Two proved out individually:

- `test-project-api.ts` references `ProjectApi.tryGetById`, which no longer
  exists - but the fixture references it AT HEAD and `ProjectApi` declares
  `findById` AT HEAD, so an earlier commit renamed it and missed the fixture.
  The lane never opened that file.
- `FakeRepository` is missing `findRecheckDue` / `deleteStaleBefore` - the
  interface declares both at HEAD and the fake implements neither at HEAD.

**`tslsp-cli diagnostics` cannot be trusted after a rename.** It reported clean
on two files that were actually broken, and only `typecheck:one` / vitest caught
them: a rename-APPLY (not the dry-run) corrupted an unrelated line in
`prisma.github-pull-requests.repository.ts:239`, garbling two parameters into
stray identifier text. The lane found and fixed both. **Any future rename lane
runs the package's real typecheck before calling a batch done** - this belongs in
the wave-2 brief.

**Two pre-existing defects found, not caused, and not this drive's to fix:**

1. `modules/user/server/src/transport/user-avatar.rest.ts` declares its door as
   `browser` while `user-avatar.rest.declaration.unit.test.ts` expects
   `session`. Both files are clean at HEAD, so the REST family's credential and
   its test disagree today. Someone changed one without the other.
2. The `TestOrganizationService` / `OrganizationApi` fixture drift is 55+
   missing members across several github and suite test fixtures.

**Deferred, and it needs a coordinator decision:** the lane stopped rather than
reach across module boundaries, correctly. `packages/eventing`'s `getKey`,
`tryGetProjection` and `tryGet` span `modules/suite` + `modules/scenario` +
`packages/eventing`, and `tryExtractSuiteId` reaches `modules/scenario`. Those
renames need one lane owning all three paths, or they will half-land.

**Wave 8 restarted 2026-09-16 with the user's decision applied.** The decision:
**follow the rule literally** - a `try*` name drops its prefix and the body
throws; the hedge moves to the caller boundary that already exists
(`isSafeRegex`'s `refine()` is exactly such a boundary). `find*` is reserved for
genuine lookups: repository reads, cache reads, registry lookups. All three
manifests were corrected before restart, and each now carries the reverted
`findSafeRegex` example by name so a lane recognises the mistake as its own.

Only TWO lanes restarted, not three. `w8-fallible-mech-a` is deliberately held
until these two are reviewed - the corrected guidance is unproven, and the last
attempt cost 73 files. mech-b was chosen as the mechanical probe because 96 of
its 141 findings are class A `try*` names, the shape most exposed to the error.

**Wave 8 STOPPED BY THE USER AND FULLY REVERTED.** All three lanes killed
mid-flight; 73 files in lane territory plus 40 files of call-site spill reverted
by explicit pathspec. The tree is exactly as the lanes found it - both `comm`
directions against the pre-spawn dirty snapshot are empty, so no peer work was
reverted and no lane work remains. Nothing from wave 8 was committed.

**What went wrong, and it was the coordinator's prompt, not only the lane.**
The lanes renamed non-lookups to `find*`: `findSafeRegex` (compiles a pattern),
`findJsonArray` / `findJsonValue` / `findContentArray` (parse and coerce),
`findGroupKeyParts` (derives). 249 added lines across 73 files. `find` is for a
lookup that may find nothing; it is not a synonym for "returns null", and using
it to satisfy the rule games the rule exactly as the blank-line split gamed
`comment-block-size`.

**The rule was never asking for that, and it says so in the message.** The
class-F text names the replacement outright - "`tryCompileSafeRegex` hedges ...
**Name it `compileSafeRegex`** and make the body throw on failure" - and
likewise `tryGet` -> `get`, `trySafeJsonParse` -> `safeJsonParse`,
`tryCoerceContentToArray` -> `coerceContentToArray`. The `find<Noun>` wording
comes from the *no-try-prefix* message, which offers it as one of two options.
The coordinator's spawn prompt told the opus lane to "narrow the catch ... and
name it `find<Noun>`", collapsing the two messages into the wrong one. A lane
reads its opening prompt twice; that is why a wrong prompt is expensive.

**Second defect in the same diff:** the lane wrapped the catch in
`if (!(error instanceof SyntaxError)) throw error;`. `new RegExp` throws only
SyntaxError and `safe()` is a boolean predicate that does not throw, so the
guard defends against nothing and turned 6 correct lines into 14.

**Open decision, and it is above a lane** - see the handover. For a *total
conversion* that answers absence for invalid input (compile, parse, coerce), the
rule offers only `find*` (a lie) or "make it throw" (wrong for customer input
that is expected to be invalid sometimes). `compileSafeRegex(): RegExp | null`
is the honest shape and trips class C. The vocabulary gap is real and wave 8
cannot restart until it is settled.

### Wave 8 routing — a correction to the governing doc, made on measurement

`handover-2026-09-16-lint-to-zero.md` wave 2 says the fallible-naming family is
2,103 findings and **"Opus, high effort - this is not a rename"**. Measured, the
family is six shapes and only one of them is what that sentence describes:

| class | count | what it is |
| --- | ---: | --- |
| A | 757 | `try*` rename, no catch claimed |
| C | 688 | nullable - needs `find*` or make it throw (judgement, deferred) |
| B | 429 | repository `get*`/`list*` -> `find*` |
| D | 175 | add an explicit return type |
| E | 24 | redundant `try` prefix, "leave the body as it is" |
| **F** | **29** | **hedges - a real catch to narrow** |

The rule's own source settles it: its census found **96.2% of flagged `try*`
sites have no catch at all**, and `no-try-prefix` is worded specifically so it
"never claims a catch it cannot see". So the catch-narrowing job is 29 findings
in 26 files, not 2,102. One opus lane takes those; the mechanical classes go to
sonnet. Routing the whole family to opus is how this drive spent $24k of its
$29k on repetitive work.

Class C (688) is deliberately deferred: renaming to `find*` is safe, but the
rule's alternative fix - make it throw - is a behaviour change, so it wants its
own tranche and its own decision. Both sonnet lanes report the class C findings
in their modules rather than touching them.

Held, not sliced: `packages/api` (68 — peer rewriting its REST runtime) and
`packages/architecture-enforcer` (85 — coordinator-owned, implements the rules
this drive is measured by).

Verify tooling rebuilt this session (it does not survive a session):
`verify-slice.py` at the job scratch dir, 139 lines, with the `--commit SHA`
mode the last session said it needed.


## Session 2026-09-16 (shell-race handover pickup, background job 7dd9a012)

handover: dev/docs/plans/handover-2026-09-16-comment-sweep-and-web-cycles.md

Drive: the route-surface and chrome-framing gaps that handover section 3/4
found. Coordinator holds ui-route-table.ts between lanes, the gap to
origin/main (4 commits, all identity), and the /settings generation decision.
Dirty tree is NOT this drive's: four peer sessions share this checkout.

| lane | status | model | owns |
| --- | --- | --- | --- |

Collected 2026-09-16 ~02:1x: **identity-trpc-transport** (blocked, CORRECTLY, and
it changed nothing - nothing to commit). It read the manifest, traced how each
procedure would actually wire, found three gaps and stopped before writing code.
All three verified by the coordinator, and TWO OF THEM CORRECT THE COORDINATOR:

1. `identityTrpc`, the wire contract the transport is typed against, is defined
   exactly once in the repository at `modules/user/contract/src/user.trpc.ts:144`
   - a package the manifest put in NEITHER the owned nor the shared list. Pure
   scoping error: it named the transport file and not the contract typing it.
2. The coordinator's claim "the contract already declares every operation" is
   WRONG FOR MFA. `IdentityCommand` (`facts.ts:370-376`) carries six members, all
   identifier verbs, and not one of the seven MFA ones; `mfaGuards()` only
   computes facts and nothing can commit them. A declared guard API is not a
   committable operation, and the coordinator conflated the two.
3. No read model exists for "list every identifier with confirmed state" -
   `IdentityApi` has only `findEmail` and `verifiedEmailsOf`.

What survives: the OWNERSHIP decision. `user.trpc.ts:141`'s own comment says the
user module declares these "because it acts on the caller's own account", so
self-service identity procedures stay there and the namespace is not split.

Manifest corrected in place with a STOP banner and re-scoped into three ordered
lanes: the MFA commit surface, then the identifier read model, then the transport.
NOT respawned - a lane starting from the original text stops in the same place for
the same reason at the same cost, and the MFA lane carries its own architecture
question (whether MFA facts share the identifier ledger or get their own stream)
that wants deciding before it starts. ROSTER ROW CLEARED.

Collected 2026-09-16 ~02:0x: **settings-security-port** (partial, correctly) in
`05bce7849f`, 14 files. `specs/identity/authentication-settings.feature`
3/27 -> **10/27**. Both its shared-file requests applied: the `/settings/security`
route entry, and `isolate: true` on the package's vitest config.

THE FLAKE WAS REAL AND WORSE THAN REPORTED. It said "1 in 3-5 runs"; the
coordinator measured **2 failures in 5 runs** before the fix and **6 consecutive
clean runs** after. `isolate: true` is the escape hatch
`packages/test-harness/src/vitest-config.ts:23` documents in as many words -
"Set true when a suite mocks modules" - so this is the sanctioned answer, not a
workaround.

The coordinator also added the 4 `@scenario` annotations the lane identified in
`modules/identity/server/src/__tests__/guards.unit.test.ts` (outside its paths,
exact lines supplied in its handoff section 11). Those four scenarios were
provably true all along and simply unannotated: 37/37 still pass, and they are
what took parity 6/27 -> 10/27. Its one oxlint finding and one `no-shadow`
finding are both byte-identical to HEAD - pre-existing, part of the lint drive's
backlog.

ITS ARCHITECTURE BLOCKER IS ANSWERED, and was smaller than it looked. The lane
found `modules/identity/server` has tested guards but zero transport, blocking 21
scenarios, and called it a which-module-owns-this decision. Checked: the
`identity.*` tRPC namespace **already exists and is already declared from
`modules/user/server/src/transport/identity.trpc.ts`**, and
`modules/identity/contract/src/identity.api.ts:99-117` **already declares every
operation needed** - the six identifier guards and the seven MFA ones. So the
contract and the services are complete and only the transport declarations are
missing. Decision: extend the existing file, do not create
`modules/identity/server/src/transport/`, because splitting one namespace across
two modules is worse than either home. Manifest:
`.claude/manifests/identity-trpc-transport.md`, lane spawned.

Collected 2026-09-16 ~01:4x: **identity-lookup-server-reads** (partial,
correctly) in `26c5c7cad2`, 10 files / 1102 insertions.
`specs/identity/platform-ops-identity-lookup.feature` 0/32 -> **13/32** (the
coordinator measured it; the lane reported partial honestly but never gave the
number, and its manifest target was 17 - the 4-scenario shortfall is exactly the
two panels it blocked on). Both `typecheck:one @langwatch/identity-contract` and
`@langwatch/identity-server` are CLEAN (zero errors), 13/13 tests, oxlint clean
on its own files.

It resolved the fenced recording question with precedent rather than blocking on
it - the audit-log port plus the process rate limiter, both already used by
several modules - which is the right use of a fence.

COORDINATOR DECISION TAKEN on its two real blockers, recorded in section 0 of its
handoff: the `history` panel and `waiting.proposals` both read through
`@langwatch/eventing`'s existing `EventRepository` per person by aggregate
stream. No new ClickHouse dependency (eventing is already a dependency and its
ClickHouse adapter already exists) and no new Postgres projection (a proposal
folds to no head on purpose, and a projection would contradict that to make a
read convenient). One mechanism answers both because `LINK_PROPOSED` is a
person-stream fact.

Care needed at collection: the lane's directories also hold ANOTHER session's
uncommitted join-request work, which carries 7 oxlint errors of its own. The
slice was committed by explicit file list; `pnpm-lock.yaml` was deliberately NOT
committed - it already carries this lane's dependency entry but is tangled with
a `packages/ui-host` change belonging to somebody else, and sweeping that in
under this message would misattribute it.

Collected 2026-09-16 ~01:3x: **settings-profile-port** (partial, correctly) in
`31c529165c`, 18 files / 849 insertions. `specs/settings/profile.feature`
0/29 -> **16/29**, verified by the coordinator running parity itself. Route-table
line applied (`/settings/profile` beside `/settings/api-keys`); the pair of route
coverage tests went 145 -> 175, all green.

TWO OF ITS CLAIMS DID NOT HOLD, and the second one mattered. It reported oxlint
"fails to load, another session broke the shared plugin" and hand-checked its
files instead. The plugin was fine by collection time and
`packages/oxlint-rules/` was not even dirty - so the coordinator ran the real
check and found **five errors in the lane's own new files**: `temporal-only` on
`revokedAt`/`lastUsedAt` typed `Date` and on a `new Date(...)` call, and
`array-type` on two `ReadonlyArray<T>` declarations. Fixed by the coordinator
(wire fields to `string`, the call to `toEpochMs` from `@langwatch/time`, which
was already a declared dependency); 79/79 tests still pass and oxlint is clean.
**Lesson for every later lane: a hand-check is not a lint run.** If a shared tool
looks broken, say so and stop claiming the check - do not substitute reading for
running it.

Its 13 unbound scenarios are a real backend gap, not lane failure: no
self-service name mutation (4 scenarios), no notion of a browser session
anywhere on this branch (7), no confirmed-address read (2). It correctly declined
to fake all three rather than ship controls that report success with nothing
behind them. Manifest for the name mutation is NOT yet written; see the
handover's next actions.

Collected 2026-09-16 ~01:2x: **ui-route-surface-repair-2** (complete) in
`ca969cd14d`. Four governance routes + loaders on main's ordering; the three
placeholders carry BOTH the governance and billed-cost flags at the route layer,
so the spec's half-gate concern is satisfied on the page and not only the nav
item. The widened destinations test independently re-proven by the coordinator:
removing `/governance/agents` fails it in both readings, restoring gives 145/145
(it was 107 before the widening). `ui-route-table.ts` is released back to the
coordinator-shared pool. ROSTER ROW CLEARED.

Collected 2026-09-16 ~01:1x: **ui-route-surface-repair** (partial, correctly) in
`e37f782919`. Its ops-block relocation verified independently by the coordinator -
99 insertions / 99 deletions with the file's sorted non-whitespace content
byte-identical, and the block now one array level deeper, inside the chrome
route's `children`. Its shared-file request applied: four entries added to
`governanceScreens` in `enterprise/modules/governance/web/src/governance.ts`
(`typecheck:one @langwatch/enterprise-governance-web` exit 0). The manifest was
MY error - it assumed those screens were registered; they were not, and the lane
refused the file rather than half-landing a route whose page key would throw at
boot. Manifest corrected in place. Row replaced by a fresh second-pass lane, not
resumed.

Pre-existing and NOT this drive's: `src/model` runs 411 tests with 1 failure,
`feature-map-links-are-routed.unit.test.ts` "/annotations lands on a page, not
the 404" - confirmed pre-existing by restoring HEAD's route table and watching it
fail identically. `/annotations` is in feature-map.json and routed nowhere: the
same class of gap as the governance four, with a test already red about it.



Runtime state, gitignored. Written at spawn, cleared when the handoff is
collected. A row outlives the lane until the coordinator clears it.

## Session 2026-09-14 night (apidiff findings drive, background job 9768954e)

Drive: work down the 21 root causes from the first apidiff report
(dev/docs/plans/apidiff-first-report-2026-09-14.md), then re-run with
`-ledger-baseline .apidiff/ledger-20260914-r2.json`. Wave 1 = the
silent-undefined members family, one module per lane. Coordinator holds the
door-fact refusal seam, the platform-link config, and the 401→200 triage.
Stays OUT of: modules/project (4a7a3221), debt-4's server dirs
(gateway/model-provider/identity/analytics/github/suite/trace/organization/
hosted-mcp/auth), prisma-client seed, tools/thuishaven.

NO ACTIVE LANES — all seven collected. Re-run in progress with
`-ledger-baseline .apidiff/ledger-20260914-r2.json`.

Collected 2026-09-14 ~22:0x: scenario-rest-green (complete; in
`2f6f11419c`, which ALSO carries the lint session's swept in-flight work —
attribution note in the commit message, lint session verified content and
approved keeping it; collect by explicit file lists from now on, their
agents are still writing in scenario/trace/langy/governance dirs).
model-provider-members-green (review, `f3624cb743`) — api + both worker
compositions given the config keys the new schemas require; Enterprise
managed-provider seam left as a named decision in its handoff.

Collected 2026-09-14 ~21:2x: experiment-members-green (review, `d2b64cf715`)
— reads(clickhouse, logger, prisma), 5434/5435 baseline-identical, the two
SDK-door fact bindings removed (host binds them since `a955763c75`).
Queued follow-up from its handoff: ExperimentCapabilityUnavailableError
(HandledError) for the three named refusals — aligned with the user's
standing rule that handled errors are improvements.
USER DIRECTION (standing, 2026-09-14): where main errored and the branch
answers a HandledError, allow and baseline it (server-error-resolved:* into
the ledger baseline); only handled-refusal-degraded is a defect.

Collected 2026-09-14 ~21:0x: entitlement-members-green + user-members-green
(review, `fa2b3c62c1`) — both config slices applied, members table
regenerated (entitlement's reads() inlined onto the class so the generator
sees it). Open follow-up from entitlement's handoff: whether an
Enterprise-tier override path for EntitlementApi needs building (core-tier
entitlement can never resolve a paid licence/subscription now) — a product
decision, parked.
Collected 2026-09-14 ~21:4x: suite-members-green (partial, correctly;
`85f7d8726d`) — publicBaseUrl via config slice (applied), presence from the
agents peer, retention from the platform default, run execution refuses
handled pending a cross-module decision (request in its handoff §10; its
scenario-test conversion request was forwarded to the active scenario lane).

Collected 2026-09-14 ~20:4x: prompt-members-green (review, `7fc8a580c2`) —
reads(prisma, logger), deleted composition ported verbatim, +1 regression
test executing the crashed path, 216/216 unit tests. Its shared request
(members table row) applied by regenerating `pnpm generate:modules`, which
also picked up experiment/user rows from lanes still in flight. typecheck:one
was contention-blocked 8/8 (concurrent lanes), lane-verified via tslsp
diagnostics; final typecheck:all before push is the backstop.

## Session 2026-09-14 evening (lint-debt drive, session 4a7a3221)

Drive: user-directed — work through `pnpm lint` (14,963 live errors measured
19:00). Working DIRECTLY (no lanes yet); edits are committed scoped and
promptly, one class per commit. NOTE to other coordinators: this session's
uncommitted edits were wiped once by a tree clean at ~19:04 — please
`git status` before sweeping, this session may have edits in flight in:
modules/presence, modules/project + ProjectApi consumers, modules/topic,
modules/workflow/server, packages/runtime-composition, packages/test-harness,
sdks/typescript, and comment-only rewraps across modules/trace/server. It
stays OUT of: agent/analytics/prompt/scenario web dirs, the debt-4 server
dirs' typecheck-relevant code, tools/thuishaven, prisma-client seed files.

## Session 2026-09-14 evening (mail-sink drive, coordinator 06d630cd)

Drive: build specs/setup/mail-sink.feature (user-approved spec) — the mailsim
service, the haven mail lane + CLI, then the seed-address lane. Contract
pinned in both manifests; integration verified at collection.

Collected: haven-golangci-prereq (`250bcee79e`) — catalogue entry, three-state
version probe (missing/pinned/other -> outdated), internal GOTOOLCHAIN-pinned
installer, spec scenario bound (26/26 on its file). Reported "complete"
uncommitted (misreport, treated as review); checks re-verified green by the
coordinator on the post-bump tree. Optional follow-up in its handoff §9:
a Version() port method for full hermeticity of the version-exec step.

DONE (coordinator, user-directed, `b772653da7`): repo Go 1.26.6 -> 1.27.1 —
go.mod, go.work, infra/clickhouse-serverless go.mod, 4 golang: Dockerfiles,
GOLANGCI_VERSION -> v2.13.2, .golangci.yml go: 1.27, BOTH go-ci.yaml pins
(fourth+fifth copies of the version), mailsim added to both CI package
lists, CLAUDE.md steers to make go-lint. The CI-shaped gate now reports
0 issues (was red with 4 pre-existing before the bump); all 13 post-bump
findings fixed, incl. two new gosec (transcription form parse annotated
bounded like its siblings; idpsim SAML pre-read size-capped at 1 MiB).
KNOWN, not this drive's: aigateway controlplane contract tests fail at
HEAD either way (TS files moved by the restructure — apidiff drive class).
FYI: make go-lint (wider set incl. tools/thuishaven) still carries ~800
pre-existing findings CI never gated; 419 are funlen/gocognit/revive that
CI runs new-lines-only. A payback drive needs its own decision.
Note for the golangci-prereq feature: haven's probe now reports v2.13.2 as
the pin, matching the bump automatically (it parses the Makefile).

Follow-on 2026-09-14 ~21:15 (user asked why golangci-lint cannot run):
ROOT CAUSE established — machine Go 1.27.1 is ahead of go.mod's 1.26.6; the
pinned v2.11.4 linter (built with Go 1.25, upstream ships latest-1) reads
export data only up to the 1.26 format; CI is immune via go-version-file.
Coordinator committed `1ed0d3583c`: make go-lint/go-lint-changed pin
GOTOOLCHAIN from go.mod, mailsim joins GO_LINT_PKGS, and the first real lint
run's 7 findings fixed (incl. a real G703 path-traversal on delete — unlink
now uses the store-minted id). mailsim lints at 0 issues.

NO ACTIVE LANES — drive COMPLETE 2026-09-14 ~20:45. All 27 enforceable
scenarios of specs/setup/mail-sink.feature bound and green; the two still
@unimplemented ("Email to the seeded identity lands in the stack that sent
it", "Every account a preset seeds is reachable through the sink") need a
live two-stack e2e, deliberately left. Coordinator ran the real-wire
integration check: booted mailsim via cmd/service, delivered real SMTP,
verified list/get JSON, links extraction, and both security-header profiles
byte-exact. Known limitations: golangci-lint unrunnable on this machine
(CI is the backstop); attachments serialise as null not [] when empty
(harmless to the Go CLI, cosmetic).

Collected: mail-seed-addresses (review; new files at `a0aa2c07d4`, its
tracked edits swept earlier into the lint session's `d5a7800212` —
content verified intact). 149/149 package tests; typecheck:one blocked by
the pre-existing modules/api-key TS2883 class the debt lanes track.
ATTRIBUTION for the ~19:04 stash incident: it was THIS lane (admitted in
its handoff §11) — it ran `git stash`, the pop conflicted, and it restored
152 files one-by-one from stash@{0}. Its unverifiable window (overwrites
between 19:05-19:35) is flagged; other sessions have re-verified their
areas. stash@{0} is now redundant per its verification — DROP (never pop)
once 4a7a3221 confirms.

Collected: haven-mail-lane (partial, correctly; `2c8becae70`) — the whole
lane/CLI/injection surface, 14 scenarios bound; coordinator applied its §10
fileregistry patch ("mail" key handed from the retired mail-room shim to the
sink lane), updated the migration scenario in haven-service-selection.feature
+ its bound test to the new key semantics, and verified db.go net-zero and
both injection branches tested. ./tools/thuishaven/... fully green after the
patch. specs/setup/mail-sink.feature is HELD UNCOMMITTED until
mail-seed-addresses is collected (it carries that lane's tag flips too).
STASH WARNING: stash@{0} (on top of 55fe9ccb49) holds a repo-wide stash some
actor made ~19:04 — it contains other sessions' work (apps/api, apps/worker,
enterprise, e2e); haven-mail-lane and mail-seed-addresses both recovered
their files from it read-only. Do not pop it; owners should `git show
stash@{0}:<path>` what they miss.

Collected: mailsim-service (review, `55fe9ccb49`) — the whole Go sink, 9/9
service-side scenarios bound, parity green with the new services/mailsim scan
root; coordinator applied the cmd/service/main.go registration, repaired a
go-mod-tidy sweep (targeted `go get` of the three emersion modules instead),
and removed the LEGACY_INERT entry. Known limitation: golangci-lint is
unrunnable on this machine twice over (go-run path: Go 1.27.1 export-data
mismatch, proven pre-existing against idpsim; PATH binary: v1 vs the repo's v2
config) — the lane hand-audited spelling/testifylint; CI's go-ci/lint is the
backstop. Mid-flight direction (user): the seeded login is GLOBAL and renamed
once to admin@mail.langwatch.localhost; haven passes no SEED_EMAIL_DOMAIN;
haven-mail-lane messaged twice (seed-env removal, DefaultAdminEmail rename).

## Session 2026-09-14 (build+typecheck drive, coordinator 22f604f3-restart)

| lane                        | status | model  | owns                                          | manifest                                              |
| --------------------------- | ------ | ------ | --------------------------------------------- | ----------------------------------------------------- |
(no active lanes this session)

Collected 2026-09-14 ~21:5x: rest-chain-port (two attempts, both partial,
both correct) — gateway class at `eb08d4c77b` (GATEWAY-SERVER AT ZERO),
langy + prompt at `a9500e30a5` (deferredScope for handler-owed permission,
public+own-check for the minted Langy session key, SSE through the raw
seam; coordinator removed the two casts the lane left — both proved
unnecessary, 8/8 integration tests green without them).
`AppRestSecurity` now survives ONLY in enterprise governance's five
transport files, which another session's restructure relocated to
`enterprise/modules/governance/server/src/transport/*.rest.ts` and whose
directory still carries that session's uncommitted edits — the governance
port is HELD until that tree goes quiet; re-derive the file list then
(details + the stored-object-file.rest.ts precedent in
.claude/handoffs/rest-chain-port.md §11-12).

Collected 2026-09-14 ~20:50: module-server-typecheck-debt-5 (partial,
correctly) — 11 files at `a57d6b3d13`: identity-server ZERO on both
projects (425/430 tests, no regressions), analytics-server 39→13 (all
remaining architectural/orphan). ROOT-CAUSED gateway: `1dfbc5dcf1` deleted
the legacy `createAppRestSecurity` chain and twelve files across
gateway-tests/langy/prompt/enterprise-governance were never ported — ~400
of gateway's ~450 errors are that one cascade; rest-chain-port owns it.
Coordinator decisions still open from its handoff: analytics' orphaned
`langwatch-ql/provisioning/` directory, and two committed
merge-conflict-marker test files from `b5320f7103`.

Collected 2026-09-14 ~20:15: module-server-typecheck-debt-4 (partial,
correctly) — 13 files at `ed38f1d3fa` (trace-server 0, hosted-mcp 0,
suite at TS2883 baseline, github source clean, model-provider 9→1
architectural); 2 more of its files were already absorbed by the
fast-moving HEAD before collection. Not reached: identity (5 real errors,
notes in its handoff §5/§9), analytics-server and gateway-server (never
measured fresh) — debt-5's scope. The one committed cast
(`as ModelMessage[]`) re-spells a pre-existing vendor-boundary cast at the
`ai` SDK seam, not a new one.

Collected 2026-09-14 ~19:45: module-web-typecheck-debt (partial, correctly)
— 15 files at `15e0f558c7` (agent-web and prompt-web to ZERO own errors,
analytics 61→47, scenario 30→10), its two shared requests applied at
`c0de19bc28` (chart-playground flag whitelisted; ContractApiMap nests dotted
namespaces the way the router does — analytics then 47→41). Remaining per
its handoff §11: analytics' borrowed-`unknown` procedures + unimplemented
components (41), scenario's last 10, and 48 errors in web packages this
manifest never owned (project 19, workflow 11, experiment 8,
model-provider 6, trace 2, langy 1, annotation 1) that share the same
declaration group — the next web lane's inventory.

**STASH WARNING (all coordinators)**: `stash@{0}` (on 55fe9ccb49) is a
150-file snapshot of the ~19:04 tree wipe — its paths overlap the
lint-debt session (4a7a3221)'s declared areas and the mail drive's
e2e/langy files, and the web lane recovered its own 10 files from it
already. The live lint session has since re-edited many of the same paths,
so POPPING IT WOULD REGRESS THE TREE. Leave it until 4a7a3221 confirms its
working state supersedes it, then drop — never pop — it. And: no lane or
coordinator should run an unscoped `git stash` on this shared checkout
again; that is what caused the wipe.

Collected 2026-09-14 late evening: module-server-typecheck-debt-3 (partial,
correctly) — langy+prompt mechanical drift collected at `05469dd538`, its
two shared-file requests applied by the coordinator at `8cfd1e6825`
(PathParameterNames strips Hono regex constraints — cleared ALL 7
prompt.rest.ts errors; finished-event schema admits evaluations — cleared
the projection pair). Remaining per its handoff §11: the REST-chain
architectural port (prompt-execute.api.ts + 3 langy api-rest files name an
`AppRestSecurity` chain @langwatch/api/rest does not export), the
dead-monolith orphan files, and scenario's result-atoms-fold straggler.
ALSO pre-existing, found at collection: scenario-contract's
scenario-execution-data.boundary.unit.test.ts resolves the repo root one
segment short (scans .../github.com/langwatch/apps, ENOENT) — a test path
bug, fails for anyone on this checkout name.

Collected 2026-09-14 evening: module-server-typecheck-debt-2 (partial,
correctly) — its webhook/evaluation/scenario work AND its five scenario
contract requests all landed in `f7f3b69f55` (previous coordinator);
scenario-server verified down to the tracked orphan/WIP classes + 2 straggler
files, folded into debt-3. Coordinator's own auth-loop fix `e9095a71a9`
(tRPC door reads sessions through the auth module by default — live-verified,
loop gone), OperationsOnly compile guard `02db04f32c`, lockfile catch-up
`2f9b7234bf`.

ENTRY POINT (2026-09-14): dev/docs/plans/handover-2026-09-14-recovery-drive.md
— the recovery-drive session (22f604f3) collected every lane and wound down;
NO lanes are active; the stack is UP and verified; the queue lives in that
handover. Everything below this line is that session's historical roster.

Drive: **get `apidiff` to a report against `origin/main`.** Gate 1 (SDK build)
is OPEN, the refreeze is DONE, migrate/seed/fixtures pass. The remaining wall
is the api's per-module App wiring: boot names one module at a time; fixed so
far model-provider, trace, webhook, moduleConfig, authz, identity (6a7c671691),
plus the api's eventing member + last erased-extends (c6d115c2db). Loop:
apidiff run -no-haven -keep -work-root <kept> -reuse-worktrees -skip-install.

handover (api drive): dev/docs/plans/handover-2026-09-13-apidiff-2.md
handover (visualdiff/worker drive): dev/docs/plans/handover-2026-09-13-visualdiff-2.md  <- ENTRY POINT for the worker-side coordinator; LIVE items at the top (one lane active: module-v2-workflow — check its handoff file on disk, its spawn session is gone)

SOLE COORDINATOR as of 2026-09-13 late evening: the apidiff and visualdiff
coordinator sessions are gone (user confirmed "only you are working now");
this session (bg job 22f604f3) holds all drives. It inherited the dead apidiff
session's uncommitted work (api idempotency-ledger seam in
api-production.composition.ts + api-rest.host.ts, and
dev/scripts/find-unbound-rest-facts.mjs) — import-checked clean, being
committed by this coordinator.

| lane | status | model | scope |
| --- | --- | --- | --- |
| scenario-di-rewire | active (22f604f3) | opus | the six remaining contract strays rewired against suite/agent class services; contract to ZERO errors |
| gateway-callable-surface | active (22f604f3) | sonnet | the six spend property members become methods (operations-only proxy finding); exact edit list in gateway-control-plane handoff |
| webhook-endpoint-stream | active (22f604f3) | sonnet | WebhookEndpointStreamService extraction + WebhookApi.appendReplayToEndpointStream; gateway wiring via §10 |
| workflow-web-imports | active (22f604f3) | sonnet | the 33 UNRESOLVED imports blocking `pnpm --filter @langwatch/ui build` (and the production image) |

Collected this wave: app-static-disposition (8760a1f575 — MOUNTED, evidence:
the api container is the whole interactive tier; fallback declines the real
route table; coordinator renamed rawSurface→staticSurface/ApiPreRoutingSurface
per user direction and wired the entrypoint); gateway-control-plane
(7987eb080b partial — members/peers ported; FOUND: module proxies answer
callable operations only, six getters unreachable → gateway-callable-surface;
webhook replay needs the stream extraction → webhook-endpoint-stream);
api-package-test-health (a8119b664c — the "flake" was spyOn never
intercepting; 16 consecutive green full-suite runs); composition-kit-fixes
(6554214081 — filters were RIGHT, tests wrong; ModuleConfigGuard applied,
six modules clean; §10 request queued: thread Config through createProcess);
unserved-operations-remeasure (6554214081 — 65 operations, five-class table
at dev/docs/plans/unserved-documented-operations-2026-09-14.md).

trace-route-500: blocked by checkout churn (three boots, three different
mid-edit failures), no repro captured. THEORY on record: TraceApp implements
none of the six members trace-legacy/tracked-event routes call — the same
missing-App-surface class gateway had. Coordinator retries the repro in a
quiet window; likely follow-up is a trace twin of gateway-control-plane.

Held: feature-shape-baseline-rebuild (until scenario-di-rewire and the
gateway/webhook pair land). Queued: createProcess Config threading (§10);
withTransports Api-vs-App phantom-reads sketch (kit handoff §11);
coordinator moved the prompt transport test (aa41886530).

worker-app-dependencies: complete with ZERO edits — the evaluator/workflow
wall does not reproduce under a resolved haven env (3873921a8a already guards
the peer); solo worker AND haven's combined backend both reach `worker ready`,
zero fatals. Latent hardening note in its handoff §9.

STACK UP 2026-09-13 ~22:20: `make haven up` stack healthy — UI 200 at
https://app.feat-strict-feature-layout-v0.langwatch.localhost:1355/,
/api/auth/session 200 no-store through the same origin, backend worker+api
ready, gateway/nlp/langy lanes present. The original ask is closed.

Collected: worker-pipeline-ownership (a708ff920d) — identity owns its worker
registrations via the trace pattern and the audit proved it was the ONLY
module-vs-installer duplicate. auth-owns-better-auth-2 (3e90aaad43) — VERIFIED
LIVE: GET /api/auth/session answers 200 + no-store + null (was 404); sign-in
serves for the first time since b383462d96. Coordinator repairs (3ca8e2a808):
test-harness ts-ast repoint + honest findLine rename, ops self-import; and
fb0c24e7db absence-list cleanup. Solo worker now dies at the observability
app's workflow dependency — the active lane's wall.

MILESTONES 2026-09-13 ~22:00:
- SOLO API BOOTS AND SERVES (first since Sep 10): mounts all transports,
  answers 401 at /api/v1/platform-health and /api/prompts, 404s for unmounted
  surfaces. /api/trace/x answers 500 — queued.
- find-unbound-rest-facts: "Every declared REST fact is bound." (zero)
- FULL BACKEND (worker+api) still walls: identity pipeline registered twice
  (module + legacy worker installer) — exposed by the restored loud refusal,
  previously a SILENT keep-first. `make haven up` timed out waiting on the
  crash-looping backend health; retry after worker-pipeline-ownership lands.
- authRest is mounted by NO process: /api/auth/* (sign-in) unserved on this
  branch; auth-owns-better-auth-2 is the fix. AuthApp and GatewayApp both
  received {} members since b383462d96 (casts, unions of optionals).

Collected since the last table: trpc-router-composition (a13108fbe8,
composeTrpcRouters + one "ops" claim, spec scenarios bound by coordinator);
scenario-server-moves (c444e9eb21, partial — 6 files remain needing DI
re-wiring vs suite-server/agent-server, inventory in its handoff §8);
gateway-spend-disposition (blocked correctly) → gateway-install (partial,
committed: spend family mounts refusing honestly; control-plane member port
QUEUED, 529-line recipe at b383462d96^, needs coordinator seam decision);
module-contributions-build-delete (f04cd59062); data-retention-install-test
(20c3d05276); prompt-create-params (97f8809c4d); coordinator: data-retention
repair (1eed7111e2), absence-list cleanup PENDING (8 served namespaces still
listed), scanner-ENOENT was pre-commit staleness (runs clean now).

Queued: gateway control-plane member port (Opus, needs ClickHouse-resolver
seam decision); WebhookApi.appendReplayToEndpointStream contract addition;
scenario 6-file DI re-wiring lane; feature-shape-baseline-rebuild (held);
apps/api absence-list update; /api/trace/x 500; packages/test-harness
declarations break (./tsAst missing); packages/api flaky isolate:false suite;
transport-mounting REST/tRPC fact filter transposition (2 failing tests);
ModuleConfigGuard applied nowhere (keep the @ts-expect-error!).
| ops-trpc-one-namespace | blocked correctly, reverted clean | sonnet | VERIFIED: the fluent builder overflows at ~50 procedures (TS2589); ops has 92 across 5 fragments — the single-contract target is unbuildable. Decision taken: Option A (kit primitive), Option B (module imports @trpc/server) rejected as hand-wiring |

BOOT PROGRESS 2026-09-13 ~21:05: solo api boot attempted after all fact lanes
landed. EVERY unbound-fact wall is cleared (scanner: 1 remaining =
gatewaySpend, family unmounted, parked). Boot now reaches transport mounting
and dies on the ops duplicate tRPC namespace — the lane above. Worker
composition imports clean. Better Auth instance composition is the named open
decision (api-browser-session-capability handoff): until wired at
api.entrypoint.main.ts:25, every session fact answers its refusing variant.

| api-browser-session-capability | collected, b6166254aa | opus | seam rebuilt, six facts bound fail-closed; two wire differences recorded in the commit; Better Auth composition decision OPEN |
| langy-prompt-facts | collected, 4b20a90735 | opus | langyTurnsMembers from declared peers (FeatureFlagApi token + prisma member); prompt platform-url on the contract (coordinator line); prompt.app.ts CreatePromptParams errors are a PRE-EXISTING class, queued |
| build-call-removal | collected, be42ed2e3e | sonnet | 38 installers end on their last contribution; bare-withApp worker evaluation composition keeps .build(), named; follow-up queued: delete ModuleContributions.build |
| merge-casualty-repairs | collected, 3305579417 | sonnet | suite-contract + secret-server compile; coordinator added the node-ESM .ts extension its typecheck could not catch |
| worker-trace-ownership-2 | collected, 9ec1f873a6 | opus | Option A landed; duplicate-name registration throws again; worker composition IMPORT OK — first full worker composition load on this branch. Spec-binding question open: 4 scenarios in modules/trace/specs bound from packages/eventing tests — verify parity counts them |
| (coordinator) data-retention repair | committed 1eed7111e2 | — | ghost re-export + toReversed lib gap; declarations pre-pass clean for trace dependents. Pre-existing: its installation tests miss the clickhouse member (queued) |

Collected this cycle (22f604f3), each on its own commit:
| lane | outcome | model | note |
| --- | --- | --- | --- |
| typecheck-honest | collected, 9f89e22eba | sonnet | both phases always run, exit ORed; the days-long apps/api blind spot is closed |
| lint-clickhouse-containment | collected, fc84e2b794 | sonnet | rule at error, 8 measured violators baselined; coordinator applied enforcer registration |
| api-shell-dead-code | collected, 0190d5d84c | sonnet | 66 dead files gone after per-file re-verification; app-static orphan REPORTED not deleted; prompt test move handed to langy-prompt-facts scope owner at next collection |
| builder-one-termination | collected, 55f2a9f725 | opus | one termination rule, .build() deprecated identity, A/B zero new failures. FOUND pre-existing: transport-mounting REST/tRPC fact filters possibly transposed (2 failing tests); ModuleConfigGuard exported but applied nowhere (do NOT delete the @ts-expect-error at define-feature.unit.test.ts:98 — it marks the missing compile-time refusal) |
| docs-reconcile-shape | collected, b68e50256a | fable | guide derives from ADR-144, names only live identifiers; ADR amendment separates module chain (no .build) from router builders (keep theirs); composition artifact grammar-admitted. On baseline rebuild: do NOT re-baseline the 10 grammar-admitted app/<m>-composition.build.ts files |
| rest-facts-batch-a | collected partial, 112a4cdbe4 | sonnet | org enterprise gates + ops bugReportCredential bound; 4 facts blocked on host capability (now the api-browser-session-capability lane); gatewaySpendBillingPlanGate PARKED: family unmounted, GatewayApp lacks its methods — architecture decision needed. FLAGGED: tRPC group.* still gates through always-refusing assertScimAllowed while the REST fact uses the real plan lookup |
| rest-facts-batch-b | collected partial, 3256cb8474 | sonnet | 5 modules bound; playground pair → host lane; langy untouched → langy-prompt-facts; workflowEvaluationRunCeiling is a NEW fact bound fail-closed (flagged, no deleted mount to compare) |
| scenario-contract-imports | collected partial, 239d2a115a | sonnet | named files clean; 11 stranded server files inventoried in handoff §12 for a scenario-server move lane; VoiceTransport home question in §11 open |

Queued: mechanical .build() removal across 48 installers (after langy-prompt-facts
frees the server.ts files); scenario-server stranded-file moves (§12 inventory);
gatewaySpend architecture decision; feature-shape-baseline rebuild (after all
implementation lanes land).

Coordinator commits this cycle: 5db3580538 (unbound-facts scanner + CI gate,
bindRestHeader fix), febccfe138 (inherited idempotency seam), 9f89e22eba,
fc84e2b794 (+enforcer registration), 0190d5d84c (+monitor devDeps), lockfile.

Collected: analytics-apikey-protections (review, two rounds) — committed
a8f3b3e1b5 (caller protections, fail-closed port) + 75a3557eb8 (both URL
facts over a publicBaseUrl config slice the coordinator applied). One flagged
inference: dashboardWidgetUrl's /analytics/reports path came from the UI
route table, not a deleted mount - sanity-check when the UI exercises it.
| worker-consolidate-scenario-workflow | active (apidiff-session coordinator) | sonnet | scenario+workflow into the shared app, agent-apps rewired, plus the monitor/evaluator follow-through checklist; owns worker-agent-apps/observability-apps/production/evaluation-execution/evaluator compositions |
Collected: langy-declared-peers (complete) — committed 7a7e741972; presence's
API carries the fabric ops, langy reads eventing and builds its dispatcher
in-module (langy-eventing.build.ts). One sanctioned wire difference recorded:
no eventing member now refuses at boot naming "eventing" (was per-write).

Collected: worker-consolidate-monitor-evaluator (partial, correctly) —
committed 7e6999d729 including the coordinator's applied shared-file request
(workerEvaluationApp declares monitors/evaluators as token dependencies,
killing the bag circularity it found). Its §12 follow-through checklist is
folded into the scenario-workflow lane's manifest.

Collected: module-workflow-members (complete) — committed b8a69d0bf9; workflow
builds workflows+datasets in-module (config nlpServiceUrl, reads prisma+
encryption, datasets: DatasetApi peer); 188 tests, module typecheck clean.
Risk noted in its handoff: model-provider resolution inlined against the
contract instead of the server wrapper - behavior-parity believed, reviewer
may want to compare once the worker boots.

Queued, spawn only after BOTH above are collected:
worker-consolidate-scenario-workflow (manifest written; owns worker-agent-apps + the same shared-app files).

USER DIRECTION 2026-09-13 evening, binding on every lane: no hand-wired
LocalFeatureApis/.declare/.withProvided peer plumbing for module instances;
consolidate into shared createApp installs the way the api process does.
Slice work small, on cheap models.

Collected: module-v2-workflow (partial) — committed 148fa2ad69 including the
coordinator's nlp-lambda test repair; install ran; workflow-server typecheck
clean, tests at baseline. Its §11.1 members question was answered by the user:
full conversion, recipe-scoped (see module-workflow-members manifest). The
visualdiff coordinator session is GONE and no successor started; this session
holds both drives.

THREE coordinator sessions share this checkout (2026-09-13 ~16:00): apidiff
(api install-order queue), visualdiff (worker side), and the user's "migrate
ksuid package" session, which owns packages/ksuid, packages/ksuid-python, the
catalog->workspace package.json sweep, pnpm-workspace.yaml and the lockfile.
Nobody else commits those files. UPDATE: the ksuid migration LANDED
(23cb2058ce) and the boot loop is running again. pnpm install is announced on
the cross-session channel before running — shared node_modules.

## Collected 2026-09-13 (visualdiff/worker drive)

| lane | outcome | model | note |
| --- | --- | --- | --- |
| worker-miniapps-scenario-obs | complete, committed `8621b412bd` | sonnet | both files v2, public exports unchanged; coordinator applied the §10 call-site lines (queryClient + eventing to observability apps); solo boot runs the whole surface to MissingMemberError suite/clickhouse |
| worker-miniapps-evaluation | complete, committed `418f69ddae` | sonnet | three files v2; named monitor/evaluator/dataset as unconverted (silent-undefined hazard class) — all three claimed within minutes |
| module-v2-langy (attempt 2) | review, committed `a24a63479f` | sonnet | reads(prisma,redis) + dependency tokens; PresenceBroadcastFabric peer token (generic, two consumers: langy + trace's future wiring); recorded gaps: relay needs a public-base-URL config field, uiActionSurface fail-closed pending FeatureFlagApi peer; baselines held exactly |
| module-v2-topic | review, committed `fd05332478` | sonnet | reads("prisma"), schedule reader self-built over the process-store row; api role's hard-coded "not scheduled" gone (deliberate wire fix); 178/178, three pre-existing failures cured; coordinator applied the package.json dep + install (announced) |
| module-v2-small-trio | partial, feature-flag committed `69a8eb70ac` | sonnet | feature-flag fully converted + voiceAgents contract fix; dashboard BLOCKED on analytics workbench surface (decision with apidiff session); topic not reached (respawned as module-v2-topic, since landed); flagged a TS project-reference staleness gotcha in its handoff |
| organization-composition-green | collected, committed `d9b888e858` | opus | triage table delivered; settingsSecrets collapsed to the encryption member; invitations/joinRequests null -> doors refuse by name (builders died with b383462d96, no owner yet — REAL wire gap apidiff will name); 243/243 |
| stored-object-composition-green | collected, committed (see below) | sonnet | 540-line port; owner lookup absence-only per pre-authorized exit; baselines byte-identical |
| worker-foundation-v2 | collected, committed `019d94914d` + coordinator wall-walking on top | sonnet | foundation rewritten to createApp/membersFrom/withModules/boot; four hand-wired installers + dead test deleted (−1064 lines); reported "blocked" on six modules' bespoke bags but the block was compile-time only — at runtime the v2 refusals name modules one at a time (identity→entitlement→…), which IS the finish line. Its "six modules structurally unfittable" analysis = the live conversion queue (organization was already converting in-tree as it wrote). Coordinator added identityServer+entitlementServer to the list and the encryption member (resolveWorkerStoredSecretCipher). codex-coding-defaults.integration.test.ts left loudly broken pending queue completion. |
| ops-composition-green | collected, committed `2c2dbc6528` (with the coordinator's apiModuleConfig ops entry) | sonnet | 491-line composition ported into the module; refusal proxies preserved; circular import broken via QueueAuditSink extraction; 449+/457 tests baseline-identical; boot confirmed past ops |
| worker-erased-extends | complete, committed `eddbdfe58d` | sonnet | 47 sites / 27 files, all case-1 (interface bases → implements). Detector now reports 0 in apps/worker; 4 remain in apps/api (handed to the apidiff session). Worker typecheck still red on pre-existing modules/scenario/contract errors — not this lane's. |
| worker-usagestats-seam | complete, committed `64af8f1446` | sonnet | routingDriver moved to @langwatch/clickhouse-client; worker infra exposes queryClient (driver+tenant guard, no double retry/limiter); ops usageStats.clickhouse optional with warn+skip; both as-never casts at the ops call site deleted (file 6→4); ops unit test 7/7. One reviewed deviation: RoutableStatementClient.query returns json(): unknown with the Row[] assertion at execute()'s one read site — the vendor's format-generic query can't satisfy the literal generic form. |

## Collected 2026-09-12 (parity drive)

| lane | outcome | model | note |
| --- | --- | --- | --- |
| parity-boot-chain-2 | stopped by coordinator, work verified + committed `17d0a92311` | sonnet | cleared organization (10 symbols restored from `0611c343fe^`) and the governance repoint, then wedged on `LangyTitleModel` with no handoff. 12 of the 24 symbols remain; the list is in the handover. organization-server 243/243, governance 158 -> 157 failures. |
| parity-boot-chain | stopped by coordinator, work salvaged, committed `85f6595385` + `aaecc74349` | sonnet | wedged ~20min past budget mid-way through coding-agent with no handoff. Its finished work was reviewed and banked; the coordinator then generalised the pattern it was applying one file at a time into a single swept change. NOT complete: the generator still does not run - it now fails on CROSS-PACKAGE type imports (`@langwatch/dataset-contract` / `DatasetNormalizePayload`), which the sweep deliberately left alone. |
| parity-pulled-usage-currency | collected, committed `1afba5a3ba` | opus | reported `partial`, accurately. Money model ported end to end; openai-admin-puller 38/41 -> 41/41, contract 77/77. Coordinator applied its two shared-file requests (the contradictory test line, and puller.ts's signed-amount + currency fields). Found a real contradiction between two on-branch tests and correctly refused to edit either. Two named tests (`pulledUsageCurrency`, `signedPulledMoney`) are verbatim ports from main that CANNOT LOAD here - they import an `@ee/...` alias this branch lacks - so they were never binding anything. |
| parity-scenario-pool | collected, committed `70960d916f` | opus | reported `partial`, correctly: repaired both owned files AND identified two artifacts outside its paths it refused to touch. Coordinator applied those (`EventSchema` -> module base schema in scenario + suite contracts, and a dropped import). Package went from every file crashing at import to 1014 passing / 22 failing. Outstanding shared-file requests NOT yet applied - see handover. |
| parity-governance-puller | collected, committed `1d758e09e0` | sonnet | file parses; found + fixed a second casualty (unqualified `encodeCursor`, a runtime ReferenceError); 38/41 tests. Claimed `complete`; collected as reviewed-with-limitation because its manifest's `typecheck:one` is blocked upstream in `packages/observability` (missing `langwatch` SDK types). The 3 test failures are the pulled-usage currency gap, not this repair. |

## Collected 2026-09-11

| lane | outcome | model | note |
| --- | --- | --- | --- |
| governance-web-server | collected | sonnet | 10 files, verified 0 markers / 0 stale, staged |
| governance-mechanical | failed | sonnet | 600s stall at file 9 of 10; finished work salvaged from disk |
| governance-batch-b | failed | sonnet | 600s stall at file 6 of 7; finished work salvaged from disk |

All three were spawned with no rows and no manifests, so the session-start hook
reported `no lanes active` while three were live. Neither failed lane left a file
list, so their finished work was recovered by sweeping `UU` entries that carry no
markers - which only works because nothing else stages a `UU` file.

## Lane mortality on this drive

Five of six spawns have died - 600s stalls and `ENOTFOUND` - and the last two
died before completing a single file, so there was nothing to salvage. This is
environmental, not prompt quality. Two consequences, both load-bearing:

- Lanes are kept small (3-8 files) so one finishes inside the failure window.
- Dead-lane recovery is the sweep for `UU` entries carrying zero markers. It
  works because nothing else in this drive stages a `UU` file, so a marker-free
  `UU` is by construction a lane's finished-but-unstaged work.

## Cycle 2 outcome

| lane | outcome |
| --- | --- |
| merge-tail-agent | killed by user after 2 of 5 files, both staged and collected |
| merge-tail-rest | died twice to 600s stalls, no files completed |
| merge-tail-trace | died once, 1 file collected; respawned |

Running total: 8 lane deaths in 10 spawns. The per-file staging instruction is
what turned dying lanes from a total loss into partial delivery - 3 files banked
this cycle from lanes that never reported.

## Cycle 3 outcome - all three died, all three delivered

trace (respawn 3), agent (respawn 2) and rest (respawn 3) each died to a 600s
stall or a mid-stream API error, and each banked files first. Markers 52 -> 45
across the cycle with no lane ever reporting completion.

Running total: 11 lane deaths in 13 spawns. Delegation is not reliable in this
environment right now; what makes it worth doing anyway is the per-file staging
instruction plus the marker-free `UU` salvage sweep.

Open reserved decision raised by the agent lane: main's voice-agent feature in
`agent-type-selector-drawer.tsx` needs a host-interface decision - see the
handover's reserved-decision section.

## Cycle 3 collection

`merge-tail-rest` COMPLETED on its third attempt - 13 files, all verified on
disk at 0 markers / 0 stale imports, three test suites green (8, 25 and 4
passing). Handoff at `.claude/handoffs/merge-tail-rest.md`. Row cleared.

What made the difference was ordering the list easiest-first and forbidding the
opening survey: the two attempts that died had both spent the window reading all
thirteen files before editing one.

### Update 20:30 (lint-debt drive, session 4a7a3221)
Active agent edit surfaces right now — collect nothing from these directories by pathspec (I collect by explicit file list):
- modules/trace (comment rewraps, two agents)
- modules/scenario/server (comment rewraps, one agent — note commit 2f6f11419c already swept an ~85-file snapshot; deltas keep landing)
- modules/automation + modules/billing (fallible-naming renames with repo-wide call sites)
- enterprise/modules/governance/server (feature-source-layout MOVE pilot: files being mv'd — a directory sweep here would commit half a move)

## Session 2026-09-16 (lint-to-zero wave 1, background job 4a7a3221)

Drive: `dev/docs/plans/handover-2026-09-16-lint-to-zero.md`. Goal is every
finding to zero, both halves of `pnpm lint`. Measured live at spawn time:
oxlint **14,885** (13,254 error / 1,631 warning), of which
`comment-block-size` **6,168** across 3,585 files; enforcer 2,761 unverified
this session.

Wave 1 is the comment sweep. Five concurrent lanes — above the three-lane
ceiling, deliberately: the five path sets are strictly disjoint, the lanes
change no code line, and review is a scoped per-file `oxlint` run rather than a
behaviour judgement, so coordinator cost per lane is near-flat.

Shared brief: `.claude/manifests/BRIEF-comment-block-wave1.md`.
Slice lists: `.claude/manifests/slices/<lane>.tsv` (dirty paths pre-excluded).

| lane | model | paths | findings / files | status |
| --- | --- | --- | ---: | --- |
| `comments-sdk-typescript` | sonnet / medium | `sdks/typescript/**` | 550 / 327 | COLLECTED `06807f2c35` + `1c24f7d5e7` |
| `comments-analytics` | sonnet / medium | `modules/analytics/**` | 408 / 215 | COLLECTED `c1ab56971a` + `5a3c6ab6ee` + `d8d945f2df` |
| `comments-trace` | sonnet / medium | `modules/trace/**` | 381 / 200 | COLLECTED `e2bbe50397` |
| `comments-scenario` | sonnet / medium | `modules/scenario/**` | 279 / 163 | COLLECTED `7b8f8ee699` + `095936beea` |
| `comments-gateway` | sonnet / medium | `modules/gateway/**` | 204 / 121 | COLLECTED `4e74c73a07` |

ANOTHER SESSION IS LIVE ON THIS CHECKOUT — 127 dirty files at spawn time, and
it wrote `modules/entitlement/server/src/app/__tests__/entitlement.fixture.ts`
at 00:50:06 and regenerated the Prisma client at 00:48:45. Its three uncollected
bodies of work, which this session does NOT commit:
- haven TUI + simulators: `tools/thuishaven/**`, `services/mailsim/**`,
  `services/idpsim/**`, `specs/setup/haven-*.feature` (~45 files; go build, vet
  and test all pass on this tree)
- request-bounds registry seam: `packages/plans/src/request-bounds.ts`,
  `packages/config/src/request-bounds.config.ts`, `modules/entitlement/**`,
  `modules/automation/server/**`, `apps/api` + `apps/worker` config and
  compositions (~22 files)
- private-runtime-export / prisma tail from 09-15 midday (~25 files) plus three
  untracked plan docs under `dev/docs/plans/`

`git stash@{0}` is theirs (mailsim WIP). Do not drop it.
Gap to origin/main at spawn: 4 behind / 2,920 ahead, merge-base `c5999477f1`.

### Wave 1 queue — slices already built, spawn on collection

`.claude/manifests/slices/*.tsv` exist for all of these; **regenerate against a
fresh `git status` before spawning**, the live session's dirty set moves.
Manifests still to write (copy the five `comments-*.md` shape).

| lane | paths | kept / files | dirty excluded |
| --- | --- | ---: | ---: |
| `comments-apps` | `apps/worker`, `apps/api`, `apps/ui` | 266 / 148 | 17 |
| `comments-enterprise` | `enterprise/modules/**` | 209 / 132 | 0 |
| `comments-eventing-pkg` | `packages/eventing/**` | 187 / 89 | 13 |
| `comments-ops` | `modules/ops/**` | 176 / 121 | 0 |
| `comments-automation` | `modules/automation/**` | 173 / 90 | 1 |
| `comments-model-provider` | `modules/model-provider/**` | 168 / 105 | 1 |
| `comments-identity` | `modules/identity/**` | 163 / 85 | 3 |
| `comments-coding-agent` | `modules/coding-agent/**` | 159 / 87 | 0 |
| `comments-prompt` | `modules/prompt/**` | 154 / 104 | 0 |
| `comments-dev-tooling` | `dev/**` | 147 / 54 | 0 |
| `comments-langy` | `modules/langy/**` | 123 / 99 | 0 |
| `comments-auth` | `modules/auth/**` | 120 / 73 | 0 |

Beyond these, 84 smaller areas hold the rest of the 6,168 (organization 109,
authz 99, architecture-enforcer 92, api-key 88, dataset 84, experiment 79,
clickhouse-client 77, project 71, workflow 70, user 70, suite 68, packages/api
68, redaction 68, group-queue 67, navigation 65, then a 713-finding tail across
56 areas). Split by package; the handover's `comments-tail` must not become one
lane of 78 areas.

Not yet verified this session: the architecture-enforcer's 2,761. It is a
whole-repo run holding ~2.76 GiB and a machine-wide slot, so it waits until the
oxlint lanes are idle.

### Lane `enforcer-d4-d5` — spawned 2026-09-16, sonnet / medium / standard

Settles D4 and D5 of `dev/docs/plans/architecture-lint-review-2026-09-08.md` on
the user's explicit direction ("settle D4 and D5 together").

Owns `packages/architecture-enforcer/**`, the two `comment-block-size` files in
`packages/oxlint-rules`, two skill reference docs, and the review document.
Disjoint from all five comment lanes.

D4 — delete the per-root comment ratchet. It records 20,110 blocks measured
2026-09-08 against a tree that now has 6,168, so it permits 3x what exists; its
only live behaviour is 168 scheduled expiry failures (5 tomorrow, 130 on
2026-10-01, 33 on 2026-10-15). Its oxlint half never matched the file shape
(`version === 0` + `roots` vs the file's `version: 1` + `entries`), so
`isCoveredByAllowedRoot` has always returned false — which is why the 6,168 is
honest. `comment-block-review` (a registered `run: () => []` no-op) goes with
it. No spec scenario binds either policy; parity is unaffected.

D5 — **already delivered; the review's "17 untested policies" is stale.**
Measured today: 39 policies registered, 38 have a test file named for them;
`overengineering-baseline` and `typed-prisma-seam-baseline` no longer exist;
`service-ceilings` kept a tested policy and lost its baseline. The one real gap
is `architecture-records` (no test anywhere) and it is load-bearing — it
enforces ten required sections in each ownership root's boundary ADR — so the
lane writes the test rather than deleting the policy.

COLLECTED 2026-09-16 01:3x as `46558772ec` (15 files, +262 / -1878). Row CLEARED
— worker stopped, handoff durable at `.claude/handoffs/enforcer-d4-d5.md`.
Reported `partial`, correctly: it stopped at a shared file rather than reaching
outside its paths.

Coordinator-verified on the tree, not taken from the handoff:
- `typecheck:one packages/architecture-enforcer` → 9 errors in 3 files
  (`feature-shape.ts`, `tests/baseline.unit.test.ts`,
  `tests/localDevLicense.unit.test.ts`), all clean in `git status` = pre-existing
  on HEAD, none touched by the lane.
- new `tests/architecture-records.unit.test.ts` → 4/4 pass.
- CLI loads, exit 0; `--review-comment-blocks` and
  `--comment-block-roots-reference` gone, `--review-test-quality` still works.
- `--list-policies` ends at `oxlint`; both comment policies absent (39 → 37).
- oxlint itself still runs, so the five comment lanes are unaffected.
- Four dirty enforcer files (`prisma-migration-access`, `prisma-table-ownership`,
  `shape-counters`, `clickhouse-tenant-scope`) are the OTHER session's 09-15
  14:1x prisma tail and were deliberately EXCLUDED from the slice.

DEFERRED, and it is the one thing left of D4 — do NOT do it while comment lanes
are live. The lane found a trap worth keeping: deleting `isCoveredByAllowedRoot`
from `comment-block-size.rule.mjs` without also removing it from the barrel
`packages/oxlint-rules/src/index.mjs` (line 23) makes EVERY oxlint invocation in
the repository crash at plugin-load with `SyntaxError: ... does not provide an
export named 'isCoveredByAllowedRoot'`, and
`pnpm --filter @langwatch/oxlint-rules test` does NOT catch it — vitest's
transform does not enforce named-export existence the way Node's ESM loader
does. The lane tried it, hit the crash, reverted cleanly, and left
`packages/oxlint-rules` identical to HEAD. Handoff section 9 has the exact
edit list. Verify with BOTH the package test AND
`pnpm exec oxlint --config .oxlintrc.jsonc <any file>`; only the second catches
it. Follow-on once it lands: `rootCovers` in
`packages/oxlint-rules/grammar/comment-block-policy.mjs:291` becomes an unused
export.

Also noted while collecting: the enforcer package still carries 92
`comment-block-size` findings and no lane owns them; they are in the 84-area
tail.

### Wave-1 collections, 2026-09-16 01:3x–02:0x

| lane | status | collected | result |
| --- | --- | --- | --- |
| `enforcer-d4-d5` | partial | `46558772ec` | D4 enforcer side + D5 test; oxlint-rules tail deferred (see above) |
| `comments-gateway` | complete | `4e74c73a07` | 204 -> 0, 121 files, 1,328 changed lines, 0 code lines |
| `comments-analytics` | partial | `c1ab56971a` | 408 -> 289, 26 densest files, 1,067 changed lines, 0 code lines |
| `comments-scenario` | complete | `7b8f8ee699` | 279 -> 1, 162 files, 1,989 changed lines, 0 code lines, 0 `@scenario` touched |
| (coordinator) | — | `095936beea` | scenario's last finding: a 101-column line ending in `// eslint-disable-line`; directive moved to its own line as `eslint-disable-next-line`, file now at 0 |
| (coordinator) | — | `2043e6f9e9` | `dev/docs/plans/comment-sweep-lost-facts.md` — the tracked register for facts the sweep cuts out |

All four rows CLEARED. Every diff was verified mechanically by the coordinator
before collection: every changed line matched a comment pattern, no file fell
outside its slice, no `@scenario` line moved.

**`.claude/handoffs/` is gitignored** (`.gitignore:191`). A lane's ADR
candidates and lost-fact notes therefore do NOT survive the lane. Copy them
into `dev/docs/plans/comment-sweep-lost-facts.md` at collection — gateway's are
already there, including one behavioural rule (spend attribution ordering) that
the lane itself flagged as cut too far and which is now nowhere in the tree.

**Reporting nuance to carry forward:** `comment-block-size` reports BOTH
over-long blocks and over-100-column comment lines under one rule id. A lane
saying "clean for comment-block-size" may mean blocks only. Measure with
`--format=json` and count the id, not the lane's prose.

### Spawned 2026-09-16 02:0x — the analytics tail, two lanes

| lane | model | paths | findings / files |
| --- | --- | --- | ---: |
| `comments-analytics-2a` | sonnet / medium | `modules/analytics/{contract,server}/**` | 108 / 69 |
| `comments-analytics-2b` | sonnet / medium | `modules/analytics/web/**` | 181 / 122 |

Split because the remainder averages 1.5 findings per file across 191 files:
the first lane spent 214 tool calls on 26 dense files, and per-file
verification over a tail that long exhausts a budget at about a third of the
list. Both manifests mandate **batch verification** (~20 files per oxlint call)
instead. Still active alongside: `comments-sdk-typescript`, `comments-trace`.

### `comments-sdk-typescript` collected, and an incident worth keeping

Collected `06807f2c35` — 320 of 550 cleared, 99 files, 2,702 changed lines,
zero code lines. Status `partial`, row CLEARED. Follow-up
`comments-sdk-typescript-2` spawned for the remaining 230 findings / 229 files
(one per file).

**INCIDENT: the oxlint plugin crashed repo-wide for a stretch, and it was our
own doing.** The `enforcer-d4-d5` lane's attempt at the `oxlint-rules` deletion
removed `isCoveredByAllowedRoot` from the rule file while the barrel
`packages/oxlint-rules/src/index.mjs:23` still re-exported it, so every
`oxlint` invocation in the repository failed to load the plugin until the lane
reverted. The sdk lane hit that window and reported it. The ordering
instruction ("touch oxlint-rules LAST") limited the blast radius but did not
prevent it — a shared linter package cannot be edited at all while lanes are
running. This is why the remaining `oxlint-rules` deletion stays deferred until
the sweep is idle, and why every tail manifest now carries: **if oxlint will
not load, STOP and report — do not improvise a substitute scanner and do not
keep editing on judgement alone.**

### Verifying a comment-only diff: use two checks, they have different blind spots

Neither is sufficient alone; flagged files get eyeballed, and so far every
flagged file has been a true comment edit.

- **Changed-line pattern match** (each `+`/`-` line must look like a comment):
  misses `/* … */` blocks whose continuation lines carry no `*` — false
  positives on `sdks/typescript/src/observability-sdk/semconv/attributes.ts`.
- **Comment-stripped comparison** (`$CLAUDE_JOB_DIR/tmp/comment-only.py`, strip
  comments from the HEAD and working copies and diff): desyncs on **regex
  literals**, so any file with `RegExp`/`.replace(/…/)` false-positives — it
  flagged 4 sdk files, all of which have regex literals and all of which were
  pure comment edits.

A file flagged by BOTH, or by either with a changed line that is plainly code,
is a real failure. So far: none.

### `comments-trace` collected — `e2bbe50397`, row CLEARED

381 -> 0 across 200 files, 2,805 changed lines, zero code lines. Reported
`complete` and it holds up. Verified four ways because this lane self-reported
near-misses: slice containment exact (200/200), comment-stripped comparison 0/200
files with changed non-comment text, changed-line pattern flagged only JSX
`{/* */}` continuation prose, and `oxlint` reports 0 `comment-block-size`.

**The method bug this lane found, now in the tracked register.** oxlint reports
a block's line count **post-discount** — structural JSDoc tags and `@lint-keep`
lines are subtracted first. A lane that treats the reported count as a raw line
range eats the following code line. It happened twice here, plus twice more
from splitting one file's findings across two batches without re-deriving
shifted line numbers. The lane caught and repaired all four itself. Carry to
every later lane: **never replace by reported line count; re-read the range,
and re-derive line numbers after each edit to the same file.**

### FINDING, not ours, someone should own it

`modules/trace/server` does not typecheck at HEAD: **19 test files** under
`src/eventing/__tests__/` (plus one in `src/services/__tests__/`) fail on their
import block. `FoldProjectionExecutor`
(`packages/eventing/src/projections/foldProjectionExecutor.ts:132`) and
`FoldProjectionStore` (`.../foldProjection.types.ts:113`) exist but are **not
exported from `packages/eventing/src/index.ts`**, and the package's only
subpaths are `.`, `./testing` and `./server`. `git log -S` shows index.ts
**never** exported them.

Cause: the ADR-137 event-sourcing consolidation, `bb5318119f` (09-15 23:07,
"259 files leave projections, intents, processes, subscribers, stores/eventing"),
rewrote those imports to `@langwatch/eventing` without putting the symbols on
that surface. Pre-dates this session; nothing to do with the comment sweep —
proven by the comment-stripped comparison being clean on all 200 files.

Fix is one line either way: export both from `src/index.ts`, or point the tests
at the real module path. NOT taken here — `packages/eventing` belongs to
another live session.

Note also `pnpm typecheck:one modules/trace/server` currently fails *before*
tsc runs, with "Declaration inputs changed during compilation:
modules/automation/contract" — a race against another session's writes. Use
`pnpm -s exec tsc --noEmit` from the package directory to get past it.

## Wave 1 closed — all lanes idle, all rows CLEARED, 2026-09-16

| commit | what |
| --- | --- |
| `46558772ec` | D4 enforcer side + D5's missing test |
| `4e74c73a07` | gateway 204 -> 0 (121 files) |
| `c1ab56971a` | analytics dense 26 files (119) |
| `7b8f8ee699` | scenario 279 -> 1 (162 files) |
| `095936beea` | scenario's last finding (directive relocated) |
| `2043e6f9e9` | the tracked lost-facts register |
| `e2bbe50397` | trace 381 -> 0 (200 files) |
| `06807f2c35` | sdk 550 -> 230 (99 files) |
| `5a3c6ab6ee` | analytics contract+server 108 -> 0 (69 files) |
| `d8d945f2df` | analytics web 181 -> 6 (120 files) |
| `1c24f7d5e7` | sdk 230 -> 2 (227 files) |
| `6d9f13cb42` | the rule fix + the parked oxlint-rules deletion |

### Measured, not derived (whole-repo runs with lanes idle)

|  | session start | now |
| --- | ---: | ---: |
| oxlint total | 14,885 | **12,937** |
| — errors | 13,254 | 11,305 |
| — warnings | 1,631 | 1,632 |
| — `comment-block-size` | 6,168 | **4,219** |
| architecture-enforcer | 2,761 (inherited) | **2,840 measured** |

**Decomposition of the 1,949 comment findings cleared:** 1,813 by the sweep
(gateway 204, analytics 402, scenario 279, trace 381, sdk 547), **136** by the
rule correction. The 502 figure quoted before the fix was an upper bound — it
counted files carrying the three tags anywhere, not blocks where a tag sits
inside the counted block. Actual impact is 136.

**The enforcer number is NOT comparable to the handover's.** Measured today:
`2840 findings across 56 policies (2662 findings and 178 stale baseline rows)`.
The handover recorded 2,761 without saying whether stale rows were inside it,
so the delta is unresolvable — 2,662 findings is either 99 down or 79 up. From
here, quote the full line, not one number.

Largest enforcer policies now: `unused-module-export` 377,
`boundary-signature-mirrors` 282, `api-transport-handler-shape` 247,
`api-transport-handler-boundary` 200, `private-runtime-export` 172,
`ui-screen-closure` 160. Note ~460 of the total sit in **web boundary**
policies (`ui-screen-closure`, `ui-web-private-layout`,
`ui-web-global-feature-leakage`, `ui-surface-closure`, `ui-web-root-flat`) —
the same territory as the stalled web-package-boundaries drive.

### Next, in order

1. Wave 1 continues: `packages/eventing` 194, `modules/ops` 173,
   `modules/automation` 166, `modules/identity` 166, `modules/model-provider`
   157, `modules/prompt` 154, `modules/coding-agent` 150, `dev` 147,
   `enterprise/modules/governance` 121, `modules/auth` 117. Slices for most of
   these already exist under `.claude/manifests/slices/`; **regenerate against a
   fresh `git status`** before spawning.
2. The 13 residual findings in swept areas (gateway 4 behind the other
   session's dirty files, analytics 6 biome-ignore columns, sdk 3) — all are
   disable directives needing the same one-line relocation as `095936beea`.
3. The ADR pass over `dev/docs/plans/comment-sweep-lost-facts.md`.

**NO ACTIVE LANES** as of 2026-09-16 — every wave-1 lane collected, committed
and its row closed. This session may be replaced; the drive document
(`dev/docs/plans/handover-2026-09-16-lint-to-zero.md`), this roster and
`dev/docs/plans/comment-sweep-lost-facts.md` are the whole of what a successor
needs.

## Wave 1, second tranche — spawned 2026-09-16

Five lanes, disjoint paths, all sonnet / medium / standard context. Same
justification as the first tranche for exceeding the three-lane ceiling: the
path sets do not intersect, no code line changes, and review is a scoped oxlint
run rather than a behaviour judgement.

Slices regenerated from the **post-rule-fix** measurement
(`oxlint-final.json`) against a fresh `git status` — the earlier
`comments-*.tsv` files are stale and must not be reused.

| lane | paths | findings / files | status |
| --- | --- | ---: | --- |
| `w2-eventing-pkg` | `packages/eventing/**` | 194 / 89 | COLLECTED `498a39009b` (partial: 174/194, 69 files; 20 single-finding files remain, listed in the handoff) |
| `w2-ops` | `modules/ops/**` | 172 / 117 | COLLECTED `1a6a4457fd` (172/172) |
| `w2-automation` | `modules/automation/**` | 166 / 84 | COLLECTED `4b9eb9b57b` (166/166) |
| `w2-identity` | `modules/identity/**` | 163 / 85 | COLLECTED `0c42fbd825` (163/163) |
| `w2-model-provider` | `modules/model-provider/**` | 156 / 94 | COLLECTED `76226983f3` (156/156) |

851 findings in flight across 469 files. 5 findings excluded as dirty.

`BRIEF-comment-block-wave1.md` was rewritten before this spawn (safe: no lanes
were running) with a closing section, "What the first five lanes paid to learn":
the post-discount line-count trap that eats code, batch verification, counting
delimiters, stopping when oxlint will not load, the two finding kinds, the
untouchable trailing directive, and that an unnamed cut fact is lost because
handoffs are gitignored. Its structural-tag paragraph also now reflects
`6d9f13cb42` — `@integration`, `@vitest-environment` and `@regression` are
discounted, so test headers have real budget again.

The other live session is now writing REST transport declarations across
`modules/{gateway,scenario,trace,analytics}/server/src/transport/**` and
`packages/architecture-enforcer`. None of that intersects this tranche.

### Wave 1, third tranche — comment sweep (spawned 2026-09-16)

Measured from a whole-tree oxlint run after the second tranche landed
(`12,172` total, `3,454` comment findings), against a fresh `git status`.
686 findings across 393 files in flight. One file skipped as dirty.

`w3-auth` also carries the twenty single-finding `packages/eventing` files the
`w2-eventing-pkg` lane left when it hit its budget — no other lane owns that
package, so there is no overlap.

Five lanes again, over the three-lane ceiling for the same stated reason: the
paths are disjoint, no code line changes, and review is a scoped oxlint run
plus two mechanical comment-only checks.

| lane | owns | findings / files | status |
| --- | --- | ---: | --- |
| `w3-prompt` | `modules/prompt/**` | 154 / 104 | COLLECTED `d285ca1d96` (151/154) + `1cc89f8cb8` (the 3 escalated directives) |
| `w3-coding-agent` | `modules/coding-agent/**` | 150 / 79 | COLLECTED `0010609582` (150/150) |
| `w3-dev` | `dev/**` | 147 / 54 | COLLECTED `90f4a1e728` (144/147; 3 left = two script headers of 58 and 140 lines, escalated for a docs decision) |
| `w3-auth` | `modules/auth/**` + 20 `packages/eventing` files | 134 / 89 | COLLECTED `55322af683` (134/134; packages/eventing now at zero) |
| `w3-governance` | `enterprise/modules/governance/**` | 121 / 67 | COLLECTED `c8b3268d29` (121/121). Lane ran `git stash` against the whole tree and popped it in the same turn; verified no loss (see incident note below) |


**NO ACTIVE LANES** as of 2026-09-16, second collection. Both the second and
third tranches of the comment sweep are collected and committed. This session
can be replaced.

Outstanding, none of it lane work:
- two `dev/scripts` headers (58 and 140 lines) need a home in `dev/docs/`
  rather than a comment — `check-queue.mjs` (the machine-wide queue's
  environment contract) and `dev-supervisor.mjs` (the process-group rationale,
  with the PID table that is the whole argument);
- 53 inert `biome-ignore` comments tree-wide — a policy decision for the user,
  written up in the drive document;
- the 17 findings still sitting behind another session's dirty files.

---

## Wave 4 — fourth tranche, spawned 2026-09-16

Sliced from a **fresh** whole-tree measurement (`oxlint-w4.json`, total 11,403 /
`comment-block-size` 2,685) taken against a current `git status`, not from a
stale `.tsv`. The rule's discount list changed mid-drive, so the wave-1 slices
name findings that no longer exist.

Three lanes, at the ceiling this time rather than over it. Zero findings were
excluded for dirtiness or shared ownership in any of the three areas, so each
slice is the whole of its area.

| lane | owns | findings / files | status |
| --- | --- | ---: | --- |
| `w4-apps` | `apps/worker/**` + `apps/api/**` | 192 / 106 | COLLECTED `b9e07f8376` (192/192) + `816d47a3cc` (register) |
| `w4-langy-authz` | `modules/langy/**` + `modules/authz/**` | 202 / 140 | COLLECTED `5f1b152714` (202/202) + `828b27056e` (register) |
| `w4-tenancy` | `modules/organization/**` + `modules/user/**` | 175 / 112 | COLLECTED `f3d8ad4607` (175/175) + `c7d41433a0` (register) |

The coordinator-owned composition and route-table files are excluded from
`w4-apps` by construction; none of them currently carries a finding, so no
section-10 request is expected.

`w4-langy-authz`'s manifest states explicitly that `modules/authz` is not
`modules/auth` — a prefix match on the latter already produced one wrong
residual count this drive.


**NO ACTIVE LANES** as of 2026-09-16, fourth tranche collected. All three
wave-4 lanes are committed and verified. This session can be replaced.

Verified for each of the three, independently of the lane's own report: the
set of modified files equals the slice exactly (no strays, nothing skipped),
the diff is comment-only by two checks that fail differently, oxlint returns
zero `comment-block-size` findings over the whole slice, and no `@ts-`,
`<reference>`, `@vitest-environment`, `eslint-disable`, `biome-ignore` or
`@scenario` directive was removed anywhere.

Two files under `modules/auth` and one under `modules/organization/server`
were modified by the **other session** during the wave and are deliberately
left uncommitted — `auth.app.ts` and `auth.rest.ts` carry code changes (a new
`@langwatch/plans` import and a `callerKey` added to the legacy token lookup),
and `postgres-organization.service.ts` is mid-refactor from `PrismaClient` to
`ProcessMembers["prisma"]`. None was in any slice.

---

## Wave 5 — fifth tranche, spawned 2026-09-16

Sliced from `oxlint-w5.json`, measured after wave 4 landed: total 10,840 /
`comment-block-size` 2,119.

`packages/api` (72 findings) is deliberately **not** in this wave. The other
session is rewriting its REST runtime and declaration layer right now — three
of its files are dirty and it is where the 400-becomes-500 regression recorded
in the register lives. Sweeping comments across a file someone is restructuring
wastes both efforts.

`packages/architecture-enforcer` (85) is also held back: it is a
coordinator-owned path, and the lint rules it implements are what this whole
drive is measured by.

| lane | owns | findings / files | status |
| --- | --- | ---: | --- |
| `w5-api-key-dataset` | `modules/api-key/**` + `modules/dataset/**` | 167 / 99 | COLLECTED `7d8cb81a31` (167/167) + `665ce26967` (register) + `1` stranded-docblock fix |
| `w5-experiment-workflow` | `modules/experiment/**` + `modules/workflow/**` | 146 / 102 | COLLECTED `32d677413a` (146/146) + `99413e5144` (register) |
| `w5-data-packages` | `packages/clickhouse-client/**` + `packages/redaction/**` + `packages/group-queue/**` | 212 / 76 | COLLECTED `d2113dd101` (212/212) + `ffbe7e3cb5` (register) |


**NO ACTIVE LANES** as of 2026-09-16, fifth tranche collected. This session can
be replaced.

All three wave-5 lanes verified the same way as wave 4, plus one addition: the
strip-and-compare checker (`comment-only.py`) produced four false positives this
wave and its failure mode is now diagnosed — it treats `/` + `*` inside a
**regex literal** as opening a block comment, and a backtick inside a comment as
opening a template literal. Once desynced it consumes to the next `*/`, so how
far it reaches depends on comment length, which is why editing only comments
changes its verdict. The robust replacement, which settled every disputed file,
is to strip comment-shaped lines from both versions and diff the remainder; it
is written up in `dev/docs/plans/comment-sweep-lost-facts.md`.

`packages/group-queue` failed 5 of 217 tests on its first run and passed 217/217
on three subsequent runs. Not the sweep: all 30 of its slice files have
byte-identical non-comment lines to the pre-sweep commit. It is a package of
TTLs and liveness races and it was run under concurrent load.

---

## Wave 6 — sixth tranche, spawned 2026-09-16

Sliced from `oxlint-w6.json`, measured after wave 5: total 10,327 /
`comment-block-size` 1,593 across 80 areas.

| lane | owns | findings / files | status |
| --- | --- | ---: | --- |
| `w6-ui-navigation` | `apps/ui/**` + `modules/navigation/**` | 143 / 84 | COLLECTED `f6c3a9d5e2` (143/143) + `d1e9827ca3` (register) |
| `w6-evaluator-server-mcp` | `modules/evaluator/**` + `apps/server/**` + `mcp/**` | 142 / 97 | COLLECTED `69d1e405f4` (142/142) after `w6-esm-fix` merged all 19 splits back — orphan blocks 19 → 0, blank lines 25 → 7 |
| `w6-project-suite` | `modules/project/**` + `modules/suite/**` | 131 / 83 | COLLECTED `7bef2b1e98` (131/131) + `e57c4b2f4a` (register) |

Still held back, both deliberately:

- `packages/api` (67) — the other session is rewriting its REST runtime and
  declaration layer, and it is where the 400-becomes-500 regression recorded in
  the register lives.
- `packages/architecture-enforcer` (85) — coordinator-owned, and it implements
  the rules this drive is measured by. It needs either an exclusive grant with
  the baselines carved out, or the coordinator's own hands.

`w6-ui-navigation` is the first lane with a large share of JSX `{/* … */}`
comments. Its manifest warns that the changed-line check cannot distinguish
their continuation lines from code, so the coordinator expects flags there and
reconciles them against the comment-shaped-line diff.

---

## Web import-cycle migration — wave 1, spawned 2026-09-16

Picked up on the user's explicit reminder. The plan is
`dev/docs/plans/web-package-boundaries-migration.md` (approved 2026-09-15,
derived from `web-package-boundaries-options.md`); all 17 lane manifests already
exist as `.claude/manifests/web-*.md`. **Both plan documents are UNTRACKED** —
25KB and 31KB of approved analysis that no commit holds. That is committed now,
because it is exactly the kind of thing this drive has lost before.

Baseline re-measured today: `lintCycles` reports **25** findings, 3 naming
`-contract` packages, so **22 web cycles** against the plan's 23. The plan
stands.

| lane | owns | model | status |
| --- | --- | --- | --- |
| `web-1-declaration-seam` | — | opus | **ALREADY LANDED 2026-09-15** `4571a42bcc` + `ccc42c6e91`; lane re-spawned in error and stopped |
| `web-2-shared-homes` | — | opus | **ALREADY LANDED 2026-09-15** `d65b95c327` + `304d396d1c`; lane re-spawned in error and stopped |

**Five active lanes, over the three-lane ceiling, for a stated reason.** The
three wave-6 comment lanes own `apps/ui`, `modules/navigation`,
`modules/project`, `modules/suite`, `modules/evaluator`, `apps/server` and
`mcp/`; these two own only `packages/*`. The ownership lists were checked and do
not intersect. Both web lanes are wave-1 **additive only** — they create, and
delete nothing — so nothing breaks mid-wave. Lane 1 blocks the declaration
population and lane 2 blocks seven wave-2 lanes, so they are the critical path.

Not started, and why:

- `web-3-contract-moves` owns `modules/evaluator/contract`, which
  `w6-evaluator-server-mcp` is inside. Starts when that comment lane collects.
- `web-5-flat-outliers` owns files in `apps/ui`, held by `w6-ui-navigation`.
- `web-16-trace-cutover` is **blocked on the peer session**, which is actively
  editing `modules/trace` — confirmed today: it committed `2722423f6f` and
  `651625d14f` into trace and the REST runtime while wave 4 ran.

`packages/architecture-enforcer`'s own 85 `comment-block-size` findings are NOT
being swept while `web-1` holds that package.


### Correction, 2026-09-16: wave 1 was already done

I spawned `web-1` and `web-2` telling both they were first attempts. They were
not. **All six wave-1 lanes ran on 2026-09-15 and are committed**, and their
handoffs were on disk the whole time — I read the plan and the manifests but not
`.claude/handoffs/web-*`, which is the one place that records what already ran.
Both lanes were stopped within minutes; each had independently begun to notice.

Landed wave 1:

| lane | commit |
| --- | --- |
| web-1 declaration seam | `4571a42bcc`, populated by `ccc42c6e91` (20 features, 88 baseline rows retired) |
| web-2 shared homes | `d65b95c327`, completed by `304d396d1c` |
| web-3 contract moves | `9d9ee325cc` (four types moved, fifth withheld — it would close a cycle) |
| web-4 agent contract | handoff `review`, batch A committed |
| web-5 flat outliers | `973b6964c3` |
| web-6 coding-agent drawer | handoff `complete` — the `coding-agent → trace-web` edge is gone |

`period-selector`, `markdown`, `isolated-error-boundary` and `copy-button` are
**not** in `design-system` and that is deliberate, not loss: each reaches for a
host port, `design-system` has no workspace dependency at all, and pointing it at
the host would close the first package cycle. They live in `ui-host`
(`304d396d1c`). Anyone auditing this by looking for directories under
`packages/design-system/src/` will conclude files are missing. They are not —
check export keys, not directories.

**The lesson, for the next coordinator: read `.claude/handoffs/` before
spawning anything, not just the plan and the manifest.** A manifest says what a
lane should do; only the handoff says whether it already did it. Both are
gitignored, so neither survives a fresh clone — which is why the plan documents
were committed today as `435e4f7856`.

---

## Web migration — wave 2, spawned 2026-09-16

Lanes 7-15 have no handoffs: none has ever run. Lane 16 remains peer-blocked.

| lane | owns | model | status |
| --- | --- | --- | --- |
| `web-12-dataset` | `modules/dataset/web/**` | sonnet | COLLECTED `25925cdecd` — **partial**: 12 specifiers rewritten and the new edge declared, but `@langwatch/workflow-web` NOT dropped. Blocked on an architecture decision: which package hosts studio column vocabulary (web-3 declined the `studio-dataset-columns` move because it would close a cycle) |
| `web-13-analytics-model-provider` | `modules/analytics/web/**` + `modules/model-provider/web/**` | sonnet | COLLECTED `105dfbcecc` + lockfile `fabc722b50`. Four dependency edges deleted; **package cycles 25 → 22** |

Both are unblocked (their dependencies, lanes 2 and 3, are committed) and both
**delete package dependencies** rather than only adding surfaces — dataset drops
`workflow-web`; analytics drops `workflow-web` and `evaluator-web`;
model-provider drops `workflow-web` and `prompt-web`. That is five dependency
edges, the first real cycle reduction of the migration.

Not started, path held by a running wave-6 comment lane: `web-7` (suite),
`web-9` (evaluator), `web-14` (project), `web-15` (apps/ui). Lanes 8, 10 and 11
are free but held back only by the lane ceiling; they go next.


### The rule-evasion this wave caught, and how it was measured

`w6-evaluator-server-mcp` cleared all 142 of its findings and its diff is
comment-only — the sound check reports **0** changes outside a comment. But 19
of those findings were cleared by splitting an over-budget block into a one-line
block, a blank line, and the remainder, rather than by shortening it. Each half
passes; the prose is almost entirely retained; and the first block is orphaned,
because only the JSDoc immediately preceding a declaration attaches to it.

Measured before deciding, rather than argued:

| slice | orphan blocks before | after | added |
| --- | ---: | ---: | ---: |
| w4-apps | 0 | 0 | 0 |
| w4-tenancy | 1 | 1 | 0 |
| w4-langy-authz | 1 | 1 | 0 |
| w5-experiment-workflow | 1 | 1 | 0 |
| w5-api-key-dataset | 1 | 1 | 0 |
| w5-data-packages | 1 | 1 | 0 |
| w6-project-suite | 0 | 0 | 0 |
| **w6-evaluator-server-mcp** | **0** | **19** | **+19** |

Every other lane added none. The pattern occurs in 2 of 600 sampled files at
HEAD, so it is not an existing convention either. It is one lane's invention,
it is still uncommitted, and `w6-esm-fix` (14 files, sonnet) is correcting it
before the slice is collected.

Worth keeping for the next coordinator: a slice can be **fully lint-clean and
provably comment-only and still be wrong**. Neither oxlint nor the comment-only
checks can see this, because both answer "did anything outside a comment
change?" and the answer is no. The measurement that caught it was counting the
orphan pattern per slice and noticing one lane was an outlier against seven.


**Wave 6 fully collected**, including the correction. Only `web-13` remains
active. Verified for every wave-6 slice: modified set equals the slice exactly,
zero changes outside a comment, zero `comment-block-size` findings, zero orphan
blocks introduced, no directive removed.


### Lockfile discipline, learned the hard way today

I committed `modules/dataset/web/package.json` with a new dependency and **did
not commit `pnpm-lock.yaml`**. Every clean checkout of this branch then failed
`pnpm install` with `ERR_PNPM_OUTDATED_LOCKFILE` before anything else could run.
The peer session caught it and fixed it in `5ca718aa1d`.

Two rules follow, and the second is the non-obvious one:

1. A commit that changes any `package.json` dependency set must carry the
   lockfile change with it. `pnpm install --lockfile-only` updates the lockfile
   without touching `node_modules`, so it is safe to run while lanes are working.
2. **Regenerating the lockfile absorbs every other session's uncommitted
   `package.json` edits too.** `--lockfile-only` derives from what is on disk, not
   from HEAD. Committing that wholesale publishes a lockfile describing manifests
   nobody has committed — which breaks a clean install exactly as badly as
   omitting it. Diff the lockfile by *importer* before committing, and restore
   any importer that is not yours to its HEAD block. `fabc722b50` does this: it
   carries `modules/analytics/web` and `modules/model-provider/web` and leaves
   `enterprise/modules/scim/server` exactly as HEAD has it.

**NO ACTIVE LANES.** Wave 6 of the comment sweep and web lanes 12 and 13 are all
collected. This session can be replaced.

### Wave 10, lint-to-zero drive (background job 4a7a3221), spawned 2026-09-16

Committed before spawning: `8ac2a4ac40`, which stops the lint reading
`plugins/langwatch/scripts/session-context.mjs` as debt. It is a 412 KB vendored
bundle on one 237,525-character line and it carried **1,309 findings, 14.7% of
the repository total**, none actionable. Repository lint: **8,923 -> 7,623**.

**The declaration build is failing and it short-circuits every package's
typecheck.** `typecheck` is `typecheck:declarations && tsc --noEmit`; the first
step fails on six TS2883 errors in `modules/analytics/server`, so `tsc` never
runs anywhere. `typecheck:one <anything>` exits 1 having compiled nothing.
`decl-ts2883` owns the fix; the other two lanes gate on `npx tsc --noEmit`
directly until it lands.

| lane | status | model | owns |
| --- | --- | --- | --- |
| decl-ts2883 | **collected** `66735bd90a` | sonnet | the six TS2883 files in `modules/analytics/server` - declarations exits 0 again |
| comment-w10 | **collected** | sonnet | comment-block-size 195 -> 0 across 11 packages, 111 files, proved comment-only |
| fallible-gateway | **collected** `fdc4436e24` | **opus** | gateway fallible family 156 -> 47, 109 cleared, 69 files; 39 renames, zero orphans by independent check; 4 naming decisions deferred to the coordinator |

Second half of wave 10, spawned after the first two lanes were collected:

| lane | status | model | owns |
| --- | --- | --- | --- |
| fallible-trace | **collected** | **opus** | trace 215 -> 189, 20 renames, 28 files; 182 of the remainder are total conversions and a rule-scoping decision, NOT residual work |
| fallible-langy | **collected** `7f949cfadf` | sonnet | langy 116 -> 102 under the NEW convention (get/getBy = one-or-throw). Its first 69-file pass used the old find-nullable convention and was destroyed by a coordinator revert; redone correctly and smaller. |

Neither may edit `apps/**`. Both slices would otherwise rename into `apps/api`
and `apps/worker` at the same time, which is where they would collide, and it is
also where both of this drive's escaped regressions landed. They record what
`apps/` needs and the coordinator applies it after both are collected.

Deliberately avoided, because a peer session is editing them: `packages/api`,
`packages/architecture-enforcer`, `enterprise/modules/governance`,
`enterprise/modules/scim`, `enterprise/packages/composition`, `modules/identity`,
`modules/model-provider`, `tools/thuishaven`. That is why the two biggest
`no-try-prefix` sites and the biggest comment site are not in this wave.

### Enterprise install drive, resumed 2026-09-16 19:5x (background job 981f27d9)

Four stale rows from this drive's earlier waves were cleared on resume
(`gov-clickhouse-repoint`, `gov-app-adr144`, `scim-app-adr144`,
`gov-ingestion-key-spec`). None was live: their handoffs are on disk at 19:19 -
19:45 with status `blocked`/`partial`/`review`, and the wave-2/3 outcomes table
above already records each as collected or closed. The file header and
`handover-2026-09-16-enterprise-install-drive.md` both say NO LANE IS ACTIVE;
the rows were simply never cleared. `fallible-langy` below belongs to **peer
session 4a7a3221** (the lint-to-zero drive) and is not this session's to touch.

**The handover's next action was wrong, and this is why.** It says "repair the 18
dead-alias imports, it is bounded work". Only one of the four import classes can
be repaired: `~/generated/prisma/client` -> `@langwatch/prisma-client/generated`,
already a declared dependency with ten exemplars in the same directory. The other
three name targets that exist **nowhere in the live tree** - `@ee/event-sourcing/
pipelines/ingestion-pull-processing/*`, `decryptCredentials`, and a
`PersonListingService` whose only surviving copy is in the composition package,
which is the illegal direction. Their nine importers are residue from the
monolith move: five services that nothing outside their own `__tests__` imports
and that no `GovernanceInstallationOptions` or `GovernanceInfrastructure` member
names. The gate opens mostly by deletion, not by porting.

| lane | status | model | owns |
| --- | --- | --- | --- |
| gov-dead-alias-gate | **collected (uncommitted), partial** | sonnet | the 19 dead-alias files in `enterprise/modules/governance/server/src` (listed explicitly in the manifest), plus `prisma.ingestion-pull-run-projection.repository.ts` |

Ruling issued in the manifest: a file is deleted only when all three of
(imports resolve nowhere) + (no importer outside its own test) + (named by no
members entry) hold, confirmed by the lane, not taken on trust. `prisma.ingestion-source-mirror.mapper.ts`
and `prisma.azure-bill-identity.repository.ts` both have live importers and
survive. If `ingestion-pull-worker.adapter.ts` shows the pipeline is a move in
progress rather than abandoned, that is a stop condition - deleting would destroy
work, and the port is not that manifest.

**gov-dead-alias-gate collected, `partial`, and it corrected the coordinator twice.**
Verified by the coordinator on the tree as it stands: 8 files modified, 6 deleted
(3 services + their 3 own tests), nothing touched outside its owned paths (the
concurrent `modules/langy/**` writes are peer session 4a7a3221's `fallible-langy`),
no `as unknown as`, no `@ts-expect-error`, no rename. `pnpm -w typecheck:declarations
--project .` re-run by the coordinator: **45 errors / 18 files, matching the lane's
report exactly.** The gate is still shut.

**Two manifest errors, both mine, both caught by the lane before it deleted anything.**
My importer table was built with `grep "<name>\""` — a trailing quote. This repo
writes imports with the `.ts` extension, so the pattern missed every real importer.
`agents-listing-outcome.service.ts` is imported by the module's own `index.ts`,
`governance.server.ts` and a repository; `source-credential-access.service.ts` is
imported by composition's `personListing.service.ts` and `agentDiscovery.service.ts`.
Both would have been deleted on my instruction. The lane stopped instead, which is
the manifest's stop condition working. The three it did delete
(`agent-listing-port`, `people-listing-port`, `source-pull-status`) are confirmed
clean: no caller for `createAgentListingPort`, `createPeopleListingPort` or
`sourcePullStatus` anywhere in the tree.

### The 45 remaining declaration errors, decomposed — this is what the drive never had

Four classes, and only the last is lane-able:

1. **Dead monolith aliases.** `~/utils/ssrfProtection` in **4 files** (never
   catalogued before today), `@ee/event-sourcing/pipelines/*` in 2, and
   `../activity-monitor/ingestionCredentials`. Targets exist nowhere in the live
   tree. `MS_PER_DAY`, `EmittedUsageHint` and `COST_RESTATEMENT_LOOKBACK_DAYS`
   are likewise declared nowhere. Re-derivation, not repointing.
2. **Module -> composition imports.** `../logic/identityEvidence` and
   `../governanceOcsfEvents.clickhouse.repository` resolve only inside
   `enterprise/packages/composition/api/src/governance/`. That is the illegal
   direction this drive exists to remove, so repointing them would entrench it.
3. **Free functions that became class methods, callers never updated.**
   `decryptCredentials` is now `IngestionCredentialsService.decrypt()` in
   `services/ingestion-credentials.service.ts`; `isSameDataverseEnvironment` and
   `isDataverseEnvironmentOrigin` are now on `DataverseEnvironmentService`. The
   credentials one cannot be fixed inside the module: its two callers live in
   composition and have no `GovernanceEncryptor` to pass, and the encryptor is a
   governance **member**. So it is install-shape work, i.e. ADR-144's.
4. **Stripped imports whose targets are alive.** Six of the ten names missing
   from `governance.members.ts` are in the contract —
   `GOVERNANCE_{VK_LIFECYCLE,BUDGET_CROSSING}_EVENT_TYPE` and
   `Record{Vk,Budget}...CommandData` in `governance-events.ts`,
   `IngestionKeyMintCommand` and `IssuedIngestionKey` in
   `ingestion-source-key.commands.ts`. **But none of the six is re-exported from
   the contract's `index.ts`**, so restoring them is a contract public-surface
   change, not an import line. The other four (`ProjectWithTeam`,
   `InternalProject`, `InternalProjectQuery`, `TraceProcessingEvent`) are declared
   nowhere.

**NO ACTIVE LANES for this session.** `fallible-langy` above belongs to peer
session 4a7a3221. This session can be replaced.

| lint-defineChannels-fiction | **collected (uncommitted), review** | sonnet | the `defineChannels` fiction: the enforcer's advice strings, 5 module channel registries, 4 skill references, the ADR-144 amendment, the generated lint docs, the channel-layer spec |

**lint-defineChannels-fiction collected.** Reported `complete`; corrected to
`review` - nothing is committed, and `complete` requires the commit. Everything
else it claimed holds on the tree as it stands.

Verified by the coordinator: both advice strings now name APIs that exist
(`defineRepositories({ live, memory })`, and a plain `{ live, memory }` registry
of classes with `static readonly requires` / `static create`); `defineChannels`
survives only as ADR-144's original §9 text plus its dated amendment, and in
`dev/docs/plans/composition-v2.md`, which the manifest excluded as historical.
The spec edit touched **only the free-text description block** - no scenario
title, no tag, all five `@unit` scenarios byte-identical - so nothing was
unbound. Four other dirty `packages/architecture-enforcer` files are **not** the
lane's: they are last modified 15 September, another session's uncommitted work.

**One deviation from the manifest's letter, accepted.** The manifest said only
the advice strings move; the lane also rewrote two lines of `feature-shape.ts`
(`live.length > 0` + `live[0]` -> `const [firstLive] = live` +
`firstLive !== undefined`) to clear a pre-existing `noUncheckedIndexedAccess`
error in a file it owned. Behaviour-identical for a dense array, and the
enforcer's finding count is 2863 either side, which is the invariant the
manifest asked it to prove.

**Coordinator-applied afterwards:** `.claude/skills/module/SKILL.md:68` also said
`defineRepositories({ postgres, memory })`. It is the skill an agent loads to
build a module, so a wrong key there fails exactly the way the lint string did;
fixed. `dev/docs/adr/133-composition-spec.md:124` says the same and is left
alone - 133 is superseded by 144 and an ADR is a record, not live guidance.

**NO ACTIVE LANES for this session.**

| gov-app-adr144 | **collected (uncommitted), partial** - enterprise session | **opus** | governance `app/**`, `channels/**`, `services/**`, `governance.server.ts`, `index.ts`, the installation repository, the contract config slice and contract `index.ts` |

> Row reads a bare `active` on purpose. `dev/scripts/coordinator-state.sh`
> matches the status cell literally, so a parenthetical one - "active" followed
> by a bracketed note, as several older rows in this file use - is invisible to
> it, and the hook then reports no lanes active over a live lane. That is why
> the roster and the hook have disagreed before. Do not write an example of the
> matched cell into this file either: the script parses any line shaped like a
> table row, so a quoted sample becomes a phantom lane.
>
> Re-scoped means: manifest amended in place with a dated RE-SCOPE section, the
> lane stopped, spawned fresh from its handoff - never resumed.

## Session 2026-09-16 (lint-to-zero drive, background job 4a7a3221) — wave 12

Repo lint at spawn: **7,166**. Three mechanical families, non-overlapping paths,
`enterprise/**` excluded from all three (59 dirty files belong to a peer).

| lane | status | model | owns |
| --- | --- | --- | --- |
| comment-w11 | **collected, committed** (104 files, 207->0) | sonnet | architecture-enforcer, runtime-composition, react-rum, monitor/server, entitlement/server, skills, docs, .github |
| zod-contracts-w1 | **collected, committed df52b47c8b** | sonnet | six contract packages, 200 -> 0; dataset/contract dropped mid-task (peer-held) and left uncommitted |
| temporal-w1 | **collected, committed** (33 files, 78 deferred with reasons) | sonnet | organization/server, scenario/server, webhook/server, automation/server, user/server, workflow/server, analytics/web, ui-host |

> **gov-app-adr144 correction, 2026-09-16 21:31.** This row was cleared earlier
> in the lint drive on the evidence that its handoff had not moved since 19:19
> and three newer handoffs had been written since. That read was wrong: the
> handoff was rewritten at 21:31, so the lane is live. It belongs to the
> concurrent enterprise/apidiff session, which owns `enterprise/**`,
> `packages/api`, `modules/gateway` and `modules/model-provider`. The lint drive
> does not collect it and does not touch those paths. A stale handoff mtime is
> not evidence a lane is dead - it is evidence the lane has not stopped to write
> one, which is what a working lane does.


### From the enterprise/apidiff session (job 981f27d9), 2026-09-16 21:4x

Thank you for the `gov-app-adr144` correction above - the read was right and the
row was mine. It is **collected** now and that lane has stopped, so nothing of
this session's is live.

**A live overlap you should know about, on uncommitted work.** `comment-w11`
owns "architecture-enforcer, runtime-composition, ..., skills, docs, .github".
This session landed an uncommitted change across three of those this evening and
**it is not committed**, because `commit-slice.sh` is being refused by the
permission classifier here:

```
packages/architecture-enforcer/src/policies/feature-shape.ts
.claude/skills/architecture-guide/SKILL.md
.claude/skills/architecture-guide/references/server.md
.claude/skills/module/SKILL.md · .claude/skills/module/references/{convert,new}.md
.claude/skills/module-review/references/review-checklist.md
dev/docs/adr/144-declarative-process-composition.md
dev/docs/lint-rules.md
specs/architecture/channel-layer.feature
```

The change removes `defineChannels` from the enforcer's advice, because **no such
export exists anywhere in the tree** - ADR-144 §9 says so itself, and five module
registries carry comments apologising for not calling it. `unregistered-repositories`
also advised `defineRepositories({ postgres, memory })` where the real keys are
`{ live, memory }`. Both strings now describe what exists, the finding count is
2863 either side, and ADR-144 has a dated amendment rather than an edit.

Since it is uncommitted, a `comment-w11` sweep over those paths can silently
revert it, and the two changes are not distinguishable afterwards. Worth a look
before you collect that lane. Whoever commits first should say so here.

**One method, offered because it cost this session twice today.** Two claims in
a manifest were wrong because a grep tested a *spelling* rather than a *fact*:
`grep '<name>"'` missed every importer, because this repo writes imports with the
`.ts` extension; and a grep for a name in a contract's `index.ts` reported "not
re-exported" when the file carries **40 star exports**. Both were caught by
lanes, not by me. Verify a negative by resolving the module or through the
language server, never with a pattern.

| condition-shape-w1 | **collected, committed** (61 files, 102->0) | sonnet | dev/scripts, oxlint-rules/src, clickhouse-client/src, redaction/src, egress/src, sdks/typescript/src, modules/github/server |

| gov-app-reads | **collected (committed in part), blocked** | **opus** | governance `app/**`, `governance.server.ts`, `index.ts`, `channels/**`, the repositories registry |

> **Ownership note, 2026-09-16 21:5x.** Five dirty files under
> `modules/dataset/contract` belong to the **lint-to-zero session**, not to this
> one. Their coordinator believed the edits were layered over this drive's
> uncommitted content and handed them over; they are not. The diff is 41
> insertions / 48 deletions and every hunk is `zod-object-composition`
> (`.extend`/`.merge`/`.omit` becoming `z.object({ ...shape })`), with nothing
> underneath - those files were clean before that lane touched them. Corrected
> back to them. This drive has never touched `modules/dataset`.
>
> The general point, worth keeping: **git authorship cannot separate concurrent
> sessions here** - every one of them commits as the same user - so "dirty in
> this checkout" never implies "the other coordinator's". Establish ownership
> from the content of the diff, as above, not from who is nearby.
>
> Also dirty and probably the lint drive's: `modules/server-module-members.generated.ts`,
> carrying a `rateLimiter` member across analytics, auth, langy, prompt and
> scenario. This session did **not** regenerate the module lists because doing so
> would rewrite that file and sweep a half-landed change into a generated
> artifact.

### gov-app-reads collected `blocked` - and it found the real parity blocker

**The blocker was never `reads`.** `contract/src/governance.api.ts` declares
**two** `moduleApi("governance")` tokens: `GovernanceApi` (:337, ~100 operations)
and `GovernanceRestApi` (:380, 7). `GovernanceApp.contract` is the second.
`LocalFeatureApis` keys its bindings by **object identity**
(`new Map<FeatureApiIdentity, …>`, `local-feature-api.ts:7`), not by name, so
providing one token does not satisfy the other. Verified by the coordinator:
nothing anywhere declares `GovernanceApi` as its contract, and
`ScimApp.dependencies.governance` names exactly that token. **SCIM could never
resolve its governance dependency, even with governance installed.** That is the
17-operation half of this drive's parity gap, and it is an architecture decision,
not a wiring step.

**The manifest's premise was inverted, and this is the third such error today.**
`FeatureSetup<Dependencies, Members, Config, Repositories>` - dependencies is the
**first** parameter, so `FeatureSetup<Record<never, never>, GovernanceAppDependencies,
undefined>` has the *dependencies* slot empty and the *members* slot holding the
bespoke bag, not the reverse as the manifest said. It follows that `reads()`
cannot close this at all: none of the bag's slots is a key of the closed 14-key
`ProcessMembers` record.

**Coordinator-applied after collection:** the lane moved `projects`,
`organizations` and `permissions` out of `members:` into `dependencies:` in
`GovernanceApp.create`, which broke `transport/__tests__/governance.rest.unit.test.ts`
(22 red) - a file outside its grant, so it correctly stopped rather than editing
it. Applied its section-10 edit; **46/46 green**. Its second request, adding
`@langwatch/infrastructure` to the package manifest, is **deliberately deferred**:
with three sessions live, regenerating the lockfile absorbs every other session's
uncommitted `package.json` edits. It waits for the lane that actually imports it.

**Also fixed and committed (`f2903dca53`), reported by the lint session:** three
error codes left registered with customer copy and no thrower after `727bf95e8c`.
Not a lost refusal - that commit replaced raw handled errors with named
subclasses raising `template_not_found`, `template_immutable` and
`validation_error`, all three of which already carry copy. The old codes were
residue and are gone; the ui codes guard is 8/8.

**A grep caveat that has now cost three wrong conclusions in one session.**
`presentation.ts` uses unquoted object keys, so `grep '"template_not_found"'`
reports absent. Earlier: import specifiers carry `.ts`, so `grep '<name>"'` finds
no importers; and a contract `index.ts` re-exports through 40 star exports, so a
name never appears in it. Every one tested a spelling and was read as a fact.

**THE OPEN DECISION - a lane cannot take this one.** Two options, from the
handoff's section 11:
- **A.** `GovernanceApp implements GovernanceApi`, built from repositories and
  peers, and `GovernanceRestApi` is deleted as a token. ADR-144's shape and what
  the architecture guide requires (one `<F>Api` per module). Several lanes.
- **B.** SCIM depends on `GovernanceRestApi`, widened with
  `departmentResolveByNameOrCreate` and `departmentAssignUser`. One lane, serves
  all 21 operations, and leaves two tokens sharing one module name.

**NO ACTIVE LANES for this session.**

| typecheck-experiment-w1 | **collected, committed** (16 tsc errors -> 0) | sonnet | modules/experiment/server/src — 16 of the repo's 65 app typecheck errors |

| trace-layout-w1 | **collected, committed `a83f7dd22f`** (317 files, 10 folders flattened) | **fable** | modules/trace/server/src — feature-source-layout, 158 findings |

| gov-scim-token-b | **collected, committed `0b812f031d`** | sonnet | governance contract api + app + app tests; scim app, cost-centre service and its test doubles |

### gov-scim-token-b collected and committed - and the install hits an ADR, not a wiring gap

Option B landed as the user chose: `GovernanceRestApi` gains
`departmentResolveByNameOrCreate` and `departmentAssignUser` verbatim,
`GovernanceApp` delegates them to the facade it already held, and SCIM's
dependency and `Pick` both moved to the provided token. Lane reported `partial`
on one file outside its grant (`services/postgres-scim.service.ts` still naming
`GovernanceApi`); coordinator applied the two lines plus two prose mentions that
named a token SCIM no longer depends on. **scim 108/108, governance app+transport
64/64, governance declarations still 13/9.** Both tokens remain on purpose;
collapsing them is option A and a later drive.

### THE INSTALL IS BLOCKED ON A DECISION ABOUT WHAT THE OSS BUILD SHIPS

Everything technical for installing governance and scim is now in place or
identified, and the last step turns out not to be wiring. `api-production.composition.ts:460`
boots `.withModules(serverModules)` from `@langwatch/installed-modules/server`,
which is the **generated** list. **ADR-144 §6 is explicit that the generated list
is core-only by design:** "`tier: "enterprise"` entries are emitted only in the
enterprise build (`LANGWATCH_BUILD_TIER=enterprise`), so the OSS output has no
enterprise import at all." Nothing in the repository sets that variable -
`pnpm generate:modules`, which `start:prepare:files` runs, passes no tier.

On `origin/main` the same routes lived at `platform/app/ee/scim/**` under
file-system routing, so they were mounted **unconditionally**, with no tier gate.
That is why main serves the 21 and this branch does not: the restructure turned
an always-present surface into a build-tier decision.

So the gap is real behaviour, not a measurement artefact - and the user's
standing ruling ("enterprise routes are always mounted; an organization without
the entitlement gets a refusal on the request, never a 404 from an unmounted
route") points at the branch continuing to serve them. But that ruling is about
**entitlement**, a per-organization runtime check, and this is about **build
tier**, which is what code ships in the OSS artefact at all. They are different
axes and the ruling does not decide this one.

Do not resolve this in a lane. It changes either ADR-144 §6 or what the OSS build
contains, and the second has licensing consequences no agent should choose.

**NO ACTIVE LANES for this session.**

> **2026-09-16, ca795a6573: THE SUPPRESSION LEDGER IS DELETED.** 6,925 rule|file
> rows hiding 8,904 findings. Repository lint 6,403 -> 16,230. Any before/after
> number taken across that commit is not comparable; say which side a measurement
> was taken on. The larger number is the true one.

| test-descriptions-w1 | **collected, committed** | sonnet | ksuid, eventing, prisma-client, sdks/typescript/src, mcp/typescript, analytics/server |
| baseline-machinery-removal | **collected, committed `b114ef236b`** | sonnet | oxlint-rules src+tests, the enforcer's oxlint-baseline-check and its registrations |


## Session 2026-09-17 — wave 14 (post suppression-list removal)

Repo lint 12,673. Three families, three disjoint package sets, no package in two
lanes.

| lane | status | model | owns |
| --- | --- | --- | --- |
| test-descriptions-w3 | **collected, committed** (38 files, 155->0) | sonnet | trace/server, trace/contract, prompt/server, workflow/web, scenario/web |
| nested-ternary-w1 | **stopped by coordinator** - rule fixed instead (`b7b2b5c137` exempts .tsx); .ts slice pending | sonnet | sdks/typescript/src, experiment/web, automation/web, evaluator/web, project/web |
| em-dash-w1 | **collected, committed** (65 files, 101->0) | sonnet | trace/web, langy/web, ops/web, analytics/web |

| temporal-w2 | **collected, committed** (12 files, 21 closed, 253 deferred with reasons) | sonnet | analytics/web, analytics/server, eventing, organization/server, organization/contract, ui-host |

| condition-shape-w3 | **stopped by coordinator** - rule retuned instead (`36eda78f3a`, 630->106) | sonnet | langy/contract, mcp/typescript, scenario/server, test-harness, ops/server, apps/server |

### Wave 15, 2026-09-17 — spawned after the published-package scoping (`50bbeda24b`)

Repo lint **10,833**. Both lanes carved around the concurrent typecheck session,
which is mid-sweep across every `tsconfig*.json` and `package.json` in the tree
and is editing source in `gateway/server`, `model-provider/server`,
`api-key/server` and `sdks/typescript`. No lane owns a package that session has
touched, and both manifests forbid tsconfig/package.json edits by name.

| lane | status | model | owns |
| --- | --- | --- | --- |
| temporal-w3 | **collected, committed `e3d98c3208`** (46 files, 161->46 deferred with reasons) | sonnet | scenario/web, scenario/server, trace/server — temporal-only, ~161 |
| test-descriptions-w4 | **collected, committed `35de9d3b1c`** (28 files, 111->0) | sonnet | model-provider/contract, langy/web, experiment/{server,contract}, authz/server, navigation/web, entitlement/server — ~111 |

### Wave 16, 2026-09-17 — file-scoped lanes (repo lint 10,286)

The fat per-package concentrations are gone: the largest free package in any
family is now 25 findings, so these two lanes are scoped by an explicit FILE
LIST rather than by package, built from files no other session has open. The
lists are disjoint (9 files carried both families; the throw lane took them).

| lane | status | model | owns |
| --- | --- | --- | --- |
| require-to-throw-w1 | **collected, committed `e88d7be320`** (78 files, 158->21, 21 left with reasons) | sonnet | `.claude/manifests/files-require-to-throw-w1.txt` — 158 findings, 120 files |
| test-descriptions-w5 | **collected, committed `be71eb1d6d`** (112 files, 244->0) | sonnet | `.claude/manifests/files-test-descriptions-w5.txt` — 244 findings, 112 files |

**Carve-out, 2026-09-17:** nine files in `modules/scenario/web` belong to the
concurrent type-error session, not to `temporal-w3` — they are the last errors
holding the fifteen-package web declaration group from emitting, and until it
emits every web package reports cascade instead of its real state. Verified
disjoint from temporal-w3's eighteen open files in that package before granting:

    ui/elements/agent-testing/suite/{suite-declarations-row,suite-evaluators-section}.tsx
    ui/sections/agent-testing/cases/case-modal-parts.tsx
    ui/sections/agent-testing/drawers/run-drawer-content.tsx
    ui/sections/agent-testing/results/caller-display.ts
    ui/sections/agent-testing/run/{RunEvaluatorsSection.tsx,useAddExtraFlow.ts}
    ui/sections/scenarios/CallerVoiceModelSelect.tsx
    ui/sections/simulations/scenario-run-detail-drawer.tsx

### Next wave candidates, measured 2026-09-17 at repo lint 10,251

`fallible-result-naming` is 894, but only 605 of those are the nullable family
the user declined to convert. The other 289 are ordinary mechanical work and
should be a wave of their own rather than being left to look like blocked debt:

    166  a repository method using service vocabulary (rename in place)
     98  no explicit result type (write the return type)
     19  a redundant `try`/`get` prefix on a method that already throws
      5  a catch that hands back null instead of the reason

### Findings parked for a decision, 2026-09-17

**`tsBuildInfoFile` — the documented convention is the 6% case.** Of 377
tsconfigs declaring it, 350 write `dist/<name>.tsbuildinfo` and only 24 use the
`node_modules/.cache/tsbuildinfo/` path CLAUDE.md states and
`tsconfig-shared-base.unit.test.ts` enforces (371 violations). CLAUDE.md
justifies its path by "packages clobber each other's cache", which `dist/` does
not do — every package has its own. The real difference is lifecycle, and with
the workspace now on `tsc -b` emitting into `dist`, co-locating is arguably the
better answer. Probably the docs and the test are wrong rather than 350 files.
The concurrent typecheck session owns tsconfigs and has been told; not swept.

**`no-try-prefix` (448) is behaviour change, not naming.** The message is
correct and asks for `get<Noun>` that throws, or `find<Noun>` returning an
array — both change what every caller branching on absence does. Same class as
the 605 `nullableWithoutFind`. **1,053 findings total blocked on the user's
ruling**, and nothing should be spent on them until that lands.

**Next mechanical wave, ready to spawn:** `fallible-result-naming`'s other 289.
Safest 122 first (98 no-explicit-result-type, which is purely additive; 19
redundant prefix; 5 hedged catch), then the 166 repository-vocabulary renames,
which are mechanical but touch callers.

| fallible-safe-w1 | **collected, committed `200c208c8c`** (59 files, 140->41) | sonnet | `.claude/manifests/files-fallible-safe-w1.txt` — 110 findings, 81 files; verified disjoint from both running lanes |

## Session 2026-09-17 (codex lint drive, background job 4a7a3221) — 5 lanes COLLECTED, none active

Collected and committed as 0cabffe042. Launched from HEAD 2c14c74d0a. All five are **codex CLI**, not Claude
subagents (owner's instruction: "no more sub agents here, codex only").
Path-exclusive by construction — no two lanes may touch the same file.

| lane | scope | findings | model | effort | why this model |
| ---- | ----- | -------- | ----- | ------ | -------------- |
| A | `apps/worker/` | 879 | gpt-6-astra | high | ADR-144 composition conversion; 786 of the 879 are one architectural cause and a wrong move stops every queue |
| B | `enterprise/modules/` | 571 | gpt-5.6-luna | high | module-shape conversion across governance + scim; repository/channel/member distinctions decide every finding |
| C | `modules/trace/` | 661 | gpt-5.6-sol | high | largest module, mixed architectural + complexity, on the ingestion hot path |
| D | `modules/scenario/` | 506 | gpt-5.6-terra | medium | mostly package-boundaries + temporal; more mechanical, but carries one blocked naming decision |
| E | `modules/analytics/` + `modules/ops/` | 578 | gpt-5.5 | medium | the most mechanical of the five: temporal-only + filenames |

Excluded from every brief: `fallible-result-naming` and `no-try-prefix` (owner's
ruling — ~1,053 findings parked, converting a nullable `find*` changes behaviour
at every call site). `enterprise/packages/` is excluded from B: another session
holds uncommitted work under its governance tests.

Pre-launch dirty snapshot: `dirty-prelaunch.txt` (133 files, none of them mine).
Attribution is snapshot-subtracted — a lane owns only what appeared after launch
inside its own scope.

**Outcome.** All five collected, verified independently, committed as `0cabffe042`
(77 files, +1,270 / −1,898). Every lane's scoped self-report reproduced exactly on
re-measurement except lane A, which reported −7 and actually netted **+1**.

| lane | scope | delta | verified |
| ---- | ----- | ----- | -------- |
| A | apps/worker | **+1** (claimed −7) | removed 200 lines of genuinely discarded stored-object construction; converted the foundation to ten contract tokens. Real architectural progress, no meter movement |
| B | enterprise/modules | −57 | exact; also added the `@langwatch/test-harness` devDependency 12 packages were importing undeclared |
| C | modules/trace | −41 | exact |
| D | modules/scenario | −12 | exact; its reported "0 → 510 typecheck" was a missing workspace link, fixed by install |
| E | analytics + ops | −22 | exact; never reached ops |

0 casts added, 0 suppressions added, stash untouched, no rule or baseline file edited.

**THE MEASUREMENT WAS BROKEN AND IS NOW FIXED — read this before quoting any number.**
Piping oxlint truncates its output (it exits without flushing). Three identical
piped runs of one tree returned **3,712 / 4,646 / 7,956**. Redirected to a file the
same tree returns **8,176** three times, byte-identical. Every lint figure on this
drive before 2026-09-17 — including "11,065 → 9,052" — was piped and is noise.

Correct baseline method: `git worktree add --detach <path> <ref>`, `pnpm install`
**inside it**, then run oxlint with that worktree as cwd. Linting a worktree from
outside the repo root silently disables every path-scoped langwatch rule
(`temporal-only` and friends match `^(apps|modules|enterprise)/` against the
workspace-relative path), which undercounts by roughly 2,000.

Verified baseline 2c14c74d0a = **8,441**. Working tree after the five lanes =
**8,176**. Control: five of six scopes no lane touched returned identical counts
on both sides.

## Session 2026-09-17 round 2 (codex, job 4a7a3221) — 5 lanes ACTIVE

Launched from 0cabffe042, verified baseline **8,176** (file-redirect method).
Scopes chosen to be clean: every scope carrying another session's uncommitted
work was excluded, so attribution stays decidable.

| lane | scope | findings | model | effort |
| ---- | ----- | -------- | ----- | ------ |
| F | `apps/worker/` | 872 | gpt-6-astra | high |
| G | `modules/trace/` | 620 | gpt-5.6-sol | high |
| H | `enterprise/packages/` | 361 | gpt-5.6-luna | high |
| I | `modules/scenario/` | 494 | gpt-5.5 | medium |
| J | `analytics/` + `workflow/` + `prompt/` | 578 | gpt-5.6-terra | medium |

Briefs now carry the corrected measurement protocol (never pipe oxlint; strip
ANSI before grepping tsc; `$?` after a pipeline is the wrong command's status)
and require each lane to re-measure its **whole scope** and report the net, not
the gross — round one had a lane report −7 while netting +1.

F is told explicitly not to redo round one's dead-code removal, and that
ADR-144's 2026-09-17 amendment (line 458) forbids substituting `LicensingApi`
for the process-provided `EntitlementSource` factory.

## Rounds 2-4 collected (job 4a7a3221) — no lanes active

| round | commit | total after | delta |
| ----- | ------ | ----------- | ----- |
| 1 | `0cabffe042` | 8,176 | −265 (lanes −131 + peers) |
| 2 | `47ad3c4e22` | 8,084 | −92 |
| 3 | `7746a2176f` | 7,978 | −106 |
| 4 | `a0d6968924` | 7,761 | −217 |

Baseline 8,441 at `2c14c74d0a`. Read
`dev/docs/plans/handover-2026-09-17-codex-lint-drive.md` before quoting any
number — the measurement method used before 2026-09-17 was broken.

## Rounds 5-7 collected — no lanes active

| round | commit | after | delta |
| ----- | ------ | ----- | ----- |
| 5 | `cac7754edb` | 7,668 | −93 |
| 6 | `01be84428a` | 7,564 | −104 |
| HostApi | `3b8be1ea32` | 7,533 | −31 |
| 7 | `273e60a76a` | 7,394 | −139 |

Owner decisions taken 2026-09-17: worker 982 → owner designing, see
`dev/docs/plans/worker-module-app-decision.md`, DO NOT scope lanes at it;
parked 1,245 → stay parked; HostPort → renamed to `*HostApi` (done);
next stretch → keep rounds going on addressable work.

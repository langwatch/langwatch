# Handover: the enterprise install drive — 2026-09-16 (rev 2)

You are the coordinator. Read `.claude/coordinator/COORDINATOR.md`, then this.
The live roster is `.claude/coordinator/LANES.md`; the drive's standing decision
is `.claude/manifests/BRIEF-governance-install.md`. **No lane of this drive is
active.** The one `active` row in the roster (`fallible-langy`) belongs to peer
session 4a7a3221 and is not yours.

## The goal, as the user set it

apidiff reads **21 operations as missing on the branch** — 17 `/api/scim/v2/*`
and `/api/scim-tokens`, 4 `/api/governance/ingestion-templates`. main served
them; this branch answers 404. Get them served.

The user's ruling, from earlier the same day and not up for renegotiation:
enterprise module routes are **always mounted**, and an organization without the
entitlement gets a **refusal on the request**, never a 404 from an unmounted
route. SCIM already behaves this way (`plan_not_entitled`); nothing about the
refusal changes. Only the wiring does.

## Read this first: the previous revision's next action was wrong

Rev 1 said "repair the 18 dead-alias imports in
`enterprise/modules/governance/server/src`, it is bounded work, then re-measure."
That was run as lane `gov-dead-alias-gate` and it is now answered. **It is not
bounded work, and "18 dead-alias imports" was not the shape of the problem.**

What is actually true, measured rather than inferred:

- `pnpm -w typecheck:declarations --project .` from the package directory exits 1
  with **13 errors across 9 files**, down from 45 / 18 at the start of the day.
  Every figure here was taken by the coordinator's own run, not from a report.
  The gate is still shut — `tsc --noEmit` still never runs for this package — but
  this is the first real movement it has ever had.
- Only one of the four dead-alias classes was ever repointable
  (`~/generated/prisma/client` -> `@langwatch/prisma-client/generated`). Done.
- Three services were genuine residue and are deleted, with no stranded callers:
  `agent-listing-port.service.ts`, `people-listing-port.service.ts`,
  `source-pull-status.service.ts`, each with its own test. Zero passing tests lost —
  they could not collect, which is why the failing-suite count fell 37 -> 34.

**Two of the five files rev 1 told the lane to delete had live importers.** The
coordinator's importer grep used a trailing quote (`grep '<name>"'`) and this repo
writes imports with the `.ts` extension, so it matched nothing real.
`agents-listing-outcome.service.ts` is exported from the module's own `index.ts`;
`source-credential-access.service.ts` is imported by two composition services.
The lane refused both and said why. If you write an ownership or residue table,
**match on the extension, and have the lane re-verify rather than trusting it.**

## The 45 errors, decomposed — the thing this drive never had

Four classes. Only the fourth looks lane-able, and it isn't either.

**1. Dead monolith aliases.** `~/utils/ssrfProtection` in **4 files** — a class
nobody had catalogued before today — plus two remaining `@ee/event-sourcing/*`
and `../activity-monitor/ingestionCredentials`. The names `MS_PER_DAY`,
`EmittedUsageHint` and `COST_RESTATEMENT_LOOKBACK_DAYS` are declared nowhere in
the live tree either. These need re-deriving or porting; there is nothing to
repoint to. Note the pre-conversion sources are still readable under
`.claude/worktrees/*/platform/app/ee/**` — that is where
`INGESTION_PULL_LISTING_OUTCOME`'s real values were recovered from
(`{ LISTED: "listed", REFUSED: "refused" } as const`, plus its type). Those are
other checkouts, not this branch: fine as evidence, never as an import target.

**2. Module -> composition imports.** `../logic/identityEvidence` and
`../governanceOcsfEvents.clickhouse.repository` resolve only inside
`enterprise/packages/composition/api/src/governance/`. Repointing them would
entrench the exact direction this drive exists to remove, so they wait for the
move, like the ClickHouse repositories did.

**3. Free functions that became class methods; callers never updated.**
`decryptCredentials` is now `IngestionCredentialsService.decrypt()`
(`services/ingestion-credentials.service.ts`); `isSameDataverseEnvironment` and
`isDataverseEnvironmentOrigin` are now on `DataverseEnvironmentService`.
The credentials one **cannot be fixed inside the module**: `withSourceCredentials`'s
two callers are in composition and have no `GovernanceEncryptor` to pass, and the
encryptor is a governance *member*. That makes it install-shape work — ADR-144's,
not a repoint.

**4. Stripped imports whose targets are alive — and still not mechanical.** Six
of the ten names missing from `governance.members.ts` do exist in the contract:
`GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE`, `GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE`,
`RecordVkLifecycleCommandData`, `RecordBudgetCrossingCommandData`
(`governance-events.ts`), and `IngestionKeyMintCommand`, `IssuedIngestionKey`
(`ingestion-source-key.commands.ts`). **None of the six is re-exported from the
contract's `index.ts`**, so restoring them is a change to the contract's public
surface, not an added import line. The remaining four — `ProjectWithTeam`,
`InternalProject`, `InternalProjectQuery`, `TraceProcessingEvent` — are declared
nowhere. All ten sit in a coordinator-held file that is also `gov-app-adr144`'s
central file.

**The conclusion that follows.** The governance server package is mid-move from
two directions at once — out of the monolith and out of the composition package —
and because the declaration build has never run, nobody had ever seen how much of
that move is unfinished. The typecheck gate does not open with a sweep. It opens
with the ADR-144 conversion, which owns `governance.members.ts`, the contract
surface and the encryptor seam. Everything else is downstream of it.

## What is left, in order

1. **`GovernanceApp` onto ADR-144** — `.claude/manifests/gov-app-adr144.md`, opus,
   currently `blocked` with its handoff on disk. It is now the critical path, not
   step 3. Re-scope it before spawning: it blocked twice on coordinator scoping
   errors, and the decomposition above is the map it was missing. It converts
   all-at-once — `feature-installer.ts:874` derives `members` from `reads`, so
   there is no half-conversion that typechecks.
2. **Six legacy collaborators, and most are not channels.** Superseded the
   "two channels" line, which was wrong twice. Six interfaces have their only
   live implementation in `enterprise/packages/composition/api/src/governance/`:
   `GovernanceEventingChannel` (governance-eventing, 20857 bytes),
   `TraceAlertTriggerMatchChannel` (governance-subscriber, 5584),
   `GovernanceSignalChannel` (governance-signals, 4268),
   `AdminWorkspaceViewOcsfChannel` (admin-workspace-view-audit, 3165),
   `IngestionSourceLifecycleChannel` (ingestion-source, 2525),
   `GovernanceWebhookChannel` (governance-webhook, 2472).

   They are all named `*Channel` because the legacy `GovernanceInfrastructure`
   bag called them that. By ADR-144 §9 a channel is messages to or from something
   the module does not own, **over a conduit**. Judged by what each file imports:
   `governance-signals`, `governance-subscriber` and `ingestion-source` open no
   conduit at all (only governance's own server, `observability` and `time`) and
   are **services**; `admin-workspace-view-audit` imports a ClickHouse repository
   and `project-contract`, so it is a **repository plus a peer dependency**;
   `governance-webhook` imports `@langwatch/eventing` **and** the webhook module,
   so it is genuinely split; only `governance-eventing` is plainly a channel.

   **Building to the `*Channel` names would manufacture five channels ADR-144
   forbids** - the same class of fiction removed from the enforcer's advice
   strings today. The classification is a decision, and it is the re-scoped
   `gov-app-adr144` lane's first deliverable, ahead of any code.

3. **The install itself** — catalogue, `dev/scripts/generate-modules.mjs`, and
   **two** composition roots. `apps/worker` installs governance as well as
   `apps/api`. This is also when the additive ClickHouse duplication gets deleted.
4. **SCIM's last blocker**: `ScimSyncLifecycle` needs Identity's ledger-commit,
   which `IdentityApi` does not expose. Parked on a bespoke member — precedent
   `project.app.ts`'s `topicClustering`. Decide: grow `IdentityApi`, or accept it
   un-suppliable.
5. **Re-run apidiff** and confirm the 21.

## Scoreboard — unmoved, and it will not move until the install lands

apidiff run `20260916-r11`, base `7b5e10e7ae`. Report and ledger in
`.apidiff/{report,ledger}-20260916-r11.json`.

| | |
| --- | --- |
| union operations | 340 |
| **probed and equal (real parity)** | **128** |
| skipped, never probed | 106 |
| differing | 82 |
| root causes | 17, **0 new** against the r9 baseline |

Of the 82 differing, 68 are missing-on-one-side and **21 of those are this drive**.

## The tree, and why nothing is committed

`dirty=326` (260 tracked, 66 untracked). **Three background jobs are writing to
this checkout**: 981f27d9 (this drive), 4a7a3221 (lint-to-zero) and 2e744849.
`.claude/coordinator/LANES.md` is written concurrently by at least two of them —
a row was cleared by a peer between two reads this session. Nothing this drive
has produced across eight lanes is committed, because **the user has not
authorised commits**. That is the standing state, not an oversight. The branch is
3045 ahead of `origin/main` and 7 behind.

When commits are authorised, collect by explicit pathspec per COORDINATOR.md §7
and never `git add -A` — two peer sessions have uncommitted work in this tree.

## Decisions taken — do NOT relitigate

- **`INGESTION_PULL_LISTING_OUTCOME` = `{ LISTED: "listed", REFUSED: "refused" }`,
  and it belongs in the governance contract.** Values recovered from the
  pre-conversion source; the constant is used only in `typeof` positions.
- **`aiToolProviders` keeps the static registry.** The only caller is
  `listProviderOptionsForAdmin`, which stamps `configured: has(providerKey)` — if
  the list were the organization's own providers that flag is constant-true.
- **`cliContacts`' invented 500-member cap is refused.**
  `OrganizationSupportContactService` already answers it over rows the module owns.
- **The cost-rollup subsystem stays in the composition package.** ~2,800 lines,
  nothing on the install path needs it. Own lane later, moved whole.
- **The ClickHouse move stays additive until the install.** Exporting repository
  classes from the module's `index.ts` was refused — `private-runtime-export`.
- **Gateway owns the budget overview.**
- **Spec buckets:** rebind where the behaviour lives elsewhere, rewrite where the
  code superseded the promise, `@unimplemented` only where genuinely absent.

## Traps that have each cost real time

1. **`timeout` does not exist on macOS.** `timeout 420 pnpm ...` exits 127 having
   run nothing, and a grep over its empty output reports zero errors. That read as
   "the declaration build is clean" for one turn this session. Never wrap a check
   in `timeout` here.
2. **Trailing-quote import greps miss everything.** See above. Match the `.ts`.
3. **Sizing the conversion from one interface.** "562 lines across 4 files" came
   from `GovernanceInstallationOptions` (30 collaborators) and missed
   `GovernanceInfrastructure` (36 more, `governance.members.ts:33`). ~66
   collaborator slots, **none ever wired on this branch** — first-time wiring, not
   a conversion.
4. **A green check that proves nothing.** ClickHouse repositories declared
   `requires = ["clickhouse"]` while `create` took a resolver *function*;
   `AnyProvider` erases the parameter, so it typechecked and 39 tests passed. It
   would have thrown on first call.
5. **Bindings that are fiction.** Ten scenarios were bound to test files importing
   a module that never existed in that package. Parity counted them bound.
6. **`as unknown as` casts.** Five lanes have now produced them; all were sent
   back. `modules/trace/server/src/app/trace-composition.build.ts:230` still
   carries two, fixable by narrowing the resolver's return type to
   `Pick<ClickHouseClient, "insert" | "query">`.
7. **Manifests that name filenames.** `*.port.ts` is banned by
   `no-port-vocabulary` and `feature-source-layout`.
8. **TS6305 floods a direct `tsc`.** Unbuilt project references produce ~296
   "output file has not been built" errors and, worse, degrade same-package
   relative imports to `any`, hiding real errors. Exclude TS6305 before comparing,
   and treat a clean direct `tsc` as weak evidence. Non-TS6305 floor is ~208.

## Outstanding defects, none blocking

- `PersonalSourceTypeNotAllowedError` (`governance.errors.ts:60`) is a plain
  `Error`, so the allow-list refusal reaches customers as a generic unknown, while
  `ingestion_key_source_not_allowed` sits registered at `app-codes.ts:237` with
  **nothing throwing it**.
- `enterprise-trpc.composition.ts` still references the deleted `ScimPlanProvider`.
- `enterprise/modules/scim/server/server/src/app/server.members.ts` — note the
  doubled `server/server` — is scaffold debris imported by nothing.
- `prisma.ingestion-pull-run-projection.repository.ts` has a shape mismatch, and
  `ingestion-pull-run-projection.tenancy.integration.test.ts` a self-import bug;
  both pre-existing, both recorded in `.claude/handoffs/gov-dead-alias-gate.md`.
- Two scenario-bound tests (`pulledUsageCurrency`, `signedPulledMoney`) import a
  second dead pipeline, `@ee/.../pulled-usage-processing/schemas/events`, whose
  names now exist in `contract/src/pulled-usage.events.ts`. Field-shape
  compatibility unverified; both carry live `@scenario` bindings to
  `specs/governance/pulled-usage-cost-reporting.feature`.
- Three `pullerWorker*.unit.test.ts` files import a subject `../pullerWorker` that
  does not exist; the live worker is `IngestionPullWorkerService`. Before deleting
  them, confirm every `@scenario` they bind is re-bound in the newer suite —
  otherwise deleting silently unbinds it.

## How to run apidiff

```
.bin/apidiff/apidiff run -no-haven -main-ref <base> -branch-dir <clean worktree> \
  -report .apidiff/report-<date>.json -ledger .apidiff/ledger-<date>.json \
  -ledger-baseline .apidiff/ledger-20260916-r11.json
```

Use a **clean worktree** for `-branch-dir`: with `-no-haven` the branch instance is
that directory itself, so a dirty tree boots dirty. Read `credentialChecks` in the
report before any count.

## Next action

**The classification is settled; the remaining 13 declaration errors are the
path.** `gov-app-adr144` ran on opus and delivered it: of the six interfaces the
legacy bag named `*Channel`, **exactly one is a channel** —
`GovernanceEventingChannel`. `AdminWorkspaceViewOcsfChannel` is a repository,
`TraceAlertTriggerMatchChannel` a peer dependency on the automation module,
`GovernanceWebhookChannel` a `WebhookApi` peer plus two members,
`GovernanceSignalChannel` splits three ways into the one eventing channel, and
`IngestionSourceLifecycleChannel` is a service over it. The renames are **not**
applied: `enterprise/packages/composition/**` imports all six by name, so they
land with the composition deletions at install time, not before. The rename
table is in `.claude/handoffs/gov-app-adr144.md`.

The 13 remaining errors, by file:

```
3  repositories/prisma/prisma.ingestion-pull-run-projection.repository.ts
2  services/databricks-genie-puller.service.ts
2  repositories/prisma/prisma.provider-account-lookup.repository.ts
1  each: services/{pulled-usage-eventing,microsoft-directory-read,copilot-bots,
        azure-cost-management,admin-api-users}.service.ts
1  repositories/clickhouse/clickhouse.governance-clickhouse.repositories.ts
```

Two of them are the `~/utils/ssrfProtection` class — a module that exists
nowhere — and one is the ClickHouse resolver TS2322 that ADR-144's member
wrapper was meant to answer. None is a sweep.

**Three decisions are open and each belongs to a person, not a lane:**

1. **`AutomationApi` exposes no record-match operation.** `TraceAlertTriggerMatchChannel`
   is a peer dependency on the automation module, but the operation it needs is
   not on the peer's API. Grow `AutomationApi`, or keep the bespoke member.
2. **`cost_usd` defaults to `"0"`, and the code argues it should not.**
   `azure-cost-management.service.ts:663` argues an absent dollar figure must
   stay absent; the schema's `.default("0")` contradicts it. This decides what a
   customer's SIEM shows for a non-USD bill — a product decision.
3. **`pulled-usage-eventing.service.ts:87`** is two structurally different
   `PulledUsageEvent` unions meeting in eventing's generics.

**Still not committed.** `dev/scripts/commit-slice.sh` was refused by the
permission classifier twice, the second not transient. Nothing from this drive,
the lint fix, or tonight's caller edits is committed. The slices are built and
verified and a boot-breaking stranded import in
`composition/api/src/index.ts` is already fixed. This needs a Bash permission
rule or another route the user chooses; do not route around it.

**A live overlap to watch.** The concurrent lint drive's `comment-w11` owns
`packages/architecture-enforcer`, `.claude/skills/**` and `dev/docs/**` — the
same paths as this session's uncommitted `defineChannels` fix. Flagged in
`LANES.md`; a sweep there could silently revert it while it is uncommitted.

**Method note, because it cost this session twice.** Two manifest claims were
wrong because a grep tested a spelling rather than a fact: `grep '<name>"'`
missed every importer, since this repo writes imports with the `.ts` extension;
and a grep for a name inside a contract's `index.ts` reported "not re-exported"
when that file carries **40 star exports**. Both were caught by lanes. Verify a
negative by resolving the module or through the language server, never with a
pattern.

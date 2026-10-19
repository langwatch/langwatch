# Entitlement merge: usage into core entitlement

Plan only, no code. Ruling: `.claude/coordinator/rulings-2026-10-05.md`, "Alex, 2026-10-06 (late evening):
entitlement absorbs usage; licensing stays separate". Measured against HEAD `e1cae50bfe`, 2026-10-06.
Replaces `dev/docs/plans/licensing-merge-2026-10-06.md` (superseded); its sections 1, 3 and 4 are reused
here and were re-checked against the code, with differences noted.

The ruling, restated as constraints this plan must meet:

- `modules/usage` merges into `modules/entitlement`: one core module owning plan resolution, limits,
  enforcement, request bounds, metering (usage's meters, `billable_events`, the trace meter) and usage
  warnings. One API, `EntitlementApi`. `UsageApi` and `@langwatch/usage-contract` are deleted in the move;
  importers are rewritten; no re-export package.
- Licensing (licences, activation codes, Connect, instance registry) and billing (Stripe, invoices, seats,
  connected invoicing) stay separate enterprise modules, one API each.
- Entitlement calls billing (Cloud subscription plan, pricing) and licensing (self-hosted licence)
  synchronously. Billing and licensing stop calling entitlement and usage and learn anything of
  entitlement's by facts only.
- Still ruled and unaffected: R8 (hosted judging moves to instant-eval; `licensing -> instant-eval` is
  cut); record §9 seat changes by fact; Q14 (trace-meter seed as a `.withMigrations` background step);
  Q161 (pricing and currency reads). R4, E1 and the E2 licensing item stay superseded: each reverses the
  ruled direction (entitlement calls billing and licensing).

Every choice the ruling does not make is in section 6, not taken.

---

## 1. Inventory, verified

The superseded plan's section 1.1 (entitlement) and 1.2 (usage) stand as written, with these checks and
differences:

- Peer edges: 401 today (the superseded plan counted 402 at `acf03c2bf9`). `peer-cycles` reports 223
  findings (25 shown, 198 hidden), not 245; batch cuts have landed since. The model in section 4 matches
  the policy's count exactly.
- Entitlement's peers (`modules/entitlement/process/src/app/entitlement.app.ts:127-132`): user `:127`,
  licensing `:128`, billing `:129`, trace `:130`, organization `:131`, project `:132`.
- Usage's peers (`modules/usage/process/src/app/usage.app.ts:34-36`): entitlement `:34`, billing `:35`,
  project `:36`. Usage has no inbound peer, so it is in no cycle today.
- `UsageApi` (`modules/usage/contract/src/usage.events.ts:57-59`, 0 operations): no peer declares it.
- `@langwatch/usage-contract`: 15 source files import it, 4 outside usage (billing process: 2 sources,
  2 tests). Exports: `USAGE_PIPELINE_NAME`, the three event-type constants, `usageMonthSchema`,
  `usageLimitSchema`, the three event data schemas and their types, `UsageApi`, `usageConfig`. None
  collides with an `@langwatch/entitlement-contract` export; `isSaas` is the shared `@langwatch/config`
  leaf in both configs.
- `@langwatch/entitlement-contract`: 223 importing source files. The package keeps its name, so none of
  them changes.
- Package graph: entitlement contract depends on `@langwatch/plans` only; usage contract, licensing
  contract and billing process depend on it. No contract-level cycle exists or is created.
- Usage builds its meters only on SaaS: `meterStores: config.isSaas ? ... : undefined`
  (`usage.app.ts:61`), and the pipeline builds early without them (`usage.pipeline.ts:85`).
- Neither module has a browser half, REST family, task or migration. The trace-meter seed service
  (`modules/usage/process/src/services/trace-meter-seed.service.ts`) exists but is not wired.

## 2. The merged module's shape

Follows record §3 (four packages, one contract and one `*Api` token), §9 (pipelines and stored names)
and in-tree precedents named per line. No new `*Api` operation: metering answers by events today and
keeps doing so.

### 2.1 Contract (`@langwatch/entitlement-contract`)

- Gains, as `contract/src/usage.events.ts`: `USAGE_PIPELINE_NAME`, `USAGE_MONTH_COUNTED_EVENT_TYPE`,
  `USAGE_LIMIT_REACHED_EVENT_TYPE`, `USAGE_LIMIT_CLEARED_EVENT_TYPE`, `usageMonthSchema`,
  `usageLimitSchema`, `monthCountedEventDataSchema`, `limitReachedEventDataSchema`,
  `limitClearedEventDataSchema` and their `z.infer` types. Values unchanged (section 6, Q1).
- Drops: `UsageApi` (nothing to keep) and `usageConfig` (its one leaf, `isSaas`, is already in
  `entitlementConfig`, `contract/src/entitlement.config.ts:22`).
- `EntitlementApi` is unchanged: 7 operations, key `"entitlement"`.

### 2.2 Process (`@langwatch/entitlement-process`)

| From `modules/usage/process/src/`                                                                       | To `modules/entitlement/process/src/`                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/usage.app.ts` (`UsageModule`, 92 lines)                                                            | absorbed by `app/entitlement.app.ts`: `EntitlementModule` exposes the usage pipeline and its `connect`, as billing's `lifecyclePipeline()` does (`billing.app.ts:808`) |
| `eventing/*` (pipeline, commands, events, process manager, two projections, subscriber)                 | `eventing/`, file names unchanged                                                                                                                                      |
| `repositories/*` and the `clickhouse/`, `memory/` pairs                                                 | `repositories/`; one registry over prisma and clickhouse (precedent: `enterprise/modules/billing/process/src/repositories/live/live.billing.repositories.ts:15`)       |
| `rules/usage-limit.rules.ts`                                                                            | `rules/`                                                                                                                                                               |
| `services/{usage-counting,billable-events-meter-append,trace-meter-append,trace-meter-seed}.service.ts` | `services/`                                                                                                                                                            |
| `usage.module.ts`, `index.ts`                                                                           | deleted; `entitlement.module.ts:12-16` gains a second `.withEventing(usageEventing)` (precedent: `billing.module.ts:51-53`, three pipelines)                           |

- `UsageCountingService` calls `entitlement.getActivePlan` (`usage-counting.service.ts:60`) through the
  peer today; after the move it calls the module's own plan resolution. The `usage -> entitlement` peer
  disappears; `usage -> billing` and `usage -> project` fold into entitlement's existing billing and
  project peers.
- Pipelines: `entitlement_usage_warning` (aggregate `global`) and `usage` (aggregate
  `usage_organization`), every stored name byte for byte.
- Stores required: prisma, clickhouse.
- Transports unchanged: `plan.*`, `limits.*`, `costs.*`; procedure names, permissions and errors as today.

### 2.3 Browser

Neither module has a browser half; the merged module has none. Billing's browser reads `plan.getActivePlan`
and `limits.getUsage` through its own declared map (`enterprise/modules/billing/browser/src/behavior/billing-api.ts:49,53`);
organization's browser imports the tRPC contracts. Both are unchanged (same package, same procedures).

### 2.4 Specs, ADRs, catalogue

- `modules/usage/specs/{usage-counting,usage}.feature` (6 and 25 scenarios, all bound) move to
  `modules/entitlement/specs/` with file names and Feature titles unchanged; bindings match by title.
  The title "Usage owns all counting" is Q2.
- `modules/usage/adrs/001-usage-package-boundary.md` becomes `modules/entitlement/adrs/002-...` with a
  one-line note (Q2).
- `modules/catalogue.json`: the `usage` entry (`:313-316`) goes; entitlement's subjects gain `usage`.

### 2.5 Every usage importer and what replaces it

| Importer                                                                                                                                                | Replacement                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `enterprise/modules/billing/process/src/eventing/billing-reporting.pipeline.ts:14-17`, `plan-limit-reached.subscriber.ts:4-7`, and their two unit tests | same names from `@langwatch/entitlement-contract`                               |
| `enterprise/modules/billing/process/package.json`, `tsconfig.json`, `tsconfig.build.json`                                                               | drop `@langwatch/usage-contract` (entitlement contract is already a dependency) |
| 11 files inside `modules/usage/process/src`                                                                                                             | move with the module; import from the same-module contract                      |
| `apps/{api,worker,tasks}/src/process-modules.generated.ts`, their `package.json`, `tsconfig.json`, `tsconfig.test.json`                                 | `pnpm generate:modules`, `pnpm sync:references` (coordinator)                   |
| root `tsconfig.json:706,709`, `tsconfig.build.json`                                                                                                     | `pnpm sync:references`                                                          |
| `dev/nx/test-reads-plugin.mjs:132` (`@langwatch/usage-process` reads two pricing docs)                                                                  | key becomes `@langwatch/entitlement-process`, merged with any existing entry    |
| `specs/billing/billable-events-copy.feature:9` (comment naming `modules/usage`)                                                                         | `modules/entitlement`                                                           |
| `UsageApi`                                                                                                                                              | nothing; no caller                                                              |

## 3. Direction

### 3.1 Billing and licensing into entitlement and usage today

Neither billing nor licensing declares an entitlement or usage peer (edge list, section 4). Every tie is a
contract import or a subscriber, none a call:

| #   | Tie                                                                                                                                                                                    | Kind                              | How it goes                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | billing `usageMonthCounted` peer subscriber (`billing-reporting.pipeline.ts:93`) on `lw.usage.month_counted`                                                                           | fact                              | stays; imports from entitlement contract; lane name `billing_reporting.<name>` unchanged        |
| 2   | billing `usageLimitReached` peer subscriber (`billing-lifecycle.pipeline.ts:73`, `plan-limit-reached.subscriber.ts`) on `lw.usage.limit_reached`                                       | fact                              | stays, as 1                                                                                     |
| 3   | billing `plan-limit-alert.service.ts:7` imports `USAGE_UNIT_DISPLAY_LABELS`                                                                                                            | contract value                    | stays (a contract import is not a call)                                                         |
| 4   | billing `deployment-plan-sources.service.ts:8-12` implements entitlement's `EntitlementSource`; exported as `createDeploymentPlanSources` (`billing.module.ts`, `index.ts`)            | contract types, dead code         | no importer anywhere; Q10                                                                       |
| 5   | billing contract returns `PlanInfo` (licensing's alias of entitlement's `Plan`, `license-plan.ts:5`) from `getActiveSubscriptionPlan`                                                  | contract type                     | Q6                                                                                              |
| 6   | billing browser imports `Plan` (`billing-api.ts:9`), `UsageStats` (`resource-limits-display.tsx:3`)                                                                                    | contract types, browser           | stays                                                                                           |
| 7   | licensing implements `EntitlementSource.resolve` (`licensing.api.ts:1`, `license.service.ts:1,16`, `licensing.app.ts:65`, `plan-provider.service.ts:2,4`, `license.ts:1` `planSchema`) | contract types, provider port     | stays: this is entitlement calling licensing (`entitlement.service.ts:61`), the ruled direction |
| 8   | billing `countBillableEventsByProjects` reads `billable_events` (`clickhouse.billable-events.repository.ts:31`), a table usage writes                                                  | table read, served to entitlement | section 3.3                                                                                     |

So "billing and licensing stop calling entitlement and usage" holds at the peer level already. What it
still requires is transitive: billing and licensing must not reach entitlement through other modules, or
`entitlement -> billing` and `entitlement -> licensing` stay cyclic (section 4).

### 3.2 Entitlement and usage into billing and licensing

| Call                                       | Site                                                                     | Under the ruling                                      |
| ------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| `LicensingApi.resolve` (plan source)       | `entitlement.service.ts:61`, wired `entitlement.app.ts:182`              | stays (self-hosted licence)                           |
| `applyPlanTypeEntitlements` (value)        | `entitlement.app.ts:2`                                                   | stays (contract import)                               |
| `BillingApi.getActiveSubscriptionPlan`     | `subscription-plan.service.ts:23`, Cloud only (`entitlement.app.ts:177`) | stays (Cloud subscription plan)                       |
| `BillingApi.getPricingModel`               | `usage-enforcement.service.ts:199`; usage `usage-counting.service.ts:61` | stays (pricing); one source with organization's is Q5 |
| `BillingApi.countBillableEventsByProjects` | `usage-enforcement.service.ts:203`                                       | not named by the ruling; section 3.3, Q3              |
| `BillingApi.sendUsageWarning`              | `usage-warning.service.ts:96`                                            | not named by the ruling; Q8                           |

Entitlement also reads pricing and currency from organization (`entitlement.app.ts:275`, Q161), the same
column billing reads.

### 3.3 Billable counts

Record §11: usage owns all counting; billing counts nothing and learns the month's total from
`month_counted`. The late-evening ruling names only "Cloud subscription plan, pricing" for entitlement's
billing calls; the evening ruling's "billable counts" item is not carried over.

Measured: billing's `countBillableEventsByProjects` (`billing.app.ts:794-798`) has one caller, entitlement
(`usage-enforcement.service.ts:203`). Billing's own Stripe reporting already uses `month_counted`
(`report-usage-for-month.commands.ts:213`). Billing's query (`clickhouse.billable-events.repository.ts:26-38`)
and usage's meter query (`clickhouse.billable-events-meter.repository.ts:54-61`) are the same
`countDistinct(DeduplicationKeyHash)` over `billable_events` by organization and window. The
`clickhouse-table-ownership` policy derives the owner from the writer's catalogue root, so after the
merge entitlement owns the table and billing's read stays the one finding until it goes. Q3 asks whether
it goes; the recommendation is yes.

## 4. Peer-cycle effect

Method as the superseded plan's section 4: `peerEdges` from
`packages/architecture-enforcer/src/policies/boundaries/peer-cycles.ts` dumps the edge list, then a
contraction (usage renamed to entitlement, self-loops dropped) and per-scenario edge removal; a finding is
an edge whose target reaches its source, as `peerCycleEdges` computes it. Today's model gives 223, the
policy's own count.

| Model                                                                                              | Edges | Findings | Modules in cycles | Entitlement, billing, licensing in a cycle  |
| -------------------------------------------------------------------------------------------------- | ----- | -------- | ----------------- | ------------------------------------------- |
| Today                                                                                              | 401   | 223      | 40                | all three (34 findings touch them or usage) |
| Merge (slice M1)                                                                                   | 398   | 223      | 40                | all three                                   |
| Merge + R8 `licensing -> instant-eval` (ruled)                                                     | 397   | 222      | 40                | all three                                   |
| As above + `billing -> licensing` cut (only under Q7 b)                                            | 396   | 221      | 40                | all three                                   |
| Merge + R8 + entitlement keeps only billing and licensing (cut organization, project, trace, user) | 393   | 218      | 40                | all three                                   |
| As above + billing drops audit-log, data-retention, gateway, organization, project                 | 388   | 213      | 40                | all three (back through licensing)          |
| As above + licensing drops gateway, organization, project                                          | 385   | 188      | 36                | none; 0 findings touch them                 |
| As above + `billing -> licensing` cut                                                              | 384   | 188      | 36                | none (the cut buys nothing more)            |
| Merge + R8 + licensing's three only                                                                | 394   | 213      | 39                | entitlement, billing                        |

Edges that keep each module in a cycle after the merge and R8:

- **Entitlement**: `-> organization` (`entitlement.app.ts:131`; back `organization -> entitlement`
  directly), `-> project` (`:132`), `-> trace` (`:130`; back `trace -> entitlement`), `-> user` (`:127`;
  back `user -> auth -> entitlement`), and `-> billing`, `-> licensing` for as long as either reaches
  back. `entitlement -> billing` alone is worth 7; every other single cut is worth 1.
- **Billing**: `-> data-retention` (`billing.app.ts:209`; back `data-retention -> entitlement`),
  `-> organization` (`:199`), `-> project` (`:207`), `-> gateway` (`:201`; back
  `gateway -> organization -> entitlement`), `-> audit-log` (`:203`; back
  `audit-log -> annotation -> entitlement`), `-> licensing` (`:195`, only while licensing reaches back).
  `-> authz` (`:197`) and `-> notification` (`:205`) are acyclic.
- **Licensing**: `-> organization` (`licensing.app.ts:167`), `-> project` (`:171`), `-> gateway`
  (`:165`). Licensing is cyclic independently of entitlement: `licensing -> organization -> identity ->
licensing` (identity asks `isPlatformSsoLicensed`).

**Smallest further cut set** taking all three out (beyond R8): 12 edges, entitlement ->
{organization, project, trace, user}, billing -> {audit-log, data-retention, gateway, organization,
project}, licensing -> {gateway, organization, project}. 222 to 188. It is minimal under the ruling:
every other out-edge of the three to a module outside them reaches back, and every back path ends in an
edge the ruling keeps (core calling entitlement, auth, identity and sso calling licensing). Cutting
`billing -> licensing` is not needed. Licensing would hold no peer at all (Q9).

Callers into entitlement and licensing that are cyclic today (analytics, annotation, auth,
data-retention, dataset, experiment, governance, identity, instant-eval, organization, prompt, role,
scim, sso, trace) clear by themselves once the 12 land; none needs cutting on the caller's side.

## 5. Slices

Each slice leaves the tree booting and its touched packages green: `pnpm --filter <pkg> typecheck`,
scoped oxlint, the module's tests, `check:feature-parity` unchanged. Shared files (catalogue, generated
module lists, tsconfig references, root tsconfigs, `dev/nx/test-reads-plugin.mjs`, `ARCHITECTURE.md`,
readmes, baselines) are coordinator applies, requested in each lane's handoff.

**Rolling-deploy finding (for M1).** Nothing in eventing is keyed by module id. Queue registry keys are
`<pipeline>:<jobType>:<jobName>` and dedup ids `<pipeline>/<jobType>/<jobName>/<id>`
(`packages/eventing/src/services/queues/queueManager.ts:338-339,359`); peer-subscriber lanes are
`<pipeline>.<name>` (`packages/eventing/src/pipeline/staticBuilder.ts:174`); process-manager state and
outbox are keyed by process name, project and key (`process-manager/processManager.types.ts:3`); the
runtime refuses a pipeline name twice on one runtime only (`eventSourcing.ts:381`). An old worker
(module `usage`) and a new one (module `entitlement`) register the same `usage` pipeline with the same
keys, and in-flight `countMonth` jobs (5-minute delay) drain on either. No usage or entitlement
migration exists, so no migration-ledger key moves.

**M1. Usage into entitlement.** Owned: `modules/usage/**` (deleted), `modules/entitlement/**`,
`enterprise/modules/billing/process/src/eventing/{billing-reporting.pipeline,plan-limit-reached.subscriber}.ts`
and their two tests, `enterprise/modules/billing/process/{package.json,tsconfig.json,tsconfig.build.json}`.
Shared requests: catalogue (`:313-316` out, entitlement subjects `+usage`), `pnpm generate:modules`,
`pnpm sync:references`, `dev/nx/test-reads-plugin.mjs:132`, `specs/billing/billable-events-copy.feature:9`,
`pnpm generate:readmes`, record §3 and §11 wording. Binds: usage-counting, usage (moved), the eight
entitlement features unchanged. Wire: none. Deploy: none (finding above). Peers: 401 to 398 edges, 223
findings unchanged. Size: about 45 files, mostly moves.

**M2. Seed the trace meter** (Q14, already ruled; after M1 so the step is declared by entitlement, not
usage). Owned: entitlement process `services/trace-meter-seed.service.ts`, the module's `.withMigrations`.
Binds: the Q14 scenario in `usage.feature`. Deploy: a background step on the worker, idempotent,
dry-run flag (migration-data-step skill).

**M3. Billable counts from the module's own meter** (after Q3). Owned: entitlement
`services/usage-enforcement.service.ts` and composition; billing `app/billing.app.ts:372,417,724-798`,
the billable-events repository pair, `BillableEventsQueryService`,
`specs/billable-events-memory.feature` (2 scenarios, retired or moved). Removes
`BillingApi.countBillableEventsByProjects`. Binds: usage-stats-reporting, usage-limit-refusal; write the
"enforcement counts from the meter" scenario first. Clears the `clickhouse-table-ownership` finding.
Wire: none. Deploy: none (same table, same query). Check first that per-organization totals match the
by-project count the enforcement path uses today.

**M4. One counter** (after Q4, and M2 for trace-capped plans). Owned: entitlement's enforcement, stats
and refused-organisations wiring. Enforcement reads the meters and the `refusedOrganizations` state;
`entitlement -> trace` goes on SaaS. Binds: usage-limit-refusal, usage, usage-counting. Deploy: switch
after the seed has run.

**M5. Usage warnings** (after Q8). Owned: entitlement `services/usage-warning*.ts`,
`eventing/entitlement-usage-warning.*`; billing usage-warning sending and a peer subscriber. Binds:
usage-warning-sweep, billing `usage-limits.feature`. Wire: none. Deploy: a warning crossing during the
deploy is sent once (idempotency on organization, threshold, month).

**M6. Billing tidy** (after Q6, Q10). Owned: billing `services/deployment-plan-sources.service.ts`,
`billing.module.ts`, `index.ts`, `specs/deployment-plan-sources.feature` (6 scenarios), billing contract
`billing-types.ts:1`, `plan-limits.ts:1`, `billing.api.ts:3`. Wire: none.

**M7. Cycle cuts** (after Q9). One lane per edge family, patterns per record §9 (peer subscriber from the
reactor's side) or a value passed in: entitlement's four, billing's five, licensing's three. Replaces
`peer-cycle-cuts-2026-10-06.md` E1, E2, LI and batch T's `entitlement -> trace` (which M4 may already
remove on SaaS).

**M8. Billing into licensing** (only under Q7 b). The superseded plan's L3 (seat changes by fact,
already ruled by record §9) stands on its own either way; L4 and L5 apply only if billing stops calling
licensing.

Record and docs (coordinator, with M1): §3 "Usage is a module of its own ... Entitlement keeps plans and
features only" and §11 "Usage warnings: usage decides, billing only sends" name a module that no longer
exists; §3.3's capability row (`EntitlementApi`) stays true; §11 "Entitlement depends on the installed
`LicensingApi` peer" stays true. `work-board-2026-10-06.md` W-20 points here.

## 6. Questions for Alex

Recommendations are marked as such; none is taken.

1. **Stored names.** Event types `lw.usage.{month_counted,limit_reached,limit_cleared}`, pipeline `usage`,
   aggregate `usage_organization`, projections `orgBillableEventsMeter` and `usageTraceMeter`, process
   managers `refusedOrganizations` and `entitlementUsageWarningSweep`, pipeline
   `entitlement_usage_warning`, tables `billable_events` and `usage_trace_meter`. (a) Keep all: no data
   change, the module name and the stored names differ. (b) Rename event types to `lw.entitlement.*`:
   stored events need an upcast or a replay, billing's subscribers change event type, and old and new
   workers disagree during the deploy. (c) Rename the pipeline only: queue keys change, so in-flight jobs
   on the old name need a drain. Recommendation: (a); code constants may still be renamed freely.
2. **Words that name usage.** The feature title "Usage owns all counting", ADR
   `001-usage-package-boundary.md` and record §3, §11. (a) Keep titles in M1 (bindings match by title),
   renumber the ADR to `002` with a one-line note, and reword record and titles in one follow-up. (b)
   Reword everything in M1. Recommendation: (a).
3. **Billable counts.** (a) Entitlement counts from its own `billable_events` meter;
   `BillingApi.countBillableEventsByProjects` and billing's repository go; the table-ownership finding
   clears; matches §11 and the late-evening direction. (b) Billing keeps counting for entitlement (policy
   stays red; §11 contradicted). (c) Billing owns the table, entitlement writes through billing (reverses
   §11). Recommendation: (a).
4. **One counter, and self-hosted.** After M1 entitlement holds two counters: the enforcement path
   (`UsageService` over billing and trace with in-process caches: `assertWithinUsageLimit`, `getUsage`,
   the warning sweep) and the meter path (`countMonth`, `month_counted`, `refusedOrganizations`,
   `limit_reached`/`limit_cleared`). Q73 ruled counting into usage; D1 was superseded. The meters exist on
   SaaS only. (a) SaaS enforcement reads the meters and the refused-organisations state; self-hosted keeps
   counting traces through `TraceApi` (so `entitlement -> trace` stays and stays cyclic). (b) As (a), and
   the trace meter also runs self-hosted, so `entitlement -> trace` goes everywhere (a ClickHouse table
   self-hosted installs then write). (c) Keep both counters. Recommendation: (a) now, (b) as a later
   decision with storage cost measured.
5. **One pricing source.** `BillingApi.getPricingModel` reads `Organization.pricingModel` directly and
   billing writes it on subscription change; `OrganizationApi.getPricing` (Q161) returns the same column
   plus currency; entitlement reads both. The ruling names billing for pricing. (a) All of entitlement's
   pricing reads go through billing, which must then answer currency too (a `BillingApi` shape change,
   amends Q161). (b) All through organization (keeps `entitlement -> organization`, cyclic). (c) Keep both.
   Recommendation: (a), since it is also one of the four reads holding `entitlement -> organization`.
6. **Who owns the `Plan` shape.** Billing's contract returns licensing's `PlanInfo`, an alias of
   entitlement's `Plan`. (a) Keep the type import (a contract import is not a call; it is entitlement's
   provider port), importing `Plan` from entitlement's contract rather than through licensing's alias.
   (b) Billing returns its own subscription-plan schema and entitlement maps it, so billing knows nothing
   of entitlement. (c) `Plan` moves to `@langwatch/plans`. Recommendation: (a); (b) if "learn anything of
   entitlement's by facts only" is meant to cover types.
7. **Billing's calls into licensing.** The late-evening ruling restates the direction for entitlement and
   usage only; the evening ruling's "billing stops calling licensing" sat in the section it replaced.
   Billing calls licensing nine ways (superseded plan §3.1: `findSeatChanges`, `getConnectedSeats`,
   `getContractTerms`, `raiseContractCommit`, `syncContractBudget`, `resetContractBudget`,
   `getHostedUsage`, `generateLicenseKey`, `recordIssuedLicense`). (a) Billing may keep calling licensing;
   the edge is acyclic once licensing's three out-edges go (section 4); only the seat fact (record §9,
   already ruled) is built. (b) Billing stops calling licensing; questions 11 to 13 then apply.
   Recommendation: (a).
8. **Usage warnings.** The sweep calls `BillingApi.sendUsageWarning` (`usage-warning.service.ts:96`);
   record §11 says usage records the crossed threshold as an event and billing sends; billing's plan-limit
   alert already subscribes to `limit_reached`. (a) A fact: entitlement records the threshold crossed
   (event type name per Q1), billing subscribes and sends; `sendUsageWarning` goes. Fits §11 and "billing
   learns entitlement's by facts only". (b) Keep the synchronous call (fits "entitlement calls billing").
   Recommendation: (a).
9. **The 12 cycle cuts.** Are they in this drive, and by which pattern? Entitlement: organization
   (team-to-organization lookup, `findAllIds`, dataset limits, pricing, seats), project
   (`listIdsByOrganization`), user (operator lookup, which E2 passed in), trace (Q4). Billing: data-retention,
   organization, project, gateway, audit-log. Licensing: organization (seat counts, licensed
   organisations, sync outcomes), project, gateway (budgets, managed keys). Licensing would hold no peer
   at all. Recommendation: cut entitlement's four and billing's five in the peer-cycle batch after M1;
   decide licensing's three separately, since they rewrite Connect and the sync.
10. **`createDeploymentPlanSources`.** Unused billing export implementing entitlement's port, bound by
    `deployment-plan-sources.feature` (6 scenarios). (a) Delete both; entitlement already composes the
    Cloud leg (`entitlement.app.ts:177`). (b) Move it into entitlement. Recommendation: (a).
11. **Licence purchase** (only under 7 b). Billing signs and records through licensing today. (a)
    Licensing subscribes to `lw.billing.checkout_completed` (`billing-lifecycle.pipeline.ts:68`), signs,
    records and mails. (b) Licensing signs and records; billing mails on a licensing fact.
12. **Contract commit and budget commands** (only under 7 b). (a) Billing records facts, licensing
    subscribes (eventual). (b) Commit and budget move to billing's connected account (data move). (c)
    Licensing's tick drives renewal and calls billing.
13. **Hosted spend on statements** (only under 7 b). (a) Billing reads the gateway itself (existing peer,
    but `billing -> gateway` is one of the 12 cuts). (b) Licensing records a hosted-spend fact billing folds.

No longer arising, from the superseded plan's section 6: the token choice and the re-export package (the
ruling names `EntitlementApi` and forbids a re-export), the `getActivePlan` name collision (licensing's
contract stays separate), the source licence (plan resolution stays core), and licensing's own
`getActivePlan`/`getSelfHostedPlan` (unaffected by this merge).

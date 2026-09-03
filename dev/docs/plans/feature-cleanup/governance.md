# governance (enterprise) — cleanup review

Audit of `packages/enterprise/features/governance/` against
[`feature-cleanup-review.md`](../../best_practices/feature-cleanup-review.md).
Reference example: [`dataset.md`](./dataset.md).

## 1. What is there now

| Package        | Non-test files | Lines  |
| -------------- | -------------- | ------ |
| `server/src`   | 143            | 24,097 |
| `contract/src` | 34             | 3,062  |
| `web/src`      | 17             | 2,757  |

**99 operations, declared 5 to 7 times each.** The contract's
`GovernanceService` (`contract/src/governance.service.ts`, 99 abstract
signatures) is satisfied by a chain of forwarding classes that hold no rules
of their own.

```
  transports
    server/src/transport/api-rest/governance.api.ts      562 lines
    server/src/transport/api-trpc/{personal-virtual-key,routing-policy}.api.ts   411
    platform/app/src/server/api/routers/governance/*.ts  2,102 lines, 10 routers  ← bypass the app
        │
    server/src/app/governance.app.ts    GovernanceApp    17 public methods, 607 lines
        │                                                (3 pure pass-throughs; the rest hold rules)
        ▼
  @langwatch/enterprise-governance-contract
    governance.service.ts   abstract GovernanceService   99 signatures
        │
        ▼   ─────────────── five forwarding layers, 1,231 lines, zero behaviour ───────────────
    services/governance-facade.service.ts
      DefaultGovernanceService                           99 delegations   345 lines
        │
    services/governance-{rules,ingestion,activity,lifecycle}-operations.service.ts
      4 "operations" classes                             99 delegations   473 lines
        │                                                (34 + 32 + 13 + 20)
    services/governance-{activity,ai-tools,department}.service.ts
      3 wrapper classes                                  35 delegations   259 lines
        │                                                (9 + 17 + 9)
    services/ingestion-source-activity.service.ts
      ActivityMonitorService                              9 delegations    77 lines
        │
        ▼   ─────────────── the code that actually does something ───────────────
    services/  41 files, 5,915 lines   (~22 real services)
    ports/     33 files, 1,309 lines   (64 abstract classes; 13 of them are repositories)
    adapters/  34 files, 9,971 lines   (10 pullers · 17 wiring classes · 7 mappers/eventing)
    repositories/prisma/  15 files, 3,751 lines
    intents/ 350 · processes/ 579 · projections/ 247 · subscribers/ 248
        │
        ▼
    Prisma · ClickHouse
```

Worked example — `activitySummary`, one read of one table, declared **seven**
times and forwarded **five**:

```
GovernanceService.activitySummary                      contract/src/governance.service.ts
  → DefaultGovernanceService.activitySummary           services/governance-facade.service.ts:242
    → GovernanceActivityOperationsService.activitySummary   services/governance-activity-operations.service.ts:28
      → GovernanceActivityService.summary              services/governance-activity.service.ts:27
        → ActivityMonitorService.summary               services/ingestion-source-activity.service.ts:25
          → ActivityMonitorRepository.summary          ports/ingestion-source-activity.port.ts:16
            → PrismaIngestionSourceActivityRepository  repositories/prisma/prisma.ingestion-source-activity.repository.ts
```

## 2. Problems

### P1 — Five stacked layers restate 99 operations and add nothing (breaks R3, R8)

`services/governance-facade.service.ts:34-344` — 99 declarations, every one of
the form:

```ts
readonly activitySummary: GovernanceService["activitySummary"] = (...args) =>
  this.activity.activitySummary(...args);
```

Below it, the same 99 again, split four ways:

| File                                                         | Delegations | Lines |
| ------------------------------------------------------------ | ----------- | ----- |
| `services/governance-rules-operations.service.ts:32-140`     | 34          | 141   |
| `services/governance-ingestion-operations.service.ts:44-144` | 32          | 145   |
| `services/governance-activity-operations.service.ts:28-70`   | 13          | 71    |
| `services/governance-lifecycle-operations.service.ts:48-115` | 20          | 116   |

Then a third tier, three more classes that forward once more:

| File                                                                                       | Delegations | Lines |
| ------------------------------------------------------------------------------------------ | ----------- | ----- |
| `services/governance-ai-tools.service.ts:30-108` → `DefaultGovernanceAiToolCatalogService` | 17          | 109   |
| `services/governance-activity.service.ts:27-78` → `ActivityMonitorService`                 | 9           | 79    |
| `services/governance-department.service.ts:17-70` → `DepartmentService`                    | 9           | 71    |

And a fourth, `services/ingestion-source-activity.service.ts:25-76`, whose nine
methods are each `return this.repository.<sameName>(input)`.

Grepping for a body across all eight files finds nothing — no `if`, no `await`,
no `const`, no `throw`. They are 1,231 lines of forwarding.

`ast-grep --filter no-same-name-delegation-ts` reports 49 hits in this feature,
17 of them in `governance-ai-tools.service.ts` alone. It **misses the two
largest layers**: `governance-facade.service.ts` and the four operations
services spell their delegations as `readonly x = (...args) => …` arrow
properties rather than methods, and the rule matches method bodies. The 198
worst delegations in the feature are invisible to the detector that exists to
find them.

The one facade the layout requires — `app/governance.app.ts` — is a different
thing and is fine (see Keep list).

### P2 — Conversation trace routing throws in production; nothing composes it (breaks R5, R6)

`services/ingestion-pull-worker.service.ts:206-208`:

```ts
if (!this.traceIngestion) {
  throw new Error("Conversation trace ingestion is not composed");
}
```

`traceIngestion` is optional (`:89`, `:103`). The only supplier anywhere is the
unit test — `ports/__tests__/ingestion-pull-worker.service.unit.test.ts:383,409`.
The production composition,
`packages/enterprise/composition/api/src/governance/ingestion-pull-worker.adapter.ts:338-347`,
passes `sources`, `registry`, `credentials`, `projects`, `sink`,
`usageEntitlement`, `usageRecords`, `diagnostics` — and no `traceIngestion`.

The branch is reachable. `routeConversations` runs when a source has
`traceProjectId` set and its type is in `CONVERSATION_ROUTING`
(`:46-52`: `databricks_genie`, `copilot_studio_dataverse`), and
`traceProjectId` is a supported field on all three source commands
(`contract/src/ingestion-source.commands.ts:26,49,72`) with a UI field to set
it (`web/src/components/trace-destination-field.tsx:90`). So an admin who
points a Genie or Copilot Studio source at a trace project gets a plain
`Error` on every pull — which degrades to a generic "unknown" with a trace id
and logs as a platform incident, telling neither the customer nor us what
actually happened.

`GovernanceTraceIngestionPort` (`ports/ingestion-pull-worker.port.ts:10`) has
**zero production implementations** — the feature declares the seam, ships the
UI that needs it, and never wires it.

### P3 — 17 `postgres.*.adapter.ts` classes are `new` with extra steps (breaks R3)

`adapters/postgres.department.adapter.ts` in full:

```ts
export class PostgresDepartmentAdapter {
  private constructor(private readonly database: object) {}
  static create(options: { database: object }): PostgresDepartmentAdapter {
    return new PostgresDepartmentAdapter(options.database);
  }
  build(): DepartmentService {
    return DepartmentService.create({
      repository: PrismaDepartmentRepository.create(this.database),
    });
  }
}
```

Sixteen lines to express one. `postgres.governance-routing.adapter.ts:1-16` and
`postgres.ingestion-pull-run-projection.adapter.ts` are the same file with three
names changed; `postgres.anomaly-rule.adapter.ts:1-22` adds one optional clock.
`postgres.ingestion-source.adapter.ts:14-55` restates a nine-field options type
three times (constructor, `create` parameter, `build` body) to change one field.

All 17 have exactly one caller,
`adapters/postgres.governance-installation.adapter.ts:122-212`, which then calls
`.build()` on each immediately. 496 lines of wiring (excluding the 252-line
installation adapter itself) between the installation root and the constructors
it wants.

Two are exported from `index.ts:65-66` and used outside: `PostgresDepartmentAdapter`
by one integration test, `PostgresAnomalyRuleAdapter` by nobody.

### P4 — `database` is typed `object` and cast at 13 repository entry points

`repositories/prisma/prisma.department.repository.ts:14-15`:

```ts
static create(database: object): PrismaDepartmentRepository {
  return new PrismaDepartmentRepository(database as PrismaClient);
}
```

Line 6 of that same file already does
`import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated"`,
and `@langwatch/prisma-client` is a declared dependency of the package
(`server/package.json`). So the `object` buys no decoupling — it only discards
the type on the way in and asserts it back. 39 occurrences of `database: object`
across 26 files. A wrong client reaches `this.prisma.department.findMany` before
anything notices.

`postgres.governance.adapter.ts:5-17` shows the honest alternative already in
the tree: a structural `GovernanceDatabase` type naming the one model and query
it needs.

### P5 — 13 repository abstracts live in `ports/`, and five are lint-waived (breaks R4's layout rule)

`ports/` holds 64 abstract classes across 33 files. Thirteen of them end in
`Repository`, are implemented only by their sibling in `repositories/prisma/`,
and are imported nowhere outside the feature:

`ActivityMonitorRepository`, `AdminWorkspaceViewAuditRepository`,
`AiToolCatalogRepository`, `AnomalyRuleRepository`, `DepartmentRepository`,
`GovernanceOcsfExportRepository`, `GovernanceSetupStateRepository`,
`IngestionSourceRepository`, `IngestionTemplateRepository`,
`PersonalVirtualKeyRepository`, `RoutingPolicyRepository`,
`SpendSpikeAnomalyRepository`, `IngestionKeyRepository`.

These are not seams to nowhere — a repository abstract with one Prisma
implementation is what the layout asks for. They are in the wrong directory.
Meanwhile `repositories/` itself holds exactly one 3-line file
(`repositories/cost-attribution-policy.repository.ts`).

The cost is recorded in the lint baseline. Six governance files are waived in
`packages/architecture-lint/src/port-module-baseline.json` for
`strict-port-module` (which requires a `*.port.ts` to export an abstract class
ending in `Port`):

```
ports/anomaly-rule.port.ts
ports/department.port.ts
ports/ingestion-template.port.ts
ports/routing-policy.port.ts
ports/governance-diagnostics.port.ts
ports/ingestion-pull-worker.port.ts
```

The first four are waived precisely because their only export is a `*Repository`.

Separately, `ports/department.port.ts:7-12` gives the repository the _service_
verbs — `getAll`, `tryGetById`, `getAssignments` — against the convention that
repositories use `findAll` / `findById`. Seven other port files already use
`find*` correctly.

### P6 — Three ports with no implementation at all (breaks R4)

| Port                           | Implementations            | Evidence                                                                                                                                                                                                                 |
| ------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `IngestionKeyCapability`       | **0**, and zero references | `ports/ingestion-source-key.port.ts:49` is the only line in the repo naming it                                                                                                                                           |
| `GovernanceTraceIngestionPort` | **0** in production        | `ports/ingestion-pull-worker.port.ts:10`; see P2                                                                                                                                                                         |
| `CliBudgetOverviewPort`        | **0** direct               | `ports/cli-bootstrap.port.ts:10`; its one subclass `GovernanceBudgetOverviewPort` (`ports/governance-budget-overview.port.ts:8`) `override`s its only method with a different signature, so the base contributes nothing |

Every **other** port in the feature earns its place — see the Keep list.

### P7 — Domain errors stay plain `Error`, so three places re-derive the status (breaks R6)

`contract/src` declares 22 error classes; **15 extend plain `Error`**. Seven of
those are re-wrapped into `HandledError`s by `app/governance.app.ts:69-176` and
`:596-607` — one class per class, restating the same failure twice with two
names (`RoutingPolicyMustHaveProviderError` → `RoutingPolicyProviderRequiredError`).
The other eight reach the customer as "unknown".

Provable consequences:

- `RoutingPolicyNotFoundError` (`contract/src/routing-policy.ts:151`, thrown at
  `services/governance-routing.service.ts:50`) is **not** in
  `asHandledRoutingPolicyError` (`app/governance.app.ts:596-607`), and
  `GovernanceApp.getRoutingPolicy` (`:481-483`) has no `try`. Asking for a
  policy id that does not exist produces a generic "unknown error" plus a trace
  id, logged as a platform fault.
- `platform/app/src/server/api/routers/governance/departments.ts:154-171` is an
  `instanceof` ladder outside the feature package, re-deriving `NOT_FOUND` for
  `DepartmentNotFoundError` and `DepartmentAssignmentTargetNotFoundError`.
- `transport/api-rest/governance.api.ts:147-188` — `mapTemplateError`, 42 lines
  mapping `TemplateNotFoundError` → 404, `PlatformTemplateImmutableError` → 403,
  `InvalidSourceTypeError` → 400. All three **already carry their own status**:
  `NotFoundError` and `ValidationError` extend `HandledError`
  (`packages/handled-error/src/handled-error.ts:314,388`) and
  `PlatformTemplateImmutableError` extends it directly
  (`contract/src/ingestion-template.ts:121`). The map also invents a second
  taxonomy (`type: "not_found" | "forbidden" | "bad_request"`) beside the codes
  the errors hold.

Also unhandled and knowable: `AiToolEntryNotFoundError`
(`contract/src/ai-tool-catalog.ts:292`), `AiToolDepartmentScopeError` (`:302`),
`RoutingPolicyProviderScopeError` (`contract/src/routing-policy.ts:159`),
`DepartmentNotFoundError` (`contract/src/department.ts:28`).

`OttlGatewayUnavailableError` (`contract/src/ottl.ts:74`) is correctly a plain
`Error` — it is infrastructure, and R6 says leave it.

### P8 — ADR-length prose in service and adapter files (breaks R7)

`services/puller-databricks-warehouse-cost.service.ts` — **373 comment lines
against 380 code lines**, the worst ratio of any feature-server file in the
repo, and already waived in
`packages/architecture-lint/src/service-quality-baseline.json` at 753 module
lines. Lines 3-34 and 78-92 are a measurement narrative, not an explanation of
the code: "Validated against a live workspace at 13.3% of warehouse compute",
"the two bounds were in conflict until this was measured", the reasoning behind
a two-hour settling window. That is an ADR. The package already has
`adrs/` with two files in it.

| File                                                   | Comment / code |
| ------------------------------------------------------ | -------------- |
| `adapters/databricks-genie-puller.adapter.ts`          | 1,177 / 2,072  |
| `services/puller-databricks-warehouse-cost.service.ts` | 373 / 380      |
| `adapters/copilot-studio-dataverse-puller.adapter.ts`  | 321 / 526      |
| `adapters/copilot-studio-trace-mapper.adapter.ts`      | 310 / 772      |
| `adapters/openai-admin-puller.adapter.ts`              | 288 / 588      |
| `adapters/anthropic-admin-puller.adapter.ts`           | 277 / 526      |
| `adapters/conversation-trace-assembly.adapter.ts`      | 117 / 117      |

Much of this is genuinely good — a vendor's billing model is exactly the kind of
surprise R7 says to keep. The split is: the _invariant_ stays beside the code,
the _investigation that established it_ moves to `adrs/`.

Two rotted path references:
`adapters/__tests__/poller-cursor.unit.test.ts:16` cites
`specs/governance/edit-pull-source-config.feature`, which lives at
`platform/app/specs/governance/edit-pull-source-config.feature`;
`assets/ingestion-templates/_template/dogfood.md:300` cites
`specs/ai-gateway/governance/user-ingestion-binding-lifecycle.feature`, which
does not exist anywhere.

### P9 — Three small, provable defects

1. **A banned re-export.** `adapters/genie-trace-mapper.adapter.ts:62`:
   `export { type ConversationRoutingProfile, KNOWN_AGENT_IDENTITIES, type KnownAgentIdentity };`
   — three symbols imported from `./conversation-trace-assembly.adapter` at
   `:40-56` and republished. Consumers should import them from their home.
2. **A broken import that nothing typechecks.**
   `platform/app/src/app/api/governance/__tests__/governance-ocsf-export.integration.test.ts:39`
   imports `PostgresGovernanceOcsfExportAdapter` from
   `@langwatch/enterprise-governance-server`. `server/package.json` exports only
   `./src/index.ts`, and `index.ts` does not export that symbol. It survives
   because `tsconfig.tsgo.json` excludes tests.
3. **A shared utility filed as an adapter.**
   `adapters/conversation-trace-assembly.adapter.ts` implements no port. It is
   seven pure functions (`stringAttr`, `intAttr`, `originAttrs`, `hashId`,
   `msToNano`, `deriveConversationIdentity`, `assembleTraceRequest`) used by
   three callers. R2 puts that in `utils/`.

## 3. What it should look like

```
contract/src/
  governance.service.ts        split the 99-signature interface along the four
                               seams the operations services already name:
                                 GovernanceRulesService     (34)
                                 GovernanceIngestionService (32)
                                 GovernanceActivityService  (13)
                                 GovernanceLifecycleService (20)
  *.errors / *.ts              15 plain Error classes → HandledError

server/src/
  app/governance.app.ts              ~600   unchanged; the one facade both
                                            transports call
  services/                          ~4,700 the ~22 services that hold rules
    governance-facade.service.ts       ~330 ONE implementation of GovernanceService,
                                            holding the 14 real collaborators
    …                                       (no operations tier, no wrapper tier,
                                             no ActivityMonitorService)
  repositories/                             13 abstracts moved out of ports/
    department.repository.ts            ~40   findAll / tryFindById / findAssignments
    anomaly-rule.repository.ts          ~36
    routing-policy.repository.ts        ~26
    …
    prisma/  15 files, ~3,750               static create(database: PrismaClient)
  ports/                             ~1,000 ~48 abstract classes, every one with a
                                            cross-package implementation
  adapters/
    pullers/    10 files, ~7,900            one per vendor — an open set
    mappers/     3 files, ~1,600
    eventing/    4 files
    postgres.governance-installation.adapter.ts  ~330  the one wiring class
  utils/
    conversation-trace-assembly.ts     ~230 was an "adapter"
  intents/ processes/ projections/ subscribers/ transport/   unchanged
  adrs/
    002-databricks-warehouse-cost-attribution.md
    003-conversation-trace-routing.md
```

**≈124 files, ≈21,700 lines. Three layers between a transport and Prisma
instead of seven.**

### The facade — one hop, not five

The contract abstract has to stay for now: nine modules outside the feature
hold `GovernanceService` directly (`platform/app/src/server/routes/auth-cli.ts`
alone calls eleven of its methods). So one class must satisfy 99 signatures.
It should be the _only_ one.

```ts
export class DefaultGovernanceService extends GovernanceService {
  private constructor(
    private readonly anomalyRules: AnomalyRuleService,
    private readonly departments: DepartmentService,
    private readonly policy: PostgresGovernancePolicyService,
    private readonly aiTools: DefaultGovernanceAiToolCatalogService,
    private readonly activity: ActivityMonitorRepository,
    private readonly personalUsage: DefaultGovernancePersonalUsageService,
    private readonly budgets: GovernanceBudgetOverviewPort,
    private readonly routingPolicies: DefaultGovernanceRoutingPolicyService,
    private readonly personalKeys: DefaultGovernancePersonalVirtualKeyService,
    private readonly ingestion: IngestionSourceService,
    private readonly ingestionKeys: IngestionKeyService,
    private readonly templates: IngestionTemplateService,
    private readonly eventing: GovernanceEventingPort,
    private readonly cli: GovernanceCliServices,
  ) { super(); }

  readonly activitySummary: GovernanceService["activitySummary"] = (...args) =>
    this.activity.summary(...args);            // one hop, to the repository
  readonly aiToolListForUser: GovernanceService["aiToolListForUser"] = (...args) =>
    this.aiTools.listForUser(...args);         // one hop, to the real service
  …
}
```

Deleted: `governance-{rules,ingestion,activity,lifecycle}-operations.service.ts`
(473 lines), `governance-{activity,ai-tools,department}.service.ts` (259),
`ingestion-source-activity.service.ts` (77). **809 lines, 143 declarations, no
behaviour change.** The remaining `governance-facade.service.ts` is a fair price
for an interface nine external modules depend on; the four layers under it were
not.

### The wiring — a constructor call is a constructor call

`postgres.governance-installation.adapter.ts` already reads as a composition
root. It should call constructors, not sixteen classes that call constructors:

```ts
build(): GovernanceService {
  const database = this.options.database;                 // PrismaClient, not object
  const routingPolicies = DefaultGovernanceRoutingPolicyService.create({
    repository: PrismaRoutingPolicyRepository.create(database),
  });
  const departments = DepartmentService.create({
    repository: PrismaDepartmentRepository.create(database),
  });
  const activity = PrismaIngestionSourceActivityRepository.create(
    database,
    this.options.activityClickhouse,
  );
  …
  return DefaultGovernanceService.create({ routingPolicies, departments, activity, … });
}
```

Deleted: 16 of the 17 `postgres.*.adapter.ts` files (~496 lines). The
installation adapter grows by ~80 and loses two `.build()` hops per service.
`static create(database: PrismaClient)` replaces `object` + `as PrismaClient` at
all 13 repositories.

### The errors — say the status once

```ts
export class RoutingPolicyNotFoundError extends NotFoundError {
  constructor(routingPolicyId: string) {
    super("routing_policy_not_found", "That routing policy no longer exists", {
      meta: { routingPolicyId },
    });
  }
}
```

The seven translator classes in `app/governance.app.ts:69-176` collapse into the
contract classes they translate, `asHandledRoutingPolicyError` (`:596-607`)
goes, `mapTemplateError` (`transport/api-rest/governance.api.ts:147-188`) goes,
and the `instanceof` ladder in
`platform/app/src/server/api/routers/governance/departments.ts:158-167` goes.
Each new code needs an entry in
`platform/app/src/features/errors/logic/codes.ts` and
`presentation.ts` in the same commit.

## 4. Keep list

- **The 10 puller adapters** (`adapters/{anthropic-admin,openai-admin,openai-compliance,claude-compliance,copilot-studio,copilot-studio-dataverse,databricks-genie,http-poller,s3-puller,poller-cursor}.adapter.ts`,
  ~7,900 lines). One file per source over an open set, registered by name at
  `packages/enterprise/composition/api/src/governance/ingestion-pull-worker.adapter.ts:325-332`.
  A new vendor touches nothing else. Correct as it is — including
  `databricks-genie-puller.adapter.ts` at 3,249 lines, whose only complaint is
  length on a hot correctness path.
- **The two trace mappers** (`genie-trace-mapper`, `copilot-studio-trace-mapper`).
  Modules of pure functions with **no collaborators** — R2's target is a module
  whose functions all re-pass the same two or three dependencies, which these do
  not. A class would add a constructor and nothing else.
- **~48 of the 64 ports.** This is the load-bearing correction to the "33 port
  files" headline: nearly every port here is a genuine cross-package inversion,
  implemented in `packages/enterprise/composition/api/src/governance/` so the
  feature never reaches the app. Nineteen of the feature's 31 production
  consumers _are_ that adapter package. `GovernanceHttpPort` has 11
  implementations, `GovernanceDiagnosticsPort` 10, `GovernanceEncryptionPort` 6,
  `TraceAlertTriggerPort` 4 (two of them in `platform/app`). None of these is a
  seam to nowhere.
- **`app/governance.app.ts`.** Required by the layout, and it earns it: it
  resolves the project→organization hop the REST family did seven times inline
  (`:533-535`), owns the `svc_<projectId>` attribution rule (`:587-589`), the
  organization-membership gate (`:538-548`), the
  `virtualKeys:viewOtherPersonal` decision (`:555-577`), and the three-read
  fan-out at `:467-471`. Only 3 of its 17 methods
  (`listRoutingPolicies:476`, `getRoutingPolicy:481`, `deleteRoutingPolicy:527`)
  are pure pass-through.
- **The optional ClickHouse dependencies.** `personalUsageReader`,
  `ocsfEvents`, `setupActivity` and `quarantineTraceActivity` are optional
  because `platform/app/src/server/app-layer/presets.ts:1967-1984` gates every
  one of them on `clickhouseEnabled`. A self-hosted deploy without ClickHouse
  genuinely does not supply them. This is **not** an R5 violation, and the
  degradations at `services/personal-usage.service.ts:36` (empty summary) and
  `services/spend-spike-anomaly-evaluator.service.ts:113-121` (`skip_no_data`)
  are the right shape. `services/ocsf-export.service.ts:33` and
  `services/quarantine-fill.service.ts:43-47` throw instead of degrading, which
  is a smaller, separate question — leave them.
- **`intents/`, `processes/`, `projections/`, `subscribers/`** (1,424 lines,
  13 files). Event-sourcing machinery with real bodies; one same-name delegation
  across the lot (`intents/governance-event-delivery.intent.ts`).
- **R1 is clean.** No service in this feature holds a `PrismaClient`,
  `Prisma.TransactionClient` or a ClickHouse client, and no service issues raw
  SQL or opens a transaction. `grep -rn 'PrismaClient\|\$transaction\|\$queryRaw' services/`
  returns nothing. The datastore stops at the repository, which is the point of
  the rule.
- **`web/` (17 files, 2,757 lines) and `contract/` apart from
  `governance.service.ts`.** No findings.

## 5. Cost and order

Seven commits, smallest risk first, each leaving the suite green.

1. **Delete the wrapper tier** — `governance-{activity,ai-tools,department}.service.ts`
   and `ingestion-source-activity.service.ts`. The four operations services take
   the real collaborators directly. −336 lines, mechanical, no behaviour.
   Clears 42 of the 49 `no-same-name-delegation-ts` hits.
2. **Delete the operations tier** — the four `*-operations.service.ts` files.
   `DefaultGovernanceService` holds the 14 collaborators. −473 lines. Rename
   nothing; the 99 method names are the contract.
3. **Fix P2** — compose `GovernanceTraceIngestionPort` in
   `ingestion-pull-worker.adapter.ts`, or delete `routeConversations`,
   `CONVERSATION_ROUTING`, both mappers' `map` entries and the
   `trace-destination-field` UI. This is a product decision, not a cleanup one;
   it must not be quietly deleted while the UI still offers it. Smallest honest
   step meanwhile: make `traceIngestion` required so the gap is a compile error.
4. **Delete 16 `postgres.*.adapter.ts` wiring classes**; inline into
   `postgres.governance-installation.adapter.ts`. Type `database` as
   `PrismaClient` at all 13 repositories and drop the `as PrismaClient` casts.
   −~420 lines net. Touches two external files
   (`index.ts:65-66` and one integration test).
5. **Move 13 `*Repository` abstracts** from `ports/*.port.ts` to
   `repositories/*.repository.ts`; rename `DepartmentRepository`'s verbs to
   `findAll` / `tryFindById` / `findAssignments`. Removes four entries from
   `port-module-baseline.json`. Pure moves; the class names do not change, so
   `extends` sites only need their import path updated.
6. **Errors → `HandledError`** — 9 contract classes gain codes; delete the 7
   translator classes in `governance.app.ts`, `asHandledRoutingPolicyError`,
   `mapTemplateError`, and the `departments.ts` ladder. Add each code to
   `features/errors/logic/codes.ts` and `presentation.ts`. Fixes the
   `getRoutingPolicy` "unknown error". Biggest customer-visible win.
7. **Comments and stragglers** — the Databricks cost narrative and the Genie
   puller's design notes to `adrs/`; `conversation-trace-assembly.adapter.ts` to
   `utils/`; delete the re-export at `genie-trace-mapper.adapter.ts:62`; export
   `PostgresGovernanceOcsfExportAdapter` from `index.ts` (or change the test's
   import); fix the two rotted spec paths.

Deferred, and deliberately not in this list: splitting the 99-signature
`GovernanceService` into four. It is the right end state — `coding-agent.ts`
uses one method of ninety-nine — but it moves nine external modules and should
follow the layer collapse, not lead it.

## 6. Blast radius

**`@langwatch/enterprise-governance-server`** — 49 files import it, 31 outside
tests. Nineteen of those are
`packages/enterprise/composition/api/src/governance/*`, the adapter package that
implements the ports. The rest: `platform/app/src/server/app-layer/` (3),
`platform/app/src/server/workers/startWorkers.ts`,
`platform/app/src/server/event-sourcing/registration/pipelineRegistry.ts`,
`platform/app/src/server/api/routers/governance/`,
`packages/enterprise/composition/worker/src/governance/`,
`packages/enterprise/composition/api/src/trpc/`, and two scripts.

124 distinct symbols are imported. The heaviest are the ports
(`GovernanceHttpPort`, `GovernanceDiagnosticsPort`, `GovernanceEncryptionPort`,
`IngestionPull*Port`, `TraceAlert*Port`, `PulledUsage*Port`), the pullers
(`AnthropicAdminPuller`, `OpenAiAdminPuller`, `DatabricksGeniePuller`,
`CopilotStudioDataversePuller`, `HttpPollingPullerAdapter`,
`S3PollingPullerAdapter`), the processes (`GatewayDebitProcess`,
`IngestionPullProcess`, `PulledUsageLedgerProcess`,
`GovernanceEventDeliveryProcess`), the transports (`GovernanceApp`,
`PersonalVirtualKeyTrpcApi`, `RoutingPolicyTrpcApi`), and
`PostgresGovernanceInstallationAdapter` + `GovernanceInstallationOptions`.

Of the eight files this review proposes deleting, **none is exported from
`index.ts`** — the facade, operations and wrapper services are already private
to the package. Commits 1 and 2 have a blast radius of zero outside the feature.

**`@langwatch/enterprise-governance-contract`** — 36 files outside the feature.
Nine hold `GovernanceService` itself: `composition/api/src/governance/runtime.ts`,
`features/scim/server/src/{adapters/scim.adapter.ts,services/scim.service.ts,services/scim-cost-center.service.ts}`,
`platform/app/src/runtime/app/features/coding-agent.ts`,
`platform/app/src/server/api/routers/governance/ingestionSources.ts`,
`platform/app/src/server/app-layer/dependencies.ts`,
`platform/app/src/server/routes/auth-cli.ts`,
`platform/app/src/server/routes/otel.ts`. These are what commit 6 (error codes)
and the deferred interface split have to move.

**`@langwatch/enterprise-governance-web`** — 20 files, all UI. Untouched by
everything above.

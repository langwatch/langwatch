# gateway — cleanup review

Reference standard: [`feature-cleanup-review.md`](../../best_practices/feature-cleanup-review.md).
Worked example: [`dataset.md`](./dataset.md).

The TypeScript side is the **control plane**. The data plane is Go
(`services/aigateway/`) and is out of scope; where the two publish the same
contract it is noted, never changed.

## 1. What is there now

**16,278 lines across 79 non-test server files**, plus a 1,513-line contract
(10 files) and a 376-line web package (8 files). **3,287 of the 16,278 server
lines (20.2%) are comment.**

| Directory | Files | Lines |
|---|---:|---:|
| `transport/api-rest` | 1 | 2,088 |
| `transport/api-trpc` | 6 | 1,285 |
| `app` | 1 | 858 |
| `services` | 8 | 1,445 |
| `ports` | 9 | 610 |
| `adapters` | 29 | 2,560 |
| `repositories` (abstract) | 3 | 173 |
| `repositories/prisma` | 10 | 2,976 |
| `repositories/clickhouse` | 4 | 2,918 |
| `intents` · `processes` · `projections` · `stores` | 6 | 1,225 |
| `index.ts` · `testing.ts` | 2 | 140 |

The budget/cache-rule/guardrail path, transport to datastore:

```
  @langwatch/gateway-contract
    gateway.service.ts        abstract GatewayService              28 signatures
        │
  server/src
    app/gateway.app.ts        GatewayAppDependencies (interface)   ~40 members
                              GatewayApp             (class)       37 members
                                                                   ← 31 one-line pass-throughs
        │                       GatewayCacheRuleOperations  (6)  ─┐  a THIRD
        │                       GatewayGuardrailOperations  (5)  ─┘  vocabulary
        │
    services/gateway.service.ts        GatewayService     30 methods
        │                                                 ← 11 delegate to the two below
        ├── services/gateway-cache-rule.service.ts   GatewayCacheRulePersistence   7 methods (5 pass-through)
        └── services/gateway-guardrail.service.ts    GatewayGuardrailCatalogue     6 methods (3 pass-through)
                │
    repositories/gateway-budget.repository.ts       abstract  17 signatures
    repositories/gateway-cache-rule.repository.ts   abstract   7 signatures
    repositories/gateway-guardrail.repository.ts    abstract   6 signatures
                │
    repositories/prisma/prisma.gateway-budget.repository.ts     1,338 lines
    repositories/prisma/prisma.gateway-cache-rule.repository.ts   258 lines
    repositories/prisma/prisma.gateway-guardrail.repository.ts    111 lines
```

Wired at `platform/app/src/server/app-layer/presets.ts:1923-1931` through
`adapters/gateway.adapter.ts` — `PrismaGatewayAdapter.create({…}).build()`,
a 59-line class whose only instance method is `build() { return this.service }`.

The spend path is shallower but ends the same way:

```
    transport → GatewayApp.spendEvents (getter)
              → services/gateway-spend-events.service.ts  GatewaySpendEventsService  4 methods
                                                          ← 4 of 4 are pass-throughs
              → ports/gateway-spend-events.port.ts        GatewaySpendEventsPort     1 impl
              → adapters/gateway-spend-events-clickhouse.adapter.ts  (10 lines, `new X(r)`)
              → repositories/clickhouse/clickhouse.gateway-spend-events.repository.ts  972 lines
```

**Six layers between a tRPC procedure and a ClickHouse query. Four add no
behaviour.**

Detectors agree. `no-same-name-delegation-ts` fires 8 times inside the feature,
`no-identity-function-ts` twice, and `packages/architecture-lint` reports 10
policy hits — every one of which is reproduced below with its own evidence.

## 2. Problems

### P1 — Two services hold a database client (breaks R1)

- `services/gateway-usage.service.ts:82` — `private readonly prisma: PrismaClient`,
  used at `:287` (`this.prisma.virtualKey.findMany`) and `:296`
  (`this.prisma.project.findMany`).
- `services/gateway-end-user-caps.service.ts:13` — `prisma: PrismaClient` as a
  parameter, used at `:20` (`gatewayBudget.findMany`) and `:32`
  (`gatewayBudgetBucketBoundary.findMany`).

Confirmed independently by `[prisma-containment]` on both files. These are two
of only ten such files repo-wide.

The two reads are small and identical in shape — "the virtual keys named by
these ids" and "every project id in this organization". Neither needs Prisma in
a service; both belong on a repository this feature already has a place for.

### P2 — `GatewayUsageService` takes a dependency nothing reads (breaks R5)

`services/gateway-usage.service.ts:83` declares `chRepo?: GatewayBudgetSpendPort`
and `:98` passes it into the constructor. **`this.chRepo` is never read.** The
only other mentions in the repo are the composition
(`platform/app/src/server/app-layer/presets.ts:843`, which passes the live
ClickHouse ledger) and a test passing `undefined`
(`services/__tests__/gateway-usage.service.unit.test.ts:89`).

The doc comment at `:87-92` explains at length why the two repos are "required
keys with optional values". It is true of `spendRepo` and vacuous for `chRepo`,
which no code path can observe.

### P3 — Three transports reach past the application (breaks R1)

| Site | What it imports |
|---|---|
| `transport/api-trpc/gateway-budget.api.ts:33` | `providerLabelFor` from `../../repositories/prisma/prisma.gateway-provider-label.repository` |
| `transport/api-trpc/gateway-cache-rule.api.ts:13` | `GatewayCacheRule` from `@langwatch/prisma-client/generated` |
| `transport/api-trpc/gateway-guardrail.api.ts:19` | `GatewayGuardrailDirection`, `GatewayGuardrailFailureMode` from the same |

All three are reported by `[api-transport-import-boundary]`; the latter two also
by `[prisma-containment]`.

The Prisma imports are type-only, so nothing at runtime breaks — but they set
the transports' wire contract equal to the database row. The feature already has
`GatewayCacheRuleResource` and `GatewayGuardrailResource` in the contract for
exactly this, and the services return them. `app/gateway.app.ts:46-51` makes the
leak structural: `GatewayCacheRuleOperations` and `GatewayGuardrailOperations`
are declared over Prisma row types, so the app facade's own signature is what
forces the transports to import them.

### P4 — Five of nine ports have one implementation beside them; one has none (breaks R4)

| Port | Implementations | Verdict |
|---|---|---|
| `GatewayOpenAdmissionsPort` (`ports/gateway-open-admissions.port.ts:44`) | 2 — `ClickHouseGatewayOpenAdmissionsRepository` (one instance) and `ClickHouseGatewayOpenAdmissionsAdapter` (fan-out across instances, `adapters/clickhouse.gateway-open-admissions.adapter.ts:36`) | **Keep** |
| `GatewayVirtualKeysPort` (`ports/gateway-virtual-key.port.ts:78`) | 1 in-package, but consumed across the package boundary by `platform/app/src/server/gateway/virtualKey.service.ts:232` | **Keep** |
| `GatewayBudgetSpendPort` (`ports/gateway-budget-spend.port.ts:106`) | 1 — `clickhouse.gateway-budget.repository.ts:518` | Delete |
| `GatewayVirtualKeySpendPort` (`:34`) | 1 — `clickhouse.gateway-virtual-key-spend.repository.ts:40` | Delete |
| `GatewaySpendEventsPort` (`:13`) | 1 — `clickhouse.gateway-spend-events.repository.ts:380` | Delete |
| `GatewayAuditPort` (`gateway-audit.port.ts:46`) | 1 — `prisma.gateway-audit.repository.ts:60` | Delete |
| `GatewayChangeEventsPort` (`:41`) | 1 — `prisma.gateway-change-event.repository.ts:16` | Delete |
| `GatewaySettlementPolicyPort` (`:1`, 3 lines) | 1 — `FixedGatewaySettlementPolicy`, 21 lines to hold one integer | Delete |
| `GatewayClickHousePort` (`ports/gateway-clickhouse.port.ts:33`) | **0** | Delete |

`GatewayClickHousePort` is dead. A repo-wide grep for the identifier returns
exactly one hit: its own declaration. The seam that is actually used is the
function type `GatewayClickHouseResolver` on line 28 of the same file, held by
all three ClickHouse repositories. The abstract class exists to satisfy
`strict-port-module`'s requirement that a `*.port.ts` export a class ending in
`Port` — the rule is being paid, not used.

### P5 — Three adapters are a `new` expression each (breaks R3)

```ts
// adapters/gateway-budget-ledger.adapter.ts:6-9
export class GatewayBudgetLedgerAdapter {
  static create(resolveClient: GatewayClickHouseResolver): GatewayBudgetSpendPort {
    return new GatewayBudgetClickHouseRepository(resolveClient);
  }
}
```

`adapters/gateway-spend-events-clickhouse.adapter.ts:6-9` and
`adapters/gateway-virtual-key-spend.adapter.ts:6-9` are the same file with two
words changed. Each is 10 lines to widen a constructor to the port from P4. When
the port goes, so does the reason for the widening.

`adapters/realtime-session-reconciliation.adapter.ts` (11 lines) is worse: it is
a pure re-export barrel, which the repo forbids outright, and its **only**
importer is its own test
(`adapters/__tests__/realtime-session-reconciliation.worker.unit.test.ts:10`).
Production reaches the same symbols through
`platform/app/src/runtime/worker/gateway-realtime-session-reconciliation.adapter.ts`
(`platform/app/src/server/workers/startWorkers.ts:175`). The package.json
subpath `./realtime-session-reconciliation` points at it.

### P6 — Four service classes are layers, not components (breaks R3)

**`GatewaySpendEventsService`** (`services/gateway-spend-events.service.ts`, 74
lines) — 4 methods, **4 pass-throughs**, three of them renamed on the way past:

| Method | Body |
|---|---|
| `getSpendEventsPage` `:20` | `return this.repository.readSpendEventsPage(input)` |
| `getSpendSummaries` `:31` | `return this.repository.readSpendSummaries(input)` |
| `walkSpendEvents` `:45` | `return this.repository.walkSpendEvents(input)` |
| `getEndUserSpend` `:56` | `return this.repository.readEndUserSpend(input)` |

**`GatewayCacheRulePersistence`** (`services/gateway-cache-rule.service.ts`) — 7
methods over a repository declaring the same 7 names
(`repositories/gateway-cache-rule.repository.ts:10-20`). Five are literal
delegations (`:22`, `:26`, `:34`, `:38`, `:60`); `update` and `archive` add a
not-found check. `layer-class` already flagged it and it was waived, not fixed:
`packages/architecture-lint/src/overengineering-baseline.json:13`.

**`GatewayGuardrailCatalogue`** (`services/gateway-guardrail.service.ts`) — same
shape, 3 of 6 delegating (`:47`, `:51`, `:55`).

**`GatewayService`** (`services/gateway.service.ts`) — 30 methods, of which
**11 exist only to rename a call**: `cacheRuleList` → `cacheRules.list` (`:240`),
`cacheRuleListPage` (`:244`), `tryCacheRuleGet` (`:252`), `cacheRuleCreate`
(`:256`), `cacheRuleUpdate` (`:260`), `cacheRuleArchive` (`:264`),
`guardrailList` (`:268`), `tryGuardrailGet` (`:272`), `guardrailCreate` (`:276`),
`guardrailUpdate` (`:280`), `guardrailArchive` (`:284`). Four more delegate
straight to the repository (`:193`, `:197`, `:201`, `:205`).

And **`PrismaGatewayAdapter`** (`adapters/gateway.adapter.ts`, 59 lines) wraps
the result so the caller can unwrap it one line later:

```ts
build(): GatewayService { return this.service; }              // :56
```

`presets.ts:1923-1931` calls `.create({…}).build()` in one expression.

### P7 — `GatewayApp` restates its own dependency interface 31 times (breaks R8)

`app/gateway.app.ts:257-476` declares `GatewayAppDependencies` with ~40 members.
`:478-858` declares `GatewayApp` with **37 members, 31 of which are one-line
pass-throughs** — 12 getters (`:491-537`) and 19 methods (`:541-688`), each
returning `this.dependencies.<sameName>(…)`.

Six members hold behaviour and justify the class: `toVirtualKeyCamelDto` (`:655`),
`toVirtualKeySnakeDto` (`:662`), and the four write pre-flights
`authorizeVirtualKeyScopeSelection` (`:708`), `authorizeVirtualKeyCreate`
(`:738`), `authorizeVirtualKeyUpdate` (`:781`), `authorizeVirtualKeyOperation`
(`:841`). Those are real, they are the reason the facade exists, and the file's
header explains honestly what they replaced.

The other 31 are the signature written twice. Renaming one argument means editing
two places in the same file, and a reader tracing a call opens the class, the
interface, and then `presets.ts` to find the closure that actually runs.

### P8 — "List the cache rules" is declared five times in four vocabularies (breaks R8)

| Declaration | Returns |
|---|---|
| `repositories/gateway-cache-rule.repository.ts:10` `list` | `GatewayCacheRuleResource[]` |
| `services/gateway-cache-rule.service.ts:22` `list` | `GatewayCacheRuleResource[]` |
| `contract/src/gateway.service.ts:77` `cacheRuleList` | `GatewayCacheRuleResource[]` |
| `services/gateway.service.ts:240` `cacheRuleList` | `GatewayCacheRuleResource[]` |
| `app/gateway.app.ts:209` `GatewayCacheRuleOperations.list` | **`GatewayCacheRule`** (Prisma row) |

The last one returns a different type for the same operation, which is what
drags `@langwatch/prisma-client/generated` into two transports (P3). Guardrails
have the identical five-way spread (`gateway-guardrail.repository.ts:10`,
`gateway-guardrail.service.ts:47`, `contract/gateway.service.ts:91`,
`services/gateway.service.ts:268`, `app/gateway.app.ts:166`).

Two implementations of each are live in one process at once: the feature's
`GatewayCacheRulePersistence`, reached through `budgetDecisions`
(`presets.ts:1923`), and `platform/app/src/server/gateway/cacheRule.service.ts`,
reached through `cacheRules` (`presets.ts:858`).

`index.ts` compounds it. `GatewayBudgetSpendPort` is exported three times —
`:6` named, `:7` `export *`, `:71` `export type *` — over the same module.
`export * from "./adapters/gateway-spend-events.adapter"` appears twice
verbatim, at `:18` and `:63`. `gateway-period.adapter` is exported named at `:22`
and starred at `:50`; `gateway-wire-money.adapter` starred at `:65` and named at
`:69`.

### P9 — Three functions return their argument (breaks R3)

- `adapters/gateway-resource-metadata.adapter.ts:79-83` — `metadataPatch` is
  `return next;`, under a 7-line doc comment. Flagged by
  `no-identity-function-ts`. One external caller,
  `platform/app/src/server/gateway/virtualKey.service.ts:367`, where
  `metadata: metadataPatch(input.metadata)` means `metadata: input.metadata`.
- `adapters/gateway-resource-metadata.adapter.ts:92-96` — `externalIdPatch` is
  `next === undefined ? undefined : (next ?? null)`, which for
  `string | null | undefined` is the identity on all three cases. The detector
  misses it because the body is an expression; its only caller is
  `identityPatchData` on line 112 of the same file.
- `repositories/prisma/prisma.gateway-budget.repository.ts:1304-1308` —
  `scopeKindToEnum(kind: BudgetScope["kind"])` returns `kind`, annotated as the
  seven-member union `BudgetScope["kind"]` already is. Flagged by
  `no-identity-function-ts`.

`identityPatchData` (`:106`) is real — two call sites, it omits absent keys —
but its body is two calls to the two functions above.

### P10 — The REST family is one 1,349-line function, and it still scrapes error codes out of message strings (breaks R2, R6)

`transport/api-rest/gateway-platform.api.ts:701-2049` is a single function,
`createGatewayPlatformRestApp`, registering **24 routes** — averaging 56 lines
each — across four resource families marked only by comment banners (`:712`
virtual keys, `:1285` provider bindings, `:1341` budgets, `:1808` cache rules).
It is 2,088 lines, the largest file in the feature by 586 lines. The first
registration begins at `:714` and the last at `:2008`, so the reader scrolls
1,294 lines to see whether a family has an endpoint.

R6 is mostly **healthy** here and the residue is small — see the Keep list. What
remains is at `:585-644`:

```ts
const TRPC_HTTP_STATUS: Record<string, ContentfulStatusCode> = {   // :585
  BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  CONFLICT: 409, PRECONDITION_FAILED: 412, TOO_MANY_REQUESTS: 429,
};
…
const codeMatch = /^([a-z0-9_]+):/.exec(error.message);                // :639
return errorResponse(c, { status, code: codeMatch?.[1] ?? …, message: error.message });
```

The stable machine code travels to the customer as a **prefix on the message**.
The comment at `:613-618` states the convention outright, and `:621-625`
concedes the `HandledError` branch above it "read[s] them directly instead of
scraping a prefix off the message, which is what the TRPCError branch below has
to do."

Seven sites still produce such a message. Only one is in this package —
`gateway-platform.api.ts:687`, `` message: `validation_error: ${…}` `` — the
other six are in `platform/app/src/server/gateway/`
(`virtualKey.authz.ts:175,196,220`, `virtualKey.service.ts:1132,1186`).

### P11 — Comments narrate superseded designs, and one names a file that does not exist (breaks R7)

20.2% of the server tree is comment. Most of it is good (see Keep list). The
part that is not is **past-tense design history**, which R7 sends to an ADR:

- `app/gateway.app.ts:5-19` — "Before it there were SEVEN bags… written out
  thirteen times between them."
- `services/gateway-usage.service.ts:8-13` — "It used to come from
  `gateway_budget_ledger_events`…"
- `processes/gateway-spend-settlement.process.ts:60` — "It used to be one
  instance per gateway request…"
- `index.ts:76`, `app/gateway.app.ts:25`, `:652`,
  `adapters/gateway-wire-money.adapter.ts:100`,
  `transport/api-rest/gateway-platform.api.ts:1386` — same register.

And one comment is simply false. `adapters/gateway-audit-serializer.adapter.ts:7`
says "Caught via unit test — see virtualKey.service.unit.test.ts". No file of
that name exists anywhere in the repo. It is 15 lines of comment over 13 lines
of code.

### P12 — File names promise a class the module does not export (breaks R2)

- `services/gateway-end-user-caps.service.ts` exports no class at all — one free
  function, `applicableEndUserCaps` (`:12`), taking four collaborators.
- `services/gateway-cache-rule.service.ts` exports `GatewayCacheRulePersistence`.
- `services/gateway-guardrail.service.ts` exports `GatewayGuardrailCatalogue`.
- `services/gateway-realtime-session-reconciliation.service.ts` exports
  `GatewayRealtimeSessionReconciliationWorker`.
- Its test lives at `repositories/__tests__/gateway-cache-rule.service.unit.test.ts`
  — a service test filed under `repositories/`.

Of the 29 files in `adapters/`, **21 export no class** — they are pure function
and constant modules (`gateway-wire-money`, `gateway-window`, `gateway-period`,
`gateway-spend-filters`, `gateway-wire-pagination`, `gateway-bucket-scope`, …).
Under R2 those are shared pure utilities and belong in `utils/`. Calling them
adapters is what makes `adapters/` the second-largest directory in the feature.

### Cross-language note — three money units at one seam

Not a defect to fix here, recorded because it constrains any change to the
money helpers.

`services/gateway-end-user-caps.service.ts:64-77` returns
`Array<Record<string, unknown>>` — an **untyped** map whose keys (`budget_id`,
`anchor_id`, `window`, `on_breach`, `limit_usd`, `spent_usd`,
`period_started_at`) are a wire contract. The Go data plane types its half of
the budget wire precisely, in **micro-USD integers**:
`services/aigateway/domain/bundle.go:570-574` and
`services/aigateway/adapters/controlplane/config_wire.go:186-190`
(`LimitMicroUSD`, `SpentMicroUSD int64`). The TS REST surface publishes decimal
**strings** derived from **nano**-USD integers
(`adapters/gateway-wire-money.adapter.ts:28-31`). Three representations of one
quantity across two languages, and the producer of one of them is `unknown`.

Also worth knowing before anyone edits the materialiser:
`services/aigateway/adapters/controlplane/config_wire.go:200-201` pins itself to
`platform/app/src/server/gateway/config.materialiser.ts:121-128` **by line
number**, from Go. That comment will rot.

## 3. What it should look like

```
contract/src/
  gateway.service.ts        ~55   split: GatewayBudgetService (17) stays;
                                  cacheRule*/guardrail* (11) move to
                                  GatewayCacheRuleService / GatewayGuardrailService
  gateway.errors.ts         470   unchanged — 15 HandledErrors, all correct
  …

server/src/
  app/gateway.app.ts               ~340   the one facade both transports call.
                                          Holds the 6 members that hold rules;
                                          exposes collaborators as fields, not
                                          31 restated signatures. Declared over
                                          contract resource types, never Prisma rows.
  services/
    gateway-budget.service.ts      ~300   was gateway.service.ts, minus the 11 renames
    gateway-cache-rule.service.ts   ~40   update + archive only (the two with rules);
                                          the other 5 collapse into the repository
    gateway-guardrail.service.ts   ~110   create/update/archive; list/tryGet collapse
    gateway-usage.service.ts       ~330   takes GatewayUsageRepository, not PrismaClient
    gateway-end-user-caps.service.ts ~85  a class; takes the same repository
    gateway-realtime-session-reconciliation.service.ts  232  unchanged
    gateway-budget-scope-reach.service.ts               100  unchanged
  repositories/
    gateway-budget.repository.ts            abstract, 17 signatures — unchanged
    gateway-cache-rule.repository.ts        abstract — unchanged
    gateway-guardrail.repository.ts         abstract — unchanged
    gateway-usage.repository.ts       ~30   NEW abstract: the two Prisma reads
                                            P1 pulls out of the service layer
    prisma/prisma.gateway-usage.repository.ts  ~45   NEW
    prisma/…                                unchanged
    clickhouse/…                            unchanged, now referenced directly
  ports/
    gateway-open-admissions.port.ts   46   2 implementations — kept
    gateway-virtual-key.port.ts      151   cross-package inversion — kept
  adapters/
    clickhouse.gateway-open-admissions.adapter.ts   83   real fan-out — kept
    gateway-virtual-key-dto.adapter.ts             229   real projection
    gateway-budget-dto.adapter.ts                  123   real projection
    virtual-key-crypto.adapter.ts                  118   real
    eventing.gateway-spend.adapter.ts              166   real
    gateway-realtime-session-reconciliation.adapter.ts  52  real
  utils/                                    the 21 class-free modules move here
    gateway-wire-money.ts            146
    gateway-window.ts                252
    gateway-period.ts                191
    gateway-spend-filters.ts         355
    gateway-spend-grouping.ts        169
    gateway-wire-pagination.ts        89
    gateway-bucket-scope.ts           55
    gateway-resource-metadata.ts     ~95   minus the two identity functions
    …
  transport/
    api-rest/
      gateway-platform.api.ts        ~420   composition + shared helpers
      gateway-virtual-key.routes.ts  ~600
      gateway-budget.routes.ts       ~520
      gateway-cache-rule.routes.ts   ~260
      gateway-provider.routes.ts      ~90
    api-trpc/…                              unchanged, minus the 3 boundary imports
  intents/ processes/ projections/ stores/  unchanged
```

**Deleted:** `ports/gateway-clickhouse.port.ts` (the class; the two types stay
as `utils/gateway-clickhouse-client.ts`), `ports/gateway-budget-spend.port.ts`,
`ports/gateway-virtual-key-spend.port.ts`, `ports/gateway-spend-events.port.ts`,
`ports/gateway-audit.port.ts`, `ports/gateway-change-events.port.ts`,
`ports/gateway-settlement-policy.port.ts`,
`adapters/gateway-budget-ledger.adapter.ts`,
`adapters/gateway-spend-events-clickhouse.adapter.ts`,
`adapters/gateway-virtual-key-spend.adapter.ts`,
`adapters/realtime-session-reconciliation.adapter.ts`,
`adapters/fixed-gateway-settlement.adapter.ts`,
`adapters/gateway.adapter.ts`, `services/gateway-spend-events.service.ts`.

**≈68 files, ≈13,900 server lines. Four layers instead of six.**

### The usage repository — Prisma stops at the repository

```ts
// repositories/gateway-usage.repository.ts
export abstract class GatewayUsageRepository {
  /** Display name and prefix for the keys a page of spend rows names. */
  abstract findVirtualKeyLabels(
    virtualKeyIds: string[],
  ): Promise<Map<string, { name: string; displayPrefix: string }>>;

  /**
   * Every project of the organization: the tenant set gateway traces can land
   * in. A key's traces land in whichever project resolved as its trace
   * destination, which for org- and team-scoped keys is the governance
   * project — rarely the one the viewer has selected.
   */
  abstract findProjectIdsByOrganization(organizationId: string): Promise<string[]>;

  /** The attributed-user budget templates and their bucket boundaries. */
  abstract findAttributedUserBudgets(input: {
    organizationId: string;
    virtualKeyId?: string;
  }): Promise<{ templates: GatewayBudgetRow[]; boundaries: BudgetBucketBoundaryRow[] }>;
}
```

```ts
export class GatewayUsageService {
  private constructor(
    private readonly usage: GatewayUsageRepository,
    private readonly spend: GatewayVirtualKeySpendRepository | undefined,
  ) {}

  static create(options: {
    usage: GatewayUsageRepository;
    spend: GatewayVirtualKeySpendRepository | undefined;   // genuinely absent without ClickHouse
  }): GatewayUsageService {
    return new GatewayUsageService(options.usage, options.spend);
  }

  async spendByVirtualKey(…): Promise<Map<string, { spentUsd: string; requests: number }>>
  async summary(…): Promise<UsageSummary>
  async summaryForVirtualKey(…): Promise<VirtualKeyUsageSummary>
}
```

`PrismaClient` leaves the service layer. `chRepo` — the dependency nothing read
— disappears rather than being carried into the new signature. `spend` stays
optional, because a deployment without ClickHouse genuinely passes `undefined`
(`presets.ts:1932-1934`).

`applicableEndUserCaps` becomes `GatewayEndUserCapsService` over the same
repository, and gains the return type the Go side already has:

```ts
export type EndUserCap = Readonly<{
  budget_id: string; anchor_id: string;
  window: Lowercase<GatewayBudgetWindow>; on_breach: Lowercase<GatewayOnBreach>;
  limit_usd: string; spent_usd: string; period_started_at: string;
}>;
```

### The spend-events and cache-rule stacks — remove the middle

```ts
// before: transport → GatewayApp.spendEvents → GatewaySpendEventsService
//                   → GatewaySpendEventsPort → adapter → repository
// after:  transport → GatewayApp.spendEvents → GatewaySpendEventsRepository
```

`GatewaySpendEventsService`'s four methods rename what the repository already
names; the port has one implementation; the adapter is a `new` expression. The
repository's methods take the `read*` names it already uses, and `GatewayApp`
holds it directly. Three files and one indirection level go, and no behaviour
moves.

The same cut on cache rules leaves the two methods that hold a rule:

```ts
export class GatewayCacheRuleService {
  private constructor(private readonly rules: GatewayCacheRuleRepository) {}

  async update(input: UpdateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    const parsed = updateGatewayCacheRuleInputSchema.parse(input);
    if (!(await this.rules.tryGet(parsed.id, parsed.organizationId))) {
      throw new GatewayCacheRuleNotFoundError();
    }
    return this.rules.update(parsed);
  }

  async archive(input: ArchiveGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>
}
```

`list`, `listPage`, `tryGet`, `create` and `listEnabledForOrganization` are read
off `GatewayCacheRuleRepository` directly, and the `layer-class` baseline entry
at `overengineering-baseline.json:13` is deleted rather than carried.

### The application — hold collaborators, do not restate them

```ts
export class GatewayApp<TApplicableBudgets = unknown, TDirectBudget = unknown> {
  readonly virtualKeys: GatewayVirtualKeyOperations;
  readonly budgets: GatewayBudgetService;
  readonly cacheRules: GatewayCacheRuleService;      // contract types, not Prisma rows
  readonly guardrails: GatewayGuardrailService;      // contract types, not Prisma rows
  readonly usage: GatewayUsageService;
  readonly spendEvents: GatewaySpendEventsRepository | undefined;
  readonly directory: GatewayDirectory;              // the ~10 tenancy + lookup closures
  readonly visibility: GatewayVisibility;            // the 6 visibility closures
  readonly checks: GatewayAuthorizationChecks;       // the 6 assert* closures
  readonly projections: GatewayProjections;          // the DTO + budget closures

  // The six members that hold rules:
  async toVirtualKeyCamelDto(…)
  async toVirtualKeySnakeDto(…)
  async authorizeVirtualKeyScopeSelection(…)
  async authorizeVirtualKeyCreate(…)
  async authorizeVirtualKeyUpdate(…)
  async authorizeVirtualKeyOperation(…)
}
```

Four named groups replace ~28 loose members on `GatewayAppDependencies`, and 31
restatements become 10 fields. `presets.ts:867-1022` — 155 lines of inline
closures — groups the same way, so a reader looking for "how does this
deployment decide visibility" opens one object instead of scanning a flat
literal. Declaring `cacheRules` and `guardrails` over contract resource types is
what lets P3's two Prisma imports leave the transports.

## 4. Keep list

- **`gateway.errors.ts` and the whole error path.** All **15** classes in
  `contract/src/gateway.errors.ts` extend `HandledError`, every one with an
  explicit `httpStatus` and an explicit `fault` — including the two 5xx-adjacent
  ones that correctly declare `fault: "platform"` (`:158-164`, `:257-264`). Every
  code has a `presentation.ts` entry. There is **no** name-keyed status map and
  **no** `instanceof` ladder in any tRPC router. This is what R6 asks for, and it
  is the opposite of the dataset finding. Only the message-prefix residue in P10
  needs work.
- **`GatewayOpenAdmissionsPort`** — two real implementations, one per instance
  and one fanning out across every configured ClickHouse
  (`adapters/clickhouse.gateway-open-admissions.adapter.ts:47-82`, which settles
  per instance rather than fail-fast). Real polymorphism.
- **`GatewayVirtualKeysPort`** — one implementation, but consumed from another
  package (`platform/app/src/server/gateway/virtualKey.service.ts:232`, via the
  `./composition/gateway-virtual-keys` subpath). A genuine inversion.
- **`app/gateway.app.ts` as a facade.** The layout requires it and its four
  write pre-flights are real cross-service rules that both doors used to run
  separately. The class stays; the 31 restatements go.
- **`adapters/gateway-wire-money.adapter.ts`.** 84 comment lines over 51 code
  lines, and every one of them earns its place: this is exact-integer money
  arithmetic where the comments record the rounding rule, the reason the
  decimal string is scaled rather than the float, and the specific drift
  (`"0.000044999999999999996"`) the code exists to avoid. A hot correctness path
  inside its quality ceiling. It moves to `utils/` and is otherwise untouched.
- **The two big repositories.** `clickhouse.gateway-budget.repository.ts` (1,502
  lines) and `prisma.gateway-budget.repository.ts` (1,338) are large, but the bulk
  is SQL construction and row mapping with a real query-shape decomposition
  (`bucketQueryShape:318`, `rollupScopeFilter:436`, `sumRollupRowsForTarget:496`).
  Splitting them is a separate change with its own risk, and length is the only
  complaint.
- **`intents/`, `processes/`, `projections/`, `stores/`** — the event-sourced
  spend pipeline is correctly shaped: the fold is deterministic, the store maps,
  the process composes. Untouched.
- **The `web/` package** (376 lines, 8 files) — small, pure, no findings.
- **Anything under `platform/app/`.** `platform/app/src/server/gateway/` holds
  ~15 more non-test files that are morally this feature (`virtualKey.service.ts`,
  `guardrail.service.ts`, `cacheRule.service.ts`, `budgetOverview.service.ts`,
  `config.materialiser.ts`, …), and six of P10's seven message-prefix errors are
  there. Moving them is the branch's larger migration, not this cleanup.

## 5. Cost and order

Seven commits, smallest risk first, each leaving the suite green.

1. **Delete what nothing uses.** `GatewayClickHousePort`
   (`ports/gateway-clickhouse.port.ts:33-35`, zero references), the
   `GatewayUsageService.chRepo` parameter (`gateway-usage.service.ts:83,95,98`),
   the duplicate `index.ts` export lines (`:18`/`:63`, `:6`/`:7`/`:71`), and the
   `realtime-session-reconciliation.adapter.ts` re-export barrel plus its
   package.json subpath — retargeting its one test at the real module. Pure
   deletion, no call site changes.
2. **The three identity functions.** Inline `metadataPatch` and `externalIdPatch`
   into `identityPatchData` and into
   `platform/app/src/server/gateway/virtualKey.service.ts:367`; delete
   `scopeKindToEnum` (`prisma.gateway-budget.repository.ts:1304`). Clears both
   `no-identity-function-ts` hits.
3. **P1 — the usage repository.** Add `GatewayUsageRepository` and its Prisma
   implementation; move the three Prisma reads out of
   `gateway-usage.service.ts` and `gateway-end-user-caps.service.ts`; turn the
   latter into a class. Clears both `[prisma-containment]` service hits, which
   are two of the ten remaining repo-wide. Biggest correctness-of-layering win.
4. **P6 + P5 — collapse the spend-events stack and the three binding adapters.**
   Delete `GatewaySpendEventsService`, `GatewaySpendEventsPort`,
   `GatewayBudgetSpendPort`, `GatewayVirtualKeySpendPort` and the three 10-line
   adapters; hand the repositories to `GatewayApp` directly. Touches
   `presets.ts:1882-1934` and `apps/api/src/features/gateway/`.
5. **P8 + P3 — one vocabulary for cache rules and guardrails.** Redeclare
   `GatewayCacheRuleOperations` and `GatewayGuardrailOperations` over contract
   resource types, shrink the two persistence classes to the methods that hold
   rules, drop the 11 renaming delegations from `services/gateway.service.ts` and
   the matching contract signatures. Clears all three
   `[api-transport-import-boundary]` hits, both transport `[prisma-containment]`
   hits, and the `layer-class` baseline entry.
6. **P7 — group `GatewayAppDependencies`.** Four named collaborator groups; the
   31 pass-throughs become 10 fields. Delete `PrismaGatewayAdapter` and inline
   its composition into `presets.ts`. Mechanical but wide — 79 external files
   import this package, though only a handful name the affected members.
7. **P10 + P11 — split the REST family and finish the error contract.** Four
   route modules under `transport/api-rest/`; replace the seven
   `snake_code: detail` messages with `HandledError`s carrying the code, then
   delete `TRPC_HTTP_STATUS` and the message regex
   (`gateway-platform.api.ts:585-644`). Move the six superseded-design comment
   blocks to an ADR and delete the false test reference at
   `gateway-audit-serializer.adapter.ts:7`. Six of the seven message sites are in
   `platform/app/`, so this commit spans the boundary and should land last.

## 6. Blast radius

**79 files outside the feature import `@langwatch/gateway-server`**, and they
name **123 distinct symbols** from the main entry. That is far broader than
dataset's 15 files / 11 symbols, and it is the single biggest constraint on this
cleanup.

By entry point:

| Entry | Importing files |
|---|---:|
| `@langwatch/gateway-server` (main) | 151 import sites |
| `./composition/gateway-audit` | 5 |
| `./composition/gateway-provider-labels` | 3 |
| `./composition/gateway-change-events` | 3 |
| `./testing` | 2 |
| `./realtime-session-reconciliation` | 2 |
| `./composition/gateway-virtual-keys` | 1 |

The four `./composition/*` subpaths in `server/package.json:31-46` point
**directly at Prisma repository files**, so 12 external files hold repositories
rather than services — the same R1 boundary as P3, one level up.

Of the 123 main-entry symbols, the ones this plan moves or deletes:

- **Ports removed (commit 4/5):** `GatewayBudgetSpendPort`,
  `GatewayVirtualKeySpendPort`, `GatewaySpendEventsPort`, `GatewayAuditPort`,
  `GatewayChangeEventsPort`, `GatewaySettlementPolicyPort`,
  `GatewayClickHouseClient`, `GatewayClickHouseResolver` — consumers switch to
  the concrete repository types.
- **Adapters removed:** `GatewayBudgetLedgerAdapter`,
  `GatewaySpendEventsClickHouseAdapter`, `GatewayVirtualKeySpendAdapter`,
  `FixedGatewaySettlementPolicy`, `PrismaGatewayAdapter` — five construction
  sites, all in `presets.ts` and `apps/api/src/features/gateway/`.
- **Service removed:** `GatewaySpendEventsService` — replaced by
  `GatewaySpendEventsRepository`, which consumers already import.
- **Helpers moved to `utils/`:** `usdToNanoUsd`, `nanoUsdToDecimalString`,
  `USD_DISPLAY_STRING_FORMAT`, `startOfCurrentMonthUTC`, `nextResetAt`,
  `nextAnchoredResetAt`, `anchoredPeriodStart`, `effectiveBudgetPeriod`,
  `budgetPeriodFloorMs`, `bucketPeriodFloorMs`, `currentPeriodStart`,
  `bucketScopeIdFor`, `attributedUserBucketScopeId`, `budgetAppliesToProvider`,
  `spendFiltersFromQuery`, `spendFilterQueryShape`, `keysetAfter`,
  `decodeSpendEventsCursor`, `decodeSpendSummariesCursor`, `isIanaTimeZone`,
  `serializeRowForAudit`, `metadataPatch`, `identityPatchData` — path-only
  changes through the barrel, invisible to consumers.
- **Unchanged and load-bearing:** `GatewayApp`, `GatewayService`, the six
  `*TrpcApi` classes, `createGatewayPlatformRestApp`, `GatewayUsageService`,
  `VirtualKeyWithScopes`, `GatewayVirtualKeysPort`, `OpenAdmission`,
  `ClickHouseGatewayOpenAdmissionsAdapter`, the spend-pipeline constants, and
  all 15 error classes.

Commits 1–3 touch fewer than 10 external files. Commit 4 touches `presets.ts`,
`apps/api/src/features/gateway/gateway-spend-rest.ports.ts` and
`platform/app/src/server/routes/gateway-internal.ts`. Commits 5–7 are the wide
ones and should not be attempted in the same change as each other.

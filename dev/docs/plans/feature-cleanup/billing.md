# billing (enterprise) — cleanup review

Audited against [`feature-cleanup-review.md`](../../best_practices/feature-cleanup-review.md)
and [`overengineering.md`](../../best_practices/overengineering.md). Worked example:
[`dataset.md`](./dataset.md).

Billing computes money. Nothing below proposes a change to a price, a quantity, a
proration or a currency decision. The two commits that touch code near those paths
say so explicitly and are ordered last.

## 1. What is there now

**8,245 non-test lines across 66 files**, in three packages.

| Package        | Non-test files | Lines |
| -------------- | -------------- | ----- |
| `server/src`   | 42             | 6,287 |
| `contract/src` | 13             | 1,370 |
| `web/src`      | 11             | 588   |

`server/src` by directory:

| Directory       | Files | Lines | Average |
| --------------- | ----- | ----- | ------- |
| `ports/`        | 10    | 234   | 23      |
| `adapters/`     | 8     | 673   | 84      |
| `repositories/` | 6     | 667   | 111     |
| `services/`     | 16    | 4,296 | 269     |
| `transport/`    | 1     | 328   | 328     |
| `index.ts`      | 1     | 89    | —       |

`server/src/index.ts` publishes **74 named symbols**. **27 have zero consumers
outside the feature.**

There is no `app/billing.app.ts`. The facade the layout reserves for the feature
lives in the application instead, at
`platform/app/src/server/app-layer/billing/enterprise/subscription.service.ts`,
and it is where the type system stops holding.

### The subscription stack — nine layers, four of them empty

```
  enterprise-trpc.composition.ts:144            SubscriptionTrpcApi.create(root, …)
        │
  server/src/transport/api-trpc/subscription.api.ts
        │   SubscriptionTrpcApi                 8 procedures
        │   type BillingApplication (:43-96)    8 signatures restated structurally
        │
  platform/app/…/billing/enterprise/subscription.service.ts
        │   EESubscriptionService (:78-176)     8 methods ← 7 one-line delegations
        │   toBillingRepository (:28-48)        13-method hand-written adapter, 13 `as any`
        │   toBillingOrganizationRepository (:50-69)
        │   createNotifier (:71-75)
        │
  server/src/services/subscription.service.ts
        │   BillingSubscriptionService          8 public + 3 private
        │
  server/src/services/seat-event-subscription.service.ts
        │   SeatEventSubscriptionService (:90-132)   4 methods ← 4 of 4 one-line delegations
        │   createSeatEventOperations (:207-631)     closure factory, 4 operations,
        │                                            speaks Prisma directly
        │
  server/src/ports/subscription.port.ts         BillingSubscriptionRepository  13 abstract
        │
  server/src/adapters/postgres.postgres.adapter.ts   PostgresBillingAdapter  create → build()
        │
  server/src/repositories/prisma/prisma.subscription.repository.ts
        │   PrismaSubscriptionRepository        13 methods
        │
  Prisma
```

### The usage-limit stack — three layers, one empty

```
  platform/app/…/billing/enterprise/usage-limit.service.ts
        │   UsageLimitService (:39-87)          3 methods ← 3 of 3 one-line delegations
        │
  server/src/services/usage-limit.service.ts    UsageLimitService  3 public + 4 private (777 lines)
        │
  server/src/services/notification.service.ts   NotificationService  10 methods (694 lines)
        │
  ports/usage-limit-email.port.ts · Slack webhook · Hubspot fetch
```

### The metering stack — clean

```
  pipelineRegistry.ts:251
        │
  adapters/eventing.billing-reporting.adapter.ts        EventingBillingReportingAdapter  2 methods
        │
  adapters/eventing.report-usage-for-month.adapter.ts   405 lines: skip conditions,
        │                                               two-phase checkpoint, circuit breaker
        ├── services/usage-reporting.service.ts   StripeUsageReportingService
        ├── services/billable-events-query.service.ts
        ├── ports/billing-checkpoint.port.ts → prisma.billing-checkpoint.repository.ts
        └── ports/billable-events.port.ts → ClickHouseBillingAdapter
                                          → clickhouse.billable-events.repository.ts
```

### What the detectors say

`no-same-name-delegation-ts` fires **4 times in this feature**, all in
`services/seat-event-subscription.service.ts:109,115,121,127` — 4 of the class's
4 methods. `no-identity-function-ts` fires zero times here. Repo-wide the two
rules produce 278 hits; billing owns 4.

The arrow-property spelling the rule cannot see
(`method = (x) => this.y.method(x)`) does not occur anywhere in the three
packages — `grep -rn "=> this\.[a-zA-Z]*\.[a-zA-Z]*(" server/src contract/src web/src`
returns nothing. Neither does `as any` or `as unknown as`. **Every unsound cast
in this feature's call graph lives in the application, not in the package.**

Recorded baselines: `overengineering-baseline.json:6` (`layer-class` on
seat-event), `service-quality-baseline.json:5,13` (notification 695 lines,
seat-event 632 lines / 415 method-lines), `port-module-baseline.json:4-8`
(five ports whose exported class does not end in `Port`).

## 2. Problems

### P1 — Both application composition roots hand the package's repository to callers that spell its methods differently (breaks R5; a live defect on this branch)

`PrismaSubscriptionRepository` implements the port's `try`-prefixed reads:

```
prisma.subscription.repository.ts:27   async tryFindActive(…)
prisma.subscription.repository.ts:34   async tryFindLastNonCancelled(…)
prisma.subscription.repository.ts:83   async tryFindByStripeId(…)
```

The application's own `SubscriptionRepository` interface spells the same three
without the prefix (`platform/app/src/server/app-layer/subscription/subscription.repository.ts:9,22`),
and has no Prisma implementation of its own — `NullSubscriptionRepository` (`:52`) is
the only class that implements it.

Two composition roots bridge the gap with a cast rather than an adapter:

- `platform/app/src/server/app-layer/billing/enterprise/subscription.service.ts:118-119`
  ```ts
  const persistence = PostgresBillingAdapter.create(db).build();
  const repository = persistence.subscriptions as unknown as SubscriptionRepository;
  ```
- `platform/app/src/server/app-layer/billing/enterprise/webhook.service.ts:193-194`
  ```ts
  subscriptionRepository: PostgresBillingAdapter.create(db).build()
    .subscriptions as unknown as SubscriptionRepository,
  ```

Downstream, both call the names that do not exist on the object they were handed:

| Call site                                                         | Method invoked         | Present on `PrismaSubscriptionRepository`? |
| ----------------------------------------------------------------- | ---------------------- | ------------------------------------------ |
| `subscription.service.ts:34` (`toBillingRepository`)              | `findLastNonCancelled` | no — it is `tryFindLastNonCancelled`       |
| `subscription.service.ts:39` (`toBillingRepository`)              | `findByStripeId`       | no — it is `tryFindByStripeId`             |
| `subscription.service.ts:154` (`getLastNonCancelledSubscription`) | `findLastNonCancelled` | no                                         |
| `webhook.service.ts:512,620,644,702,817`                          | `findByStripeId`       | no                                         |
| `webhook.service.ts:683,722`                                      | `findLastNonCancelled` | no                                         |

Ten call sites, `TypeError: … is not a function`, on the SaaS path only
(`presets.ts:1670` gates the whole block on `config.isSaas`). The reachable
surface is the paid one: `subscription.getLastSubscription`
(`transport/api-trpc/subscription.api.ts:254`), `createOrUpdateSubscription`
(`services/subscription.service.ts:178`), `updateSubscriptionItems` (`:120`),
and — worst — the Stripe webhook, which at `webhook.service.ts:493` writes
`linkStripeId` and then throws at `:512`, so a completed checkout half-applies
and Stripe retries the handler forever.

`git blame` puts both casts on this branch (`7f795ec66b`, 2026-08-27 and
`0a696e2905a`, 2026-08-24); `git merge-base --is-ancestor 7f795ec66b origin/main`
says NOT on main. **Nothing is charged wrongly and nothing shipped — but this
must not merge as it stands.**

The unit test that should have caught it builds the service through
`createWithDependencies` with a hand-written double
(`platform/app/src/server/app-layer/billing/enterprise/__tests__/subscription.service.unit.test.ts:137,157,182`),
so it exercises the app-spelled names and passes while the production path
cannot run.

`toBillingRepository:32` also stubs `tryFindActive: async () => null`
unconditionally. That method has a real caller —
`services/plan-provider.service.ts:84` — which happily gets the genuine
repository straight from `presets.ts:1625-1626`, so nothing reads the stub
today. It is a live trap for the next caller.

### P2 — `SeatEventSubscriptionService` is a 4-method pass-through over a closure factory that holds Prisma (breaks R1, R2, R3)

631 lines. The class is `services/seat-event-subscription.service.ts:90-132` — a
private constructor, a `create`, and four methods that are each one line:

```ts
createSeatEventCheckout(
  input: Parameters<SeatEventOperations["createSeatEventCheckout"]>[0],
): ReturnType<SeatEventOperations["createSeatEventCheckout"]> {
  return this.operations.createSeatEventCheckout(input);
}
```

Four of four (`:109,115,121,127`) — the only `layer-class` entry billing carries.
The parameter and return types are _derived_ from a `ReturnType<typeof …>` alias
(`:88`) rather than stated, which is signal 2 in `overengineering.md`: the type
reconstructs a shape a signature could say once.

The behaviour lives in `createSeatEventOperations` (`:207-631`), a closure over
`{ stripe, db, prices, customerCurrency }` — R2's exact tell, a class whose
constructor was never written.

It also breaks R1 outright. The service takes a database client:

```ts
// services/seat-event-subscription.service.ts:30-38
type SeatEventDatabase = {
  subscription: {
    findMany(args: any): Promise<any[]>;
    updateMany(args: any): Promise<{ count: number }>;
    update(args: any): Promise<any>;
  };
  organizationInvite: { deleteMany(args: any): Promise<{ count: number }> };
  $transaction<T>(run: (transaction: any) => Promise<T>): Promise<T>;
};
```

`presets.ts:1680` passes `prisma` straight in. The service then runs
`db.subscription.findMany` (`:231,358`), `db.subscription.updateMany` (`:370`),
`db.organizationInvite.deleteMany` (`:384`), `db.$transaction` (`:403`) and
`tx.organizationInvite.create` (`:430`) itself. These five `any`s are the only
`any` in the whole feature.

The feature's own ADR forbids this in one sentence —
`adrs/001-billing-package-boundary.md`, "Persistence": _"Services consume narrow
repository classes rather than generated client types."_

### P3 — `OrganizationPricingRepository` is a strict subset of `BillingOrganizationPort`, with a byte-identical implementation (breaks R4, R8)

```ts
// ports/organization-pricing.port.ts:1-3
export abstract class OrganizationPricingRepository {
  abstract tryGetPricingModel(organizationId: string): Promise<string | null>;
}

// ports/organization.port.ts:2-3
export abstract class BillingOrganizationPort {
  abstract tryGetPricingModel(organizationId: string): Promise<string | null>;
  …
```

Both have exactly one implementation, both in this package, and the two bodies
are the same seven lines: `prisma.organization-pricing.repository.ts:13-19` and
`prisma.organization.repository.ts:14-20`. `PostgresBillingAdapter.build()`
constructs **both** over the same client (`postgres.postgres.adapter.ts:37,39`),
so every process holds two objects that answer one question identically.

The narrower one has exactly one consumer, `services/seat-sync.service.ts:11`.

### P4 — Two ClickHouse "adapters" are construction ceremony (breaks R3)

`adapters/clickhouse.clickhouse.adapter.ts` (32 lines) and
`adapters/clickhouse.billable-events-meter.adapter.ts` (33 lines) each hold a
resolver, and each has one method:

```ts
// clickhouse.clickhouse.adapter.ts:26-31
build(): BillableEventsRepository {
  return BillableEventsClickHouseRepository.create({
    resolveClient: this.resolveClient,
    resolveOrganizationClient: this.resolveOrganizationClient,
  });
}
```

Their doc comments say "Constructs the feature's ClickHouse reader without
exposing it" — but `index.ts` does not export the repositories either way, so
`Adapter.create(options).build()` and `Repository.create(options)` differ only in
one class, one file and one call. `PostgresBillingAdapter` is not the same case:
it bundles four repositories into one record and earns its place.

### P5 — Two adapters have no users at all (breaks R8)

| File                                             | Lines | Internal users | External users |
| ------------------------------------------------ | ----- | -------------- | -------------- |
| `adapters/null-organization.adapter.ts`          | 28    | 0              | 0              |
| `adapters/null-subscription-notifier.adapter.ts` | 14    | 0              | 0              |

Both are exported (`index.ts:24,26`) and referenced nowhere else in the
repository — not in a service default, not in `presets.ts`, not in a test.
`NullBillingErrorReporter` and `NullUsageLimitEmailAdapter` are different: they
are real `??` defaults at `notification.service.ts:294,295` and
`nurturing.service.ts:62`.

`services/seat-sync.service.ts` (60 lines) is in the same state one level up:
exported at `index.ts:75`, and its only caller anywhere is
`server/src/__tests__/seatSyncService.unit.test.ts`.

### P6 — Optional dependencies production always supplies, plus a module-level global (breaks R5)

`services/usage-limit.service.ts:170-172` makes `errorReporter`,
`resourceCooldown` and `planCooldown` optional, and defaults each:

```ts
this.errorReporter = errorReporter ?? { capture: () => {} }; // :181 — an inline
this.resourceCooldown = resourceCooldown ?? resourceLimitCooldown; // second copy of
this.planCooldown = planCooldown ?? planLimitCooldown; // NullBillingErrorReporter
```

The only production composition —
`platform/app/src/server/app-layer/billing/enterprise/usage-limit.service.ts:60-65`,
reached from `presets.ts:336,2751` — supplies **all three**, every time, on SaaS
and self-hosted alike. So the two module-level singletons at
`usage-limit.service.ts:63` and `:75` are never the object in play; they exist
only to be the `??` right-hand side. They are still exported (`:65,:79`), and the
application re-declares **both names for different objects**
(`platform/app/.../usage-limit.service.ts:34-35`, `TtlCache`-backed). Two
`resourceLimitCooldown`s, two `planLimitCooldown`s, one import away from each
other — the aliasing hazard `dataset.md` P2 describes.

`planLimitInFlight` is worse: a module-level `Set` (`:74`) that the service reads
and mutates directly at `:276,279,339` while injecting everything else, and that
the application re-exports at `:36` so its own test can reach into it.

`BillingCooldownCache.claim?` (`:36`) is optional, and `:284` pays for it:

```ts
const claimed = await (this.planCooldown.claim?.(organizationId, true) ?? false);
```

Both implementations define `claim` — `MemoryCooldownCache:56` and the app's
`cacheAdapter:31`. There is no object where the fallback `false` — which silently
skips the alert — can be reached.

### P7 — `index.ts` publishes 74 symbols; 27 have no consumer outside the feature (breaks R8)

`BillableEventsMeterClickHouseClientResolver`, `BillableEventsWindow`,
`BillingCheckpoint`, `BillingClickHouseClientResolver`, `BillingCooldownCache`,
`BillingDisplayInvoice`, `BillingOrganizationCache`,
`BillingReportOrganizationReader`, `CheckoutCurrencyResolution`,
`CurrencyRequest`, `EUR_COUNTRIES`, `EventingReportUsageForMonthAdapter`,
`GeneratedLicense`, `MeterEventResult`, `NUMERIC_OVERRIDE_FIELDS`,
`NullBillingErrorReporter`, `NullBillingOrganizationAdapter`,
`NullBillingSubscriptionNotifierAdapter`, `NullUsageLimitEmailAdapter`,
`NurturingServiceOptions`, `OrganizationPricingRepository`,
`PostgresBillingPersistence`, `ReportUsageForMonthCommandDeps`, `SeatSyncService`,
`StripeErrorTranslatorPort`, `SubscriptionItemUpdate`, `UsageLimitData`.

`contract/src/index.ts` is twelve `export *` lines; `web/src/index.ts` is one
named export and eight `export *`.

### P8 — The same eight operations are declared four times (breaks R8)

| Where                                                                       | Form                                           |
| --------------------------------------------------------------------------- | ---------------------------------------------- |
| `server/src/services/subscription.service.ts:81,87,144,214,240,261,298,328` | the implementation                             |
| `platform/app/src/server/app-layer/subscription/subscription.service.ts`    | app `SubscriptionService` interface            |
| `platform/app/…/billing/enterprise/subscription.service.ts:133-175`         | 7 delegating methods, `Parameters<…>[0]` types |
| `server/src/transport/api-trpc/subscription.api.ts:43-96`                   | structural `BillingApplication`, 54 lines      |

`RECENT_INVOICES_LIMIT = 4` is declared twice — `services/subscription.service.ts:33`
and `platform/app/…/billing/enterprise/subscription.service.ts:20` — and the
package's copy is exported, so a reader has two `4`s to keep in step.

### P9 — Three shells over free functions in `web/` and `services/` (breaks R2, R3, R8)

`services/currency.service.ts:138-155` is a class with no fields whose two
members each forward one line to a module function defined above it
(`getCurrencyFromCountry:44`, `detectCurrencyFromRequest:95`). The behaviour is
in the functions; the class adds a `create()`.

On the web side the same call takes three hops:

```
contract getGrowthSeatPriceCents(prices)
  ← web/src/billing-pricing.service.ts:17-19   BillingPricingService.getGrowthSeatPriceCents()
  ← web/src/billing-plans.ts:36                export const getGrowthSeatPriceCents = () => …
  ← web/src/use-billing-pricing.ts:26          const priceCents = getGrowthSeatPriceCents();
```

`BillingPricingService` (24 lines, 2 one-line delegations) has no consumer
outside `billing-plans.ts`, which already pins the catalogue in a module-level
singleton at `:32-34`.

`web/src/billing-plans.ts:24-30` also re-exports `formatPrice`,
`isAnnualTieredPlan`, `parseGrowthSeatPlanType`, `resolveGrowthSeatPlanType`,
`BillingInterval` and `Currency` straight from the contract — the repo's
"never re-export" rule.

### P10 — `UsageLimitService.create` restates its own constructor (breaks R3)

`services/usage-limit.service.ts:191-226`: a 36-line static factory whose entire
body destructures ten names and passes the same ten names to a constructor that
takes the same object type, applying two defaults on the way
(`isSaas = false`, `baseHost = "https://app.langwatch.ai"`). The ten field names
are written four times in the file — declarations (`:142-151`), constructor
params (`:153-175`), factory params (`:191-213`), factory body (`:214-225`).
Compare `NotificationService.create` (`:301-303`), which forwards its options
object unchanged in three lines.

### P11 — Two Prisma repositories take `object` and cast (type hole at the seam)

```ts
// prisma.organization-pricing.repository.ts:9-10
static create(database: object): PrismaOrganizationPricingRepository {
  return new PrismaOrganizationPricingRepository(database as PrismaClient);
}
```

Same at `prisma.subscription.repository.ts:23-24`. The other two repositories in
the same directory take a real `PrismaClient`
(`prisma.organization.repository.ts:10`, `prisma.billing-checkpoint.repository.ts:10`).
`object` accepts `{}`, and the cast means the mistake surfaces as a runtime
`TypeError` — which is precisely how P1 reaches production.

### P12 — Smaller, worth naming

- `prisma.subscription.repository.ts:150-153` — `cancelTrialSubscriptions` is a
  documented no-op ("the `isTrial` column does not exist in the schema yet"), and
  the checkout webhook calls it at `webhook.service.ts:546`. A port operation
  nothing implements.
- Six error classes share `code: "subscription_sync_failed"` —
  `NoActiveSubscriptionError` (`billing.errors.ts:129`), `CustomerCreationRaceError`
  (`:66`), `SubscriptionItemNotFoundError` (`:226`), `SubscriptionCreationFailedError`
  (`:266`), `SubscriptionRecordNotFoundError` (`:287`). The customer reads one
  sentence for five different causes, and `SubscriptionNotLinkedError:152`
  documents that this exact conflation misled customers once already.
- `services/license-purchase.service.ts:16` (`LicenseGenerator`) and `:42`
  (`LicensePurchaseDelivery`) are abstract classes declared in `services/`. They
  have genuine cross-package implementations
  (`platform/app/…/license-purchase.service.ts:12,29`), so R4 keeps them — but
  they belong in `ports/*.port.ts` under the layout rule.
- `specs/billing/global-projections.feature` has 2 scenarios and **0 binding
  tags**, so it reports `✓ all bound` while binding nothing
  (`check-feature-parity.ts` skips untagged scenarios). The other five billing
  feature files are fully tagged.

## 3. What it should look like

```
contract/src/                                     unchanged, 1,370 lines
  billing.errors.ts                        385    16 HandledError classes — keep as is

server/src/
  app/
    billing.app.ts                        ~130    NEW. The one class both the tRPC
                                                  transport and the webhook call.
                                                  Holds the customer→checkout rule
                                                  that EESubscriptionService holds today.
  services/
    subscription.service.ts               ~470    unchanged
    seat-event-subscription.service.ts    ~560    the closure becomes the class body
    usage-limit.service.ts                ~740    factory collapsed, deps required
    notification.service.ts                694    unchanged
    usage-reporting.service.ts             333    unchanged
    billable-events-query.service.ts       181    unchanged
    subscription-item-calculator.service.ts 181   unchanged — money
    nurturing.service.ts                   188    unchanged
    stripe-customer-currency.service.ts    126    unchanged — money
    annual-events-billing-threshold.service.ts 124  unchanged — money
    license-purchase.service.ts            ~95    ports lifted out
    plan-provider.service.ts               117    unchanged
    currency.service.ts                   ~150    the three module functions become
                                                  private methods
    customer.service.ts                     94    unchanged
    best-effort.service.ts                  49    unchanged
  repositories/
    prisma/prisma.subscription.repository.ts       ~225   + findLastNonCancelled naming settled
    prisma/prisma.organization.repository.ts         47
    prisma/prisma.billing-checkpoint.repository.ts  131
    prisma/prisma.seat-event.repository.ts         ~120   NEW — the five Prisma calls
                                                          P2 moves out of the service
    clickhouse/clickhouse.billable-events.repository.ts        186
    clickhouse/clickhouse.billable-events-meter.repository.ts   65
  ports/
    subscription.port.ts                    71
    organization.port.ts                     9
    billing-checkpoint.port.ts              49
    billable-events.port.ts                 22
    billable-events-meter.port.ts           35
    error-reporter.port.ts                  15
    usage-limit-email.port.ts               21
    subscription-notifier.port.ts            6
    stripe-error-translator.port.ts          3
    seat-event.port.ts                     ~35   NEW — the repository P2 needs
    license-delivery.port.ts               ~35   NEW — LicenseGenerator + LicensePurchaseDelivery
  adapters/
    postgres.postgres.adapter.ts            43
    eventing.report-usage-for-month.adapter.ts   405
    eventing.billing-reporting.adapter.ts    80
    stripe-error.stripe-error.adapter.ts     38
  transport/api-trpc/subscription.api.ts   ~280   BillingApplication narrows to one
                                                  `app: BillingApp` field
  index.ts                                 ~50    ~47 symbols
```

**Deleted:** `ports/organization-pricing.port.ts`,
`repositories/prisma/prisma.organization-pricing.repository.ts`,
`adapters/clickhouse.clickhouse.adapter.ts`,
`adapters/clickhouse.billable-events-meter.adapter.ts`,
`adapters/null-organization.adapter.ts`,
`adapters/null-subscription-notifier.adapter.ts`,
`services/seat-sync.service.ts`, `web/src/billing-pricing.service.ts`.

In the application: `EESubscriptionService` and its three `to*Repository`
converters, and `platform/app/src/server/app-layer/billing/enterprise/usage-limit.service.ts`,
collapse into `presets.ts`.

**≈40 server files, ≈5,700 lines. Five layers instead of nine.**

### The seat-event service — the class its closure already is

No arithmetic moves. `quotedAmounts`, `seatChangeParams`, `resolveProrationDate`
and every line of `previewProration` are copied verbatim; only the enclosing
scope changes.

```ts
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

export class SeatEventSubscriptionService {
  private constructor(
    private readonly stripe: Stripe,
    private readonly seatEvents: SeatEventRepository,
    private readonly prices: StripePriceMap,
    private readonly customerCurrency: StripeCustomerCurrencyService,
  ) {}

  static create(options: {
    stripe: Stripe;
    seatEvents: SeatEventRepository;
    prices: StripePriceMap;
    customerCurrency: StripeCustomerCurrencyService;
  }): SeatEventSubscriptionService { … }

  async createSeatEventCheckout(input: {
    organizationId: string; customerId: string; baseUrl: string;
    currency: CurrencyType; billingInterval: BillingInterval;
    membersToAdd: number; isUpgradeFromTiered?: boolean; invites?: InviteInput[];
  }): Promise<{ url: string | null }>
  async updateSeatEventItems(input: { organizationId: string; totalMembers: number; quotedAt?: number }): Promise<{ success: boolean }>
  async previewProration(input: { organizationId: string; newTotalSeats: number }): Promise<SeatQuote>
  async seatEventBillingPortalUrl(input: { customerId: string; baseUrl: string }): Promise<{ url: string }>

  private async findSeatSubscription(organizationId: string): Promise<LinkedSubscription>
  private async loadSeatChangeTarget(organizationId: string): Promise<SeatChangeTarget>
}
```

The four delegations, `SeatEventOperations`, the `Parameters<…>` / `ReturnType<…>`
derivations and all five `any`s disappear. The five Prisma calls move behind:

```ts
export abstract class SeatEventRepository {
  /** ACTIVE and CANCELLED rows, newest first — the candidate set the seat-change
   *  target is ranked from. Ranking stays in the service; it is a billing rule. */
  abstract findSeatChangeCandidates(organizationId: string): Promise<BillingSubscriptionRecord[]>;

  /** Cancels abandoned PENDING checkouts and the PAYMENT_PENDING invites they
   *  stamped, in that order. Returns how many rows were cancelled. */
  abstract cancelStalePendingCheckouts(input: {
    organizationId: string;
    plans: readonly string[];
  }): Promise<{ count: number }>;

  /** The PENDING subscription and its invites, committed together — a checkout
   *  that creates one without the other leaves an unpayable invite. */
  abstract createPendingWithInvites(input: {
    organizationId: string;
    plan: string;
    maxMembers: number;
    invites: InviteInput[];
  }): Promise<{ id: string }>;

  abstract activateWithSeatCount(input: { id: string; maxMembers: number }): Promise<void>;
}
```

`db.$transaction` at `:403` becomes `createPendingWithInvites`; the duplicate-invite
skip at `:419-428` moves inside it unchanged, so the same rows are written under the
same transaction.

### The application facade — one class, no casts

P1 exists because two objects with two spellings met behind an `as unknown as`.
The fix is to stop converting: the package repository is the repository.

```ts
// server/src/app/billing.app.ts
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

export class BillingApp {
  private constructor(
    private readonly customers: CustomerService,
    private readonly subscriptions: BillingSubscriptionService,
  ) {}

  static create(options: {
    database: PrismaClient;          // the composition seam, and the only place it appears
    stripe: Stripe;
    prices: StripePriceMap;
    organizations: BillingOrganizationPort;
    notifier: BillingSubscriptionNotifierPort;
  }): BillingApp

  /** Checkout needs a provider customer first; the two are one act to the caller. */
  async startCheckout(input: { organizationId: string; user: { email?: string | null }; … }): Promise<{ url: string | null }>
  async listInvoices(input: { organizationId: string }): Promise<BillingDisplayInvoice[]>
  async previewProration(input: { organizationId: string; newTotalSeats: number }): Promise<SeatQuote>
  …
}
```

`presets.ts:1689` becomes `billing = BillingApp.create({ database: prisma, stripe: stripeClient, … })`.
`EESubscriptionService`, `toBillingRepository`, `toBillingOrganizationRepository`,
`createNotifier` and the app's `SubscriptionRepository` interface all go, and with
them the ten `TypeError` call sites and the thirteen `as any`s. The transport's
`BillingApplication` (`subscription.api.ts:43-96`) narrows to `{ billing?: BillingApp }`.

`webhook.service.ts:193-194` takes `BillingSubscriptionRepository` directly, no cast.

### The two ports that are one

```ts
// ports/organization.port.ts — unchanged, already a superset
export abstract class BillingOrganizationPort {
  abstract tryGetPricingModel(organizationId: string): Promise<string | null>;
  abstract tryGetStripeCustomerId(organizationId: string): Promise<string | null>;
  abstract tryFindName(organizationId: string): Promise<{ id: string; name: string } | null>;
  abstract tryFindFirstTeamId(organizationId: string): Promise<string | null>;
}
```

`SeatSyncService` (its only consumer) is deleted with it; the duplicate
`tryGetPricingModel` body and the second repository instance in
`PostgresBillingAdapter.build()` go with that.

## 4. Keep list

- **`contract/src/billing.errors.ts` — do not touch.** Sixteen classes, every one
  a `HandledError`, every 5xx with an explicit `fault`, and all twelve distinct
  codes present in both `platform/app/src/features/errors/logic/codes.ts` and
  `presentation.ts`. There is no `Record<name, {status,code}>` and no `instanceof`
  ladder anywhere in the feature. This is the reference the other features should
  copy, and R6 has nothing to say about it.
- **Every money path, verbatim.** `quotedAmounts`
  (`seat-event-subscription.service.ts:75-86`), `seatChangeParams` (`:147-177`),
  `resolveProrationDate` (`:196-205`), `previewProration` (`:541-614`),
  `subscription-item-calculator.service.ts`, `annual-events-billing-threshold.service.ts`,
  `stripe-customer-currency.service.ts`, and the `?? 0` refusal at
  `seat-event-subscription.service.ts:583-586`. Their comment blocks read like
  incident reports and `overengineering.md` would normally send them to an ADR —
  they stay. Each documents a wrong number a customer was shown
  (`total` vs `amount_due`, €54.25 quoted against €639.91 charged), and the code
  is unreadable without them. R7 keeps a comment that is true of the code
  beneath it, and these are.
- **The two-phase checkpoint and the circuit breaker**
  (`ports/billing-checkpoint.port.ts`, `adapters/eventing.report-usage-for-month.adapter.ts`).
  405 lines of a genuinely stateful protocol, correct as written.
- **`BillableEventsQueryService.create(repository | null)`.** The null is real:
  `presets.ts:2039-2044` passes `null` whenever ClickHouse is disabled, which is
  the self-hosted default. Not R5.
- **`BillableEventsMeterPort` split from `BillableEventsRepository`.** The comment
  at `ports/billable-events-meter.port.ts:3-13` explains why the read and write
  sides are named apart, and it is right: one appends per event, one aggregates a
  month.
- **`LicenseGenerator` / `LicensePurchaseDelivery`.** One implementation each, but
  both live in `platform/app` — the cross-package inversion R4 keeps. Only the
  file they sit in changes.
- **`transport/api-trpc/subscription.api.ts` procedure bodies.** Thin, correctly
  policy-wrapped, and the header comment at `:24-28` records why there is no
  billing-specific error middleware. Only the context type shrinks.
- **`notification.service.ts` at 694 lines.** Ten sends and three Slack block
  builders; the length is the message copy, not complexity. It is in
  `service-quality-baseline.json:5` and stays there.
- **`src/__tests__/stripe.integration.test.ts`.** Real Stripe test keys. Not run,
  not changed, and no commit below alters a signature it calls.

## 5. Cost and order

Six commits, smallest risk first. Commits 1-4 touch no arithmetic at all.

1. **Delete what nothing uses.** `adapters/null-organization.adapter.ts`,
   `adapters/null-subscription-notifier.adapter.ts`,
   `services/seat-sync.service.ts` and its test,
   `web/src/billing-pricing.service.ts` (inlined into `billing-plans.ts`), and the
   `web/src/billing-plans.ts:24-30` re-export block, with importers repointed at
   the contract. Shrink `index.ts` to the ~47 symbols with a consumer. Fold
   `services/currency.service.ts`'s three module functions into private methods.
   Zero behaviour, ~200 lines.

2. **Collapse the two duplicate ports.** Delete
   `ports/organization-pricing.port.ts` and
   `repositories/prisma/prisma.organization-pricing.repository.ts`; drop
   `organizationPricing` from `PostgresBillingPersistence`. Delete the two
   ClickHouse adapters and have `presets.ts:2039` and `:2876,3651` call the
   repositories' `create` directly. Give the two `database: object` factories a
   real `PrismaClient`. Fixes P3, P4, P11.

3. **Fix P1 and delete the application facade.** Add `app/billing.app.ts`, wire
   `presets.ts:1689` and `webhook.service.ts:193` to it, delete
   `EESubscriptionService`, the three `to*Repository` converters, the app's
   `SubscriptionRepository` interface, and both `as unknown as` casts. Narrow the
   transport's `BillingApplication`. Drop the duplicate `RECENT_INVOICES_LIMIT`.
   **This is the commit that must land before the branch merges** — the ten
   `TypeError` sites in P1 are the reason. Before writing it, rewrite
   `__tests__/subscription.service.unit.test.ts:137` to build the service through
   the production factory rather than `createWithDependencies` with a hand-made
   double, so the suite can fail on a name mismatch.

4. **Make the usage-limit dependencies required.** Collapse
   `UsageLimitService.create` (`:191-226`) into an options-forwarding factory,
   drop the three optionals and the inline `{ capture: () => {} }` at `:181`,
   delete the two unused module singletons at `:63,:75`, make
   `BillingCooldownCache.claim` required, and inject `planLimitInFlight` as a
   field instead of reading the module-level `Set`. Delete
   `platform/app/…/billing/enterprise/usage-limit.service.ts` and its three
   delegations, wiring `presets.ts:2751` straight to the package. Fixes P6, P10.

5. **Move the license ports.** `LicenseGenerator` and `LicensePurchaseDelivery`
   out of `services/license-purchase.service.ts` into
   `ports/license-delivery.port.ts`. File move plus imports; the classes keep
   their names so `port-module-baseline.json` gains two entries or the classes
   gain a `Port` suffix in the same change.

6. **`SeatEventSubscriptionService` — the closure becomes the class, and Prisma
   moves behind `SeatEventRepository`.** Two mechanical steps, but on the checkout
   path, so it lands last and alone. **No expression inside `quotedAmounts`,
   `seatChangeParams`, `resolveProrationDate` or `previewProration` changes.**
   Gate it on `server/src/__tests__/seatEventSubscription.unit.test.ts`,
   `specs/billing/seat-subscription-retention-policy.feature` and
   `specs/billing/subscription-cancellation.feature` all green, and tag
   `specs/billing/global-projections.feature`'s two scenarios in the same change
   so the billing spec set stops reporting green over nothing. Fixes P2.

`stripe.integration.test.ts` is untouched by all six.

## 6. Blast radius

**13 files outside the feature name `@langwatch/enterprise-billing-server`** —
10 source, 3 test or lint fixture. One of the ten,
`platform/app/src/features/langy/components/LangyPlanLimitCard.tsx:32`, only
mentions it in a comment, so there are **9 real importers**. A tenth entry,
`platform/app/src/runtime/app/features/billing.ts:3`, is a re-export shim that
republishes the whole package and adds three compatibility aliases.

Symbols they use: `SubscriptionTrpcApi`, `SubscriptionTrpcContext`
(`packages/enterprise/composition/api/src/trpc/enterprise-trpc.composition.ts:21-22`),
`PostgresBillingAdapter`, `ClickHouseBillingAdapter`,
`ClickHouseBillableEventsMeterAdapter`, `StripeErrorAdapter`,
`SeatEventSubscriptionService`, `SubscriptionItemCalculatorService`,
`BillingSubscriptionService`, `CustomerService`, `StripeUsageReportingService`,
`StripeCustomerCurrencyService`, `SaaSPlanProviderService`,
`BillableEventsQueryService`, `UsageLimitService`, `NotificationService`,
`NurturingService`, `BestEffortService`, `AnnualEventsBillingThresholdService`,
`LicensePurchaseService`, `LicenseGenerator`, `LicensePurchaseDelivery`,
`EventingBillingReportingAdapter`, `BillableEventRecord`, `BillingErrorReporter`,
`BillingOrganizationPort`, `BillingSubscriptionRepository`,
`BillingSubscriptionNotifierPort`, `UsageLimitEmailAdapter`,
`BillableEventsMeterPort`, `BILLING_ORG_CACHE_PREFIX`, `BILLING_ORG_CACHE_TTL_MS`,
`RECENT_INVOICES_LIMIT`, `planLimitInFlight`.

Heaviest concentrations: `platform/app/src/server/app-layer/presets.ts` (the sole
production composition root), `platform/app/src/server/app-layer/billing/enterprise/`
(three files, two of which commits 3 and 4 delete), and
`platform/app/src/server/event-sourcing/registration/` (three files, using only
`BillableEventRecord` and `EventingBillingReportingAdapter` — untouched by every
commit above).

**`@langwatch/enterprise-billing-web`** is named by **16 files** — 12 source, 4
test or fixture. Eleven of the twelve are application UI under
`platform/app/src/components/subscription/`, `components/plans/` and
`pages/settings/`; the twelfth is the enterprise feature catalogue. Only commit 1
touches them, and only by moving four re-exported names back to the contract
import they already come from.

`packages/enterprise/src/index.ts:62` and
`packages/enterprise/tests/enterprise-catalogue.unit.test.ts:30` name both
packages in the enterprise feature catalogue; neither package name changes.

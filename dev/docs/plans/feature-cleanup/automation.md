# automation — cleanup review

Written against [`feature-cleanup-review.md`](../../best_practices/feature-cleanup-review.md),
matching [`dataset.md`](dataset.md).

## 1. What is there now

**21,944 lines across 161 non-test files** — server 78 / 10,925, contract 45 / 4,885,
web 38 / 6,134. The server package holds **30 port classes in 16 files**, **24
services**, **7 abstract repositories over 8 Prisma repositories**, and **1,063
comment lines (9.7%), 504 of which sit in two of the 78 files**.

Server, by directory:

| Directory | Files | Lines |
| --- | ---: | ---: |
| `services/` | 24 | 4,812 |
| `transport/api-trpc/` | 3 | 1,461 |
| `adapters/` | 8 | 1,477 |
| `repositories/prisma/` | 8 | 791 |
| `app/` | 1 | 572 |
| `ports/` | 16 (30 classes) | 436 |
| `transport/api-rest/` | 1 | 362 |
| `processes/` | 3 | 268 |
| `subscribers/` | 2 | 177 |
| `repositories/` | 7 | 175 |
| `index.ts` / `testing.ts` | 2 | 278 |
| `intents/` | 3 | 116 |

### The write path (tRPC `upsert`)

```
transport/api-trpc/automation.api.ts   AutomationTrpcApi
    │                                  upsert is ~300 lines and holds the
    │                                  create/reactivate/report-schedule rules
app/automation.app.ts                  AutomationApp        31 methods
    │                                  ← 22 one-line pass-throughs, 9 real rules
services/automation.service.ts         AutomationService    40 methods
    │                                  extends a 44-signature contract class
repositories/trigger.repository.ts     TriggerRepository    13 abstract
    │
repositories/prisma/prisma.trigger.repository.ts
```

### The graph-alert evaluation path

This is the one to look at. **Four pass-throughs before the first decision, and
the chain leaves the feature package into `platform/app` and comes straight back
into the feature package.**

```
processes/graph-alert-sweep.process.ts
    │  AutomationScheduledIntentPort              3 signatures
services/automation.service.ts:102                evaluateGraphTrigger
    │                                             → this.graph.evaluate(input)     PASS-THROUGH 1
services/trigger-graph.service.ts:76              AutomationGraphService
    │                                             3 methods, 3 pass-throughs        PASS-THROUGH 2
services/graph-trigger-evaluation.service.ts:42   GraphTriggerEvaluationService
    │                                             1 method + 23 lines of re-export  PASS-THROUGH 3
services/graph-trigger-evaluator.service.ts:23    GraphTriggerEvaluatorService
    │                                             ← the first real step (3 phases)
plan · series · incident services
    │  AutomationGraphNotifierPort
platform/app/.../automation-graph-ports.ts:291    AppAutomationGraphNotifierAdapter
    │                                             1 method, 1 line                  PASS-THROUGH 4
services/graph-alert-dispatch.service.ts:60       GraphAlertDispatchService   ← real
    │  AutomationGraphDeliveryPort
adapters/postgres.automation-graph-delivery.adapter.ts   4 methods, 2 same-name delegations
    │
repositories/prisma/*
```

Both ends of `AutomationGraphNotifierPort` are the feature's own code. The port
exists so a class in `platform/app` can wrap a class in `packages/features/automation`
to hand it back to `packages/features/automation`.

## 2. Problems

### P1 — A service builds and runs raw ClickHouse SQL (breaks R1)

`services/graph-trigger-heartbeat.service.ts:36-42` declares its own
`ClickHouseClient` structural type; `:324-425` (`loadProjectRecency`) resolves a
client through `AutomationHeartbeatPort`, string-builds a 20-line
`ReplacingMergeTree` IN-tuple dedup query interpolating a table name and an id
column (`:355-375`), calls `client.query(...)` (`:378`), and hand-parses the row
(`:383-397`).

The service layer therefore knows `trace_analytics`, `evaluation_analytics`,
`toUnixTimestamp64Milli`, partition-pruning predicates and the tenant-first WHERE
rule. That is a repository's knowledge. `repositories/graph-trigger-sent.repository.ts`
already owns the ledger side of the same decision — the recency read belongs
beside it as `findLatestActivityAt({ projectId, source, since })`.

This is also the feature's only R1 breach: no other service touches Prisma or
ClickHouse.

### P2 — `AutomationPersistCapService` is a shell over module-global mutable state (breaks R2, R5)

`services/persist-cap.service.ts:73-129` — the class has 10 members. **Every one
of the 7 operations is a one-line delegation to a free function in the same file**:

```ts
static resolvePersistDailyCap(projectId, dependencies) { return resolvePersistDailyCap(projectId, dependencies); }   // :85-90
static persistCapKey(input)          { return persistCapKey(input); }            // :92-94
static persistCapClaimKey(input)     { return persistCapClaimKey(input); }       // :96-98
static consumePersistCapSlot(input)  { return consumePersistCapSlot(input); }    // :100-104
static readPersistCapCounts(input)   { return readPersistCapCounts(input); }     // :106-110
static resetMemoryStore()            { return resetMemoryPersistCapStore(); }    // :112-114
resolvePersistDailyCap(projectId)    { return resolvePersistDailyCap(projectId, this.dependencies); }  // :116-118
consumePersistCapSlot(input)         { return consumePersistCapSlot({ ...input, redis: this.redis }); } // :120-122
readPersistCapCounts(input)          { return readPersistCapCounts({ ...input, redis: this.redis }); }  // :124-128
```

The state those functions read is **module-global**, not instance state:

- `:18` `const capCache = new Map<string, {value, expiresAt}>()`
- `:226` `const memoryStore = new Map<string, MemoryEntry>()`
- `:227` `const claimStore = new Map<string, number>()`
- `:238` `let lastMemorySweepAt = 0`

Two `AutomationPersistCapService` instances in one process share one plan cache
and one degraded-mode claim ledger. `resetMemoryStore()` (`:112`) exists only
because tests cannot otherwise get a clean one — the tell that the state should
have been a field. The class is the constructor these functions never got.

`static` and instance versions of the same three operations are also R8: the same
call declared twice so a caller can skip composing.

### P3 — The graph-evaluation chain is three layers that add nothing (breaks R3)

- `services/trigger-graph.service.ts:76-90` — `AutomationGraphService` has
  **3 methods, all three one-line delegations** (`evaluate`, `decideHeartbeat`,
  `handlePersistCapBreach`) to the three services it composes at `:48-73`. It
  holds no rule of its own.
- `services/graph-trigger-evaluation.service.ts` — 59 lines. Lines `6-23` are
  pure re-export of `graph-trigger-evaluator.service`; the class's single
  instance method (`:42-48`) forwards to `GraphTriggerEvaluatorService.evaluate`,
  and `:51-58` declares the **same operation a second time as a static**
  ("Test seam for characterisation coverage of the evaluator itself").
- `services/graph-trigger-evaluator.service.ts:38-49` re-exports again from
  `trigger-evaluator.service`. Three files deep of re-export chain to reach one
  digest function.

`ast-grep --filter no-same-name-delegation-ts` confirms mechanically: 11 hits in
the package, at `services/automation.service.ts:98,114,118,122,132,231,235,251`,
`services/trigger-graph.service.ts:76`, and
`adapters/postgres.automation-graph-delivery.adapter.ts:44,52`.

`AutomationEvaluationSubscriberService` (`services/automation-evaluation-subscriber.service.ts:41-62`)
is the same shape from the other side: 2 methods, both one-line calls to free
functions in `subscribers/`, re-passing the same four dependencies each time.

### P4 — Four ports are declared twice to satisfy the lint rule (breaks R4, R8)

`packages/architecture-lint/src/port-modules.ts:214-217` requires every
`ports/*.port.ts` to export an abstract class **whose name ends in `Port`**. Four
files satisfy it with an empty subclass and keep the real name for every consumer:

| File | Real class | Lint-satisfying alias | References to the alias |
| --- | --- | --- | ---: |
| `ports/automation-clock.port.ts:5` | `AutomationClock` (47 refs) | `AutomationClockPort` | **1** — its own declaration |
| `ports/scheduled-jobs.port.ts:28` | `ScheduledJobStore` (28 refs) | `ScheduledJobStorePort` | **1** |
| `ports/scheduler-wake.port.ts:5` | `SchedulerWake` (15 refs) | `SchedulerWakePort` | **1** |
| `ports/unsubscribe-token.port.ts:10` | `UnsubscribeTokenVerifier` (13 refs) | `UnsubscribeTokenVerifierPort` | **1** |

Nothing imports any of the four aliases. R4's own wording covers this: "renaming
the file and the class is one change or neither." Rename the base classes and
delete the aliases.

### P5 — Six ports have one implementation beside them in the same package (breaks R4)

Full ledger of the 26 distinct ports (`grep -rn "extends <Port>"`, production
implementations only):

| Port | Production impls | Where | Verdict |
| --- | ---: | --- | --- |
| `AutomationTriggerMatchRecorderPort` | 3 | `platform/app`, `apps/worker` ×2 | **Keep** — real polymorphism |
| `ScheduledJobStore` | 2 | `platform/app` (Prisma, Null) | **Keep** |
| `AutomationLoggerPort` · `AutomationHeartbeatPort` · `AutomationDispatchErrorPort` · `AutomationRunawayPort` · `AutomationNotificationDeliveryPort` · `AutomationEmailCapStorePort` · `AutomationDatasetMapperPort` · `AutomationPersistActionWriterPort` · `AutomationSettlementFilterEvaluatorPort` · `AutomationSettlementObservabilityPort` · `AutomationTestFirePort` · `AutomationClock` · `SchedulerWake` · `UnsubscribeTokenVerifier` | 1 each | `platform/app` | **Keep** — genuine inversion |
| `AutomationIntentRetentionPort` | structural | `apps/worker` process store | **Keep** — cross-package |
| `AutomationScheduledIntentPort` | structural | narrows 44 contract signatures to 3 | **Keep** — the narrowing earns it |
| `AutomationGraphNotifierPort` | 1 | `platform/app:291` wrapping the feature's own `GraphAlertDispatchService` | **Delete** |
| `AutomationSlackBotTokenDecryptorPort` | 1 | `platform/app:93` wrapping the feature's own `SlackProviderAdapter` | **Delete** — see P6 |
| `AutomationGraphDeliveryPort` | 1 | `adapters/postgres.automation-graph-delivery.adapter.ts:14`, same package | **Delete** |
| `AutomationEvaluationTriggerFilterPort` | 1 | `services/automation-evaluation-trigger-filter.service.ts:9`, same package | **Delete** |
| `AutomationSlackProviderPort` | 1 | `adapters/slack-provider.adapter.ts:79`, same package | **Delete** |
| `AutomationWebhookProviderPort` | 1 | `adapters/webhook-provider.adapter.ts:170`, same package | **Delete** |
| `AutomationSettlementExecutorPort` | 1 | `services/trigger-settlement-dispatch.service.ts:48`, same package | **Delete** |
| `AutomationSettlementMatchConfirmationPort` | 1 | `services/automation-settlement-match-confirmation.service.ts:41`, same package | **Delete** |

`automation-settlement.port.ts:17-19` documents its own expiry: "The port has one
compatibility implementation while the trace filter evaluator finishes its own
extraction." That extraction is done — `AutomationSettlementFilterEvaluatorPort`
below it is the real seam and has its implementation in `platform/app`.

### P6 — "Decrypt the stored Slack bot token" is declared four times (breaks R8)

One operation, two ports, two adapter instances, four declarations:

1. `ports/automation-provider.port.ts:15` — `AutomationSlackProviderPort.tryDecrypt(params: { slackBotToken?: string }): string | null`
   → `adapters/slack-provider.adapter.ts:106-108`
2. `platform/app/.../automation-adapters/providers/slack/server.ts:8` builds a
   **second** `SlackProviderAdapter` and re-exports the method as a free function
   `decryptSlackBotToken` (`:26-28`) — a one-line delegation
3. `ports/automation-graph.port.ts:43` — `AutomationSlackBotTokenDecryptorPort.tryDecrypt(params: SlackActionParams): string | null`
   → `platform/app/.../automation-graph-ports.ts:93-97`, which calls the free
   function from (2)
4. `transport/api-trpc/automation.api.ts:177` — `ports.providers.decryptSlackBotToken(actionParams: unknown): string | null`
   → `platform/app/src/server/api/root.ts:297-298`, which calls the free function
   from (2) again

Three different parameter types (`{slackBotToken?}`, `SlackActionParams`,
`unknown`) for the same argument. `automation-dispatch.wiring.ts:164` composes
one `SlackProviderAdapter`; `providers/slack/server.ts:8` composes another; both
hold the same crypto.

### P7 — `nextauthSecret` threads through three constructors and is dropped at each (breaks R5, and is a live defect)

`verifyUnsubscribeToken` takes **one** parameter
(`platform/app/src/server/mailer/unsubscribeToken.ts:70`) and reads the secret from
`env` itself (`:38-49`). Two days ago commit `4a94175ed50` (2026-08-28) added a
second argument at the call site:

```ts
// platform/app/src/runtime/app/features/automation.ts:69-75
constructor(private readonly nextauthSecret: string | undefined) { super(); }
tryVerify(token: string) {
  return verifyUnsubscribeToken(token, this.nextauthSecret);   // ← TS2554: expected 1 argument
}
```

Three separate dead paths for the same value:

- `AppAutomationRuntime.create` accepts `nextauthSecret?: string`
  (`automation.ts:107`) — and `presets.ts:1758-1765`, the only production
  composition, **does not pass it**, so `AppUnsubscribeTokenVerifier` always gets
  `undefined`;
- `AppAutomationGraphPorts` carries `nextauthSecret?: string`
  (`automation-graph-ports.ts:58`), spread into `PostgresAutomationAdapter.create`
  at `automation.ts:129` — whose input type has no such field
  (`adapters/postgres.automation.adapter.ts:54-71`), so it is silently discarded;
- the call site above discards it a third time.

Unsubscribe verification works only because `unsubscribeToken.ts` ignores all of
it. Delete the parameter from all three places.

### P8 — The one facade exists, and both doors still disagree about report schedules (breaks R3 / R8)

`app/automation.app.ts:1-27` states the facade's purpose: the doors used to hold
three descriptions of the same composition, "agreeing by attention rather than by
construction." Nine of its 31 methods hold real rules and earn the class. But the
biggest write in the feature never reached it:

- `AutomationApp.delete` (`:444-450`) correctly bundles `softDeleteById` +
  `removeReportSchedule`;
- `AutomationApp.update` (`:431-433`) is a bare pass-through;
- so the "editing a report into something else must retire its calendar entry"
  rule lives **only in the tRPC transport**, at
  `transport/api-trpc/automation.api.ts:1173-1192`, along with the graph-alert
  reactivate-by-`customGraphId` rule (`:1128-1170`), the
  `filters`/`filterQuery` supersession (`:1097-1101`) and cadence resolution.
  ~300 lines of business rules in a transport.
- `transport/api-rest/automation.api.ts:299` PATCHes `actionParams` through
  `app.update` with no schedule reconciliation. The comment at `:1183-1187` of
  the tRPC file describes exactly the failure that leaves: "the ScheduledJob keeps
  waking forever and the report handler repeatedly loads a now-non-report trigger."

The REST family also hand-rolls three 404s — `:177`, `:280`, `:349`,
`return c.json({ error: "Trigger not found" }, 404)` — when
`AutomationApp.requireById` (`:321-325`) already throws
`AutomationNotInProjectError`, a `NotFoundError` with the `automation_not_found`
code and a presentation entry at `presentation.ts:2251`.

### P9 — Two error classes that should be one, and one that is dead (breaks R6, R8)

24 of the feature's 28 error classes are `HandledError`s with presentation
entries — error handling is in good shape overall. The exceptions:

- `contract/src/automation.errors.ts:15` — `InvalidUnsubscribeTokenError extends Error`,
  thrown at `services/automation.service.ts:406`. Both transports then translate
  it, in two places:
  `transport/api-trpc/email-suppression.api.ts:185-187` rethrows it as
  `UnsubscribeLinkInvalidError`, and
  `platform/app/src/server/routes/unsubscribe.ts:59-61` hand-rolls
  `c.json({ error: "Invalid token" }, 400)`. `UnsubscribeLinkInvalidError`
  (`app/automation.app.ts:256-263`) already carries the code, the status and the
  copy — throw it from the service and both catch blocks go.
- `contract/src/automation.errors.ts:9` — `TriggerNotFoundError extends Error`,
  thrown by `repositories/prisma/prisma.trigger.repository.ts:117`. It reaches
  every transport as an unknown 500.
- `contract/src/automation.errors.ts:3` — `AutomationNotFoundError`. Declared,
  exported, **zero references anywhere in the repo**.

### P10 — Dead repository methods, a false comment about them, and an inline `import()` (breaks R7, R8)

`repositories/trigger-fire-history.repository.ts:28` says:

> `/** Compatibility aliases used by the aggregate Automation service. */`

They are not. `AutomationService.getFireStats` calls `findAllStatsForProject`
(`services/automation.service.ts:320`) and `getRecentFires` calls
`findAllRecentByTriggerId` / `findAllRecentForProject` (`:332,:337`). The two
aliases `findStats` (`:29`) and `findRecent` (`:33`) have **no production caller**
— only their declaration, their Prisma implementation
(`repositories/prisma/prisma.trigger-fire-history.repository.ts:110-128`) and a
stub in the test fake (`services/__tests__/automation.service.unit.test.ts:237,240`).

That implementation also breaks the repo's inline-`import()` ban:

```ts
// repositories/prisma/prisma.trigger-fire-history.repository.ts:113
): Promise<import("@langwatch/automation-contract").AutomationFireStats[]> {
```

Separately, `filterSuppressed` is implemented twice, byte-identically:
`services/automation.service.ts:431-443` and
`adapters/postgres.automation-graph-delivery.adapter.ts:34-42`, each with its own
copy of the email normaliser (`automation.service.ts:44` `normalize`,
`postgres.automation-graph-delivery.adapter.ts:11` `normalizeEmail`).

### P11 — Every Prisma repository takes `database: object` and casts it back (breaks R8)

Ten sites take the client as `object` and immediately cast:

```ts
// repositories/prisma/prisma.custom-graph.repository.ts:8-14
private constructor(private readonly database: PrismaClient) { super(); }
static create(database: object): PrismaCustomGraphRepository {
  return new PrismaCustomGraphRepository(database as PrismaClient);
}
```

`PrismaClient` is imported on line 3 of that same file, from
`@langwatch/prisma-client/generated`, which is a declared dependency
(`server/package.json`). The type is available and is thrown away at exactly the
seam where passing the wrong object is silent. Same pattern at
`prisma.trigger.repository.ts:44`, `prisma.trigger-fire-history.repository.ts:18`,
`prisma.webhook-delivery.repository.ts:16`,
`prisma.email-suppression-name.repository.ts:10`,
`prisma.graph-trigger-sent.repository.ts:18`,
`prisma.email-suppression.repository.ts:9`, and in the two composition adapters
(`adapters/postgres.automation.adapter.ts:35,55`,
`adapters/postgres.automation-graph-delivery.adapter.ts:24`).

### P12 — The comments are in the wrong files (breaks R7, in the other direction)

1,063 comment lines over 10,925 — the lowest density of the large features. The
problem is not the total; it is the distribution. **504 of them (47%) are in two
of 78 files**: `transport/api-trpc/automation.api.ts` (336) and
`app/automation.app.ts` (168), the two files a reader is least likely to be lost
in. Nineteen non-test files over ~90 code lines carry two comment lines or fewer,
ten of them **zero**:

| File | Code lines | Comment lines |
| --- | ---: | ---: |
| `services/trigger-settlement-notification.service.ts` | 423 | **0** |
| `services/automation.service.ts` | 414 | **0** |
| `services/trigger-settlement-persistence.service.ts` | 261 | **0** |
| `services/automation-template.service.ts` | 239 | **0** |
| `services/graph-alert-dispatch.service.ts` | 231 | 1 |
| `repositories/prisma/prisma.graph-trigger-sent.repository.ts` | 199 | 1 |
| `services/graph-trigger-alert-delivery.service.ts` | 193 | **0** |
| `services/trigger-evaluator.service.ts` | 193 | 1 |
| `repositories/prisma/prisma.trigger.repository.ts` | 185 | **0** |
| `services/runaway-containment.service.ts` | 156 | 1 |
| `services/trigger-settlement-email.service.ts` | 149 | **0** |
| `repositories/prisma/prisma.trigger-fire-history.repository.ts` | 129 | **0** |
| `services/graph-trigger-evaluation-plan.service.ts` | 127 | **0** |

The sharpest case is the whole once-per-trace notification guarantee:

```ts
// repositories/prisma/prisma.trigger.repository.ts:63-73 — no comment
async claimSend(input: { triggerId: string; traceId: string; projectId: string }): Promise<boolean> {
  const result = await this.database.triggerSent.createMany({ data: [input], skipDuplicates: true });
  return result.count === 1;
}
```

`skipDuplicates` plus a unique index is what decides, across concurrent workers,
which one sends the notification and which stays silent. It reads as a bulk
insert. Three repositories also write the same `TriggerSent` table with three
different meanings — the send-claim ledger here, the fire history
(`prisma.trigger-fire-history.repository.ts:29,37,43,52,92,103`) and the
graph-alert incident ledger (`prisma.graph-trigger-sent.repository.ts:41-165`) —
and only the third says so (`:8`).

`services/trigger-settlement-notification.service.ts` is 467 lines and 19 methods
with zero comments; the claim/send ordering in `claimCandidates` (`:424`) and
`completeDispatch` (`:172`) is the feature's hardest invariant and carries no
explainer.

## 3. What it should look like

```
server/src/
  app/
    automation.app.ts                    ~330   31 → 20 methods. The 22 pass-throughs
                                                collapse into ~11 that carry rules;
                                                gains `upsert` (from the transport) and
                                                `updateWithScheduleSync`
  services/
    automation.service.ts                ~330   40 → 30 methods; the graph and persist-cap
                                                delegations go
    graph-trigger-evaluator.service.ts   ~230   was 3 files; the plan/series/incident
                                                composition and the digest, one class
    graph-trigger-evaluation-plan.service.ts     ~147  unchanged
    graph-trigger-series-evaluation.service.ts    ~89  unchanged
    graph-trigger-incident.service.ts             ~83  unchanged
    graph-trigger-heartbeat.service.ts   ~290   the ClickHouse query moves out
    graph-alert-dispatch.service.ts      ~265   takes the three repositories directly
    graph-trigger-alert-delivery.service.ts      ~214  + ~25 lines of invariants
    trigger-settlement-dispatch.service.ts       ~121  unchanged
    trigger-settlement-notification.service.ts   ~490  + ~25 lines of invariants
    trigger-settlement-persistence.service.ts    ~295
    trigger-settlement-email.service.ts          ~167
    automation-settlement-match-confirmation.service.ts  ~146
    automation-evaluation-subscriber.service.ts  ~150  absorbs the two subscriber functions
    automation-evaluation-trigger-filter.service.ts  ~26  no longer extends a port
    automation-template.service.ts       ~269
    persist-cap.service.ts               ~470   free functions → private methods;
                                                the three module Maps → instance fields
    email-cap.service.ts                 ~208
    persist-action.service.ts            ~183
    runaway-containment.service.ts       ~176
    report-schedule.service.ts            ~88
    trigger-evaluator.service.ts         ~221
  repositories/
    trigger.repository.ts                 ~44
    trigger-fire-history.repository.ts    ~28   `findStats` / `findRecent` deleted
    graph-trigger-sent.repository.ts      ~48   + `findLatestActivityAt`
    custom-graph.repository.ts            ~13
    email-suppression.repository.ts       ~15
    email-suppression-name.repository.ts  ~14
    webhook-delivery.repository.ts        ~11
    prisma/                                     8 files, `database: PrismaClient`
    clickhouse/clickhouse.graph-trigger-activity.repository.ts  ~90   ← from P1
  ports/                                        16 classes in 12 files
    automation-clock.port.ts              ~3    class renamed to `AutomationClockPort`
    scheduled-jobs.port.ts                ~26   `ScheduledJobStorePort`
    scheduler-wake.port.ts                ~3    `SchedulerWakePort`
    unsubscribe-token.port.ts             ~8    `UnsubscribeTokenVerifierPort`
    automation-graph.port.ts              ~30   notifier + slack-decryptor removed
    automation-provider.port.ts           ~41   the ONE slack/webhook provider port
    automation-notification-delivery.port.ts  ~72
    automation-settlement.port.ts         ~30   filter-evaluator + observability only
    automation-runaway.port.ts            ~30
    automation-persist-action.port.ts     ~26
    automation-test-fire.port.ts          ~34
    email-cap.port.ts · automation-evaluation-subscriber.port.ts (recorder only)
    automation-scheduled-intent.port.ts · automation-intent-retention.port.ts
  adapters/ · intents/ · processes/ · subscribers/ · transport/
```

**Deleted:** `services/trigger-graph.service.ts`,
`services/graph-trigger-evaluation.service.ts`,
`ports/automation-graph-delivery.port.ts`,
`adapters/postgres.automation-graph-delivery.adapter.ts`, the four empty `*Port`
aliases, six single-implementation port classes, `AutomationNotFoundError`, the
two `TriggerFireHistoryRepository` aliases, and the wrapper classes
`AppAutomationGraphNotifierAdapter` / `AppAutomationSlackTokensAdapter` in
`platform/app`.

**≈70 files, ≈9,600 lines. Four hops from a tRPC procedure to Prisma instead of eight.**

### The graph evaluation, straightened

`AutomationScheduledIntentPort` already narrows the contract to the three
operations the pipeline needs, so `AutomationService` can hold the evaluator
directly and the two intermediate classes disappear:

```ts
export class AutomationService extends AutomationCapability {
  private constructor(
    // …
    private readonly graphEvaluator: GraphTriggerEvaluatorService,
    private readonly graphHeartbeat: GraphTriggerHeartbeatService,
    private readonly containment: RunawayContainmentService,
  ) { super(); }

  evaluateGraphTrigger(input: { triggerId: string; projectId: string; reason: GraphTriggerEvaluationReason }) {
    return this.graphEvaluator.evaluate(input);
  }
}
```

and `GraphTriggerEvaluatorService` takes the dispatcher as a constructor field
rather than reaching back out through a port that `platform/app` re-enters:

```ts
export class GraphTriggerEvaluatorService {
  private constructor(
    private readonly plans: GraphTriggerEvaluationPlanService,
    private readonly series: GraphTriggerSeriesEvaluationService,
    private readonly incidents: GraphTriggerIncidentService,
    private readonly dispatch: GraphAlertDispatchService,   // ← was AutomationGraphNotifierPort
  ) {}
}
```

`AutomationGraphNotifierPort`, `GraphAlertDispatchInput`/`Result` (which move to
`graph-alert-dispatch.service.ts` where they are produced), and
`AppAutomationGraphNotifierAdapter` all go. Three of the four pass-throughs go
with them.

### The persist cap, as a class

Constructor fields replace the four module globals, so two instances stop sharing
one cache, and `resetMemoryStore` stops existing:

```ts
export class AutomationPersistCapService {
  private readonly capCache = new Map<string, { value: number; expiresAt: number }>();
  private readonly memoryStore = new Map<string, MemoryEntry>();
  private readonly claimStore = new Map<string, number>();
  private lastMemorySweepAt = 0;

  private constructor(
    private readonly projects: ProjectService,
    private readonly plans: AutomationPlanProvider,
    private readonly config: PersistCapConfig,
    private readonly redis: AutomationEmailCapStorePort | null,   // ← the existing port,
  ) {}                                                            //   not a second Redis interface

  static create(options: { projects; planProvider; config; redis?: AutomationEmailCapStorePort | null }): AutomationPersistCapService

  async resolvePersistDailyCap(projectId: string): Promise<number>
  async consumePersistCapSlot(input: ConsumePersistCapSlotInput): Promise<AutomationPersistCapDecision>
  async readPersistCapCounts(input: ReadPersistCapCountsInput): Promise<Record<string, AutomationPersistCapCount>>

  private capForPlan(plan: AutomationPlan): number
  private persistCapKey(input: PersistCapKeyInput): string
  private persistCapClaimKey(input: PersistCapClaimKeyInput): string
  private rememberClaim(claimKey: string, expiresAt: number): void
  private sweepExpiredMemoryEntries(now: number): void
  private async tryCountViaRedis(input): Promise<Record<string, AutomationPersistCapCount> | null>
  private countInMemory(input): Record<string, AutomationPersistCapCount>
}
```

`AutomationPersistCapRedisPort` (`persist-cap.service.ts:34-37`) is a second,
narrower declaration of `AutomationEmailCapStorePort`
(`ports/email-cap.port.ts:1-13`) — `eval` and `get` against the same Redis. One
port, both callers. `redis` stays genuinely optional: `presets.ts:1741` passes
`redis ?? null` and `runtime/app/features/automation.ts:58` builds no store when
there is no connection, so this is the one optional dependency in the feature
that production really does omit.

### One Slack provider port

`AutomationSlackBotTokenDecryptorPort` goes; `AutomationSlackProviderPort` gains
the one signature the graph path needed, typed the way its caller already types
it:

```ts
export abstract class AutomationSlackProviderPort {
  abstract tryDecrypt(params: SlackActionParams): string | null;
  abstract tokenMissing(input: { incoming: SlackActionParams; existing?: SlackActionParams | null }): boolean;
  abstract persist(input: { incoming: SlackActionParams; existing?: SlackActionParams | null }): SlackActionParams;
  abstract redact(params: SlackActionParams): SlackActionParams;
}
```

`platform/app` composes **one** `SlackProviderAdapter` and passes it to the graph
ports, the dispatch wiring and `root.ts`. `providers/slack/server.ts:26-28`'s
free-function wrapper and `automation-graph-ports.ts:93-97`'s adapter both go.

## 4. Keep list

- **`subscribers/`** — event sourcing inside the server package is correct.
  `graph-trigger-activity.subscriber.ts` and
  `evaluation-alert-trigger-match.subscriber.ts` stay where they are; only their
  free-function shape folds into `AutomationEvaluationSubscriberService`.
- **The provider set** — `contract/src/providers/{slack,webhook,email,dataset,annotation-queue}.ts`
  and `web/src/providers/registry.ts` are an open set with one file per action.
  A new channel touches nothing else. That is correct design.
- **`AutomationTriggerMatchRecorderPort`** — three implementations across two
  packages, including the deliberate late-binding pair at
  `apps/worker/src/features/automation/automation-worker-feature.installer.ts:21,36`.
  Real polymorphism, and the installer comment (`:12-20`) earns its length.
- **The 14 cross-package ports** listed in P5 — genuine inversions. The feature
  must not reach `platform/app`.
- **`app/automation.app.ts`** — required by the layout, and it holds nine real
  rules. It gets bigger, not smaller.
- **`contract/src/templating/`** — 2,000 lines of Liquid rendering, block-kit
  allowlisting and template context, with its own 13-file test suite. A real
  domain, already the right shape.
- **`services/trigger-settlement-dispatch.service.ts`** — 3 methods with real
  retry/observability policy in `rethrowIfRetryable` (`:112-120`). Not a layer.
- **`services/graph-alert-dispatch.service.ts`** and
  `services/trigger-settlement-notification.service.ts` — hot correctness paths,
  well decomposed into private methods, inside their quality ceiling. They need
  comments (P12), not surgery.
- **The 21 `HandledError` classes** in `app/automation.app.ts:63-263` and
  `contract/src/automation.errors.ts:22-178`, every one with a
  `presentation.ts` entry. This is the reference for how the rest of the repo
  should look.

## 5. Cost and order

Nine commits, smallest risk first, each leaving the suite green.

1. **Delete the four empty `*Port` aliases; rename the base classes.**
   `AutomationClock` → `AutomationClockPort`, `ScheduledJobStore` →
   `ScheduledJobStorePort`, `SchedulerWake` → `SchedulerWakePort`,
   `UnsubscribeTokenVerifier` → `UnsubscribeTokenVerifierPort`. Mechanical, ~100
   references, satisfies `strict-port-module` honestly. No behaviour change.

2. **Fix `nextauthSecret` (P7).** Drop the parameter from
   `AppUnsubscribeTokenVerifier`, `AppAutomationRuntime.create`, and
   `AppAutomationGraphPorts`. Removes a live TS2554 introduced on this branch.

3. **Delete the dead code.** `AutomationNotFoundError`,
   `TriggerFireHistoryRepository.findStats`/`findRecent` and their Prisma
   implementations, the false comment above them, and the inline `import()` at
   `prisma.trigger-fire-history.repository.ts:113`. Trim the 47 `index.ts`
   symbols with no external importer.

4. **`database: PrismaClient` everywhere (P11).** Ten `as PrismaClient` casts go.
   Type-only.

5. **Errors (P9).** `InvalidUnsubscribeTokenError` and `TriggerNotFoundError`
   become `HandledError`s — the first folding into the existing
   `UnsubscribeLinkInvalidError`, the second into `AutomationNotInProjectError`.
   Deletes both `instanceof` sites and the three hand-rolled REST 404s.

6. **Collapse the graph chain (P3).** Delete `AutomationGraphService` and
   `GraphTriggerEvaluationService`; delete `AutomationGraphNotifierPort` and its
   `platform/app` wrapper; `GraphTriggerEvaluatorService` takes
   `GraphAlertDispatchService` directly. Three of four pass-throughs go.

7. **Collapse the same-package ports (P5, P6).** `AutomationGraphDeliveryPort`
   and its adapter (the duplicate `filterSuppressed` goes with it),
   `AutomationEvaluationTriggerFilterPort`,
   `AutomationSettlementExecutorPort`, `AutomationSettlementMatchConfirmationPort`,
   `AutomationWebhookProviderPort`, and the Slack-token quadruplication down to
   one `AutomationSlackProviderPort`.

8. **`AutomationPersistCapService` → a real class (P2).** Free functions become
   private methods, module Maps become fields, `AutomationPersistCapRedisPort`
   folds into `AutomationEmailCapStorePort`, the static twins and
   `resetMemoryStore` go. The riskiest commit: it changes cache lifetime from
   process to instance, so the persist-cap integration tests
   (`platform/app/.../automation-adapters/dispatch/__tests__/persistCap.integration.test.ts`)
   are the gate.

9. **The `upsert` rules move to `AutomationApp` (P8); the ClickHouse recency
   query moves behind `GraphTriggerSentRepository` (P1); write the ~120 comment
   lines P12 asks for**, starting with `claimSend`, the three meanings of
   `TriggerSent`, and the claim/send ordering in
   `trigger-settlement-notification.service.ts`.

Commits 1–5 are safe in any order and could land as one batch. Commit 9 is two
independent halves and can split if the REST/tRPC divergence needs its own spec
scenario first — it should, since it is a behaviour fix, not a refactor.

## 6. Blast radius

**27 files outside the feature import `@langwatch/automation-server`** — 17 in
`platform/app/src/runtime/app/features/`, 4 in `platform/app/src/server/`, 3 in
`apps/api/`, 1 in `apps/worker/`, plus tests. They use **74 symbols**, of which
`index.ts` exports 119; **47 exported symbols have no importer outside the
feature** (P3 of the cleanup list, commit 3).

The heaviest external consumers, by what they name:

| File | Symbols |
| --- | --- |
| `platform/app/src/server/app-layer/presets.ts` | `AppAutomationRuntime`, `AppAutomationClock`, `AutomationPersistCapService`, `PostgresAutomationGraphDeliveryAdapter`, `createAutomationTestFirePort`, `createAutomationTestRuntime` |
| `platform/app/src/runtime/app/features/automation-graph-ports.ts` | `GraphAlertDispatchService`, `WebhookProviderAdapter`, and 6 port classes |
| `platform/app/src/runtime/app/features/automation-dispatch.wiring.ts` | `AutomationSettlementDispatchService`, `SlackProviderAdapter`, `AutomationSettlement*Port` ×3 |
| `platform/app/src/server/event-sourcing/registration/pipelineRegistry.ts` | `createAutomationsPipeline` |
| `apps/api/src/features/automation/automation-trpc.mount.ts`, `app-rest.features.ts` | `AutomationTrpcApi`, `EmailSuppressionTrpcApi`, `createTriggerRestApp` |
| `apps/worker/src/features/automation/automation-worker-feature.installer.ts` | `AutomationTriggerMatchRecorderPort`, `AutomationIntentRetentionPort` |

**71 files import `@langwatch/automation-contract`** and **28 import
`@langwatch/automation-web`** — neither is touched by commits 1–8. Commit 5 is
the only one that reaches the contract package, and it changes two error base
classes plus one deletion.

Commits 6 and 7 delete symbols that `platform/app` currently imports
(`AutomationGraphNotifierPort`, `AutomationGraphDeliveryPort`,
`AutomationSettlementExecutorPort`, `AutomationSettlementMatchConfirmationPort`,
`AutomationSlackBotTokenDecryptorPort`) — five files in
`platform/app/src/runtime/app/features/` change in the same commit, and
`platform/app/src/server/api/root.ts:297` with them.

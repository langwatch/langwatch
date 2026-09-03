# coding-agent — cleanup review

Audited against [`feature-cleanup-review.md`](../../best_practices/feature-cleanup-review.md),
following the worked example [`dataset.md`](dataset.md).

## 1. What is there now

**20,942 lines, 136 non-test source files, 50 test files** across three packages:

| package        | non-test files | non-test lines | test files |
| -------------- | -------------: | -------------: | ---------: |
| `server/src`   |             52 |         10,059 |         26 |
| `contract/src` |             33 |          4,224 |          6 |
| `web/src`      |             51 |          6,659 |         18 |

**Eleven read operations, declared five times over.** The read path:

```
  apps/api  ·  transport/api-trpc/coding-agent.api.ts   (5 procedures, 287 ln)
              transport/api-rest/coding-agent.api.ts    (2 routes, 483 ln)
        │
  app/coding-agent.app.ts        CodingAgentApp          10 public methods
        │                                                ← 6 are one-line pass-throughs
  services/coding-agent.service.ts
                                 CodingAgentFeatureService 11 methods
        │                                                ← 11 of 11 are one-line
        │                                                  delegations; no rules of its own
        ├── services/coding-agent-session-read.service.ts        (337 ln, real)
        ├── services/coding-agent-pull-request-read.service.ts   (449 ln, real)
        ├── services/coding-agent-pull-request-mapping-backfill.service.ts (145 ln)
        └── services/coding-agent-trace-pull-request.service.ts  (144 ln)
                 ├── coding-agent-pull-request-assignment.service.ts  (103 ln, 0 fields)
                 ├── coding-agent-pull-request-usage.service.ts       (264 ln, 0 fields)
                 ├── coding-agent-personal-pull-request-values.service.ts (157 ln, 0 state)
                 └── coding-agent-session-list-pull-request.service.ts (148 ln)
        │
  repositories/*.repository.ts   4 abstract classes, 13 methods, + 4 Null twins
        │
  repositories/*/clickhouse.repository.ts   4 files, 1,944 ln
```

The write path (event-sourced — correct, and staying):

```
  projections/  8 files, 2,494 ln    subscribers/  5 files, 1,177 ln
        │
  adapters/eventing.coding-agent-projections.adapter.ts    3 append stores (110 ln)
  adapters/eventing.coding-agent-session-store.adapter.ts  fold store (204 ln)
        │
  contract/src/coding-agent-projection-persistence.ts
                                 CodingAgentProjectionPersistence  6 signatures
        │                                                ← one implementation, in the
        │                                                  sibling package
  adapters/coding-agent.adapter.ts
                                 CodingAgentProjectionPersistenceAdapter  6 methods
        │                                                ← 6 of 6 are one-line delegations
  repositories/  (same four as above)
```

The two paths meet through **two module-level `WeakMap`s** — see P2.

## 2. Problems

### P1 — `CodingAgentFeatureService` is a layer, not a component (breaks R3)

`services/coding-agent.service.ts:44-177`. Eleven methods. Every one is a single
delegation; nine are same-name and caught by `no-same-name-delegation-ts`
(lines 115, 122, 128, 134, 144, 148, 160, 166, 172); the other two rename only:

```ts
backfillPullRequestMappings(input) { return this.collaborators.mappingBackfill.backfill(input); }   // :138-142
linkTraceSessionsToPullRequests(input) { return this.collaborators.tracePullRequests.link(input); } // :154-158
```

Already baselined at `packages/architecture-lint/src/overengineering-baseline.json:13`.
The class holds no rule of its own; its only real content is the 47-line wiring
block in `create` (`:45-102`), which is composition-root work.

`app/coding-agent.app.ts` is the one facade the layout allows, and it earns it —
`getPullRequestUsage` (`:161-178`), `getPullRequestDetail` (`:181-197`),
`getPersonalProjectPullRequestUsage` (`:209-228`) and `githubConnection`
(`:235-251`) hold the tenancy boundary. But six of its ten public methods are the
second pass-through in the same chain:

| `app/coding-agent.app.ts`                     | body                                                            |
| --------------------------------------------- | --------------------------------------------------------------- |
| `:114-119` `getSessionEvents`                 | `return this.dependencies.codingAgents.getSessionEvents(input)` |
| `:122-124` `getUsageTotals`                   | same shape                                                      |
| `:127-129` `listRecent`                       | same shape                                                      |
| `:132-136` `listForProject`                   | same shape                                                      |
| `:139-141` `githubWebBase`                    | `return this.dependencies.github.getWebBase()`                  |
| `:144-146` `tryResolveOrganizationForProject` | same shape — **and no caller anywhere**                         |

`tryResolveOrganizationForProject` has zero call sites outside the class's own
two private uses (`:213`, `:263`). `githubConnection` (`:235`) is public with one
caller, itself (`:227`).

### P2 — Two `WeakMap`s smuggle repositories past a type that erased them (breaks R3, R5)

`adapters/coding-agent.adapter.ts:48-52`:

```ts
const projectionRepositories = new WeakMap<
  CodingAgentProjectionPersistence,
  CodingAgentRepositories
>();
const projectionClocks = new WeakMap<CodingAgentProjectionPersistence, CodingAgentClockPort>();
```

`CodingAgentProjectionPersistenceAdapter.create` builds the four repositories
(`:73`) and stashes them in a module-global side table (`:76-77`) because the
declared type of `CodingAgentRuntimeOptions.projections` is the contract's
abstract class (`:133`), which has no repositories on it. `CodingAgentRuntime.create`
then reads them back out (`:154-155`) and throws at runtime when it cannot:

```ts
if (repositories === undefined || clock === undefined) {
  throw new Error("CodingAgentProjectionPersistence must be package-created"); // :156-158
}
```

That is R5's exact shape — a compile-time guarantee traded for a runtime throw —
plus a hidden global. The abstraction being worked around is P3.

### P3 — `CodingAgentProjectionPersistence` has one implementation, six pass-throughs (breaks R3, R4)

`contract/src/coding-agent-projection-persistence.ts:9-47` declares six
signatures. The only non-test implementation is
`adapters/coding-agent.adapter.ts:60-130`, in the sibling package of the same
feature, and all six of its methods are one-liners:

| adapter                            | forwards to                                           |
| ---------------------------------- | ----------------------------------------------------- |
| `:81-87` `storeSession`            | `repositories.sessions.upsert`                        |
| `:89-97` `storeSessionBatch`       | `repositories.sessions.upsertBatch`                   |
| `:99-108` `loadSessionWithApplied` | `repositories.sessions.tryFindBySessionIdWithApplied` |
| `:110-115` `appendTraceSessions`   | `repositories.traceSessions.ensure`                   |
| `:117-122` `appendMetricSeries`    | `repositories.metricSeries.ensure`                    |
| `:124-129` `appendSessionEvents`   | `repositories.sessionEvents.ensure`                   |

The repositories are already abstract classes with `Null` twins
(`repositories/coding-agent-session.repository.ts:7,56`,
`coding-agent-session-event.repository.ts:8,44`,
`coding-agent-trace-session.repository.ts:4,16`,
`session-metric-series.repository.ts:12,26`), so the seam this port claims to
provide exists one layer down and is used there.

### P4 — Four contract methods are wrappers around exported free functions (breaks R3)

`contract/src/coding-agent.service.ts:45-62`:

```ts
buildTranscript(input)      { return buildCodingAgentTranscript(input); }   // :45-50
logContentKeys(eventName)   { return logContentKeys(eventName); }          // :52-54
contentAttrKeys(eventName)  { return contentAttrKeys(eventName); }         // :56-58
shouldFilterSpan(input)     { return shouldFilterCodingAgentSpan(input); } // :60-62
```

No subclass overrides any of the four (checked across `packages`, `platform`,
`apps`). Three of the four target functions are already public exports of the same
package — `logContentKeys` and `contentAttrKeys` via `contract/src/index.ts:13`,
`buildCodingAgentTranscript` via `:14`. The fourth,
`shouldFilterCodingAgentSpan` (`contract/src/telemetry/coding-agent-span-filter.ts:91`),
is reachable only through the wrapper today; `telemetry/index.ts` does not
re-export it, so the fix needs one export line.

The cost is paid outside the feature. `platform/app/src/server/app-layer/traces/claude-code-log-enrichment.ts:78`
writes both spellings of one call in a single expression:

```ts
for (const key of codingAgents?.contentAttrKeys(eventName) ?? contentAttrKeys(eventName)) {
```

They are provably the same value, so the optional `codingAgents` parameter
(`:77`) decides nothing. Two more consumers hold a whole eleven-method service to
reach one pure function — `packages/features/trace/server/src/services/trace-ingestion.service.ts:306`
(`shouldFilterSpan` only) and `.../transport/api-trpc/trace-read-mappers.api.ts:812`
(`logContentKeys` only) — and two test doubles restate all eleven abstract
methods to satisfy it: `platform/app/src/test-utils/test-coding-agent.service.ts`
(107 lines) and `packages/features/trace/server/src/services/__tests__/support/coding-agent.service.fake.ts`
(51 lines).

### P5 — A private copy of a registry-driven normaliser will silently drop the next agent (breaks R8) — **defect**

`services/coding-agent-session-read.service.ts:304-312` defines a private
`normalizeMetricName` with a hardcoded prefix regex:

```ts
const name = raw.replace(
  /^(claude_code|claude_cowork|cowork|opencode|codex|gemini_cli|github\.copilot|copilot)\./,
  "",
);
if (name === "token.usage" || name === "turn.token_usage") return "token_usage";
```

The canonical one is exported from the contract at
`contract/src/telemetry/coding-agent-normalization.ts:208-213`, and it is derived
from the agent registry:

```ts
return METRIC_ALIASES[stripAgentPrefix(rawMetricName)] ?? null; // :212
const METRIC_ALIASES = mergeAliasTables(
  BASE_METRIC_ALIASES,
  CODING_AGENT_REGISTRY.map((agent) => agent.metricAliases),
); // :257-260
```

`stripAgentPrefix` (`:544-551`) walks `CODING_AGENT_REGISTRY`. Add a seventh
agent to `contract/src/telemetry/` — the open set this feature is built around —
and the projection picks it up (`projections/coding-agent-session-metric.projection.ts:1`
imports the contract version) while `getUsageTotals` does not, because the regex
at `:306` never heard of it. Metric-only sessions for that agent will read as
zero tokens and zero cost.

`normalizeTokenType` is duplicated the same way:
`services/coding-agent-session-read.service.ts:314-330` against
`contract/src/telemetry/coding-agent-normalization.ts:561`. The copies agree
today; the contract version carries the comments explaining why (`:552-560`).

Also duplicated, byte-for-byte: `emitSystemPrompt` at
`contract/src/coding-agent-transcript-codex.ts:56-69` and
`contract/src/coding-agent-transcript-span.ts:87-100`.

### P6 — Two optional options; one is never supplied, the other never read when omitted (breaks R5)

`adapters/coding-agent.adapter.ts:139-146`:

```ts
export type CodingAgentProjectionPersistenceOptions = {
  clickHouse: CodingAgentClickHousePort | null;
  retention: { defaultTraceRetentionDays: number };
  readMetrics?: CodingAgentReadMetricsPort; // :144
  clock?: CodingAgentClockPort; // :145
};
```

Every non-test call site, repo-wide:

- `platform/app/src/server/app-layer/presets.ts:1796-1804` — passes `readMetrics`,
  omits `clock`.
- `platform/app/src/server/app-layer/presets.ts:3323-3326` (`createTestApp`) —
  passes `clickHouse: null`, so `createRepositories` returns the four `Null`
  repositories at `:178-185` and never reaches the `readMetrics` default at `:186`.

So `readMetrics` is supplied on every path that reads it, and `clock` is supplied
on no path at all — its default `SystemCodingAgentClock.create()` (`:71`) is the
only value it ever takes. Meanwhile the write path _does_ construct its own clock
(`platform/app/src/server/event-sourcing/registration/pipelineRegistry.ts:1053`),
so one process holds two `SystemCodingAgentClock` instances and the injection
point that would let a test replace the read-side one is never used by the
composition root.

### P7 — `index.ts` publishes 34 symbols; 12 have no external consumer (breaks R8)

`server/src/index.ts`. Zero references outside `packages/features/coding-agent/`:
`CodingAgentAppDependencies`, `CodingAgentCaller`, `CodingAgentClockPort`,
`CodingAgentCostMetricsPort`, `CodingAgentGithubConnection`,
`CodingAgentProcessingPipelineDeps`, `CodingAgentProjectionPersistenceOptions`,
`CodingAgentPullRequestRef`, `CodingAgentRuntimeOptions`, `CodingAgentTrpcRequest`,
`CodingAgentViewerVisibility`, `NoopCodingAgentReadMetricsPort`.

Worse, `index.ts:3` re-exports the concrete adapter under the abstract class's name:

```ts
CodingAgentProjectionPersistenceAdapter as CodingAgentProjectionPersistence,
```

so `CodingAgentProjectionPersistence` means the abstract class when imported from
`@langwatch/coding-agent-contract` and the concrete adapter when imported from
`@langwatch/coding-agent-server`. Nothing imports the alias.

### P8 — Two stateless classes threaded through four constructors (breaks R2's converse)

`CodingAgentPullRequestAssignmentService` (`services/coding-agent-pull-request-assignment.service.ts:2-49`)
and `CodingAgentPullRequestUsageService` (`services/coding-agent-pull-request-usage.service.ts:56-259`)
both declare `private constructor() {}` with **no fields** and `static create()`
with **no arguments**. Their methods are pure. `CodingAgentPersonalPullRequestValuesService`
(`coding-agent-personal-pull-request-values.service.ts:28-153`) holds only those
two and is itself pure.

They are constructed at `services/coding-agent.service.ts:62-67` and then threaded
as constructor dependencies into four places —
`coding-agent-personal-pull-request-values.service.ts:29-41`,
`coding-agent-session-list-pull-request.service.ts`,
`coding-agent-trace-pull-request.service.ts`, and
`coding-agent-pull-request-read.service.ts:56-58,73-75`, whose options object is
eleven fields wide (`:48-59`). Three of those eleven carry no state.

### P9 — A port outside `ports/`, and a utility module named `.repository.ts` (breaks R4, R2)

- `CodingAgentReadMetricsPort` is an abstract class ending in `Port`, declared in
  `adapters/coding-agent-read-metrics.adapter.ts:4-10`, not in `ports/`. It has
  two real implementations (`:12` Noop, and
  `platform/app/src/runtime/app/features/coding-agent.ts:27`), so the port is
  earned — only its address is wrong.
- `repositories/coding-agent-clickhouse/clickhouse.repository.ts` contains no
  repository. It exports four pure helpers — `asNumber` (`:4`), `asStringArray`
  (`:9`), `parseClickHouseDateTimeMs` (`:14`), `groupTenantsByClient` (`:19`) —
  used by two sibling ClickHouse repositories. R2 puts those in `utils/`.

### P10 — Comments that narrate a past the code no longer has (breaks R7)

- `adapters/eventing.coding-agent-session-store.adapter.ts:52` and `:95` both cite
  `createCodingAgentSessionSeenTouch`. No such symbol exists anywhere in the repo;
  the behaviour lives in `services/coding-agent-session-seen.service.ts`.
- `app/coding-agent.app.ts:1-24` — a 24-line header, of which ~11 lines
  (`:6-12`, `:52`) describe the shape the code had **before** this class existed
  ("each door declared its own bag", "two names for one shape, agreeing only
  because nobody had changed either"). ADR material.
- `transport/api-trpc/coding-agent.api.ts:77-79` and
  `transport/api-rest/coding-agent.api.ts:105-109`, `:251`, `:448` repeat the same
  before/after narrative at four more sites.
- `adapters/eventing.coding-agent-session-store.adapter.ts:31` cites "PR #5708's
  trace-keyed store" — a pull-request number in a source comment.

There is no comment block over 60 lines; `comment-block-size` is clean.

### Clean on R1 and R6

**R1** — no service holds a database client. `ClickHouseClient` appears only in
`ports/coding-agent-clickhouse.port.ts:5` and inside `repositories/*/`
(`coding-agent-session/clickhouse.repository.ts:2,657`,
`coding-agent-session-event/clickhouse.repository.ts:1,432`,
`coding-agent-clickhouse/clickhouse.repository.ts:1`). No `PrismaClient`, no
`$transaction`, anywhere in the feature.

**R6** — no bespoke error taxonomy, no `Record<name, {status, code}>` map, no
`instanceof` ladder in either transport. The REST family throws
`ValidationError.fromZodError` (`transport/api-rest/coding-agent.api.ts:12,124`)
and the app throws the shared `GithubPullRequestNotMappedError`
(`app/coding-agent.app.ts:42,267`). The four remaining `throw new Error` sites
(`adapters/coding-agent.adapter.ts:157`,
`subscribers/coding-agent-span-facts-dispatch.subscriber.ts:193,206,364`) are
programmer-error and infrastructure assertions — correctly plain.

## 3. What it should look like

```
contract/src/
  coding-agent.service.ts            ~95   11 abstract signatures only — the four
                                           concrete wrappers deleted; consumers import
                                           the pure functions the package already exports
  coding-agent-projection-persistence.ts    DELETED (P3)
  coding-agent-transcript-span.ts           keeps the single emitSystemPrompt;
                                            codex imports it
  telemetry/                                unchanged — the open agent set

server/src/
  app/coding-agent.app.ts            ~300   the one facade. Absorbs the four
                                            collaborators directly; the six
                                            pass-throughs become real reads;
                                            tryResolveOrganizationForProject deleted,
                                            githubConnection made private
  services/
    coding-agent-session-read.service.ts        337  unchanged but for P5
    coding-agent-pull-request-read.service.ts   449  unchanged, 8 deps instead of 11
    coding-agent-pull-request-mapping-backfill.service.ts 145
    coding-agent-trace-pull-request.service.ts  ~140
    coding-agent-session-list-pull-request.service.ts ~145
    coding-agent-session-seen.service.ts         72
    coding-agent.service.ts                     DELETED (P1)
  utils/
    pull-request-assignment.ts        ~100   was a 0-field class (P8)
    pull-request-usage.ts             ~260   was a 0-field class (P8)
    personal-pull-request-values.ts   ~155   was a 0-state class (P8)
    clickhouse-values.ts               ~35   was repositories/coding-agent-clickhouse/ (P9)
  ports/
    coding-agent-billing.port.ts        11
    coding-agent-clickhouse.port.ts      6
    coding-agent-clock.port.ts           4
    coding-agent-cost-metrics.port.ts   11
    coding-agent-trace-processing.port.ts 22
    coding-agent-read-metrics.port.ts   ~12   moved out of adapters/ (P9)
  repositories/  projections/  subscribers/  transport/   unchanged
  adapters/
    coding-agent.adapter.ts           ~120   CodingAgentRuntime only; the persistence
                                             adapter and both WeakMaps gone (P2, P3)
```

**≈47 server files, ≈9,300 lines.** Three layers on the read path instead of five;
two on the write path instead of four.

### The runtime, without the side table

`CodingAgentRuntime` builds the repositories once and hands them to both halves.
The eventing adapters take the repositories they actually write to, so the
contract's persistence port and the `WeakMap`s both disappear, and with them the
`"must be package-created"` throw:

```ts
export type CodingAgentRuntimeOptions = {
  clickHouse: CodingAgentClickHousePort | null;
  retention: { defaultTraceRetentionDays: number };
  readMetrics: CodingAgentReadMetricsPort; // required — presets always passes it
  clock: CodingAgentClockPort; // required — one clock per process
  github: GithubService;
  projects: ProjectService;
  billing: CodingAgentBillingPolicyPort;
};

export class CodingAgentRuntime {
  readonly service: CodingAgentService;
  readonly repositories: CodingAgentRepositories; // named, not smuggled

  static create(options: CodingAgentRuntimeOptions): CodingAgentRuntime {
    const repositories = createRepositories(options);
    return new CodingAgentRuntime(
      CodingAgentApp.create({ ...options, repositories }),
      repositories,
    );
  }
}
```

`EventingCodingAgentSessionStoreAdapter.create` and the three append adapters take
`sessions` / `traceSessions` / `metricSeries` / `sessionEvents` directly instead
of `persistence: CodingAgentProjectionPersistence`, dropping one hop each.

### The contract service, with nothing to wrap

```ts
export abstract class CodingAgentService {
  abstract getSessionEvents(input: CodingAgentSessionEventsInput): Promise<{ ... }>;
  // ... the ten others, unchanged
}
```

and the three consumers stop holding a service to reach a function:

```ts
// trace-ingestion.service.ts
import { shouldFilterCodingAgentSpan } from "@langwatch/coding-agent-contract";
if (shouldFilterCodingAgentSpan({ scopeName, spanName, attributeKeys })) return;

// claude-code-log-enrichment.ts:78 — one spelling, and the parameter goes
for (const key of contentAttrKeys(eventName)) {
```

Both test doubles shrink by the four methods they never exercised, and
`trace-ingestion.service.ts` loses a constructor dependency outright.

### The normaliser, said once

`services/coding-agent-session-read.service.ts:304-330` deletes both private
copies and imports what its sibling projection already imports:

```ts
import { normalizeMetricName, normalizeTokenType } from "@langwatch/coding-agent-contract";
```

`METRIC_ALIASES` already carries `turn.token_usage` through
`CODING_AGENT_REGISTRY` (`coding-agent-normalization.ts:257-260`), so the read
gains the registry's agents rather than losing anything. Pin it with a test that
folds a metric-only session for an agent added to the registry after the read
service was written.

## 4. Keep list

- **`app/coding-agent.app.ts`** — required by the layout, and it holds the real
  cross-transport rules: the organization resolution both doors would otherwise
  duplicate (`:260-271`), the caller's permission cut taken from the organization
  rather than the request (`:166-169`), and the orphan-project reading
  (`:216-221`). Only the six pass-throughs go.
- **`projections/` and `subscribers/`** — event sourcing inside the server package
  is correct here and stays where it is. 2,494 + 1,177 lines of real derivation.
- **The five `ports/` files.** `CodingAgentBillingPolicyPort`,
  `CodingAgentClickHousePort` and `CodingAgentTraceProcessingPort` each have their
  single implementation in `platform/app` — genuine cross-package inversions
  (`platform/app/src/runtime/app/features/coding-agent.ts:12,46`,
  `coding-agent-trace-processing.adapter.ts:12`). `CodingAgentReadMetricsPort` has
  two. `CodingAgentClockPort` has one in-package implementation, but a per-feature
  clock port is the house pattern — `auth/server/src/ports/auth-clock.port.ts:2`,
  `scenario/server/src/ports/scenario-clock.port.ts:1`,
  `automation/server/src/ports/automation-clock.port.ts:1` — and it is what makes
  the seven-day read window testable. `CodingAgentCostMetricsPort` (11 lines, one
  in-package implementation) is the marginal one; it is small enough that deleting
  it buys nothing, and the OTel adapter is a real boundary.
- **`adapters/eventing.contribute-{log,span,metric}-facts.adapter.ts`** — one file
  per fact source, and each differs where it matters: the idempotency keys at
  `:47` (log, record hash), `:46` (span, trace+span) and the metric equivalent are
  three different correctness decisions. An open set; new sources arrive without
  touching the others.
- **`adapters/eventing.coding-agent-projections.adapter.ts`** — 110 lines for three
  one-line appends looks thin, but the base class at `:16-32` owns the
  retention-default fallback, which is load-bearing and belongs in one place.
- **`repositories/coding-agent-session/clickhouse.repository.ts`** (1,040 lines) and
  **`projections/coding-agent-session.projection.ts`** (783 lines) — hot
  correctness paths, already inside their quality ceiling. Length is the only
  complaint and it is not one worth acting on.
- **`web/`** — 51 files of components and pure display logic, explicit exports,
  no server dependency. Nothing to do.
- **`contract/src/telemetry/`** — eleven files, one per agent plus the shared
  registry. The canonical open set; it is what P5 exists to protect.

## 5. Cost and order

Five commits, smallest risk first, each leaving the suite green:

1. **P5 + the duplicate `emitSystemPrompt`.** Delete three private copies, import
   the canonical functions. Touches two files, fixes a live defect, no structural
   change. Add the registry-drift test.
2. **P4 + P10.** Delete the four concrete methods from
   `contract/src/coding-agent.service.ts`, export `shouldFilterCodingAgentSpan`
   from `telemetry/index.ts`, repoint the three consumers at the exported
   functions, drop the now-inert `codingAgents?` parameter in
   `claude-code-log-enrichment.ts`. Move the archaeology out of the six comment
   sites into an ADR; delete the two `createCodingAgentSessionSeenTouch`
   references. Shrinks both test doubles.
3. **P8 + P9.** Three stateless classes become `utils/` modules; the eleven-field
   options object at `coding-agent-pull-request-read.service.ts:48-59` drops to
   eight. Move `CodingAgentReadMetricsPort` into `ports/`, rename the misfiled
   `coding-agent-clickhouse/clickhouse.repository.ts` to `utils/clickhouse-values.ts`.
   Mechanical, import-only.
4. **P1.** Delete `services/coding-agent.service.ts`; `CodingAgentApp` composes the
   four collaborators and implements `CodingAgentService` itself. Delete the two
   dead app methods. Remove the baseline entry at
   `packages/architecture-lint/src/overengineering-baseline.json:13`.
5. **P2 + P3 + P6 + P7.** Delete `CodingAgentProjectionPersistence`, the persistence
   adapter, both `WeakMap`s and the runtime throw; point the eventing adapters at
   the repositories. Make `readMetrics` and `clock` required, threading the process
   clock from `pipelineRegistry.ts:1053` into `presets.ts:1796` so there is one.
   Trim `index.ts` to the ~22 symbols with consumers and drop the shadowing alias
   at `:3`. The only commit that touches `platform/app` composition — do it last.

## 6. Blast radius

**11 files outside the feature import `@langwatch/coding-agent-server`:**
`apps/api/src/index.ts`, `apps/api/src/app-rest/app-rest.features.ts`,
`apps/api/src/features/coding-agent/coding-agent-trpc.mount.ts`,
`packages/features/trace/server/src/repositories/clickhouse/stored-span-row.codec.ts`,
`platform/app/src/runtime/app/features/coding-agent.ts`,
`platform/app/src/runtime/app/features/coding-agent-trace-processing.adapter.ts`,
`platform/app/src/runtime/app/__tests__/subscriber-throttle-policy.unit.test.ts`,
`platform/app/src/server/app-layer/app.ts`,
`platform/app/src/server/app-layer/dependencies.ts`,
`platform/app/src/server/app-layer/presets.ts`,
`platform/app/src/server/event-sourcing/registration/pipelineRegistry.ts`.

They use 22 of the 34 exported symbols. By external reference count:
`createCodingAgentRestApp` (7), `CodingAgentApp` (6),
`CodingAgentSessionListReadOutcome` (4), `CodingAgentRuntime` /
`CodingAgentProjectionPersistenceAdapter` / `EventingCodingAgentProcessingAdapter` /
`OtelCodingAgentCostMetricsAdapter` (3 each), and 2 each for `CodingAgentTrpcApi`,
`CodingAgentTrpcContext`, `CodingAgentTrpcPorts`, `CodingAgentRestAuditPort`,
`CodingAgentScopePorts`, `CodingAgentBillingPolicyPort`, `CodingAgentClickHousePort`,
`CodingAgentReadMetricsPort`, `CodingAgentTraceProcessingPort`,
`SystemCodingAgentClock` and the four subscriber factories.
`CodingAgentCallerScope` has one.

**22 files import `@langwatch/coding-agent-contract`** — the surface commit 2 and
commit 5 change. The four contract methods removed in commit 2 are reached from
four call sites (`trace-ingestion.service.ts:306`,
`trace-read-mappers.api.ts:812`, `traces-v2.api.ts:542`,
`claude-code-log-enrichment.ts:78`) plus the two test doubles.
`CodingAgentProjectionPersistence`, removed in commit 5, is referenced outside the
feature only by `pipelineRegistry.ts:406`.

**18 files import `@langwatch/coding-agent-web`** — untouched by every commit above.

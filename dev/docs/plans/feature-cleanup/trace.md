# trace — cleanup review

Written against [`feature-cleanup-review.md`](../../best_practices/feature-cleanup-review.md),
shaped after the worked example [`dataset.md`](./dataset.md).

**Verdict up front:** this is not `dataset`. The layer stack is honest — no service
holds a database client (R1 clean), the app facade has zero optional dependencies
(R5 clean at the top), and `TraceApp` earns its keep (17 of 53 members are pure
pass-throughs, not 22 of 26). What is wrong here is **sprawl, not depth**: a
59-file flat `services/` bin holding two unrelated populations, a 2,410-line query
compiler filed under `adapters/`, 128 exports nobody outside imports, 25 comment
sites naming files that no longer exist, and one genuinely dead module.

---

## 1. What is there now

**56,043 lines across 376 non-test files**, in three published packages.

| Package                     | Files |  Lines |       External importers |
| --------------------------- | ----: | -----: | -----------------------: |
| `@langwatch/trace-server`   |   181 | 29,990 |                       50 |
| `@langwatch/trace-contract` |    60 |  8,427 |                      237 |
| `@langwatch/trace-web`      |   135 | 17,626 | 235 (all `platform/app`) |

Plus 90 test files in the server package.

### Server layer stack

```
  TRANSPORT                                                 9 files   4,358 lines
    transport/api-trpc/     5 routers  (traces-v2 1,534 · traces 565 · shared-trace 415
                                        · trace-edit-overlay 225 · spans 125)
                            + trace-read-mappers.api.ts    899   (mappers, not a router)
                            + trace-view-gates.api.ts      206   (gates, not a router)
    transport/api-rest/     trace-export 249 · tracked-event 140
        │                        ▲
        │                        └── 3 transport files import from ../../services/  ⚠
        ▼
  APPLICATION                                               1 file    1,041 lines
    app/trace.app.ts        TraceApp                  50 methods + 3 collaborator getters
                            + 11 collaborator interfaces declared inline (lines 78–301)
        │
        ├─────────────────────────────┬──────────────────────────┐
        ▼                             ▼                          ▼
  SERVICES                      PORTS                      PROJECTIONS / SUBSCRIBERS
   services/    75 files         ports/  26 files           projections/  4 files 2,311
     *.rules.ts    42  5,372       29 abstract classes         trace-derived     1,266
     *.service.ts  17  3,747       56 abstract signatures      trace-summary       802
     canonicalisation/ 16 1,287    (16 implemented in          trace-rollup        169
                                    platform/app — real       span-storage          74
                                    inversions)              subscribers/ 8 files 1,424
        │                             │                          │
        ▼                             ▼                          ▼
  ADAPTERS                                                  33 files   4,240 lines
    adapters/  eventing.*           10 files  1,167   true adapters
               *.clickhouse.adapter 19 files  2,882   ⚠ 18 of these are a PURE
               null-*                3 files     88     SQL/AST compiler — no client,
               clickhouse.trace       1 file    159     no port, no async  (2,410 lines)
        │
        ▼
  STORES / REPOSITORIES                                    23 files   5,256 lines
    stores/         8 files   600   (fold state bags + eventing stores)
    repositories/   3 files   165   (abstract)
    repositories/clickhouse/ 12 files 4,491
        trace-list 1,225 · trace-summary 597 · trace-analytics 559 · trace-span 546
        trace-full-record.mapper 502 · trace-full-record 335 · stored-span-row.codec 241 …
        │
        ▼
  ClickHouse
```

### The one composition root

```
platform/app/src/server/app-layer/app.ts:478-486     ← the ONLY TraceApp.create()
platform/app/src/server/app-layer/presets.ts:2675    ← the 13-member `traces` bag
platform/app/src/runtime/app/features/trace.ts:339   ← the ONLY ClickHouseTraceAdapter.create()
platform/app/src/runtime/app/trace-projections.adapter.ts:111
platform/app/src/server/event-sourcing/registration/pipelineRegistry.ts:1250
```

`TraceAppDependencies` (`app/trace.app.ts:274-301`) has **zero optional fields**, and
production supplies all 16. `trace.app.ts` contains **no `throw` statements at all**.
There is no dead optionality tree here. R5 problems exist, but they are two layers
down and much smaller (P8).

---

## 2. Problems

### P1 — `services/` is one flat bin holding two unrelated populations (R2, R8)

59 top-level files, of which **42 are `*.rules.ts` (5,372 lines)** and 17 are
`*.service.ts`. **21 of the 42 have exactly one importer.**

The 42 split cleanly into two populations that share nothing:

**(a) Vendor canonicalisation rules — 24 files**, each imported by exactly one
canonicaliser one directory down:

| Canonicaliser                                  | Lines | Its rules files, one directory up                                                                                      | Their lines |
| ---------------------------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------- | ----------: |
| `canonicalisation/langwatch.canonicaliser.ts`  |    19 | `langwatch-value` · `langwatch-metrics` · `langwatch-metadata` · `langwatch-identity` (+ `langwatch-structured-value`) |         408 |
| `canonicalisation/vertex-adk.canonicaliser.ts` |    23 | `vertex-adk-core` · `-request` · `-response` · `-tool-call`                                                            |         291 |
| `canonicalisation/gen-ai.canonicaliser.ts`     |    19 | `gen-ai-span` · `gen-ai-log`                                                                                           |         335 |
| `canonicalisation/codex.canonicaliser.ts`      |    21 | `codex-span` · `codex-log` (+ `codex-canonical-value`)                                                                 |         325 |
| `canonicalisation/vercel.canonicaliser.ts`     |    17 | `vercel-core` → `vercel-tool-call` · `vercel-io`                                                                       |         292 |
| `canonicalisation/mastra.canonicaliser.ts`     |   249 | `mastra-value`                                                                                                         |         225 |
| `services/trace-canonicalisation.service.ts`   |   226 | `claude-code-request` → `claude-code-truncated-request` (+ `-response`, `-content`, `-call-policy`)                    |         919 |

`vercel.canonicaliser.ts` in full — this is the whole file:

```ts
export class VercelCanonicaliser implements CanonicalAttributesPort {
  readonly id = "vercel";

  apply(ctx: ExtractorContext): void {
    if (!canonicaliseVercelCore(ctx)) {
      return;
    }
    canonicaliseVercelIO(ctx);
  }
}
```

**(b) Infrastructure rules — 18 files** that have nothing to do with vendors: shard
keys, payload caps, storage anchors, analytics trims, span identity, summary
attributes.

Adding a vendor today means touching `services/canonicalisation/` **and** dropping
2–5 more files into the same flat directory the shard-key math lives in. The open
set is real (see the Keep list) — the flat bin around it is not.

### P2 — `services/canonical-value.rules.ts` is dead (R8)

43 lines. **Zero production importers.** Its only importer:

```
services/canonicalisation/__tests__/strands.unit.test.ts:4:
  import { toAttrValue } from "../../canonical-value.rules";
```

A test fixture helper living in the production tree, exported from a `.rules.ts`
file as if it were a rule. Not re-exported from `index.ts`.

### P3 — Two `capPayloadString` implementations, same algorithm, same marker (R8)

| File                                  |                     Lines | Consumers                                                                                             |
| ------------------------------------- | ------------------------: | ----------------------------------------------------------------------------------------------------- |
| `services/payload-cap.rules.ts`       |                        22 | `claude-code-request.rules.ts:4`, `claude-code-response.rules.ts:3`, `claude-code-content.rules.ts:1` |
| `services/trace-payload-cap.rules.ts` | 75 (48 comment / 24 code) | `index.ts` only → 2 external files                                                                    |

Byte-identical marker string in both — `payload-cap.rules.ts:15` and
`trace-payload-cap.rules.ts:54`:

```ts
const marker = `…[langwatch: truncated${labelPart}, ${byteSize} bytes total]`;
```

The short one **forks the constant** rather than importing it:

```ts
// payload-cap.rules.ts:1
const DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES = 256 * 1024;

// trace-payload-cap.rules.ts:31 — the correct version
import { DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES } from "./trace-attribute-cap.rules";
```

`DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES` is also published from `index.ts` and imported
by one external file. Three declarations of one number; raising the cap in
`trace-attribute-cap.rules.ts` silently leaves the three Claude Code lift sites at
the old value.

### P4 — Five more helpers defined two or three times each (R8)

| Helper                 | Definitions                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isRecord`             | `repositories/clickhouse/trace-full-protection.mapper.ts:176` · `repositories/clickhouse/trace-full-record.mapper.ts:301` · `services/canonical-guard.rules.ts:4` |
| `safeStringify`        | `services/canonical-guard.rules.ts:102` · `services/langwatch-structured-value.rules.ts:17` · `services/claude-code-response.rules.ts:255`                        |
| `stringifyToolPayload` | `services/vercel-tool-call.rules.ts:53` · `services/gemini-content.rules.ts:146` — **behaviourally identical**, one written as `function`, one as `const`         |
| `utf8ByteLength`       | `services/trace-attribute-cap.rules.ts:51` · `services/trace-payload-cap.rules.ts:34`                                                                             |
| `traceScopeSchema`     | `transport/api-trpc/trace-edit-overlay.api.ts:104` · `traces.api.ts:148` · `spans.api.ts:70` — same `z.object({ projectId, traceId })` three times                |

Separately, `asNumber` has **three divergent** definitions
(`canonical-guard.rules.ts:29` handles `bigint`; `codex-canonical-value.rules.ts:17`
handles `""` but not `bigint`; `repositories/clickhouse/trace-analytics.repository.ts:27`
is a third shape). That is not a duplicate to merge — it is three coercion policies
that a reader has to discover per call site.

There is no `utils/` directory in this package. R2 says shared pure utilities get
one; the absence is why they keep re-appearing.

### P5 — `adapters/` holds a 2,410-line SQL compiler that is not an adapter (R2)

**18 of the 33 files in `adapters/`** contain no client, no port, no `extends`, and
no `async` — they are pure functions from a filter AST to a ClickHouse SQL string:

```
  433  adapters/trace-query-meta-fields.clickhouse.adapter.ts
  397  adapters/trace-query.clickhouse.adapter.ts
  285  adapters/trace-query-fields.clickhouse.adapter.ts
  265  adapters/trace-query-translators.clickhouse.adapter.ts
  147  adapters/trace-query-values.clickhouse.adapter.ts
   92  adapters/trace-query-evaluation.adapter.ts
   87  adapters/trace-query-custom-fields.clickhouse.adapter.ts
   27  adapters/trace-query-subquery.clickhouse.adapter.ts
  + 10 trace-facet-*.clickhouse.adapter.ts (578 lines)
```

The cost is a layering inversion the ASCII stack shows: `services/` imports upward
into `adapters/` because that is where the compiler ended up.
`services/trace-query-evaluation.service.ts:15,20,21,22,31` imports from **five**
of them. Nothing about them is an adapter; nothing about them is ClickHouse-client
shaped. Renaming `adapters/` to `query/` for these 18 files removes the inversion
without moving a line of logic.

### P6 — Pass-throughs (R3)

- `services/trace-span-command-shard.rules.ts:39-47` — `spanShardIndex` is
  `return shardIndexFor(spanId, shardCount)`. Its **only** caller is
  `spanCommandGroupKey` ten lines below (`:67`), and it is not re-exported from
  `index.ts`. Nine lines of signature and doc comment for one call.
- `app/trace.app.ts:334-346` — three getters (`logRecords`, `canonicalisation`,
  `codingAgents`) hand collaborators out of the facade as values. The transport
  consumes them at `transport/api-trpc/traces-v2.api.ts:403,404,454,459,460`. The
  same file **also** reaches around the facade for the same collaborator at
  `traces-v2.api.ts:1231` and `:1529` (`ctx.app.traces.codingAgents`). Two routes
  to one object; the facade's own docblock (`trace.app.ts:322-332`) explains why the
  hole exists but not why there are two of them.
- 17 of 53 `TraceApp` members are single-expression delegations
  (`readTopicCounts:560`, `readCustomersAndLabels:565`, `readTraceList:625`,
  `readSessionGroups:630`, `readFacets:637`, `readNewCount:644`, `readSuggestions:649`,
  `readDiscover:654`, `readFacetValues:659`, `readSpanTreePage:890`,
  `readSpanTreeDelta:895`, `readEvaluationRuns:986`, `readCodingAgentSession:993`,
  plus the three getters and `getTenantEmitter:611`). That is a facade doing its job,
  not a layer to delete — **noted so nobody deletes it**.

### P7 — Comments (R7)

Package-wide the ratio is fine: **5,793 comment lines to 21,674 code lines (0.27)**.
The problem is concentrated.

**Six files carry more comment than code, most by 2× or more:**

| Ratio | Comment / code | File                                                     |
| ----: | -------------: | -------------------------------------------------------- |
|  4.36 |        48 / 11 | `services/trace-span-storage-group.rules.ts`             |
|  2.80 |        98 / 35 | `services/trace-storage-anchor.rules.ts`                 |
|  2.36 |        26 / 11 | `adapters/trace-facet-span-status.clickhouse.adapter.ts` |
|  2.09 |        46 / 22 | `services/trace-viewer-protections.service.ts`           |
|  2.03 |        59 / 29 | `services/trace-span-command-shard.rules.ts`             |
|  2.00 |        48 / 24 | `services/trace-payload-cap.rules.ts`                    |

Every one is an **incident narrative or a rollout note**, exactly the class R7 sends
to an ADR. `trace-span-storage-group.rules.ts:1-29` is a 29-line header for a 6-line
function; it recounts a dated backlog and does fleet-capacity arithmetic:

> "…the drain floor measured in the 2026-07-30/31 backlog, where spanStorage held
> ~118 of ~1,030 busy fleet slots…"
> "Rollout note: old `span:{eventId}` groups drain naturally under their historic
> keys…"

`trace-storage-anchor.rules.ts:12-13` files an incident and `:36-39` documents a
superseded design:

> "…is what filed a log-only trace (Claude Code / Codex "Path B") in partition
> `196952` with a TTL deadline of `1970 + retention`, already years past."
> "Before the freeze this self-corrected - `min(span start)` pulled the live row
> back into a real partition…"

**17 distinct file references in comments point at files that no longer exist**, at
25 sites. R7's own example. The full list:

| Named file                                   | Cited at                                                                                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./services/storage-anchor.ts` (a `{@link}`) | `projections/trace-derived.projection.ts:383,464`                                                                                                         |
| `traceAnalytics.foldProjection.ts`           | `services/trace-storage-anchor.rules.ts:15`                                                                                                               |
| `commandShardKey.ts`                         | `services/trace-span-storage-group.rules.ts:15`                                                                                                           |
| `spanStorageGroupKey.ts`                     | `projections/span-storage.projection.ts:33`                                                                                                               |
| `trace-request-collection.service.ts`        | `projections/trace-summary.projection.ts:461`                                                                                                             |
| `claudeCode.ts`                              | `services/trace-io-accumulation.service.ts:126`                                                                                                           |
| `meta-handlers.ts`                           | `adapters/trace-facet-registry.clickhouse.adapter.ts:164` · `adapters/trace-query.clickhouse.adapter.ts:385` · `contract/src/trace-query-metadata.ts:451` |
| `filter-to-clickhouse/ast.ts`                | `adapters/trace-facet-event-attribute-keys…:25` · `…metadata-keys…:20` · `…span-attribute-keys…:34`                                                       |
| `filter-to-clickhouse/build-handlers.ts`     | `adapters/trace-facet-registry.clickhouse.adapter.ts:54`                                                                                                  |
| `build-handlers.ts`                          | `adapters/trace-query-evaluation.adapter.ts:76`                                                                                                           |
| `span-attribute-keys.ts`                     | `adapters/trace-facet-event-attribute-keys…:19` · `…metadata-keys…:26`                                                                                    |
| `facet-registry.ts`                          | `adapters/trace-facet-query.clickhouse.adapter.ts:12`                                                                                                     |
| `metadata-keys.ts`                           | `web/src/facet-constants.ts:45`                                                                                                                           |
| `densityStore.ts`                            | `web/src/url-state.ts:2`                                                                                                                                  |
| `mutations.ts`                               | `contract/src/trace-query-analysis.ts:4` · `contract/src/trace-query-ast.ts:3`                                                                            |
| `queries.ts`                                 | `contract/src/trace-query-ast.ts:2`                                                                                                                       |
| `_extraction.ts`                             | `contract/src/trace-span-io.ts:47`                                                                                                                        |

One more outside the package, pointing back in:
`platform/app/src/runtime/app/trace-processing.adapter.ts:97` says "See
`spanCommandGroupKey.ts`" — that file has not existed since the rules files were
renamed.

### P8 — Optional dependencies production always supplies (R5)

Two clusters, both small, both real.

**(a) `ClickHouseTraceAdapterOptions` — four optional ports with `?? Null…` defaults.**

```ts
// adapters/clickhouse.trace.adapter.ts:33-36
  queryClassification?: TraceQueryClassificationPort;
  summaryReader?: TraceSummaryReaderPort;
  records?: TraceRecordPort;
  eventDerivation?: TraceEventDerivationPort;

// :69-73  — the four defaults
      queryClassification: this.options.queryClassification ?? NullTraceQueryClassificationAdapter.create(),
      summaryReader: this.options.summaryReader ?? new NullTraceSummaryReader(),
      records: this.options.records ?? new NullTraceRecordPort(),
      eventDerivation: this.options.eventDerivation ?? new NullTraceEventDerivationPort(),
```

`ClickHouseTraceAdapter.create(` has exactly **one** caller in the whole repo —
`platform/app/src/runtime/app/features/trace.ts:339-347` — and it passes all four
unconditionally. **All four `??` branches are unreachable in production.** (The
`Null*` classes themselves stay: `createNull` at `:50-61` is a live production path
via `presets.ts:2109` when ClickHouse is disabled. Only the optionality goes.)

**(b) `windowedReadMetrics` — optional in two repositories, never absent.**

Declared optional at `repositories/clickhouse/trace-summary.repository.ts:102,109`
and `trace-analytics.repository.ts:187,194`; defaulted at
`repositories/clickhouse/windowed-read.ts:22`:

```ts
const metrics = options.metrics ?? new NullTraceWindowedReadMetricsAdapter();
```

Every production construction passes it — `presets.ts:1346`, `presets.ts:1838`,
`presets.ts:1852`, `platform/app/src/runtime/app/replay-runtime.adapter.ts:89`.
`NullTraceWindowedReadMetricsAdapter` (`adapters/null-trace-windowed-read-metrics.adapter.ts`,
11 lines) is **constructed nowhere else in the repo** and is dead in production.

### P9 — `index.ts` publishes 275 names; 128 are never imported outside (R8)

385 lines, no `export *` (good discipline), 188 value exports and 98 type-only
exports. Measured against all 50 external non-test importers of
`@langwatch/trace-server`:

- **147 names are imported externally.**
- **128 are not — 78 of them values.**

The unused-value set includes eleven whole service classes and projections
(`SpanStatusService`, `SpanTimingService`, `TraceOriginService`,
`TraceNameResolutionService`, `TraceAttributeAccumulationService`,
`TracePromptAccumulationService`, `TraceAnalyticsFoldProjection`,
`TraceSummaryFoldProjection`, `EventingTraceProcessingAdapter`, `IdUtils`,
`TraceRequestUtils`), fifteen constants (`RESERVED_CACHE_READ_TOKENS`,
`RESERVED_CACHE_CREATION_TOKENS`, `RESERVED_REASONING_TOKENS`, `KNOWN_FIELDS`,
`FIELD_DEFS`, `HIDDEN_RESOURCE_ATTRS`, `MAX_SPAN_SHARD_COUNT`,
`SPAN_STORAGE_MAP_SHARD_COUNT`, `TRACE_SPAN_MAP_COALESCE_MAX_BATCH`,
`TRACE_ANALYTICS_PROJECTION_VERSION_LATEST`, `…_PRE_SPLIT`,
`TRACE_SUMMARY_READ_WINDOW_MS`, `RECORD_SPAN_DEDUPLICATION`, `OUTPUT_SOURCE`,
`SessionTitleRedactionFlag`), and every one of the seven `gate*` functions plus
every `mapSpan*` / `redact*` mapper that `trace-read-mappers.api.ts` already shares
internally with `shared-trace.api.ts`.

Of the 147 that _are_ used, only **26 are used by more than one file**; `Protections`
alone accounts for 16.

Two `.rules.ts` files exist solely to feed this barrel:
`services/scenario-role-metrics.rules.ts` (116 lines) and
`services/trace-payload-cap.rules.ts` (75) have **no in-package importer at all** —
their only importer is `index.ts`. They are API surface filed under `services/`.

### P10 — `TraceNotFoundError` exists twice, only one is handled (R6)

```
contract/src/trace.errors.ts:3
    export class TraceNotFoundError extends Error          ← plain Error

platform/app/src/server/app-layer/traces/errors.ts:10
    export class TraceNotFoundError extends NotFoundError  ← HandledError, code "trace_not_found"
```

Both are imported into the same file under different names:

```
platform/app/src/runtime/app/features/trace.ts:13
    import { TraceNotFoundError, traceRecordSchema } from "@langwatch/trace-contract";
platform/app/src/runtime/app/features/trace.ts:59
    import { TraceNotFoundError as AppTraceNotFoundError } from "~/server/app-layer/traces/errors";
```

`:195` throws the **contract** one out of `AppTraceRecordAdapter.getById`; `:551`
tests for the **app-layer** one (`isTraceNotFound: (error) => AppTraceNotFoundError.is(error)`),
which the share transport consumes at
`transport/api-trpc/shared-trace.api.ts:302`.

To be precise about what is and is not broken: today those are different paths —
the share transport's throw comes from `platform/app/src/server/app-layer/traces/trace-summary.service.ts:57`,
which does use the handled class, so the predicate matches and the trap has not
fired. But the plain-`Error` copy is the one in the **contract**, imported by 237
files, and it is the one the rest of the platform will reach for. It also throws
away copy that already exists: `trace_not_found` is a registered code with
remediation (`packages/handled-error/src/remediation.ts:60`) and a customer-facing
presentation entry (`platform/app/src/features/errors/logic/presentation.ts:256`).
Every throw of the contract class degrades to "unknown error" with a trace id when
it reaches a boundary, for a failure we have named and written copy for.

`contract/src/trace.errors.ts` also holds two errors that **are** correct
(`FilterParseError:10`, `FilterFieldUnknownError:28`), which is what makes the third
one look like an oversight rather than a decision.

### P11 — `ports/trace.port.ts` exports `TraceRepository`, not a `*Port` (R4, policy)

`packages/architecture-lint/src/port-module-baseline.json:32` carries
`"packages/features/trace/server/src/ports/trace.port.ts"` as a standing exception
to `strict-port-module`, because its exported abstract class is named
`TraceRepository` (`ports/trace.port.ts:27`) and the rule requires the name to end
in `Port`. Per R4 the file and the class are one rename or neither: it is a
repository interface, so it belongs in `repositories/trace.repository.ts` and the
baseline entry goes with it.

### P12 — `trace-derived.projection.ts` is a fold with a row codec inside it (R2)

1,266 lines: 521 comment, 660 code, 85 blank. One class
(`TraceAnalyticsFoldProjection`, `:989`) with 12 `handle*` methods, and around it
**thirteen free functions plus eleven exported constants and types**.

Lines 447–704 are unambiguously a **serialisation concern**, not folding:

```
447  export function projectAnalyticsStateToRow({...})     state → ClickHouse row
586  export function traceAnalyticsStateFromRow(row)       row → state
656  function readNullableString(...)
666  function readReservedTokenSum(...)
680  function parseLabels(...)
704  function asTraceSummaryStateView(state)
```

The package already has the right precedent for this:
`repositories/clickhouse/stored-span-row.codec.ts` (241 lines). Splitting the codec
out is a move, not a rewrite, and it takes ~260 lines and 3 of the 11 rotted-comment
sites with it.

### P13 — Three transport files import from `services/` (R3, layering)

```
transport/api-trpc/traces-v2.api.ts:68     import type { Protections } from "../../services/trace-viewer-protections.service";
transport/api-trpc/shared-trace.api.ts:35  import type { Protections } from "../../services/trace-viewer-protections.service";
transport/api-trpc/trace-view-gates.api.ts:3  import { redactHiddenAttributes } from "../../services/trace-attribute-redaction.service";
```

Two are `import type` and harmless. The third is a **value** import that skips the
application entirely: the transport calls redaction directly rather than through
`TraceApp`. `Protections` is also the single most-imported symbol from this package
(16 external files), so it is a shared vocabulary type sitting in a service module
rather than in the contract.

---

## 3. What it should look like

The stack is right; the drawers are wrong. Almost every move below is a **file
move plus an import rewrite**, not a redesign.

```
contract/src/
  trace.errors.ts                     ~55   TraceNotFoundError becomes a NotFoundError
  trace-protections.ts                ~40   `Protections` moves here from services/
  …58 other files unchanged

server/src/
  index.ts                           ~190   275 exports → ~147
  app/trace.app.ts                   ~820   unchanged in shape; the 11 inline
                                            collaborator interfaces move to ports/
  transport/                                unchanged (9 files, 4,358)

  services/                    17 files, ~3,750
    trace-io-accumulation.service.ts        UNTOUCHED (hot path, see Keep)
    trace-attribute-accumulation.service.ts
    trace-ingestion.service.ts
    trace-canonicalisation.service.ts
    span-cost / span-status / span-timing / span-normalization
    trace-origin / trace-name-resolution / trace-prompt-accumulation
    trace-query-evaluation / trace-query-field-catalogue
    trace-projection-runtime / trace-viewer-protections
    trace-attribute-redaction / trace-storage-anchor

    canonicalisation/          one folder per vendor — the open set, now closed over
      claude-code/  claude-code.canonicaliser.ts + request · truncated-request ·
                    response · content · call-policy .rules.ts        ~1,080
      langwatch/    langwatch.canonicaliser.ts + value · metrics ·
                    metadata · identity · structured-value .rules.ts    ~430
      vertex-adk/   + core · request · response · tool-call             ~315
      gen-ai/       + span · log                                        ~355
      codex/        + span · log · canonical-value                      ~345
      vercel/       + core · io · tool-call                             ~310
      mastra/       + value                                             ~475
      gemini/       + content                                           ~155
      strands/ copilot/ haystack/ logfire/ openinference/ spring-ai/
      traceloop/ legacy-otel/ fallback/                                 ~660
      shared/       canonical-extraction · canonical-message ·
                    canonical-guard · canonical-json .rules.ts          ~765

  query/                       18 files, ~2,410   ← moved out of adapters/
    filter/  trace-query.compiler.ts · fields · meta-fields · values ·
             translators · custom-fields · subquery · evaluation
    facets/  registry · evaluator · query · label · events ·
             span-name · span-status · metadata-keys ·
             span-attribute-keys · event-attribute-keys

  utils/                        4 files,  ~110   ← new; R2's home for shared pure helpers
    json.ts          isRecord · safeJsonParse · safeStringify · stringifyToolPayload
    coercion.ts      asNumber (ONE policy) · asString
    bytes.ts         utf8ByteLength · capPayloadString (ONE implementation)
    shard.ts         shardIndexFor · clampShardCount

  ports/                       26 files,   ~700   ← unchanged count; +11 moved in from trace.app.ts
  adapters/                    15 files, ~1,830   ← eventing.* · clickhouse.trace · null-*
  projections/                  5 files, ~2,050
    trace-derived.projection.ts       ~830   the fold only
    trace-analytics-row.codec.ts      ~270   ← extracted (P12)
    trace-summary / trace-rollup / span-storage
  repositories/  stores/  subscribers/       unchanged
```

**Deleted outright:** `services/canonical-value.rules.ts` (43, P2),
`services/payload-cap.rules.ts` (22, P3),
`adapters/null-trace-windowed-read-metrics.adapter.ts` (11, P8b), the four `??` defaults
and four `?` markers in `adapters/clickhouse.trace.adapter.ts` (P8a),
`spanShardIndex` (P6), and ~128 export lines from `index.ts` (P9).

**Net: ≈29,990 → ≈29,300 server lines, 181 → 176 files.** The line count barely moves,
and that is the honest result: this feature's problem is that its 29,990 lines are in
the wrong 181 drawers, not that there are 29,990 of them.

### The canonicalisation move, concretely

Today, adding Bedrock means editing `services/canonicalisation/` and then dropping
`bedrock-core.rules.ts`, `bedrock-request.rules.ts`, `bedrock-response.rules.ts` into
the same flat directory as `trace-span-command-shard.rules.ts`. After:

```
services/canonicalisation/bedrock/
  bedrock.canonicaliser.ts       imports only from ./  and ../shared/
  bedrock-core.rules.ts
  bedrock-request.rules.ts
  bedrock-response.rules.ts
  __tests__/
```

One folder in, one line added to the registry, nothing else touched — which is what
the open set was supposed to buy. `services/*.rules.ts` drops from 42 files to 6,
and every remaining one is genuinely infrastructure.

### The two payload caps become one

```ts
// utils/bytes.ts
import { DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES } from "../services/trace-attribute-cap.rules";

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/**
 * Caps a string to `maxBytes`, appending a marker naming the original size so a
 * cut is self-describing in the stored value. The marker counts against the
 * budget, so the result never exceeds `maxBytes`.
 *
 * Why it exists at all: see ADR-0NN. Keep the reasoning there, not here.
 */
export function capPayloadString(
  value: string,
  maxBytes: number = DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
  label?: string,
): string {
  const byteSize = utf8ByteLength(value);
  if (byteSize <= maxBytes) return value;

  const marker = `…[langwatch: truncated${label ? ` ${label}` : ""}, ${byteSize} bytes total]`;
  // subarray on a UTF-8 buffer can split a multibyte sequence; toString yields a
  // single replacement char, which is fine for a truncation tail and keeps us
  // strictly under budget.
  const head = Buffer.from(value, "utf8")
    .subarray(0, Math.max(0, maxBytes - utf8ByteLength(marker)))
    .toString("utf8");

  return head + marker;
}
```

Three call sites in `claude-code-*.rules.ts` change their import path; the 48-line
incident narrative in `trace-payload-cap.rules.ts:1-30` becomes an ADR paragraph and
a four-line docblock.

### The composition, with the optionality gone

```ts
// adapters/clickhouse.trace.adapter.ts
export type ClickHouseTraceAdapterOptions = {
  resolveClient: TraceClickHouseResolver;
  modelProviders: ModelProviderService;
  queryFieldValues: TraceQueryFieldValuesPort;
  queryClassification: TraceQueryClassificationPort;   // was ?:
  summaryReader: TraceSummaryReaderPort;               // was ?:
  records: TraceRecordPort;                            // was ?:
  eventDerivation: TraceEventDerivationPort;           // was ?:
  payloads: TracePayloadReaderPort;
  fullIo: TraceFullIoPort;
};

build(): TraceServiceContract {
  const clickhouse = ResolverTraceClickHousePort.create(this.options.resolveClient);
  return TraceService.create({
    ...this.options,
    repository: ClickHouseTraceSpanRepository.create(clickhouse),
    fullRecords: ClickHouseTraceFullRecordRepository.create(
      clickhouse, this.options.payloads, this.options.fullIo,
    ),
  });
}
```

The one caller (`platform/app/src/runtime/app/features/trace.ts:339`) already passes
all four, so this is a type change with no call-site edit. `createNull` at `:50` is
untouched — it is the real "ClickHouse disabled" path and the `Null*` classes stay
for it.

### The error

```ts
// contract/src/trace.errors.ts
export class TraceNotFoundError extends NotFoundError {
  declare readonly code: "trace_not_found";

  constructor(traceId: string, options: { reasons?: readonly Error[] } = {}) {
    super("trace_not_found", "Trace", traceId, {
      meta: { traceId },
      ...remediation("trace_not_found"),
      ...options,
    });
    this.name = "TraceNotFoundError";
  }
}
```

`platform/app/src/server/app-layer/traces/errors.ts:10` is deleted and its importers
point at the contract. The alias at `runtime/app/features/trace.ts:59` disappears,
`isTraceNotFound` can be `(e) => TraceNotFoundError.is(e)` against one class, and the
copy already sitting in `presentation.ts:256` starts reaching customers.

---

## 4. Keep list

- **`services/canonicalisation/` — the open set stays open.** One canonicaliser per
  vendor, sixteen of them, each `implements CanonicalAttributesPort`
  (`ports/canonical-attributes.port.ts:25`). New vendors arrive without touching the
  others; that is correct and P1 is about _where the vendor's rules files sit_, never
  about collapsing the set.
- **`ports/` — 26 files, 29 abstract classes, 56 signatures.** The fragmentation is
  policy: `packages/architecture-lint/src/port-modules.ts` requires a `.port.ts`
  module to export an abstract class named `*Port`. More to the point, **16 of these
  ports are implemented in `platform/app/src/runtime/app/`** — genuine cross-package
  inversions, exactly R4's keep criterion:

  | Port                                                                                                                                            | Implementation                                                      |
  | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
  | `TraceSpanPiiRedactionPort` · `…CostEnrichmentPort` · `…TokenEstimationPort` · `…ContentDropPort` · `…SpoolPort` · `TraceSpanNormalizationPort` | `runtime/app/trace-record-span.adapter.ts:31,49,84,107,158,132`     |
  | `TraceAnalyticsProjectionPort` · `TraceAnalyticsRollupPort` · `TraceSpanStoragePort`                                                            | `runtime/app/trace-projection-storage.adapter.ts:60,39,21`          |
  | `TraceSummaryProjectionPort`                                                                                                                    | `runtime/app/trace-summary-fold.adapter.ts:13`                      |
  | `TraceProcessingPipelinePort`                                                                                                                   | `runtime/app/trace-processing.adapter.ts:121`                       |
  | `TraceFullIoPort` · `TracePayloadReaderPort`                                                                                                    | `runtime/app/features/trace.ts:265,236`                             |
  | `TraceIoExtractionPort` · `TraceMediaReferencePort` · `TraceModelCostPort`                                                                      | `runtime/app/trace-projections.adapter.ts:113,114,115` (structural) |

  `CanonicalAttributesPort` has sixteen in-package implementations — real
  polymorphism. Only `ports/trace.port.ts` is flagged (P11), and only because it is a
  repository wearing a port's filename.

- **`services/trace-io-accumulation.service.ts` (494 lines)** — the trace summary
  fold, the hottest correctness path in the feature, already inside its quality
  ceiling. Its one rotted comment reference (`:126`, `claudeCode.ts`) is worth a
  one-word fix; nothing else about it should be touched, and specifically not for
  readability.
- **`app/trace.app.ts` as a facade.** 17 of 53 members are pure delegations — high
  enough to notice, far short of R3's "mostly such methods". The other 36 carry real
  rules: full-vs-preview resolution (`:360-438`, #4991), waterfall ordering
  (`:448-475`), the partition-pruning hint (`:307-313`, `occurredAtHint`). Deleting
  this class would push all of it into two transports that must not disagree.
- **`ClickHouseTraceAdapter.createNull` and its seven `Null*` classes**
  (`adapters/clickhouse.trace.adapter.ts:50-158`). This looks like test scaffolding
  and is not: `presets.ts:2109` and `presets.ts:1536` take it in production whenever
  `clickhouseEnabled` is false. Only the _optionality_ around it goes (P8a).
- **`repositories/clickhouse/` (12 files, 4,491 lines).** Every ClickHouse client
  access in the feature is here, below a repository. R1 is clean and should stay
  clean — no service, projection, subscriber or app file in this package holds a
  `PrismaClient`, a `Prisma.TransactionClient` or a ClickHouse client.
- **`@langwatch/trace-web` (135 files, 17,626 lines).** Flat, no layering to
  unwind, and 100% consumed by `platform/app` — 205 of its 235 importers live under
  `platform/app/src/features/traces-v2/`. Out of scope for this pass.

---

## 5. Cost and order

Seven commits, smallest risk first, each leaving the suite green.

1. **Comments and dead references** — retire the six incident narratives (P7) to an
   ADR, fix the 25 rotted file references, delete
   `services/canonical-value.rules.ts` (P2) after moving `toAttrValue` into
   `services/canonicalisation/__tests__/support/`. Zero behaviour change; ~350 lines
   of comment leave the tree.
2. **`utils/` and the duplicate helpers** (P3, P4) — one `capPayloadString`, one
   `isRecord`, one `safeStringify`, one `stringifyToolPayload`, one
   `utf8ByteLength`, one `traceScopeSchema`, one `shardIndexFor`; delete
   `spanShardIndex` (P6). Pick a single `asNumber` policy deliberately and say which
   in the commit message. Pure-function moves, covered by existing tests.
3. **Required dependencies** (P8) — four `?:` → required in
   `ClickHouseTraceAdapterOptions`, four `??` defaults deleted, `windowedReadMetrics`
   required in both repositories, `null-trace-windowed-read-metrics.adapter.ts`
   deleted. The single caller already conforms, so this is a type-only change.
4. **`adapters/` → `query/`** (P5) — move 18 pure compiler files, rewrite imports.
   Removes the `services/ → adapters/` inversion. Large diff, zero logic.
5. **Canonicalisation folders** (P1) — 24 vendor `.rules.ts` files move into
   per-vendor folders under `services/canonicalisation/`; `services/*.rules.ts` drops
   from 42 files to 6. Tests move with them. Largest diff of the seven, still no
   logic change.
6. **`TraceNotFoundError` → `HandledError`** (P10) — the contract class extends
   `NotFoundError`, the `platform/app` duplicate is deleted, the alias at
   `runtime/app/features/trace.ts:59` goes. Touches `automation/server` (2 files) and
   `coding-agent/server`; the presentation entry already exists, so no registry work.
   Do this **after** the moves so the rename lands on a settled tree.
7. **Export surface and the last structural split** — shrink `index.ts` from 275 to
   ~147 names (P9), move `Protections` into the contract (P13), extract
   `trace-analytics-row.codec.ts` out of `trace-derived.projection.ts` (P12), rename
   `ports/trace.port.ts` → `repositories/trace.repository.ts` and drop its
   `port-module-baseline.json:32` entry (P11).

Commits 1–5 cannot change behaviour by construction. Commit 6 is the only one that
changes what a customer sees, and it changes it from "unknown error" to copy that is
already written.

---

## 6. Blast radius

| Package                     | External non-test importers | Where they live                                                              |
| --------------------------- | --------------------------: | ---------------------------------------------------------------------------- |
| `@langwatch/trace-server`   |                      **50** | `platform/app` 43 · `apps/api` 5 · `apps/worker` 2 — **zero** in `packages/` |
| `@langwatch/trace-contract` |                     **237** | `platform/app` 184 · 53 across 13 other feature packages                     |
| `@langwatch/trace-web`      |                     **235** | `platform/app` only (205 under `features/traces-v2/`)                        |

**Server package: 150 distinct symbols across 61 import statements; only 26 are used
by more than one file.** `Protections` leads at 16 files, then `RecordSpanCommand`,
`TraceSummaryRepository` and `translateFilterToClickHouse` at 3 each. The remaining
124 are single-consumer.

The concentration is what makes the moves cheap. Fourteen files import more than
three symbols; five of those account for most of the surface:

| File                                                                      | Symbols |
| ------------------------------------------------------------------------- | ------: |
| `platform/app/src/runtime/app/trace-processing.adapter.ts`                |      28 |
| `platform/app/src/runtime/app/features/trace.ts`                          |      19 |
| `platform/app/src/server/event-sourcing/registration/pipelineRegistry.ts` |      17 |
| `platform/app/src/runtime/app/trace-record-span.adapter.ts`               |      10 |
| `apps/api/src/features/trace/trace-trpc.mount.ts`                         |      10 |

The other 36 importers pull one to three symbols each.

**No deep imports anywhere.** Every specifier resolves through a declared `exports`
map — no `dist/` reaches, no relative paths into the package. The only subpath
exports in use are `@langwatch/trace-server/testing` (7 occurrences, all in test
files) and the seven `@langwatch/trace-web/*.store` entries (all inside
`platform/app`, overwhelmingly as `vi.mock` targets).

Two stale workspace dependencies worth clearing while nearby:

- `packages/features/gateway/web/package.json:31-32` declares `@langwatch/trace-server`
  and `@langwatch/trace-web`; its only production import is `escapeValue` from
  `@langwatch/trace-contract`. Both are used solely in
  `src/__tests__/traces-href-for-key.unit.test.ts`.
- `packages/features/coding-agent/server/package.json:49` declares
  `@langwatch/trace-server`; all five usages are in `__tests__`.

# trace

Traces: ingestion and canonicalisation of spans, the projections built from them, and the reads, renderings and exports other modules ask for.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                 |
| Subjects       | trace, trace-ingestion                                                                          |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser) · [client](client)     |
| Api token      | `TraceApi` = `moduleApi<TraceApi>()("trace")`, `contract/src/trace.api.ts:955` (141 operations) |
| Other token    | `CollectorApi`, `process/src/transport/collector.rest.ts:93`                                    |
| Other token    | `TrackedEventApi`, `process/src/transport/tracked-event.rest.ts:36`                             |
| Installed by   | api, worker, tasks (process); ui (browser)                                                      |

## What trace owns

| Kind                           | Name                                                                                                                                                                                                                                                                                                                                                                      | Declared at                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Postgres, accessed not claimed | `Annotation`, `AnnotationScore`, `Topic`                                                                                                                                                                                                                                                                                                                                  | `process/src/repositories/prisma/prisma.trace-annotations.repository.ts:24`                   |
| ClickHouse table (writes)      | `trace_summaries`                                                                                                                                                                                                                                                                                                                                                         | `process/src/repositories/clickhouse/clickhouse.trace-index-materialisation.repository.ts:64` |
| ClickHouse table (writes)      | `stored_spans`                                                                                                                                                                                                                                                                                                                                                            | `process/src/repositories/clickhouse/span-storage.repository.ts:748`                          |
| ClickHouse table (writes)      | `trace_analytics_rollup`                                                                                                                                                                                                                                                                                                                                                  | `process/src/repositories/clickhouse/trace-analytics-rollup.repository.ts:92`                 |
| ClickHouse table (writes)      | `trace_analytics`                                                                                                                                                                                                                                                                                                                                                         | `process/src/repositories/clickhouse/trace-metrics-analytics.repository.ts:138`               |
| Stores required                |                                                                                                                                                                                                                                                                                                                                                                           | `process/src/channels/http/http.trace.channels.ts:12`                                         |
| Stores required                | prisma, clickhouse, redis, rateLimiter, eventReadSeat                                                                                                                                                                                                                                                                                                                     | `process/src/repositories/live/live.trace.repositories.ts:22`                                 |
| Stores required                | prisma, clickhouse                                                                                                                                                                                                                                                                                                                                                        | `process/src/repositories/prisma/prisma.trace.repositories.ts:38`                             |
| Config                         | `spanProcessingShards` (TRACE_SPAN_PROCESSING_SHARDS), `tokenizer.bpeDirectory` (TIKTOKENS_PATH), `tokenizer.fetchTimeoutMs` (TIKTOKEN_FETCH_TIMEOUT_MS), `tokenizer.disabled` (DISABLE_TOKENIZATION), `disableCodingAgentSpanFilter` (LANGWATCH_DISABLE_CODING_AGENT_SPAN_FILTER), `foldCacheTtlSeconds` (LANGWATCH_FOLD_CACHE_TTL_SECONDS), `publicBaseUrl` (BASE_HOST) | `contract/src/trace.config.ts:9`                                                              |

Anything else trace needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name             | Token              | Module                                        |
| ---------------- | ------------------ | --------------------------------------------- |
| `apiKeys`        | `ApiKeyApi`        | [api-key](../api-key/README.md)               |
| `authz`          | `AuthzApi`         | [authz](../authz/README.md)                   |
| `dataPrivacy`    | `DataPrivacyApi`   | [data-privacy](../data-privacy/README.md)     |
| `dataRetention`  | `DataRetentionApi` | [data-retention](../data-retention/README.md) |
| `evaluators`     | `EvaluatorApi`     | [evaluator](../evaluator/README.md)           |
| `featureFlags`   | `FeatureFlagApi`   | [feature-flag](../feature-flag/README.md)     |
| `modelProviders` | `ModelProviderApi` | [model-provider](../model-provider/README.md) |
| `plans`          | `EntitlementApi`   | [entitlement](../entitlement/README.md)       |
| `presence`       | `PresenceApi`      | [presence](../presence/README.md)             |
| `projects`       | `ProjectApi`       | [project](../project/README.md)               |
| `share`          | `ShareApi`         | [share](../share/README.md)                   |
| `storedObjects`  | `StoredObjectApi`  | [stored-object](../stored-object/README.md)   |

## Who depends on trace

[analytics](../analytics/README.md), [annotation](../annotation/README.md), [automation](../automation/README.md), [coding-agent](../coding-agent/README.md), [evaluation](../evaluation/README.md), [experiment](../experiment/README.md), [gateway](../gateway/README.md), [governance](../../enterprise/modules/governance/README.md), [instant-eval](../instant-eval/README.md), [log](../log/README.md), [metric](../metric/README.md), [ops](../ops/README.md), [scenario](../scenario/README.md), [topic](../topic/README.md) (as a peer).

<!-- readme:generated:end -->

# trace

Traces: ingestion and canonicalisation of spans, the projections built from them, and the reads, renderings and exports other modules ask for.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                 |
| Subjects       | trace, trace-ingestion                                                                          |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                        |
| Api token      | `TraceApi` = `moduleApi<TraceApi>()("trace")`, `contract/src/trace.api.ts:861` (139 operations) |
| Other token    | `CollectorApi`, `process/src/transport/collector.rest.ts:94`                                    |
| Other token    | `TrackedEventApi`, `process/src/transport/tracked-event.rest.ts:41`                             |
| Installed by   | api, worker, tasks (process); ui (browser)                                                      |

## What trace owns

| Kind                      | Name                                                                                                                                                                                  | Declared at                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| ClickHouse table (writes) | `stored_spans`                                                                                                                                                                        | `process/src/repositories/clickhouse/span-storage.repository.ts:674`            |
| ClickHouse table (writes) | `trace_analytics_rollup`                                                                                                                                                              | `process/src/repositories/clickhouse/trace-analytics-rollup.repository.ts:92`   |
| ClickHouse table (writes) | `trace_analytics`                                                                                                                                                                     | `process/src/repositories/clickhouse/trace-metrics-analytics.repository.ts:124` |
| ClickHouse table (writes) | `trace_summaries`                                                                                                                                                                     | `process/src/repositories/clickhouse/trace-summary.repository.ts:220`           |
| Stores required           | prisma, clickhouse, redis, rateLimiter                                                                                                                                                | `process/src/repositories/live/live.trace.repositories.ts:16`                   |
| Stores required           | prisma, clickhouse                                                                                                                                                                    | `process/src/repositories/prisma/prisma.trace.repositories.ts:31`               |
| Config                    | `spanProcessingShards` (TRACE_SPAN_PROCESSING_SHARDS), `tokenizer.bpeDirectory` (TIKTOKENS_PATH), `tokenizer.fetchTimeoutMs` (TIKTOKEN_FETCH_TIMEOUT_MS), `publicBaseUrl` (BASE_HOST) | `contract/src/trace.config.ts:9`                                                |

Anything else trace needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name             | Token              | Module                                        |
| ---------------- | ------------------ | --------------------------------------------- |
| `annotations`    | `AnnotationApi`    | [annotation](../annotation/README.md)         |
| `apiKeys`        | `ApiKeyApi`        | [api-key](../api-key/README.md)               |
| `authz`          | `AuthzApi`         | [authz](../authz/README.md)                   |
| `dataPrivacy`    | `DataPrivacyApi`   | [data-privacy](../data-privacy/README.md)     |
| `dataRetention`  | `DataRetentionApi` | [data-retention](../data-retention/README.md) |
| `evaluations`    | `EvaluationApi`    | [evaluation](../evaluation/README.md)         |
| `evaluators`     | `EvaluatorApi`     | [evaluator](../evaluator/README.md)           |
| `experiments`    | `ExperimentApi`    | [experiment](../experiment/README.md)         |
| `featureFlags`   | `FeatureFlagApi`   | [feature-flag](../feature-flag/README.md)     |
| `instantEvals`   | `InstantEvalApi`   | [instant-eval](../instant-eval/README.md)     |
| `logs`           | `LogApi`           | [log](../log/README.md)                       |
| `modelProviders` | `ModelProviderApi` | [model-provider](../model-provider/README.md) |
| `monitors`       | `MonitorApi`       | [monitor](../monitor/README.md)               |
| `plans`          | `EntitlementApi`   | [entitlement](../entitlement/README.md)       |
| `presence`       | `PresenceApi`      | [presence](../presence/README.md)             |
| `projects`       | `ProjectApi`       | [project](../project/README.md)               |
| `share`          | `ShareApi`         | [share](../share/README.md)                   |
| `storedObjects`  | `StoredObjectApi`  | [stored-object](../stored-object/README.md)   |
| `topics`         | `TopicApi`         | [topic](../topic/README.md)                   |

## Who depends on trace

[agent](../agent/README.md), [analytics](../analytics/README.md), [annotation](../annotation/README.md), [automation](../automation/README.md), [coding-agent](../coding-agent/README.md), [entitlement](../entitlement/README.md), [evaluation](../evaluation/README.md), [gateway](../gateway/README.md), [governance](../../enterprise/modules/governance/README.md), [instant-eval](../instant-eval/README.md), [log](../log/README.md), [metric](../metric/README.md), [ops](../ops/README.md), [project](../project/README.md), [scenario](../scenario/README.md), [topic](../topic/README.md) (as a peer).

<!-- readme:generated:end -->

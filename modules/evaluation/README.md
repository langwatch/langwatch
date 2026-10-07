# evaluation

Evaluations: running evaluators against traces, the evaluation runs that record their results, and the evaluator lists peers read.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Classification | core (`modules/catalogue.json`)                                                                                    |
| Subjects       | evaluation                                                                                                         |
| Halves         | [contract](contract) · [process](process/README.md)                                                                |
| Api token      | `EvaluationApi` = `moduleApi<EvaluationApi>()("evaluation")`, `contract/src/evaluation.api.ts:127` (30 operations) |
| Installed by   | api, worker, tasks (process)                                                                                       |

## What evaluation owns

| Kind                      | Name                                                                                                                                                                                                                                                                                                                                                                                                                                          | Declared at                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Postgres table            | `Cost`                                                                                                                                                                                                                                                                                                                                                                                                                                        | `process/src/repositories/prisma/prisma.evaluation-cost.repository.ts:23`    |
| ClickHouse table (writes) | `evaluation_runs`                                                                                                                                                                                                                                                                                                                                                                                                                             | `process/src/repositories/clickhouse/evaluation-run-write.repository.ts:160` |
| Stores required           | prisma, clickhouse, redis, objectStorage                                                                                                                                                                                                                                                                                                                                                                                                      | `process/src/repositories/live/live.evaluation.repositories.ts:19`           |
| Secrets                   | `openAi` (OPENAI_API_KEY), `azureContentSafety` (AZURE_CONTENT_SAFETY_KEY)                                                                                                                                                                                                                                                                                                                                                                    | `process/src/app/evaluation.app.ts:275`                                      |
| Config                    | `langevalsEndpoint` (LANGEVALS_ENDPOINT), `stagingThresholdBytes` (LANGEVALS_STAGING_THRESHOLD_BYTES), `stagingTtlSeconds` (LANGEVALS_STAGING_TTL_SECONDS), `evaluationMaxPayloadBytes` (EVAL_MAX_PAYLOAD_BYTES), `topicClusteringMaxPayloadBytes` (TOPIC_CLUSTERING_MAX_PAYLOAD_BYTES), `azureContentSafetyEndpoint` (AZURE_CONTENT_SAFETY_ENDPOINT), `enablePresidio` (LANGWATCH_ENABLE_PRESIDIO), `enableLingua` (LANGWATCH_ENABLE_LINGUA) | `contract/src/evaluation.config.ts:26`                                       |

Anything else evaluation needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name             | Token              | Module                                        |
| ---------------- | ------------------ | --------------------------------------------- |
| `analytics`      | `AnalyticsApi`     | [analytics](../analytics/README.md)           |
| `datasets`       | `DatasetApi`       | [dataset](../dataset/README.md)               |
| `evaluators`     | `EvaluatorApi`     | [evaluator](../evaluator/README.md)           |
| `experiments`    | `ExperimentApi`    | [experiment](../experiment/README.md)         |
| `featureFlags`   | `FeatureFlagApi`   | [feature-flag](../feature-flag/README.md)     |
| `modelProviders` | `ModelProviderApi` | [model-provider](../model-provider/README.md) |
| `monitors`       | `MonitorApi`       | [monitor](../monitor/README.md)               |
| `retention`      | `DataRetentionApi` | [data-retention](../data-retention/README.md) |
| `traces`         | `TraceApi`         | [trace](../trace/README.md)                   |
| `workflows`      | `WorkflowApi`      | [workflow](../workflow/README.md)             |

## Who depends on evaluation

[automation](../automation/README.md), [experiment](../experiment/README.md), [gateway](../gateway/README.md), [scenario](../scenario/README.md), [topic](../topic/README.md), [trace](../trace/README.md) (as a peer).

<!-- readme:generated:end -->

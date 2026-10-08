# experiment

Experiments: saved definitions, their runs, and the pages that list them.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Classification | core (`modules/catalogue.json`)                                                                                    |
| Subjects       | experiment                                                                                                         |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser) · [client](client)                        |
| Api token      | `ExperimentApi` = `moduleApi<ExperimentApi>()("experiment")`, `contract/src/experiment.api.ts:369` (67 operations) |
| Other token    | `ExperimentV3RestApi`, `process/src/transport/experiment-v3.rest.ts:65`                                            |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                         |

## What experiment owns

| Kind                           | Name                                                                                                                                                                               | Declared at                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Postgres, accessed not claimed | `Experiment`, `ExperimentVersion`, `User`, `WorkflowVersion`                                                                                                                       | `process/src/repositories/prisma/prisma.experiment.repository.ts:33`                    |
| ClickHouse table (writes)      | `experiment_run_items`                                                                                                                                                             | `process/src/eventing/experiment-run-item.store.ts:46`                                  |
| ClickHouse table (writes)      | `dspy_steps`                                                                                                                                                                       | `process/src/repositories/clickhouse/clickhouse.experiment-dspy.repository.ts:131`      |
| ClickHouse table (writes)      | `experiment_runs`                                                                                                                                                                  | `process/src/repositories/clickhouse/clickhouse.experiment-run-state.repository.ts:311` |
| Stores required                | prisma, clickhouse, redis                                                                                                                                                          | `process/src/repositories/live/live.experiment.repositories.ts:31`                      |
| Config                         | `blockLocalHttpCalls` (BLOCK_LOCAL_HTTP_CALLS), `allowedProxyHosts` (ALLOWED_PROXY_HOSTS), `runConcurrency` (EVAL_V3_CONCURRENCY), `publicBaseUrl` (BASE_HOST), `isSaas` (IS_SAAS) | `contract/src/experiment.config.ts:13`                                                  |

Anything else experiment needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name             | Token              | Module                                        |
| ---------------- | ------------------ | --------------------------------------------- |
| `agents`         | `AgentApi`         | [agent](../agent/README.md)                   |
| `apiKeys`        | `ApiKeyApi`        | [api-key](../api-key/README.md)               |
| `dataset`        | `DatasetApi`       | [dataset](../dataset/README.md)               |
| `entitlement`    | `EntitlementApi`   | [entitlement](../entitlement/README.md)       |
| `evaluation`     | `EvaluationApi`    | [evaluation](../evaluation/README.md)         |
| `evaluators`     | `EvaluatorApi`     | [evaluator](../evaluator/README.md)           |
| `modelProviders` | `ModelProviderApi` | [model-provider](../model-provider/README.md) |
| `monitors`       | `MonitorApi`       | [monitor](../monitor/README.md)               |
| `permissions`    | `AuthzApi`         | [authz](../authz/README.md)                   |
| `presence`       | `PresenceApi`      | [presence](../presence/README.md)             |
| `projects`       | `ProjectApi`       | [project](../project/README.md)               |
| `prompts`        | `PromptApi`        | [prompt](../prompt/README.md)                 |
| `retention`      | `DataRetentionApi` | [data-retention](../data-retention/README.md) |
| `storedObjects`  | `StoredObjectApi`  | [stored-object](../stored-object/README.md)   |
| `workflows`      | `WorkflowApi`      | [workflow](../workflow/README.md)             |

## Who depends on experiment

[langy](../langy/README.md), [ops](../ops/README.md), [trace](../trace/README.md), [workflow](../workflow/README.md) (as a peer).

<!-- readme:generated:end -->

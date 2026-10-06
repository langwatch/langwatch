# workflow

Workflows: definitions, graph versions and the Studio DSL, and executing a workflow's components.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                            |
| Subjects       | workflow                                                                                                   |
| Halves         | [contract](contract) · [process](process) · [browser](browser)                                             |
| Api token      | `WorkflowApi` = `moduleApi<WorkflowApi>()("workflow")`, `contract/src/workflow.api.ts:422` (59 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                 |

## What workflow owns

| Kind            | Name                                                                                                                                                                                                                                                                                                            | Declared at                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Stores required | prisma                                                                                                                                                                                                                                                                                                          | `process/src/repositories/prisma/prisma.workflow.repositories.ts:19` |
| Secrets         | `nlpLambdaFleet` (LANGWATCH_NLP_LAMBDA_CONFIG), `nlpInternal` (LANGWATCH_NLP_INTERNAL_SECRET)                                                                                                                                                                                                                   | `process/src/app/workflow.app.ts:606`                                |
| Config          | `nlpServiceUrl` (LANGWATCH_NLP_SERVICE), `stagingThresholdBytes` (LANGEVALS_STAGING_THRESHOLD_BYTES), `stagingTtlSeconds` (LANGEVALS_STAGING_TTL_SECONDS), `relayTurnCeilingMs` (NLP_FETCH_MAX_TIMEOUT_MS), `publicBaseUrl` (BASE_HOST), `nlpCodeBlockTimeoutSeconds` (NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS) | `contract/src/workflow.config.ts:79`                                 |

Anything else workflow needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name             | Token              | Module                                        |
| ---------------- | ------------------ | --------------------------------------------- |
| `agents`         | `AgentApi`         | [agent](../agent/README.md)                   |
| `apiKeys`        | `ApiKeyApi`        | [api-key](../api-key/README.md)               |
| `authz`          | `AuthzApi`         | [authz](../authz/README.md)                   |
| `datasets`       | `DatasetApi`       | [dataset](../dataset/README.md)               |
| `evaluators`     | `EvaluatorApi`     | [evaluator](../evaluator/README.md)           |
| `experiments`    | `ExperimentApi`    | [experiment](../experiment/README.md)         |
| `modelProviders` | `ModelProviderApi` | [model-provider](../model-provider/README.md) |
| `monitors`       | `MonitorApi`       | [monitor](../monitor/README.md)               |
| `secrets`        | `SecretApi`        | [secret](../secret/README.md)                 |

## Who depends on workflow

[agent](../agent/README.md), [audit-log](../audit-log/README.md), [evaluation](../evaluation/README.md), [evaluator](../evaluator/README.md), [experiment](../experiment/README.md), [langy](../langy/README.md), [monitor](../monitor/README.md), [onboarding](../onboarding/README.md), [ops](../ops/README.md), [platform-health](../platform-health/README.md), [prompt](../prompt/README.md), [scenario](../scenario/README.md) (as a peer).

<!-- readme:generated:end -->

# suite

Suites (run plans): their definitions, the scenario references they hold and their run history.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                |
| Subjects       | suite                                                                                          |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                       |
| Api token      | `SuiteApi` = `moduleApi<SuiteApi>()("suite")`, `contract/src/suite.api.ts:122` (28 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                     |

## What suite owns

| Kind                           | Name                                                                                  | Declared at                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Postgres, accessed not claimed | `Scenario`, `SimulationSuite`                                                         | `process/src/repositories/prisma/prisma.suite.repository.ts:63`              |
| ClickHouse table (writes)      | `suite_runs`                                                                          | `process/src/repositories/clickhouse/clickhouse.suite-run.repository.ts:111` |
| Config                         | `foldCacheTtlSeconds` (LANGWATCH_FOLD_CACHE_TTL_SECONDS), `publicBaseUrl` (BASE_HOST) | `contract/src/suite.config.ts:5`                                             |

Anything else suite needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name             | Token              | Module                                        |
| ---------------- | ------------------ | --------------------------------------------- |
| `agents`         | `AgentApi`         | [agent](../agent/README.md)                   |
| `evaluators`     | `EvaluatorApi`     | [evaluator](../evaluator/README.md)           |
| `featureFlags`   | `FeatureFlagApi`   | [feature-flag](../feature-flag/README.md)     |
| `modelProviders` | `ModelProviderApi` | [model-provider](../model-provider/README.md) |
| `projects`       | `ProjectApi`       | [project](../project/README.md)               |
| `prompts`        | `PromptApi`        | [prompt](../prompt/README.md)                 |
| `retention`      | `DataRetentionApi` | [data-retention](../data-retention/README.md) |
| `scenarios`      | `ScenarioApi`      | [scenario](../scenario/README.md)             |

## Who depends on suite

[platform-health](../platform-health/README.md) (as a peer).

<!-- readme:generated:end -->

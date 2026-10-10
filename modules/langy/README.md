# langy

Langy, the in-product assistant: conversations, turns, messages, credentials and relay frames, and the pipeline that carries a turn to the agent and back.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                |
| Subjects       | conversation, credential, langy, message, relay, turn                                          |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser) · [client](client)    |
| Api token      | `LangyApi` = `moduleApi<LangyApi>()("langy")`, `contract/src/langy.api.ts:510` (82 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                     |

## What langy owns

| Kind                      | Name                                                                                                                                                                                                                                                                                                                                         | Declared at                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| ClickHouse table (writes) | `langy_analytics_events`                                                                                                                                                                                                                                                                                                                     | `process/src/repositories/clickhouse/clickhouse.langy-analytics-event.repository.ts:158` |
| Stores required           |                                                                                                                                                                                                                                                                                                                                              | `process/src/channels/http/http.langy.channels.ts:11`                                    |
| Stores required           | prisma, redis, clickhouse, rateLimiter                                                                                                                                                                                                                                                                                                       | `process/src/repositories/live/live.langy.repositories.ts:16`                            |
| Secrets                   | LANGY_INTERNAL_SECRET                                                                                                                                                                                                                                                                                                                        | `process/src/app/langy.app.ts:286`                                                       |
| Config                    | `agentUrl` (LANGY_AGENT_URL), `workerCallbackUrl` (LANGY_WORKER_CALLBACK_URL), `workerGatewayUrl` (LANGY_WORKER_GATEWAY_URL), `mirrorProjectId` (LANGY_MIRROR_PROJECT_ID), `gatewayInternalUrl` (LW_GATEWAY_INTERNAL_URL), `gatewayPublicUrl` (LW_GATEWAY_PUBLIC_URL), `gatewayLegacyUrl` (LW_GATEWAY_BASE_URL), `publicBaseUrl` (BASE_HOST) | `contract/src/langy.config.ts:18`                                                        |

Anything else langy needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name             | Token                 | Module                                        |
| ---------------- | --------------------- | --------------------------------------------- |
| `agents`         | `AgentApi`            | [agent](../agent/README.md)                   |
| `apiKeys`        | `ApiKeyApi`           | [api-key](../api-key/README.md)               |
| `authz`          | `AuthzApi`            | [authz](../authz/README.md)                   |
| `datasets`       | `DatasetApi`          | [dataset](../dataset/README.md)               |
| `evaluators`     | `EvaluatorApi`        | [evaluator](../evaluator/README.md)           |
| `experiments`    | `ExperimentApi`       | [experiment](../experiment/README.md)         |
| `featureFlags`   | `FeatureFlagApi`      | [feature-flag](../feature-flag/README.md)     |
| `gateway`        | `GatewayApi`          | [gateway](../gateway/README.md)               |
| `github`         | `GithubApi`           | [github](../github/README.md)                 |
| `modelProviders` | `ModelProviderApi`    | [model-provider](../model-provider/README.md) |
| `monitors`       | `MonitorApi`          | [monitor](../monitor/README.md)               |
| `notifications`  | `NotificationService` | [notification](../notification/README.md)     |
| `onboarding`     | `OnboardingApi`       | [onboarding](../onboarding/README.md)         |
| `plans`          | `EntitlementApi`      | [entitlement](../entitlement/README.md)       |
| `presence`       | `PresenceApi`         | [presence](../presence/README.md)             |
| `projects`       | `ProjectApi`          | [project](../project/README.md)               |
| `prompts`        | `PromptApi`           | [prompt](../prompt/README.md)                 |
| `retention`      | `DataRetentionApi`    | [data-retention](../data-retention/README.md) |
| `scenarios`      | `ScenarioApi`         | [scenario](../scenario/README.md)             |
| `secrets`        | `SecretApi`           | [secret](../secret/README.md)                 |
| `users`          | `UserApi`             | [user](../user/README.md)                     |
| `workflows`      | `WorkflowApi`         | [workflow](../workflow/README.md)             |

## Who depends on langy

[insight](../insight/README.md), [ops](../ops/README.md), [platform-health](../platform-health/README.md) (as a peer).

<!-- readme:generated:end -->

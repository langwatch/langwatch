# onboarding

Onboarding: the guided paths a new project follows and the steps it has recorded.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                                   |
| Subjects       | onboarding                                                                                                        |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                                          |
| Api token      | `OnboardingApi` = `moduleApi<OnboardingApi>()("onboarding")`, `contract/src/onboarding.api.ts:76` (12 operations) |
| Other token    | `IntegrationsChecksApi`, `process/src/transport/integrations-checks.trpc.ts:17`                                   |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                        |

## What onboarding owns

No table, store, secret or config: onboarding declares none.

Anything else onboarding needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name             | Token              | Module                                        |
| ---------------- | ------------------ | --------------------------------------------- |
| `dashboards`     | `DashboardApi`     | [dashboard](../dashboard/README.md)           |
| `datasets`       | `DatasetApi`       | [dataset](../dataset/README.md)               |
| `gateway`        | `GatewayApi`       | [gateway](../gateway/README.md)               |
| `modelProviders` | `ModelProviderApi` | [model-provider](../model-provider/README.md) |
| `monitors`       | `MonitorApi`       | [monitor](../monitor/README.md)               |
| `organizations`  | `OrganizationApi`  | [organization](../organization/README.md)     |
| `permissions`    | `AuthzApi`         | [authz](../authz/README.md)                   |
| `projects`       | `ProjectApi`       | [project](../project/README.md)               |
| `prompts`        | `PromptApi`        | [prompt](../prompt/README.md)                 |
| `scenarios`      | `ScenarioApi`      | [scenario](../scenario/README.md)             |
| `workflows`      | `WorkflowApi`      | [workflow](../workflow/README.md)             |

## Who depends on onboarding

[langy](../langy/README.md) (as a peer).

<!-- readme:generated:end -->

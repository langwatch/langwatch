# evaluator

Evaluators: their definitions, and executing them as code or native checks with the settings a run resolves.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                                |
| Subjects       | evaluator                                                                                                      |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser) · [client](client)                    |
| Api token      | `EvaluatorApi` = `moduleApi<EvaluatorApi>()("evaluator")`, `contract/src/evaluator.api.ts:155` (30 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                     |

## What evaluator owns

| Kind           | Name                        | Declared at                                                         |
| -------------- | --------------------------- | ------------------------------------------------------------------- |
| Postgres table | `Evaluator`                 | `process/src/repositories/prisma/prisma.evaluator.repository.ts:76` |
| Config         | `publicBaseUrl` (BASE_HOST) | `contract/src/evaluator.config.ts:4`                                |

Anything else evaluator needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name             | Token              | Module                                        |
| ---------------- | ------------------ | --------------------------------------------- |
| `auditLog`       | `AuditLogApi`      | [audit-log](../audit-log/README.md)           |
| `modelProviders` | `ModelProviderApi` | [model-provider](../model-provider/README.md) |
| `monitors`       | `MonitorApi`       | [monitor](../monitor/README.md)               |
| `permissions`    | `AuthzApi`         | [authz](../authz/README.md)                   |
| `users`          | `UserApi`          | [user](../user/README.md)                     |
| `workflows`      | `WorkflowApi`      | [workflow](../workflow/README.md)             |

## Who depends on evaluator

[automation](../automation/README.md), [evaluation](../evaluation/README.md), [experiment](../experiment/README.md), [gateway](../gateway/README.md), [langy](../langy/README.md), [monitor](../monitor/README.md), [scenario](../scenario/README.md), [suite](../suite/README.md), [trace](../trace/README.md), [workflow](../workflow/README.md) (as a peer).

<!-- readme:generated:end -->

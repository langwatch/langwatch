# monitor

Monitors: the checks that run an evaluator over incoming traces, their definitions and whether one may run.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                       |
| Subjects       | monitor                                                                                               |
| Halves         | [contract](contract) · [process](process) · [browser](browser)                                        |
| Api token      | `MonitorApi` = `moduleApi<MonitorApi>()("monitor")`, `contract/src/monitor.api.ts:76` (22 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                            |

## What monitor owns

| Kind           | Name                        | Declared at                                                       |
| -------------- | --------------------------- | ----------------------------------------------------------------- |
| Postgres table | `Monitor`                   | `process/src/repositories/prisma/prisma.monitor.repository.ts:69` |
| Config         | `publicBaseUrl` (BASE_HOST) | `contract/src/monitor.api.ts:80`                                  |

Anything else monitor needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name          | Token           | Module                                |
| ------------- | --------------- | ------------------------------------- |
| `evaluation`  | `EvaluationApi` | [evaluation](../evaluation/README.md) |
| `evaluators`  | `EvaluatorApi`  | [evaluator](../evaluator/README.md)   |
| `permissions` | `AuthzApi`      | [authz](../authz/README.md)           |
| `workflows`   | `WorkflowApi`   | [workflow](../workflow/README.md)     |

## Who depends on monitor

[audit-log](../audit-log/README.md), [automation](../automation/README.md), [evaluation](../evaluation/README.md), [evaluator](../evaluator/README.md), [experiment](../experiment/README.md), [gateway](../gateway/README.md), [langy](../langy/README.md), [onboarding](../onboarding/README.md), [ops](../ops/README.md), [trace](../trace/README.md), [workflow](../workflow/README.md) (as a peer).

<!-- readme:generated:end -->

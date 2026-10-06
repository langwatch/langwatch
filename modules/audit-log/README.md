# audit-log

The audit log: every module records who did what through it, and an entity's history is read back from it.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Classification | core (`modules/catalogue.json`)                                                                        |
| Subjects       | audit-log                                                                                              |
| Halves         | [contract](contract) · [process](process/README.md)                                                    |
| Api token      | `AuditLogApi` = `moduleApi<AuditLogApi>()("audit-log")`, `contract/src/audit-log.ts:71` (3 operations) |
| Other token    | `AuditLogHomeApi`, `process/src/transport/home.trpc.ts:14`                                             |
| Installed by   | api, worker, tasks (process)                                                                           |

## What audit-log owns

| Kind           | Name       | Declared at                                                                         |
| -------------- | ---------- | ----------------------------------------------------------------------------------- |
| Postgres table | `AuditLog` | `process/src/repositories/prisma/prisma.agent-audit-log-migration.repository.ts:11` |
| Postgres table | `AuditLog` | `process/src/repositories/prisma/prisma.audit-log.repository.ts:37`                 |
| Postgres table | `AuditLog` | `process/src/repositories/prisma/prisma.recent-touch.repository.ts:12`              |

Anything else audit-log needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name          | Token           | Module                                |
| ------------- | --------------- | ------------------------------------- |
| `agents`      | `AgentApi`      | [agent](../agent/README.md)           |
| `annotations` | `AnnotationApi` | [annotation](../annotation/README.md) |
| `datasets`    | `DatasetApi`    | [dataset](../dataset/README.md)       |
| `monitors`    | `MonitorApi`    | [monitor](../monitor/README.md)       |
| `projects`    | `ProjectApi`    | [project](../project/README.md)       |
| `prompts`     | `PromptApi`     | [prompt](../prompt/README.md)         |
| `workflows`   | `WorkflowApi`   | [workflow](../workflow/README.md)     |

## Who depends on audit-log

[agent](../agent/README.md), [auth](../auth/README.md), [automation](../automation/README.md), [billing](../../enterprise/modules/billing/README.md), [coding-agent](../coding-agent/README.md), [enterprise-ops](../../enterprise/modules/enterprise-ops/README.md), [evaluator](../evaluator/README.md), [github](../github/README.md), [governance](../../enterprise/modules/governance/README.md), [identity](../identity/README.md), [ops](../ops/README.md), [project](../project/README.md), [scenario](../scenario/README.md), [scim](../../enterprise/modules/scim/README.md), [sso](../../enterprise/modules/sso/README.md) (as a peer).

<!-- readme:generated:end -->

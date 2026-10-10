# project

Projects: finding them, their summaries and paths, and the departments they are assigned to.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Classification | core (`modules/catalogue.json`)                                                                        |
| Subjects       | project                                                                                                |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser) · [client](client)            |
| Api token      | `ProjectApi` = `moduleApi<ProjectApi>()("project")`, `contract/src/project.api.ts:290` (52 operations) |
| Other token    | `ProjectManagementApi`, `process/src/transport/project.rest.ts:87`                                     |
| Other token    | `ProjectBrowserApi`, `process/src/transport/project.trpc.ts:69`                                        |
| Installed by   | api, worker, tasks (process); ui (browser)                                                             |

## What project owns

| Kind            | Name               | Declared at                                                                        |
| --------------- | ------------------ | ---------------------------------------------------------------------------------- |
| Postgres table  | `Project`          | `process/src/repositories/prisma/prisma.project-storage-settings.repository.ts:14` |
| Postgres table  | `Project`          | `process/src/repositories/prisma/prisma.project.repository.ts:50`                  |
| Stores required | prisma, encryption | `process/src/repositories/prisma/prisma.project.repositories.ts:13`                |

Anything else project needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token             | Module                                    |
| --------------- | ----------------- | ----------------------------------------- |
| `auditLog`      | `AuditLogApi`     | [audit-log](../audit-log/README.md)       |
| `authorization` | `AuthzApi`        | [authz](../authz/README.md)               |
| `dataPrivacy`   | `DataPrivacyApi`  | [data-privacy](../data-privacy/README.md) |
| `organizations` | `OrganizationApi` | [organization](../organization/README.md) |

## Who depends on project

[agent](../agent/README.md), [analytics](../analytics/README.md), [annotation](../annotation/README.md), [api-key](../api-key/README.md), [auth](../auth/README.md), [automation](../automation/README.md), [coding-agent](../coding-agent/README.md), [dashboard](../dashboard/README.md), [dataset](../dataset/README.md), [enterprise-gateway](../../enterprise/modules/enterprise-gateway/README.md), [evaluator](../evaluator/README.md), [experiment](../experiment/README.md), [gateway](../gateway/README.md), [github](../github/README.md), [governance](../../enterprise/modules/governance/README.md), [hosted-mcp](../hosted-mcp/README.md), [langy](../langy/README.md), [model-provider](../model-provider/README.md), [onboarding](../onboarding/README.md), [ops](../ops/README.md), [platform-health](../platform-health/README.md), [prompt](../prompt/README.md), [scenario](../scenario/README.md), [share](../share/README.md), [slack](../slack/README.md), [suite](../suite/README.md), [trace](../trace/README.md), [webhook](../webhook/README.md) (as a peer).

<!-- readme:generated:end -->

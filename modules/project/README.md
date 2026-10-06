# project

Projects: finding them, their summaries and paths, and the departments they are assigned to.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Classification | core (`modules/catalogue.json`)                                                                        |
| Subjects       | project                                                                                                |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                               |
| Api token      | `ProjectApi` = `moduleApi<ProjectApi>()("project")`, `contract/src/project.api.ts:171` (40 operations) |
| Other token    | `ProjectManagementApi`, `process/src/transport/project.rest.ts:116`                                    |
| Other token    | `ProjectBrowserApi`, `process/src/transport/project.trpc.ts:76`                                        |
| Installed by   | api, worker, tasks (process); ui (browser)                                                             |

## What project owns

| Kind            | Name               | Declared at                                                                        |
| --------------- | ------------------ | ---------------------------------------------------------------------------------- |
| Postgres table  | `Project`          | `process/src/repositories/prisma/prisma.project-storage-settings.repository.ts:14` |
| Postgres table  | `Project`          | `process/src/repositories/prisma/prisma.project.repository.ts:36`                  |
| Stores required | prisma, encryption | `process/src/repositories/prisma/prisma.project.repositories.ts:13`                |

Anything else project needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token             | Module                                    |
| --------------- | ----------------- | ----------------------------------------- |
| `apiKeys`       | `ApiKeyApi`       | [api-key](../api-key/README.md)           |
| `auditLog`      | `AuditLogApi`     | [audit-log](../audit-log/README.md)       |
| `authorization` | `AuthzApi`        | [authz](../authz/README.md)               |
| `dataPrivacy`   | `DataPrivacyApi`  | [data-privacy](../data-privacy/README.md) |
| `organizations` | `OrganizationApi` | [organization](../organization/README.md) |
| `share`         | `ShareApi`        | [share](../share/README.md)               |
| `topics`        | `TopicApi`        | [topic](../topic/README.md)               |
| `trace`         | `TraceApi`        | [trace](../trace/README.md)               |

## Who depends on project

[agent](../agent/README.md), [analytics](../analytics/README.md), [annotation](../annotation/README.md), [api-key](../api-key/README.md), [audit-log](../audit-log/README.md), [automation](../automation/README.md), [billing](../../enterprise/modules/billing/README.md), [coding-agent](../coding-agent/README.md), [dashboard](../dashboard/README.md), [data-privacy](../data-privacy/README.md), [data-retention](../data-retention/README.md), [dataset](../dataset/README.md), [enterprise-gateway](../../enterprise/modules/enterprise-gateway/README.md), [entitlement](../entitlement/README.md), [experiment](../experiment/README.md), [gateway](../gateway/README.md), [github](../github/README.md), [governance](../../enterprise/modules/governance/README.md), [hosted-mcp](../hosted-mcp/README.md), [instant-eval](../instant-eval/README.md), [langy](../langy/README.md), [licensing](../../enterprise/modules/licensing/README.md), [model-provider](../model-provider/README.md), [onboarding](../onboarding/README.md), [ops](../ops/README.md), [organization](../organization/README.md), [platform-health](../platform-health/README.md), [prompt](../prompt/README.md), [scenario](../scenario/README.md), [share](../share/README.md), [slack](../slack/README.md), [suite](../suite/README.md), [trace](../trace/README.md), [usage](../usage/README.md), [user](../user/README.md), [webhook](../webhook/README.md) (as a peer).

<!-- readme:generated:end -->

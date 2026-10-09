# automation

Automations: triggers and their fire history, report schedules, delivery policy and project email suppression, and the pipeline that evaluates and delivers them.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Classification | core (`modules/catalogue.json`)                                                                                    |
| Subjects       | automation, email-suppression, report-schedule, trigger, trigger-fire-history                                      |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                                           |
| Api token      | `AutomationApi` = `moduleApi<AutomationApi>()("automation")`, `contract/src/automation.api.ts:230` (62 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                         |

## What automation owns

| Kind                           | Name                                                                                                                                                                                                                                                                                                            | Declared at                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Postgres, accessed not claimed | `CustomGraph`, `EmailSuppression`, `Project`, `Trigger`, `TriggerLatestEvaluation`, `TriggerSent`                                                                                                                                                                                                               | `process/src/repositories/prisma/prisma.custom-graph.repository.ts:12` |
| Stores required                |                                                                                                                                                                                                                                                                                                                 | `process/src/channels/http/http.automation.channels.ts:7`              |
| Stores required                | prisma, redis, encryption                                                                                                                                                                                                                                                                                       | `process/src/repositories/prisma/prisma.automation.repositories.ts:29` |
| Secrets                        | `unsubscribe` (NEXTAUTH_SECRET)                                                                                                                                                                                                                                                                                 | `process/src/app/automation.app.ts:403`                                |
| Config                         | `emailHourlyCap` (TRIGGER_EMAIL_HOURLY_CAP), `tenantDailyCap` (TRIGGER_EMAIL_TENANT_DAILY_CAP), `persistDailyCapFree` (TRIGGER_PERSIST_DAILY_CAP_FREE), `persistDailyCapPaid` (TRIGGER_PERSIST_DAILY_CAP_PAID), `persistDailyCapEnterprise` (TRIGGER_PERSIST_DAILY_CAP_ENTERPRISE), `publicBaseUrl` (BASE_HOST) | `contract/src/automation.config.ts:11`                                 |

Anything else automation needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token                 | Module                                    |
| --------------- | --------------------- | ----------------------------------------- |
| `analytics`     | `AnalyticsApi`        | [analytics](../analytics/README.md)       |
| `annotations`   | `AnnotationApi`       | [annotation](../annotation/README.md)     |
| `auditLog`      | `AuditLogApi`         | [audit-log](../audit-log/README.md)       |
| `authorization` | `AuthzApi`            | [authz](../authz/README.md)               |
| `datasets`      | `DatasetApi`          | [dataset](../dataset/README.md)           |
| `entitlement`   | `EntitlementApi`      | [entitlement](../entitlement/README.md)   |
| `evaluations`   | `EvaluationApi`       | [evaluation](../evaluation/README.md)     |
| `evaluators`    | `EvaluatorApi`        | [evaluator](../evaluator/README.md)       |
| `monitors`      | `MonitorApi`          | [monitor](../monitor/README.md)           |
| `notifications` | `NotificationService` | [notification](../notification/README.md) |
| `projects`      | `ProjectApi`          | [project](../project/README.md)           |
| `slack`         | `SlackApi`            | [slack](../slack/README.md)               |
| `traces`        | `TraceApi`            | [trace](../trace/README.md)               |
| `webhooks`      | `WebhookApi`          | [webhook](../webhook/README.md)           |

## Who depends on automation

[dashboard](../dashboard/README.md), [ops](../ops/README.md), [platform-health](../platform-health/README.md) (as a peer).

<!-- readme:generated:end -->

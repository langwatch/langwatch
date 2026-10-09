# ops

Platform administration for every deployment: admin operations, impersonation, blob storage inspection and the operator views over queues and the scheduler.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                         |
| -------------- | --------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                         |
| Subjects       | admin, impersonation, ops                                                               |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                |
| Api token      | `OpsApi` = `moduleApi<OpsApi>()("ops")`, `contract/src/ops.api.ts:699` (134 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                              |

## What ops owns

| Kind            | Name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Declared at                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Postgres table  | `BugReport`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `process/src/repositories/prisma/prisma.bug-report.repository.ts:38` |
| Stores required |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `process/src/channels/http/http.ops.channels.ts:12`                  |
| Secrets         | `licensePrivateKey` (LANGWATCH_LICENSE_PRIVATE_KEY), `slackBugReportsBotToken` (SLACK_BUG_REPORTS_BOT_TOKEN), `credentials` (CREDENTIALS_SECRET), `credentialsFallback` (NEXTAUTH_SECRET), `credentialsPrevious` (CREDENTIALS_SECRET_PREVIOUS)                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `process/src/app/ops.app.ts:772`                                     |
| Config          | `apiKey` (LANGWATCH_OPS_API_KEY), `clickhouseOpsUrl` (CLICKHOUSE_OPS_URL), `usageStats.disabled` (DISABLE_USAGE_STATS), `usageStats.installMethod` (INSTALL_METHOD), `usageStats.chartVersion` (LANGWATCH_CHART_VERSION), `collectClickHouseBackupMetrics` (CLICKHOUSE_BACKUP_METRICS_ENABLED), `productAnalytics.key` (POSTHOG_KEY), `productAnalytics.host` (POSTHOG_HOST), `grafana` (GRAFANA_BASE_URL), `bugReportSlackChannel` (SLACK_BUG_REPORTS_CHANNEL), `cloudOps` (LANGWATCH_CLOUD_OPS), `adminEmails` (ADMIN_EMAILS), `nodeEnvironment` (NODE_ENV), `isSaas` (IS_SAAS), `publicBaseUrl` (BASE_HOST), `serviceVersion` (SERVICE_VERSION), `otelResourceAttributes` (OTEL_RESOURCE_ATTRIBUTES) | `contract/src/ops.config.ts:28`                                      |

Anything else ops needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name             | Token              | Module                                                    |
| ---------------- | ------------------ | --------------------------------------------------------- |
| `analytics`      | `AnalyticsApi`     | [analytics](../analytics/README.md)                       |
| `annotations`    | `AnnotationApi`    | [annotation](../annotation/README.md)                     |
| `apiKeys`        | `ApiKeyApi`        | [api-key](../api-key/README.md)                           |
| `auditLog`       | `AuditLogApi`      | [audit-log](../audit-log/README.md)                       |
| `auth`           | `AuthApi`          | [auth](../auth/README.md)                                 |
| `authz`          | `AuthzApi`         | [authz](../authz/README.md)                               |
| `automations`    | `AutomationApi`    | [automation](../automation/README.md)                     |
| `codingAgents`   | `CodingAgentApi`   | [coding-agent](../coding-agent/README.md)                 |
| `dashboards`     | `DashboardApi`     | [dashboard](../dashboard/README.md)                       |
| `datasets`       | `DatasetApi`       | [dataset](../dataset/README.md)                           |
| `experiments`    | `ExperimentApi`    | [experiment](../experiment/README.md)                     |
| `featureFlags`   | `FeatureFlagApi`   | [feature-flag](../feature-flag/README.md)                 |
| `gateway`        | `GatewayApi`       | [gateway](../gateway/README.md)                           |
| `github`         | `GithubApi`        | [github](../github/README.md)                             |
| `identity`       | `IdentityApi`      | [identity](../identity/README.md)                         |
| `instantEvals`   | `InstantEvalApi`   | [instant-eval](../instant-eval/README.md)                 |
| `langy`          | `LangyApi`         | [langy](../langy/README.md)                               |
| `licensing`      | `LicensingApi`     | [licensing](../../enterprise/modules/licensing/README.md) |
| `modelProviders` | `ModelProviderApi` | [model-provider](../model-provider/README.md)             |
| `monitors`       | `MonitorApi`       | [monitor](../monitor/README.md)                           |
| `notifications`  | `NotificationApi`  | [notification](../notification/README.md)                 |
| `organizations`  | `OrganizationApi`  | [organization](../organization/README.md)                 |
| `projects`       | `ProjectApi`       | [project](../project/README.md)                           |
| `prompts`        | `PromptApi`        | [prompt](../prompt/README.md)                             |
| `retention`      | `DataRetentionApi` | [data-retention](../data-retention/README.md)             |
| `scenarios`      | `ScenarioApi`      | [scenario](../scenario/README.md)                         |
| `storedObjects`  | `StoredObjectApi`  | [stored-object](../stored-object/README.md)               |
| `traces`         | `TraceApi`         | [trace](../trace/README.md)                               |
| `users`          | `UserApi`          | [user](../user/README.md)                                 |
| `workflows`      | `WorkflowApi`      | [workflow](../workflow/README.md)                         |

## Who depends on ops

[enterprise-ops](../../enterprise/modules/enterprise-ops/README.md) (as a peer).

<!-- readme:generated:end -->

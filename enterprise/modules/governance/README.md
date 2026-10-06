# governance

AI governance: ingestion sources and pulls, cost attribution, anomaly rules and alerts, tool and session policies, departments, and the CLI's budget and virtual-key reads.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                                                                                                                                                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classification | enterprise (`modules/catalogue.json`)                                                                                                                                                                                                                                                                                                                           |
| Subjects       | ai-tool-catalog, anomaly-alert, anomaly-rule, canonical-cost, cost-attribution-policy, department, governance, ingestion-credentials, ingestion-pull, ingestion-source, ingestion-template, ocsf-export, ottl, persona-home, personal-usage, platform-tool-policy, pull-destination, pulled-usage, puller, quarantine-fill, session-policy, spend-spike-anomaly |
| Halves         | [contract](contract) · [process](process) · [browser](browser)                                                                                                                                                                                                                                                                                                  |
| Api token      | `GovernanceRestApi` = `moduleApi<GovernanceRestApi>()("governance")`, `contract/src/governance.api.ts:448` (112 operations)                                                                                                                                                                                                                                     |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                                                                                                                                                                                                                                                                      |

## What governance owns

| Kind                           | Name                                                                                                                                                                                                                                                                                                                                                            | Declared at                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Postgres, accessed not claimed | `AiToolEntry`, `AnomalyAlert`, `AnomalyRule`, `AuditLog`, `Department`, `DepartmentMembershipHistory`, `DiscoveredAgent`, `DiscoveredPerson`, `ErasedIdentifierSuppression`, `GovernanceTenantHistory`, `IdentityMatch`, `IdentityMatchSuggestion`, `IngestionPullRunProjection`, `IngestionSource`, `IngestionTemplate`, `OrganizationUser`, `Project`, `User` | `process/src/repositories/prisma/prisma.ai-tool-catalog.repository.ts:27`                  |
| ClickHouse table (writes)      | `governance_kpis`                                                                                                                                                                                                                                                                                                                                               | `process/src/repositories/clickhouse/clickhouse.anomaly-spend.repository.ts:57`            |
| ClickHouse table (writes)      | `governance_cost_rollup_charges`                                                                                                                                                                                                                                                                                                                                | `process/src/repositories/clickhouse/clickhouse.governance-cost-charge.repository.ts:102`  |
| ClickHouse table (writes)      | `governance_cost_rollup_1d`                                                                                                                                                                                                                                                                                                                                     | `process/src/repositories/clickhouse/clickhouse.governance-cost-rollup.repository.ts:493`  |
| ClickHouse table (writes)      | `governance_cost_rollup_restatement_index`                                                                                                                                                                                                                                                                                                                      | `process/src/repositories/clickhouse/clickhouse.governance-cost-rollup.repository.ts:580`  |
| ClickHouse table (writes)      | `governance_ocsf_events`                                                                                                                                                                                                                                                                                                                                        | `process/src/repositories/clickhouse/clickhouse.ocsf-events.repository.ts:300`             |
| Stores required                | clickhouse                                                                                                                                                                                                                                                                                                                                                      | `process/src/repositories/clickhouse/clickhouse.governance-clickhouse.repositories.ts:134` |
| Stores required                | prisma, clickhouse, operatorReads, encryption, rateLimiter                                                                                                                                                                                                                                                                                                      | `process/src/repositories/live/live.governance.repositories.ts:26`                         |
| Stores required                | prisma, encryption                                                                                                                                                                                                                                                                                                                                              | `process/src/repositories/prisma/prisma.governance.repositories.ts:30`                     |
| Secrets                        | GOVERNANCE_ERASURE_PSEUDONYM_SECRET                                                                                                                                                                                                                                                                                                                             | `process/src/app/governance.app.ts:464`                                                    |
| Config                         | `gatewayPublicUrl` (LW_GATEWAY_PUBLIC_URL), `gatewayInternalUrl` (LW_GATEWAY_INTERNAL_URL), `gatewayLegacyUrl` (LW_GATEWAY_BASE_URL), `isSaas` (IS_SAAS), `publicBaseUrl` (BASE_HOST), `ingestRateLimitDisabled` (LW_INGEST_RATE_LIMIT_DISABLED)                                                                                                                | `contract/src/governance.config.ts:33`                                                     |

Anything else governance needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name                | Token                  | Module                                                      |
| ------------------- | ---------------------- | ----------------------------------------------------------- |
| `agents`            | `AgentApi`             | [agent](../../../modules/agent/README.md)                   |
| `apiKeys`           | `ApiKeyApi`            | [api-key](../../../modules/api-key/README.md)               |
| `auditLog`          | `AuditLogApi`          | [audit-log](../../../modules/audit-log/README.md)           |
| `auth`              | `AuthApi`              | [auth](../../../modules/auth/README.md)                     |
| `enterpriseGateway` | `EnterpriseGatewayApi` | [enterprise-gateway](../enterprise-gateway/README.md)       |
| `entitlements`      | `EntitlementApi`       | [entitlement](../../../modules/entitlement/README.md)       |
| `featureFlags`      | `FeatureFlagApi`       | [feature-flag](../../../modules/feature-flag/README.md)     |
| `gateway`           | `GatewayApi`           | [gateway](../../../modules/gateway/README.md)               |
| `logs`              | `LogApi`               | [log](../../../modules/log/README.md)                       |
| `metrics`           | `MetricApi`            | [metric](../../../modules/metric/README.md)                 |
| `modelProviders`    | `ModelProviderApi`     | [model-provider](../../../modules/model-provider/README.md) |
| `organizations`     | `OrganizationApi`      | [organization](../../../modules/organization/README.md)     |
| `permissions`       | `AuthzApi`             | [authz](../../../modules/authz/README.md)                   |
| `projects`          | `ProjectApi`           | [project](../../../modules/project/README.md)               |
| `scim`              | `ScimApi`              | [scim](../scim/README.md)                                   |
| `traces`            | `TraceApi`             | [trace](../../../modules/trace/README.md)                   |
| `users`             | `UserApi`              | [user](../../../modules/user/README.md)                     |

## Who depends on governance

[coding-agent](../../../modules/coding-agent/README.md), [hosted-mcp](../../../modules/hosted-mcp/README.md), [scim](../scim/README.md), [user](../../../modules/user/README.md) (as a peer).

<!-- readme:generated:end -->

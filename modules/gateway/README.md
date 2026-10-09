# gateway

The AI Gateway: virtual keys, gateway debits and the gateway's internal door, plus the agent cache and voice provider credentials it serves.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                          |
| Subjects       | gateway, gateway-debit, virtual-key                                                                      |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                                 |
| Api token      | `GatewayApi` = `moduleApi<GatewayApi>()("gateway")`, `contract/src/gateway.api.ts:1029` (101 operations) |
| Other token    | `GatewayInternalDoorApi`, `process/src/transport/gateway-internal.rest.ts:99`                            |
| Other token    | `GatewaySpendApi`, `process/src/transport/gateway-spend.rest.ts:52`                                      |
| Installed by   | api, worker, tasks (process); ui (browser)                                                               |

## What gateway owns

| Kind                           | Name                                                                                                                                                                                                                                                                                                                                                                                                    | Declared at                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Postgres, accessed not claimed | `AuditLog`, `GatewayBudget`, `GatewayBudgetBucketBoundary`, `GatewayCacheRule`, `GatewayChangeEvent`, `GatewayGuardrail`, `GatewayRealtimeSession`, `GatewayRealtimeSessionReport`, `Group`, `GroupMembership`, `ModelProvider`, `Organization`, `Project`, `RoutingPolicy`, `Team`, `User`, `VirtualKey`, `VirtualKeyScope`                                                                            | `process/src/repositories/prisma/prisma.gateway-audit.repository.ts:16`                 |
| ClickHouse table (writes)      | `gateway_budget_ledger_events`                                                                                                                                                                                                                                                                                                                                                                          | `process/src/repositories/clickhouse/clickhouse.gateway-budget.repository.ts:289`       |
| ClickHouse table (writes)      | `gateway_spend`                                                                                                                                                                                                                                                                                                                                                                                         | `process/src/repositories/clickhouse/clickhouse.gateway-spend-events.repository.ts:235` |
| Stores required                |                                                                                                                                                                                                                                                                                                                                                                                                         | `process/src/channels/http/http.gateway.channels.ts:6`                                  |
| Stores required                | prisma, clickhouse, encryption, redis                                                                                                                                                                                                                                                                                                                                                                   | `process/src/repositories/live/live.gateway.repositories.ts:46`                         |
| Secrets                        | `internalSecret` (LW_GATEWAY_INTERNAL_SECRET), `jwtSecret` (LW_GATEWAY_JWT_SECRET), `virtualKeyPepper` (LW_VIRTUAL_KEY_PEPPER)                                                                                                                                                                                                                                                                          | `process/src/app/gateway.app.ts:1137`                                                   |
| Config                         | `spendSettlementGraceMs` (LW_SPEND_SETTLEMENT_GRACE_MS), `internalUrl` (LW_GATEWAY_INTERNAL_URL), `controlPlaneUrl` (GATEWAY_CONTROL_PLANE_URL), `publicBaseUrl` (BASE_HOST), `baseUrl` (LW_GATEWAY_BASE_URL), `publicUrl` (LW_GATEWAY_PUBLIC_URL), `isSaas` (IS_SAAS), `allowLoopbackVoiceProviders` (VOICE_UNSAFE_ALLOW_LOOPBACK_PROVIDERS), `foldCacheTtlSeconds` (LANGWATCH_FOLD_CACHE_TTL_SECONDS) | `contract/src/gateway.config.ts:26`                                                     |

Anything else gateway needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name             | Token              | Module                                        |
| ---------------- | ------------------ | --------------------------------------------- |
| `apiKeys`        | `ApiKeyApi`        | [api-key](../api-key/README.md)               |
| `authz`          | `AuthzApi`         | [authz](../authz/README.md)                   |
| `evaluations`    | `EvaluationApi`    | [evaluation](../evaluation/README.md)         |
| `evaluators`     | `EvaluatorApi`     | [evaluator](../evaluator/README.md)           |
| `featureFlags`   | `FeatureFlagApi`   | [feature-flag](../feature-flag/README.md)     |
| `modelProviders` | `ModelProviderApi` | [model-provider](../model-provider/README.md) |
| `monitors`       | `MonitorApi`       | [monitor](../monitor/README.md)               |
| `oneTimeReveals` | `SecretApi`        | [secret](../secret/README.md)                 |
| `organizations`  | `OrganizationApi`  | [organization](../organization/README.md)     |
| `projects`       | `ProjectApi`       | [project](../project/README.md)               |
| `traces`         | `TraceApi`         | [trace](../trace/README.md)                   |

## Who depends on gateway

[enterprise-gateway](../../enterprise/modules/enterprise-gateway/README.md), [governance](../../enterprise/modules/governance/README.md), [instant-eval](../instant-eval/README.md), [langy](../langy/README.md), [licensing](../../enterprise/modules/licensing/README.md), [onboarding](../onboarding/README.md), [ops](../ops/README.md), [scenario](../scenario/README.md), [webhook](../webhook/README.md) (as a peer).

<!-- readme:generated:end -->

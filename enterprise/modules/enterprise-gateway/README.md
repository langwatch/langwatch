# enterprise-gateway

The Enterprise half of the AI Gateway: routing policies and personal gateway keys.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Classification | enterprise (`modules/catalogue.json`)                                                                                                           |
| Subjects       | enterprise-gateway, personal-virtual-key, routing-policy                                                                                        |
| Halves         | [contract](contract) · [process](process/README.md)                                                                                             |
| Api token      | `EnterpriseGatewayApi` = `moduleApi<EnterpriseGatewayApi>()("enterprise-gateway")`, `contract/src/enterprise-gateway.api.ts:75` (16 operations) |
| Installed by   | api, worker, tasks (process)                                                                                                                    |

## What enterprise-gateway owns

| Kind                           | Name                                                                                                     | Declared at                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Postgres, accessed not claimed | `RoutingPolicy`                                                                                          | `process/src/repositories/prisma/prisma.routing-policy.repository.ts:27`       |
| Stores required                | prisma                                                                                                   | `process/src/repositories/prisma/prisma.enterprise-gateway.repositories.ts:10` |
| Config                         | `gatewayPublicUrl` (LW_GATEWAY_PUBLIC_URL), `gatewayLegacyUrl` (LW_GATEWAY_BASE_URL), `isSaas` (IS_SAAS) | `contract/src/enterprise-gateway.config.ts:13`                                 |

Anything else enterprise-gateway needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name             | Token              | Module                                                      |
| ---------------- | ------------------ | ----------------------------------------------------------- |
| `authz`          | `AuthzApi`         | [authz](../../../modules/authz/README.md)                   |
| `gateway`        | `GatewayApi`       | [gateway](../../../modules/gateway/README.md)               |
| `modelProviders` | `ModelProviderApi` | [model-provider](../../../modules/model-provider/README.md) |
| `organizations`  | `OrganizationApi`  | [organization](../../../modules/organization/README.md)     |
| `projects`       | `ProjectApi`       | [project](../../../modules/project/README.md)               |
| `users`          | `UserApi`          | [user](../../../modules/user/README.md)                     |

## Who depends on enterprise-gateway

[governance](../governance/README.md), [user](../../../modules/user/README.md) (as a peer).

<!-- readme:generated:end -->

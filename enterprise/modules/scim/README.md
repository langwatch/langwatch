# scim

SCIM provisioning: directory connections, their tokens, and syncing users from a directory.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------- |
| Classification | enterprise (`modules/catalogue.json`)                                                       |
| Subjects       | scim, scim-sync                                                                             |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser) · [client](client) |
| Api token      | `ScimApi` = `moduleApi<ScimApi>()("scim")`, `contract/src/scim.api.ts:293` (34 operations)  |
| Installed by   | api, worker, tasks (process); ui (browser)                                                  |

## What scim owns

| Kind            | Name                                                                                                                                                                               | Declared at                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Stores required |                                                                                                                                                                                    | `process/src/channels/scim-channels.registry.ts:13`              |
| Stores required | prisma, operatorReads, eventReadSeat                                                                                                                                               | `process/src/repositories/prisma/prisma.scim.repositories.ts:17` |
| Secrets         | `auth0WebhookSecret` (AUTH0_SCIM_WEBHOOK_SECRET), `tokenPepper` (CREDENTIALS_SECRET), `tokenPepperFallback` (NEXTAUTH_SECRET), `tokenPepperPrevious` (CREDENTIALS_SECRET_PREVIOUS) | `contract/src/scim.config.ts:14`                                 |
| Config          | `provenOffboarding` (SCIM_V2_GRANTS)                                                                                                                                               | `contract/src/scim.config.ts:7`                                  |

Anything else scim needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token            | Module                                                |
| --------------- | ---------------- | ----------------------------------------------------- |
| `auditLog`      | `AuditLogApi`    | [audit-log](../../../modules/audit-log/README.md)     |
| `authorization` | `AuthzApi`       | [authz](../../../modules/authz/README.md)             |
| `entitlements`  | `EntitlementApi` | [entitlement](../../../modules/entitlement/README.md) |
| `users`         | `UserApi`        | [user](../../../modules/user/README.md)               |

## Who depends on scim

[governance](../governance/README.md), [identity](../../../modules/identity/README.md) (as a peer).

<!-- readme:generated:end -->

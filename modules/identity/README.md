# identity

The platform operator's identity lookup: find a person by address, review proposed sign-ins and domain claims, detach methods and end sessions. Only `ops:manage` at the platform may use it, and every act is recorded.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                                           |
| Subjects       | identity                                                                                                                  |
| Halves         | [contract](contract) · [process](process)                                                                                 |
| Api token      | `IdentityLookupApi` = `moduleApi<IdentityLookupApi>()("identity")`, `contract/src/identity-lookup.ts:241` (11 operations) |
| Other token    | `IdentityApi`, `contract/src/identity.api.ts:825`                                                                         |
| Other token    | `TwoStepVerificationApi`, `contract/src/two-step-verification.ts:118`                                                     |
| Installed by   | api, worker, tasks (process)                                                                                              |

## What identity owns

| Kind                           | Name                                                                                                                                                                                                                                                                                                                                   | Declared at                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Postgres, accessed not claimed | `Account`, `AccountCredential`, `AuditLog`, `Identifier`, `IdentifierReservation`, `IdentityProjectionCursor`, `JoinRequest`, `MfaEnrollment`, `Organization`, `OrganizationInvite`, `OrganizationUser`, `Passkey`, `SsoAuthenticationActivity`, `SsoConnection`, `SsoConnectionRegistrationSlot`, `SsoVerifiedDomain`, `Team`, `User` | `process/src/repositories/prisma/prisma.sso-migration-evidence.repository.ts:13` |
| Stores required                | prisma, encryption, rateLimiter                                                                                                                                                                                                                                                                                                        | `process/src/repositories/prisma/prisma.identity.repositories.ts:47`             |
| Secrets                        | `internalSlackSignupsWebhook` (SLACK_CHANNEL_SIGNUPS)                                                                                                                                                                                                                                                                                  | `process/src/app/identity.app.ts:450`                                            |
| Config                         | `ssoDomainProofDnsServers` (SSO_DOMAIN_PROOF_DNS_SERVERS), `isSaas` (IS_SAAS), `publicBaseUrl` (BASE_HOST)                                                                                                                                                                                                                             | `contract/src/identity.config.ts:20`                                             |

Anything else identity needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token                 | Module                                                    |
| --------------- | --------------------- | --------------------------------------------------------- |
| `auditLog`      | `AuditLogApi`         | [audit-log](../audit-log/README.md)                       |
| `auth`          | `AuthApi`             | [auth](../auth/README.md)                                 |
| `entitlements`  | `EntitlementApi`      | [entitlement](../entitlement/README.md)                   |
| `licensing`     | `LicensingApi`        | [licensing](../../enterprise/modules/licensing/README.md) |
| `notifications` | `NotificationService` | [notification](../notification/README.md)                 |
| `organizations` | `OrganizationApi`     | [organization](../organization/README.md)                 |
| `permissions`   | `AuthzApi`            | [authz](../authz/README.md)                               |
| `scim`          | `ScimApi`             | [scim](../../enterprise/modules/scim/README.md)           |
| `users`         | `UserApi`             | [user](../user/README.md)                                 |

## Who depends on identity

[auth](../auth/README.md), [ops](../ops/README.md), [organization](../organization/README.md), [scim](../../enterprise/modules/scim/README.md), [sso](../../enterprise/modules/sso/README.md) (as a peer).

<!-- readme:generated:end -->

# identity

The platform operator's identity lookup: find a person by address, review proposed sign-ins and domain claims, detach methods and end sessions. Only `ops:manage` at the platform may use it, and every act is recorded.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                                           |
| Subjects       | identity                                                                                                                  |
| Halves         | [contract](contract) · [process](process/README.md) · [client](client)                                                    |
| Api token      | `IdentityLookupApi` = `moduleApi<IdentityLookupApi>()("identity")`, `contract/src/identity-lookup.ts:241` (11 operations) |
| Other token    | `IdentityApi`, `contract/src/identity.api.ts:838`                                                                         |
| Other token    | `TwoStepVerificationApi`, `contract/src/two-step-verification.ts:118`                                                     |
| Other token    | `JoinRequestDoorApi`, `process/src/transport/join-request.trpc.ts:63`                                                     |
| Installed by   | api, worker, tasks (process)                                                                                              |

## What identity owns

| Kind                           | Name                                                                                                                                                                                                                                                                                                                                                  | Declared at                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Postgres, accessed not claimed | `Account`, `AccountCredential`, `AuditLog`, `Identifier`, `IdentifierReservation`, `IdentityProjectionCursor`, `JoinRequest`, `MfaEnrollment`, `Organization`, `OrganizationInvite`, `OrganizationUser`, `Passkey`, `SsoAuthenticationActivity`, `SsoConnection`, `SsoConnectionRegistrationSlot`, `SsoProvider`, `SsoVerifiedDomain`, `Team`, `User` | `process/src/features/sso-connection/repositories/prisma/prisma.sso-registrant.repository.ts:14` |
| Stores required                |                                                                                                                                                                                                                                                                                                                                                       | `process/src/channels/http/http.identity.channels.ts:25`                                         |
| Stores required                | prisma, encryption, rateLimiter, eventReadSeat                                                                                                                                                                                                                                                                                                        | `process/src/repositories/prisma/prisma.identity.repositories.ts:54`                             |
| Secrets                        | `internalSlackSignupsWebhook` (SLACK_CHANNEL_SIGNUPS)                                                                                                                                                                                                                                                                                                 | `process/src/app/identity.app.ts:453`                                                            |
| Config                         | `ssoDomainProofDnsServers` (SSO_DOMAIN_PROOF_DNS_SERVERS), `isSaas` (IS_SAAS), `publicBaseUrl` (BASE_HOST), `passkeysEnabled` (PASSKEYS_ENABLED), `mfaEnrollmentOpen` (MFA_ENROLLMENT_OPEN), `localPasswords` (LOCAL_PASSWORDS_ENABLED)                                                                                                               | `contract/src/identity.config.ts:28`                                                             |

Anything else identity needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token                 | Module                                                    |
| --------------- | --------------------- | --------------------------------------------------------- |
| `auditLog`      | `AuditLogApi`         | [audit-log](../audit-log/README.md)                       |
| `entitlements`  | `EntitlementApi`      | [entitlement](../entitlement/README.md)                   |
| `licensing`     | `LicensingApi`        | [licensing](../../enterprise/modules/licensing/README.md) |
| `notifications` | `NotificationService` | [notification](../notification/README.md)                 |
| `organizations` | `OrganizationApi`     | [organization](../organization/README.md)                 |
| `permissions`   | `AuthzApi`            | [authz](../authz/README.md)                               |
| `scim`          | `ScimApi`             | [scim](../../enterprise/modules/scim/README.md)           |
| `users`         | `UserApi`             | [user](../user/README.md)                                 |

## Who depends on identity

[auth](../auth/README.md), [ops](../ops/README.md), [organization](../organization/README.md), [sso](../../enterprise/modules/sso/README.md) (as a peer).

<!-- readme:generated:end -->

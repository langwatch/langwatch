# auth

Signing in and staying signed in: the browser session, the signed-out front door (passwords, passkeys, two-step verification, identity providers), impersonation, and the CLI's bootstrap, session and token flow.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------ |
| Classification | core (`modules/catalogue.json`)                                                            |
| Subjects       | auth, cli-bootstrap, cli-session, cli-token                                                |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                   |
| Api token      | `AuthApi` = `moduleApi<AuthApi>()("auth")`, `contract/src/auth.api.ts:417` (57 operations) |
| Other token    | `AuthCliDeviceFlowApi`, `process/src/transport/auth-cli-device-flow.rest.ts:42`            |
| Other token    | `AuthDoorApi`, `process/src/transport/auth.rest.ts:47`                                     |
| Installed by   | api, worker, tasks (process); ui (browser)                                                 |

## What auth owns

| Kind                           | Name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Declared at                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Postgres table                 | `Session`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `process/src/repositories/prisma/prisma.auth-session.repository.ts:64`              |
| Postgres table                 | `SignInAttemptLock`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `process/src/repositories/prisma/prisma.sign-in-attempt-lock.repository.ts:16`      |
| Postgres table                 | `VerificationToken`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `process/src/repositories/prisma/prisma.signup-verification-token.repository.ts:18` |
| Postgres, accessed not claimed | `User`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `process/src/repositories/prisma/prisma.auth-directory.repository.ts:6`             |
| Stores required                | redis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `process/src/channels/redis/redis.auth.channels.ts:17`                              |
| Stores required                | prisma, redis, rateLimiter, encryption                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `process/src/repositories/live/live.auth.repositories.ts:24`                        |
| Secrets                        | `session` (NEXTAUTH_SECRET), `googleClientSecret` (GOOGLE_CLIENT_SECRET), `githubClientSecret` (GITHUB_CLIENT_SECRET), `gitlabClientSecret` (GITLAB_CLIENT_SECRET), `azureAdClientSecret` (AZURE_AD_CLIENT_SECRET), `auth0ClientSecret` (AUTH0_CLIENT_SECRET), `oktaClientSecret` (OKTA_CLIENT_SECRET), `cognitoClientSecret` (COGNITO_CLIENT_SECRET), `oneLoginClientSecret` (ONELOGIN_CLIENT_SECRET), `oidcClientSecret` (OIDC_CLIENT_SECRET), `auth0ManagementSecret` (AUTH0_MGMT_CLIENT_SECRET), `internalSlackSignupsWebhook` (SLACK_CHANNEL_SIGNUPS)               | `process/src/app/auth.app.ts:274`                                                   |
| Config                         | `sessionUrl` (NEXTAUTH_URL), `mfaEnrollmentOpen` (MFA_ENROLLMENT_OPEN), `passkeysEnabled` (PASSKEYS_ENABLED), `passkeyHandleSecret` (PASSKEY_HANDLE_SECRET), `trustedIdpOrigins` (SSO_TRUSTED_IDP_ORIGINS), `idpSimulatorUrl` (LANGWATCH_IDPSIM_URL), `localPasswords` (LOCAL_PASSWORDS_ENABLED), `auth0ManagementClientId` (AUTH0_MGMT_CLIENT_ID), `signInProviders` (AUTH_PROVIDER), `isSaas` (IS_SAAS), `signUpMode` (SIGN_UP_MODE), `publicBaseUrl` (BASE_HOST), `nodeEnvironment` (NODE_ENV), `cliRefreshTokenTtlSeconds` (LANGWATCH_CLI_REFRESH_TOKEN_TTL_SECONDS) | `contract/src/auth.config.ts:20`                                                    |

Anything else auth needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token                 | Module                                                    |
| --------------- | --------------------- | --------------------------------------------------------- |
| `apiKeys`       | `ApiKeyApi`           | [api-key](../api-key/README.md)                           |
| `auditLog`      | `AuditLogApi`         | [audit-log](../audit-log/README.md)                       |
| `authz`         | `AuthzApi`            | [authz](../authz/README.md)                               |
| `entitlements`  | `EntitlementApi`      | [entitlement](../entitlement/README.md)                   |
| `featureFlags`  | `FeatureFlagApi`      | [feature-flag](../feature-flag/README.md)                 |
| `identity`      | `IdentityApi`         | [identity](../identity/README.md)                         |
| `licensing`     | `LicensingApi`        | [licensing](../../enterprise/modules/licensing/README.md) |
| `notifications` | `NotificationService` | [notification](../notification/README.md)                 |
| `organizations` | `OrganizationApi`     | [organization](../organization/README.md)                 |
| `projects`      | `ProjectApi`          | [project](../project/README.md)                           |
| `sso`           | `SsoApi`              | [sso](../../enterprise/modules/sso/README.md)             |
| `users`         | `UserApi`             | [user](../user/README.md)                                 |

## Who depends on auth

[github](../github/README.md), [governance](../../enterprise/modules/governance/README.md), [hosted-mcp](../hosted-mcp/README.md), [ops](../ops/README.md) (as a peer).

<!-- readme:generated:end -->

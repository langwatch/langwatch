# sso

Single sign-on: what a deployment may federate with, connections and claimed domains, and the operator's ledger.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                        |
| -------------- | -------------------------------------------------------------------------------------- |
| Classification | enterprise (`modules/catalogue.json`)                                                  |
| Subjects       | sso                                                                                    |
| Halves         | [contract](contract) · [process](process) · [browser](browser)                         |
| Api token      | `SsoApi` = `moduleApi<SsoApi>()("sso")`, `contract/src/sso.api.ts:244` (44 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                             |

## What sso owns

| Kind    | Name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Declared at                                            |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Secrets | GOOGLE_CLIENT_SECRET                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `process/src/app/sso.app.ts:329`                       |
| Config  | `authProvider` (AUTH_PROVIDER), `legacyProvider` (NEXTAUTH_PROVIDER), `googleClientId` (GOOGLE_CLIENT_ID), `githubClientId` (GITHUB_CLIENT_ID), `gitlabClientId` (GITLAB_CLIENT_ID), `azureAdClientId` (AZURE_AD_CLIENT_ID), `azureAdTenantId` (AZURE_AD_TENANT_ID), `auth0ClientId` (AUTH0_CLIENT_ID), `auth0Issuer` (AUTH0_ISSUER), `oktaClientId` (OKTA_CLIENT_ID), `oktaIssuer` (OKTA_ISSUER), `cognitoClientId` (COGNITO_CLIENT_ID), `cognitoIssuer` (COGNITO_ISSUER), `oneLoginClientId` (ONELOGIN_CLIENT_ID), `oneLoginIssuer` (ONELOGIN_ISSUER), `oidcClientId` (OIDC_CLIENT_ID), `oidcIssuer` (OIDC_ISSUER), `isSaas` (IS_SAAS), `publicBaseUrl` (BASE_HOST) | `../../../packages/config/src/deployment-facts.ts:238` |

Anything else sso needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token            | Module                                                  |
| --------------- | ---------------- | ------------------------------------------------------- |
| `auditLog`      | `AuditLogApi`    | [audit-log](../../../modules/audit-log/README.md)       |
| `authorization` | `AuthzApi`       | [authz](../../../modules/authz/README.md)               |
| `featureFlags`  | `FeatureFlagApi` | [feature-flag](../../../modules/feature-flag/README.md) |
| `identity`      | `IdentityApi`    | [identity](../../../modules/identity/README.md)         |
| `licensing`     | `LicensingApi`   | [licensing](../licensing/README.md)                     |

## Who depends on sso

[auth](../../../modules/auth/README.md) (as a peer).

<!-- readme:generated:end -->

# data-privacy

Data privacy: per-scope rules and the PII redaction level a project runs at.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Classification | core (`modules/catalogue.json`)                                                                                          |
| Subjects       | data-privacy                                                                                                             |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                                                 |
| Api token      | `DataPrivacyApi` = `moduleApi<DataPrivacyApi>()("data-privacy")`, `contract/src/data-privacy.api.ts:132` (16 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                               |

## What data-privacy owns

| Kind                           | Name                                                                                                                                                                           | Declared at                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Postgres table                 | `DataPrivacyPolicy`                                                                                                                                                            | `process/src/repositories/prisma/prisma.data-privacy.repository.ts:15`           |
| Postgres, accessed not claimed | `Department`, `Group`, `Organization`, `OrganizationUser`, `Project`, `Team`                                                                                                   | `process/src/repositories/prisma/prisma.data-privacy-directory.repository.ts:17` |
| Stores required                |                                                                                                                                                                                | `process/src/channels/http/http.data-privacy.channels.ts:11`                     |
| Secrets                        | `googleApplicationCredentials` (GOOGLE_APPLICATION_CREDENTIALS)                                                                                                                | `process/src/app/data-privacy.app.ts:103`                                        |
| Config                         | `googleDlpDisabled` (LANGWATCH_DISABLE_GOOGLE_DLP), `enforcement` (LANGWATCH_DATA_PRIVACY_ENFORCEMENT), `nodeEnvironment` (NODE_ENV), `langevalsEndpoint` (LANGEVALS_ENDPOINT) | `contract/src/data-privacy.config.ts:11`                                         |

Anything else data-privacy needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name           | Token            | Module                                    |
| -------------- | ---------------- | ----------------------------------------- |
| `featureFlags` | `FeatureFlagApi` | [feature-flag](../feature-flag/README.md) |
| `permissions`  | `AuthzApi`       | [authz](../authz/README.md)               |

## Who depends on data-privacy

[analytics](../analytics/README.md), [log](../log/README.md), [metric](../metric/README.md), [model-provider](../model-provider/README.md), [project](../project/README.md), [trace](../trace/README.md) (as a peer).

<!-- readme:generated:end -->

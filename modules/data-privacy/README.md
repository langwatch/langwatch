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

| Kind                           | Name                                                                                                                                                                                                                                                                                                      | Declared at                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Postgres table                 | `DataPrivacyPolicy`                                                                                                                                                                                                                                                                                       | `process/src/repositories/prisma/prisma.data-privacy.repository.ts:15`           |
| Postgres, accessed not claimed | `Department`, `Group`, `Organization`, `OrganizationUser`, `Project`, `Team`                                                                                                                                                                                                                              | `process/src/repositories/prisma/prisma.data-privacy-directory.repository.ts:17` |
| Stores required                |                                                                                                                                                                                                                                                                                                           | `process/src/channels/http/http.data-privacy.channels.ts:18`                     |
| Secrets                        | `googleApplicationCredentials` (GOOGLE_APPLICATION_CREDENTIALS)                                                                                                                                                                                                                                           | `process/src/app/data-privacy.app.ts:104`                                        |
| Config                         | `googleDlpDisabled` (LANGWATCH_DISABLE_GOOGLE_DLP), `enforcement` (LANGWATCH_DATA_PRIVACY_ENFORCEMENT), `nodeEnvironment` (NODE_ENV), `langevalsEndpoint` (LANGEVALS_ENDPOINT), `piiRedactionModelLambdaArn` (PII_REDACTION_MODEL_LAMBDA_ARN), `piiRedactionModelEndpoint` (PII_REDACTION_MODEL_ENDPOINT) | `contract/src/data-privacy.config.ts:11`                                         |

Anything else data-privacy needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name           | Token            | Module                                    |
| -------------- | ---------------- | ----------------------------------------- |
| `featureFlags` | `FeatureFlagApi` | [feature-flag](../feature-flag/README.md) |
| `permissions`  | `AuthzApi`       | [authz](../authz/README.md)               |

## Who depends on data-privacy

[analytics](../analytics/README.md), [log](../log/README.md), [metric](../metric/README.md), [model-provider](../model-provider/README.md), [project](../project/README.md), [trace](../trace/README.md) (as a peer).

<!-- readme:generated:end -->

## PII redaction model

Strict PII analysis can go to the PII redaction model instead of Presidio, for organizations with
the `release_pii_redaction_model_enabled` flag only, on a deployment that sets
`PII_REDACTION_MODEL_LAMBDA_ARN` (the alias ARN, `...:live`) or `PII_REDACTION_MODEL_ENDPOINT`.
Any problem with the model sends the batch to Presidio, then Google DLP, as for every other
organization.

- **Usage log.** Each batch routed to the model leaves one `PII redaction model call` log line
  with `organizationId`, `projectId`, `texts`, `characters`, `spansFound`, `outcome` (`ok`, or the
  fallback reason) and `durationMs`; an error adds its class name only. It never holds a text, a
  finding's value or an error message. Fallbacks are also counted by `reason` on
  `pii_redaction_model_fallbacks` (`timeout`, `error`, and `routing_error` when the flag or the
  project could not be read).
- **No change without the flag or the settings.** With neither setting, the model channel answers
  "not configured" and nothing new is read: no flag, no project, no request. With a setting but
  without the flag, the only new work is one flag read per batch and one project read per project
  per minute; the batch goes to Presidio as before and the model is never called.

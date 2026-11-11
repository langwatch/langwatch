# data-privacy

Data privacy: per-scope rules and the PII redaction level a project runs at.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Classification | core (`modules/catalogue.json`)                                                                                          |
| Subjects       | data-privacy                                                                                                             |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                                                 |
| Api token      | `DataPrivacyApi` = `moduleApi<DataPrivacyApi>()("data-privacy")`, `contract/src/data-privacy.api.ts:142` (16 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                               |

## What data-privacy owns

| Kind                           | Name                                                                                                                                                                                                                                       | Declared at                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Postgres table                 | `DataPrivacyPolicy`                                                                                                                                                                                                                        | `process/src/repositories/prisma/prisma.data-privacy.repository.ts:15`           |
| Postgres, accessed not claimed | `Department`, `Group`, `Organization`, `OrganizationUser`, `Project`, `Team`                                                                                                                                                               | `process/src/repositories/prisma/prisma.data-privacy-directory.repository.ts:17` |
| Stores required                |                                                                                                                                                                                                                                            | `process/src/channels/http/http.data-privacy.channels.ts:18`                     |
| Secrets                        | `googleApplicationCredentials` (GOOGLE_APPLICATION_CREDENTIALS), `requestIdKey` (API_KEY_PEPPER), `requestIdKeyFallback` (CREDENTIALS_SECRET), `requestIdKeyLastFallback` (NEXTAUTH_SECRET)                                                | `process/src/app/data-privacy.app.ts:139`                                        |
| Config                         | `googleDlpDisabled` (LANGWATCH_DISABLE_GOOGLE_DLP), `enforcement` (LANGWATCH_DATA_PRIVACY_ENFORCEMENT), `nodeEnvironment` (NODE_ENV), `langevalsEndpoint` (LANGEVALS_ENDPOINT), `piiRedactionModelEndpoint` (PII_REDACTION_MODEL_ENDPOINT) | `contract/src/data-privacy.config.ts:11`                                         |

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
`PII_REDACTION_MODEL_ENDPOINT`: the Lambda alias ARN (`arn:aws:lambda:...:live`) or an HTTP address.
Any problem with the model sends the batch to Presidio, then Google DLP, as for every other
organization.

- **Billing.** Every batch the model answers is priced at 0.00005 dollars per 100 characters and
  recorded once, as a `gateway_spend` row of request type `pii_redaction`; a fallback is never
  priced. Organizations with `release_pii_redaction_model_free` are recorded at zero. Billing
  reports the month on `langwatch_pii_redaction_usd` only once Stripe holds that meter
  ([ADR-201](../../dev/docs/adr/201-pii-redaction-model-call-is-metered.md),
  `specs/pii-redaction-billing.feature`).

- **Strict only.** Only a batch whose project's resolved privacy policy is `strict` can reach the
  model. A custom level, even one that selects every analysis-service entity, and a batch whose
  policy could not be loaded stay on Presidio exactly as today, without reading the flag. The
  request's own level is not enough: both of those send `STRICT` batches too.

- **Time cap.** A model call is aborted after 50 s (`PII_REDACTION_MODEL_TIMEOUT_MS`) and the batch
  goes to Presidio. Presidio then gets its own 60 s timeout: the two timers are separate, so a
  batch can wait up to 110 s (50 + 60) before it reaches Google DLP.
  The abort cancels the invoke request; the function itself may run on until its own timeout.
- **Usage log.** Each batch routed to the model leaves one `PII redaction model call` log line
  with `organizationId`, `projectId`, `texts`, `characters`, `spansFound`, `outcome` (`ok`, or the
  fallback reason) and `durationMs`; an error adds its class name only. It never holds a text, a
  finding's value or an error message. Fallbacks are also counted by `reason` on
  `pii_redaction_model_fallbacks` (`too_long`, `timeout`, `throttled`, `error`, `breaker_open`,
  and `routing_error` when the flag or the project could not be read). A model call counts on
  `pii_checks` under `method="pii_redaction_model"`, and its duration and outcome go on
  `evaluation_duration_milliseconds` and `evaluation_status_counter` under
  `evaluator_type="pii_redaction_model"`, never under Presidio's `presidio/pii_detection`.
- **No change without the flag or the settings.** With neither setting, the model channel answers
  "not configured" and nothing new is read: no flag, no project, no request. With a setting but
  without the flag, the only new work is one flag read per batch and one project read per project
  per minute; the batch goes to Presidio as before and the model is never called.
- **Long batches.** A batch with more than 8,000 characters in all its texts
  (`PII_REDACTION_MODEL_MAX_BATCH_CHARACTERS`) skips the model and goes to Presidio, logged and
  counted as `too_long`. The limit is per batch, not per text: one batch is one invoke, and the
  model's time grows with every character in it, so many short texts are as slow as one long one.
- **Cool-down after a timeout.** When a model call times out, or Lambda throttles it
  (`TooManyRequestsException`), the process skips the model for 2 minutes
  (`PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS`): every routed batch goes straight to Presidio,
  logged and counted as `breaker_open`. Then one batch tries the model while the others still
  skip it; if it answers, the model is used again, if it times out, another cool-down starts. A
  refusal or a bad answer does not start one: the model answered in time. The breaker is in
  memory and per process, not per organization: the model is one deployment for every
  organization, so a slow model costs each worker at most one 50 s wait per cool-down, not one
  per organization. Batches already in flight when it opens still run to their own time cap.
  Over HTTP (`PII_REDACTION_MODEL_ENDPOINT`) a throttle cannot be told from other refusals, so
  only a timeout opens it there.

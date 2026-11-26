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

| Kind                           | Name                                                                                                                                                                                                                                                           | Declared at                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Postgres table                 | `DataPrivacyPolicy`                                                                                                                                                                                                                                            | `process/src/repositories/prisma/prisma.data-privacy.repository.ts:15`           |
| Postgres, accessed not claimed | `Department`, `Group`, `Organization`, `OrganizationUser`, `Project`, `Team`                                                                                                                                                                                   | `process/src/repositories/prisma/prisma.data-privacy-directory.repository.ts:17` |
| Stores required                |                                                                                                                                                                                                                                                                | `process/src/channels/http/http.data-privacy.channels.ts:18`                     |
| Secrets                        | `googleApplicationCredentials` (GOOGLE_APPLICATION_CREDENTIALS), `requestIdKey` (API_KEY_PEPPER), `requestIdKeyFallback` (CREDENTIALS_SECRET), `requestIdKeyLastFallback` (NEXTAUTH_SECRET)                                                                    | `process/src/app/data-privacy.app.ts:142`                                        |
| Config                         | `googleDlpDisabled` (LANGWATCH_DISABLE_GOOGLE_DLP), `enforcement` (LANGWATCH_DATA_PRIVACY_ENFORCEMENT), `nodeEnvironment` (NODE_ENV), `langevalsEndpoint` (LANGEVALS_ENDPOINT), `piiRedactionModelEndpoint` (PII_REDACTION_MODEL_ENDPOINT), `isSaas` (IS_SAAS) | `contract/src/data-privacy.config.ts:11`                                         |

Anything else data-privacy needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name           | Token            | Module                                    |
| -------------- | ---------------- | ----------------------------------------- |
| `entitlements` | `EntitlementApi` | [entitlement](../entitlement/README.md)   |
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
  priced. Organizations with `release_pii_redaction_model_free`, and every call on a self-hosted install
  (`IS_SAAS` unset, which runs the model itself), are recorded at zero. Billing
  reports the month on `langwatch_pii_redaction_usd` only once Stripe holds that meter
  ([ADR-201](../../dev/docs/adr/201-pii-redaction-model-call-is-metered.md),
  `specs/pii-redaction-billing.feature`).

- **Settings page.** On LangWatch Cloud with the same flag, the Data Privacy page offers the
  organization Essential (included) or Strict (the model, with its price derived from the billed
  rate, or "Included for your organization" with `release_pii_redaction_model_free`), and the rule
  drawer shows what a level runs and stores. A pick writes only the PII level of the organization
  rule through `setForScope`; Strict at a price and replacing Custom ask first. The browser cannot
  see `PII_REDACTION_MODEL_ENDPOINT`, so the flag is the gate: on self-hosted the Helm chart forces
  it exactly when it sets the endpoint. Self-hosted, the model needs an Enterprise license as well:
  licensed with the flag, the page offers it as included with the license, as the ledger records
  it; licensed without the flag, the drawer says to ask for it to be turned on; unlicensed, the
  server keeps Strict on Presidio and the drawer advertises the license
  (`specs/pii-redaction-level-picker.feature`, `specs/span-pii-redaction.feature`).

- **Strict only.** Only a batch whose effective PII level is `strict` can reach the model: the
  project's policy is `strict`, or it is `essential` and the request asks for `STRICT`. A custom
  level, even one that selects every analysis-service entity, and a batch whose policy could not
  be loaded stay on Presidio exactly as today, without reading the flag. The request's own level
  is not enough on its own: both of those send `STRICT` batches too.

- **Time cap.** A model call is aborted after 50 s (`PII_REDACTION_MODEL_TIMEOUT_MS`) and the batch
  goes to Presidio. Presidio then gets its own 60 s timeout: the two timers are separate, so a
  batch can wait up to 110 s (50 + 60) before it reaches Google DLP.
  The abort cancels the invoke request; the function itself may run on until its own timeout.
- **Usage log.** Each batch routed to the model leaves one `PII redaction model call` log line
  with `organizationId`, `projectId`, `texts`, `characters`, `findings`, `outcome` (`ok`, or the
  fallback reason) and `durationMs`; an error adds its class name only. It never holds a text, a
  finding's value or an error message. Fallbacks are also counted by `reason` on
  `pii_redaction_model_fallbacks` (`too_long`, `timeout`, `throttled`, `error`, `breaker_open`,
  `busy`, `unplaceable`,
  and `routing_error` when the flag or the project could not be read). A model call counts on
  `pii_checks` under `method="pii_redaction_model"`, and its duration and outcome go on
  `evaluation_duration_milliseconds` and `evaluation_status_counter` under
  `evaluator_type="pii_redaction_model"`, never under Presidio's `presidio/pii_detection`.
- **No change without the flag or the settings.** With neither setting, the model channel answers
  "not configured" and nothing new is read: no flag, no project, no request. With a setting but
  without the flag, the only new work is one flag read per batch and one project read per project
  per minute; the batch goes to Presidio as before and the model is never called.
- **Long batches.** A batch with more than 8,000 characters in all its texts
  (`PII_REDACTION_MODEL_MAX_BATCH_CHARACTERS`) is too long for one call: the model's time grows
  with every character in it, so many short texts are as slow as one long one. Unless it is
  split, it skips the model and goes to Presidio, logged and counted as `too_long`.
- **Split batches.** Where the model is a Lambda function (`PII_REDACTION_MODEL_ENDPOINT` an ARN)
  and the organization has `release_pii_redaction_model_split_enabled`, a batch of 8,001 to
  32,000 characters (`PII_REDACTION_MODEL_MAX_SPLIT_CHARACTERS`) is cut into pieces of about
  4,000 that overlap by 200, sent on two calls at once per process, and merged by widest range
  (ADR-207). Split calls go to the same endpoint as single calls, each naming its context; what
  differs by context sits in one table, `MODEL_CALL_RULES`. A piece with a backslash or a
  trimmed edge, or whose findings do not rebuild the model's own masked text, sends the whole
  batch to Presidio as `unplaceable`; so do a busy process (`busy`), a call that fails and a
  span over its 50 s budget (the usual reasons). Split calls have their own cool-down, and the
  batch is billed once on its characters. Over 32,000 characters, a model reached over HTTP, or
  the flag off, stays `too_long`.
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

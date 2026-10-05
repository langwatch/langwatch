# Feature parity: where the product and the scenario disagree

Date: 2026-10-05. Branch: feat/strict-feature-layout-v0. Each row stays unbound until Alex rules: change the scenario, or change the product. Row numbers index the lane's TSV in `.claude/handoffs/parity-bind-<area>.tsv` (0-based, header excluded); detail in that lane's handoff, section 11.

## Langy

| Row                         | Scenario says                                  | Product does                                                                                            |
| --------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 62                          | Langy is never granted delete                  | grants destructive grains the holder holds ("Langy can delete my work, because I can" is bound to that) |
| 120                         | the failure detail names the missing access    | "Ask whoever manages access..."                                                                         |
| 260, 261                    | a quiet line and a countdown, no red card      | a card with a Try again action                                                                          |
| 145                         | dismissed context chips return on a new chat   | chips are opt-in; a new chat starts with none                                                           |
| 175-177, 179, 181, 185, 186 | traces-view, lens, dataset, find-similar chips | alert, Analytics, Annotations, Datasets chips; no alert chip without a query                            |

## Governance

| Row   | Scenario says                                                          | Product does                                                                                                      |
| ----- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 34-37 | Add department navigates to a routed drawer; the page mounts no dialog | local state in governance-people.screen.tsx mounts the drawer                                                     |
| 32    | sample figures replace the real ones                                   | shows them alongside                                                                                              |
| 45    | a source that read its bill cannot be repointed                        | nothing stops it                                                                                                  |
| 111   | a shared secret is redacted on read                                    | `redactDestinationConfig` (contract anomaly-rule.ts) has no caller: possible secret exposure, not only a test gap |

## Auth

| Row   | Scenario says                                           | Product does                                                                                                                               |
| ----- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 4, 5  | a project login returns the project's API key           | a project session, never a key                                                                                                             |
| 9     | personal_project omitted when its key is withheld       | always returned as {id, slug, name}, no api_key                                                                                            |
| 19    | (fallback rules for X-Auth-Token)                       | a decodable `Authorization: Basic user:pass` parses as projectId:token and wins over X-Auth-Token (api-rest-credentials.service.ts:491)    |
| 32-36 | browser-held claims adopt an unfinished passkey account | address proofs; no such claim exists                                                                                                       |
| 40    | OAuthAccountNotLinked names the org's required method   | always "connect this one in Settings > Security"                                                                                           |
| 62    | (last-used method)                                      | rememberLastUsedMethod does not clear the pending slot: a password sign-in after an abandoned social dial is overwritten (possible defect) |
| 81    | a verified but unresolved session is anonymous          | returns a caller with authSessionId                                                                                                        |
| 83    | a throwing resolver leaves the caller anonymous         | BrowserSessionVerificationService.verify does not catch resolveBrowserSession                                                              |

## Identity

| Row    | Scenario says                                                       | Product does                                                                              |
| ------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1-7    | the worker composes its own mail gateway and ledgers                | composes through ConnectedIdentityEventing, producer-only registration: retire or rewrite |
| 27, 28 | backfill uses a derived identifier                                  | adopts each Account row's own issuer                                                      |
| 29, 30 | identifier backfill enrolled automatically, whole-user cohort       | enrolledAutomatically = false, per tenant                                                 |
| 92     | a no-answer history falls back to allowsJit                         | registration requires arrivalPolicy; reducer defaults to refuse                           |
| 93     | activation refused when the deployment has no password door         | guard checks only hasLiveBinding                                                          |
| 94     | a break-glass grant held by someone with no password does not count | live bindings counted whatever the holder has                                             |
| 70, 73 | SAML resolver checks the proved domain; repeat sign-in continues    | domain gate is upstream; repeat sign-in answers "link"                                    |

## Langy, second pass

| Row | Scenario says                                       | Product does                                                                                                                                                  |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 128 | the traceback stays reachable behind the disclosure | `LangyToolErrorCard` renders the reference only when `presentation.code` is set, so a bare traceback has no "Show details" and is unreachable (likely defect) |
| 68  | a trace search card links "Open in Traces"          | the action reads "View in Trace Explorer" (wording)                                                                                                           |

## Scenario

| Ref                                                                                   | Scenario says                                                     | Product does                                                                                      |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| suite-list-view-status.feature:32/46/61/69, suites-page-metrics-display.feature:60/68 | "failed (3/5)", "pending"                                         | `formatRunStatusLabel` returns "Failed (3/5)", "Pending", "Passed" (wording or CSS?)              |
| simulation-service.feature:46                                                         | a job registered on the worker graph                              | computeRunMetrics sent with delay and deduplication (simulation-command-dispatcher.service.ts:94) |
| scenario-evaluation-pending.feature:187/238                                           | the grading job carries attachments, field values and definitions | the payload carries ids only                                                                      |
| simulation-run-metrics.feature:86/190                                                 | metrics triggered on RunFinished                                  | triggered from the trace-settled subscriber                                                       |
| voice-agents-v1.feature:373                                                           | each child environment is built                                   | caller keys travel in adapterData.callerEnv                                                       |
| suite-archive-confirmation-dialog.feature:15/23                                       | "Archive suite?", the sidebar                                     | "Archive run plan?", the plans table                                                              |

## Trace

| Row                        | Scenario says                                          | Product does                                                          |
| -------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| 9                          | neither tracked-event URL is served without a recorder | both routes mount and refuse by name (TraceIngestionUnavailableError) |
| 14, 15                     | the Explorer runs an instant eval from Langy           | no handler registered for explorer.runInstantEval                     |
| 51, 52                     | unmapped cost suggestion rules                         | nothing ever sets SpanDetail.costSuggestion (unimplemented)           |
| 27, 29, 30, 32, 36, 37, 44 | "capability services"                                  | installed peers taken directly (stale wording)                        |

## Governance, second pass

| Row | Scenario says               | Product does  |
| --- | --------------------------- | ------------- |
| 10  | setupState lists six fields | returns seven |

## API keys

| Row    | Scenario says                                                     | Product does                                                           |
| ------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 6      | minting answers id, name, masked hint, grants, created and expiry | id, name and createdAt (pinned by the tRPC test)                       |
| 12     | a "Project key (legacy)" row is listed and can only be revoked    | ADR-002 and the screen test: the legacy key cannot be found            |
| 19     | a new key expires in 90 days unless never is chosen               | the drawer defaults to "No expiration"                                 |
| 20     | a key row offers Revoke and nothing else                          | Edit and Revoke                                                        |
| 26     | the mint dialog greys out roles beyond the reader                 | the drawer has no role chooser                                         |
| 28, 29 | an "I've stored this key" checkbox gates Done                     | a "Token Created" panel with .env, Bearer, Basic and assistant tabs    |
| 33     | audit actions api-key.created / api-key.revoked with the key id   | apiKey.create / apiKey.revoke; the mint entry carries name and keyType |
| 42     | the family serves two screens                                     | it registers four                                                      |

## Analytics

| Row  | Scenario says                                         | Product does                                                                                                        |
| ---- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1-15 | the LWQL workbench screen (period_start / period_end) | the workbench was removed (9d192f6f29); reserved names are dashboard_context_period_start / _end: retire or rewrite |
| 34   | react-vega is pinned, recorded in the PR              | the package pins vega, vega-lite, vega-embed; no react-vega                                                         |

## Organization

| Row    | Scenario says                                                              | Product does                                                                            |
| ------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 12     | a group scope outside the organization answers 400                         | GroupScopeNotInOrganizationError declares 422                                           |
| 27     | a deactivated person does not take a seat                                  | the seat count filters only `disabledAt` and never `user.deactivatedAt` (likely defect) |
| 14, 15 | a directory with no product never reads "SCIM"; group grants stay editable | SourceBadge shows "SCIM"; group detail never says grants stay editable                  |
| 9-11   | refused as FORBIDDEN                                                       | the enterprise gate answers `enterprise_plan_required` (bound; wording)                 |

## Scenario, second pass

| Ref                                          | Scenario says                                             | Product does                                                                 |
| -------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| suites-page-metrics-display.feature:16       | the pill clock shows average agent latency; cost "$0.024" | total duration; "$0.0240"                                                    |
| suite-bugfixes-1956.feature:44               | Run Again stays on the standalone run page                | no standalone run page; Run Again navigates to /simulations?pendingBatch=... |
| real-time-run-updates.feature:60/66/72/80/86 | adaptive polling                                          | no refetchInterval; a test asserts no timer                                  |

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

| Row | Scenario says | Product does |
| --- | --- | --- |
| 128 | the traceback stays reachable behind the disclosure | `LangyToolErrorCard` renders the reference only when `presentation.code` is set, so a bare traceback has no "Show details" and is unreachable (likely defect) |
| 68 | a trace search card links "Open in Traces" | the action reads "View in Trace Explorer" (wording) |

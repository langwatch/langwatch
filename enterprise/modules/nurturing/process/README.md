# @langwatch/enterprise-nurturing-process

The server half of [nurturing](../README.md). Product analytics and lifecycle messaging: every owner tells nurturing through a subscriber on its own pipeline, and nurturing alone talks to PostHog and Customer.io.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("nurturing").withRepositories(nurturingRepositories).withChannels(nurturingChannels).withApi(NurturingModule).withEventing(nurturingEventing)`, `src/nurturing.module.ts:14`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`NurturingApi`)

Every owner tells nurturing through a subscriber on its own pipeline (§9); nurturing names no peer.

Peers call these through the token, declared at `../contract/src/nurturing-types.ts:207`; nothing else in this package is public.

#### `recordSignal`

Records the signal on nurturing's pipeline; its subscriber sends what main sent, once.

```typescript
recordSignal(signal: NurturingSignal): Promise<void>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

None: this module declares no tRPC router.

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `nurturing` (aggregate `nurturing_signal`)

Declared at `src/eventing/nurturing.pipeline.ts:303`. Events: `nurturingSignalRecordedEventSchema`.

| Kind            | Name                            | Handles                                                                                                          | Declared at                              |
| --------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| command         | `recordSignal`                  | –                                                                                                                | `src/eventing/nurturing.pipeline.ts:626` |
| subscriber      | `deliverSignal`                 | `lw.nurturing.signal_recorded` from [nurturing](../README.md)                                                    | `src/eventing/nurturing.pipeline.ts:308` |
| peer subscriber | `guidedOnboardingRecorded`      | `lw.guided_onboarding.recorded` from [onboarding](../../../../modules/onboarding/README.md)                      | `src/eventing/nurturing.pipeline.ts:313` |
| peer subscriber | `onboardingVariantAssigned`     | `lw.guided_onboarding.variant_assigned` from [onboarding](../../../../modules/onboarding/README.md)              | `src/eventing/nurturing.pipeline.ts:321` |
| peer subscriber | `guidedOnboardingTurnFailed`    | `lw.langy_guided_onboarding.turn_failed` from [langy](../../../../modules/langy/README.md)                       | `src/eventing/nurturing.pipeline.ts:329` |
| peer subscriber | `usageReportReceived`           | `lw.saas.usage_report_received` from [saas](../../saas/README.md)                                                | `src/eventing/nurturing.pipeline.ts:334` |
| peer subscriber | `experimentRan`                 | `lw.experiment.ran` from [experiment](../../../../modules/experiment/README.md)                                  | `src/eventing/nurturing.pipeline.ts:339` |
| peer subscriber | `evaluationRan`                 | `lw.evaluation.ran` from [evaluation](../../../../modules/evaluation/README.md)                                  | `src/eventing/nurturing.pipeline.ts:347` |
| peer subscriber | `evaluationCompleted`           | `lw.evaluation.lifecycle_completed` from [evaluation](../../../../modules/evaluation/README.md)                  | `src/eventing/nurturing.pipeline.ts:355` |
| peer subscriber | `projectCreated`                | `lw.project.created` from [project](../../../../modules/project/README.md)                                       | `src/eventing/nurturing.pipeline.ts:367` |
| peer subscriber | `subscriptionChanged`           | `lw.billing.subscription_changed` from [billing](../../billing/README.md)                                        | `src/eventing/nurturing.pipeline.ts:372` |
| peer subscriber | `subscriptionStarted`           | `lw.billing.subscription_started` from [billing](../../billing/README.md)                                        | `src/eventing/nurturing.pipeline.ts:380` |
| peer subscriber | `checkoutCompleted`             | `lw.billing.checkout_completed` from [billing](../../billing/README.md)                                          | `src/eventing/nurturing.pipeline.ts:388` |
| peer subscriber | `sessionStarted`                | `lw.auth.session_started` from [auth](../../../../modules/auth/README.md)                                        | `src/eventing/nurturing.pipeline.ts:396` |
| peer subscriber | `ssoAutoAdded`                  | `lw.auth.sso_auto_added` from [auth](../../../../modules/auth/README.md)                                         | `src/eventing/nurturing.pipeline.ts:404` |
| peer subscriber | `organizationSignedUp`          | `lw.organization.signed_up` from [organization](../../../../modules/organization/README.md)                      | `src/eventing/nurturing.pipeline.ts:412` |
| peer subscriber | `userRegistered`                | `lw.user.registered` from [user](../../../../modules/user/README.md)                                             | `src/eventing/nurturing.pipeline.ts:420` |
| peer subscriber | `userCreated`                   | `lw.user.created` from [user](../../../../modules/user/README.md)                                                | `src/eventing/nurturing.pipeline.ts:429` |
| peer subscriber | `authSignedUp`                  | `lw.auth.signed_up` from [auth](../../../../modules/auth/README.md)                                              | `src/eventing/nurturing.pipeline.ts:438` |
| peer subscriber | `membersInvited`                | `lw.organization.members_invited` from [organization](../../../../modules/organization/README.md)                | `src/eventing/nurturing.pipeline.ts:446` |
| peer subscriber | `inviteAccepted`                | `lw.organization.invite_accepted` from [organization](../../../../modules/organization/README.md)                | `src/eventing/nurturing.pipeline.ts:454` |
| peer subscriber | `integrationMethodChosen`       | `lw.organization.integration_method_chosen` from [organization](../../../../modules/organization/README.md)      | `src/eventing/nurturing.pipeline.ts:462` |
| peer subscriber | `promptCreated`                 | `lw.prompt.created` from [prompt](../../../../modules/prompt/README.md)                                          | `src/eventing/nurturing.pipeline.ts:470` |
| peer subscriber | `workflowCreated`               | `lw.workflow.created` from [workflow](../../../../modules/workflow/README.md)                                    | `src/eventing/nurturing.pipeline.ts:478` |
| peer subscriber | `scenarioCreated`               | `lw.scenario.created` from [scenario](../../../../modules/scenario/README.md)                                    | `src/eventing/nurturing.pipeline.ts:486` |
| peer subscriber | `scenarioRunSucceeded`          | `lw.simulation_run.finished` from [scenario](../../../../modules/scenario/README.md)                             | `src/eventing/nurturing.pipeline.ts:494` |
| peer subscriber | `simulationRunFinished`         | `lw.simulation_run.finished` from [scenario](../../../../modules/scenario/README.md)                             | `src/eventing/nurturing.pipeline.ts:506` |
| peer subscriber | `firstTraceRecorded`            | `lw.trace.first_trace_recorded` from [trace](../../../../modules/trace/README.md)                                | `src/eventing/nurturing.pipeline.ts:522` |
| peer subscriber | `traceReceived`                 | `lw.trace.trace_received` from [trace](../../../../modules/trace/README.md)                                      | `src/eventing/nurturing.pipeline.ts:533` |
| peer subscriber | `codingAgentSessionStored`      | `lw.coding_agent.session_stored` from [coding-agent](../../../../modules/coding-agent/README.md)                 | `src/eventing/nurturing.pipeline.ts:548` |
| peer subscriber | `personalTeamCreated`           | `lw.organization.personal_team_created` from [organization](../../../../modules/organization/README.md)          | `src/eventing/nurturing.pipeline.ts:561` |
| peer subscriber | `personalWorkspaceProvisioned`  | `lw.organization.personal_workspace_provisioned` from [organization](../../../../modules/organization/README.md) | `src/eventing/nurturing.pipeline.ts:567` |
| peer subscriber | `personalOwnerListed`           | `lw.project.personal_owner_listed` from [project](../../../../modules/project/README.md)                         | `src/eventing/nurturing.pipeline.ts:573` |
| peer subscriber | `projectTraced`                 | `lw.trace.project_traced` from [trace](../../../../modules/trace/README.md)                                      | `src/eventing/nurturing.pipeline.ts:579` |
| peer subscriber | `firstMessageListed`            | `lw.project.first_message_listed` from [project](../../../../modules/project/README.md)                          | `src/eventing/nurturing.pipeline.ts:585` |
| peer subscriber | `userErased`                    | `lw.user.erased` from [user](../../../../modules/user/README.md)                                                 | `src/eventing/nurturing.pipeline.ts:592` |
| peer subscriber | `appPageOpened`                 | `lw.auth.app_page_opened` from [auth](../../../../modules/auth/README.md)                                        | `src/eventing/nurturing.pipeline.ts:597` |
| peer subscriber | `insightFiled`                  | `lw.insight.filed` from [insight](../../../../modules/insight/README.md)                                         | `src/eventing/nurturing.pipeline.ts:603` |
| peer subscriber | `insightSeen`                   | `lw.insight.seen` from [insight](../../../../modules/insight/README.md)                                          | `src/eventing/nurturing.pipeline.ts:608` |
| peer subscriber | `insightArchived`               | `lw.insight.archived` from [insight](../../../../modules/insight/README.md)                                      | `src/eventing/nurturing.pipeline.ts:614` |
| peer subscriber | `insightKept`                   | `lw.insight.kept` from [insight](../../../../modules/insight/README.md)                                          | `src/eventing/nurturing.pipeline.ts:620` |
| lane aliases    | `≈ MAIN_NURTURING_LANE_ALIASES` | –                                                                                                                | `src/eventing/nurturing.pipeline.ts:627` |

## Configuration

| Kind   | Leaf                | Environment variable   | Declared at                              |
| ------ | ------------------- | ---------------------- | ---------------------------------------- |
| secret | `–`                 | `CUSTOMER_IO_API_KEY`  | `src/app/nurturing.app.ts:39`            |
| config | `customerIoRegion`  | `CUSTOMER_IO_REGION`   | `../contract/src/nurturing.config.ts:8`  |
| config | `customerIoBaseUrl` | `CUSTOMER_IO_BASE_URL` | `../contract/src/nurturing.config.ts:10` |
| config | `posthogKey`        | `POSTHOG_KEY`          | `../contract/src/nurturing.config.ts:11` |
| config | `posthogHost`       | `POSTHOG_HOST`         | `../contract/src/nurturing.config.ts:12` |

<!-- readme:generated:end -->

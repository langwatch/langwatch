# @langwatch/enterprise-nurturing-process

The server half of [nurturing](../README.md). Product analytics and lifecycle messaging: every owner tells nurturing through a subscriber on its own pipeline, and nurturing alone talks to PostHog and Customer.io.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("nurturing").withRepositories(nurturingRepositories).withChannels(nurturingChannels).withApi(NurturingModule).withEventing(nurturingEventing)`, `src/nurturing.module.ts:14`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`NurturingApi`)

Every owner tells nurturing through a subscriber on its own pipeline (§9); nurturing names no peer.

Peers call these through the token, declared at `../contract/src/nurturing-types.ts:182`; nothing else in this package is public.

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

Declared at `src/eventing/nurturing.pipeline.ts:173`. Events: `nurturingSignalRecordedEventSchema`.

| Kind            | Name                                                                                           | Handles                                                                                                     | Declared at                              |
| --------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| command         | `recordSignal`                                                                                 | –                                                                                                           | `src/eventing/nurturing.pipeline.ts:392` |
| subscriber      | `deliverSignal`                                                                                | `lw.nurturing.signal_recorded` from [nurturing](../README.md)                                               | `src/eventing/nurturing.pipeline.ts:178` |
| peer subscriber | `guidedOnboardingRecorded`                                                                     | `lw.guided_onboarding.recorded` from [onboarding](../../../../modules/onboarding/README.md)                 | `src/eventing/nurturing.pipeline.ts:183` |
| peer subscriber | `guidedOnboardingTurnFailed`                                                                   | `lw.langy_guided_onboarding.turn_failed` from [langy](../../../../modules/langy/README.md)                  | `src/eventing/nurturing.pipeline.ts:191` |
| peer subscriber | `usageReportReceived`                                                                          | `lw.saas.usage_report_received` from [saas](../../saas/README.md)                                           | `src/eventing/nurturing.pipeline.ts:196` |
| peer subscriber | `experimentRan`                                                                                | `lw.experiment.ran` from [experiment](../../../../modules/experiment/README.md)                             | `src/eventing/nurturing.pipeline.ts:201` |
| peer subscriber | `evaluationRan`                                                                                | `lw.evaluation.ran` from [evaluation](../../../../modules/evaluation/README.md)                             | `src/eventing/nurturing.pipeline.ts:209` |
| peer subscriber | `evaluationCompleted`                                                                          | `lw.evaluation.lifecycle_completed` from [evaluation](../../../../modules/evaluation/README.md)             | `src/eventing/nurturing.pipeline.ts:217` |
| peer subscriber | `projectCreated`                                                                               | `lw.project.created` from [project](../../../../modules/project/README.md)                                  | `src/eventing/nurturing.pipeline.ts:226` |
| peer subscriber | `subscriptionChanged`                                                                          | `lw.billing.subscription_changed` from [billing](../../billing/README.md)                                   | `src/eventing/nurturing.pipeline.ts:231` |
| peer subscriber | `subscriptionStarted`                                                                          | `lw.billing.subscription_started` from [billing](../../billing/README.md)                                   | `src/eventing/nurturing.pipeline.ts:239` |
| peer subscriber | `checkoutCompleted`                                                                            | `lw.billing.checkout_completed` from [billing](../../billing/README.md)                                     | `src/eventing/nurturing.pipeline.ts:247` |
| peer subscriber | `sessionStarted`                                                                               | `lw.auth.session_started` from [auth](../../../../modules/auth/README.md)                                   | `src/eventing/nurturing.pipeline.ts:255` |
| peer subscriber | `ssoAutoAdded`                                                                                 | `lw.auth.sso_auto_added` from [auth](../../../../modules/auth/README.md)                                    | `src/eventing/nurturing.pipeline.ts:263` |
| peer subscriber | `organizationSignedUp`                                                                         | `lw.organization.signed_up` from [organization](../../../../modules/organization/README.md)                 | `src/eventing/nurturing.pipeline.ts:271` |
| peer subscriber | `userRegistered`                                                                               | `lw.user.registered` from [user](../../../../modules/user/README.md)                                        | `src/eventing/nurturing.pipeline.ts:279` |
| peer subscriber | `userCreated`                                                                                  | `lw.user.created` from [user](../../../../modules/user/README.md)                                           | `src/eventing/nurturing.pipeline.ts:288` |
| peer subscriber | `authSignedUp`                                                                                 | `lw.auth.signed_up` from [auth](../../../../modules/auth/README.md)                                         | `src/eventing/nurturing.pipeline.ts:297` |
| peer subscriber | `membersInvited`                                                                               | `lw.organization.members_invited` from [organization](../../../../modules/organization/README.md)           | `src/eventing/nurturing.pipeline.ts:305` |
| peer subscriber | `inviteAccepted`                                                                               | `lw.organization.invite_accepted` from [organization](../../../../modules/organization/README.md)           | `src/eventing/nurturing.pipeline.ts:313` |
| peer subscriber | `integrationMethodChosen`                                                                      | `lw.organization.integration_method_chosen` from [organization](../../../../modules/organization/README.md) | `src/eventing/nurturing.pipeline.ts:321` |
| peer subscriber | `promptCreated`                                                                                | `lw.prompt.created` from [prompt](../../../../modules/prompt/README.md)                                     | `src/eventing/nurturing.pipeline.ts:329` |
| peer subscriber | `workflowCreated`                                                                              | `lw.workflow.created` from [workflow](../../../../modules/workflow/README.md)                               | `src/eventing/nurturing.pipeline.ts:337` |
| peer subscriber | `scenarioCreated`                                                                              | `lw.scenario.created` from [scenario](../../../../modules/scenario/README.md)                               | `src/eventing/nurturing.pipeline.ts:345` |
| peer subscriber | `scenarioRunSucceeded`                                                                         | `lw.simulation_run.finished` from [scenario](../../../../modules/scenario/README.md)                        | `src/eventing/nurturing.pipeline.ts:353` |
| peer subscriber | `simulationRunFinished`                                                                        | `lw.simulation_run.finished` from [scenario](../../../../modules/scenario/README.md)                        | `src/eventing/nurturing.pipeline.ts:365` |
| peer subscriber | `firstTraceRecorded`                                                                           | `lw.trace.first_trace_recorded` from [trace](../../../../modules/trace/README.md)                           | `src/eventing/nurturing.pipeline.ts:374` |
| peer subscriber | `traceReceived`                                                                                | `lw.trace.trace_received` from [trace](../../../../modules/trace/README.md)                                 | `src/eventing/nurturing.pipeline.ts:383` |
| lane aliases    | `≈ [ { from: "simulation_processing:subscriber:scenarioRunMilestones", to: { jobType: "subsc…` | –                                                                                                           | `src/eventing/nurturing.pipeline.ts:394` |

## Configuration

| Kind   | Leaf                | Environment variable   | Declared at                              |
| ------ | ------------------- | ---------------------- | ---------------------------------------- |
| secret | `–`                 | `CUSTOMER_IO_API_KEY`  | `src/app/nurturing.app.ts:32`            |
| config | `customerIoRegion`  | `CUSTOMER_IO_REGION`   | `../contract/src/nurturing.config.ts:8`  |
| config | `customerIoBaseUrl` | `CUSTOMER_IO_BASE_URL` | `../contract/src/nurturing.config.ts:10` |
| config | `posthogKey`        | `POSTHOG_KEY`          | `../contract/src/nurturing.config.ts:11` |
| config | `posthogHost`       | `POSTHOG_HOST`         | `../contract/src/nurturing.config.ts:12` |

<!-- readme:generated:end -->

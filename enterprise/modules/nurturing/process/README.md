# @langwatch/enterprise-nurturing-process

The server half of [nurturing](../README.md). Product analytics and lifecycle messaging: every owner tells nurturing through a subscriber on its own pipeline, and nurturing alone talks to PostHog and Customer.io.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("nurturing").withRepositories(nurturingRepositories).withApi(NurturingModule).withEventing(nurturingEventing)`, `src/nurturing.module.ts:8`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`NurturingApi`)

Every owner tells nurturing through a subscriber on its own pipeline (§9); nurturing names no peer.

Peers call these through the token, declared at `../contract/src/nurturing-types.ts:185`; nothing else in this package is public.

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

Declared at `src/eventing/nurturing.pipeline.ts:157`. Events: `nurturingSignalRecordedEventSchema`.

| Kind            | Name                         | Handles                                                                                                     | Declared at                              |
| --------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| command         | `recordSignal`               | –                                                                                                           | `src/eventing/nurturing.pipeline.ts:361` |
| subscriber      | `deliverSignal`              | `lw.nurturing.signal_recorded` from [nurturing](../README.md)                                               | `src/eventing/nurturing.pipeline.ts:162` |
| peer subscriber | `guidedOnboardingRecorded`   | `lw.guided_onboarding.recorded` from [onboarding](../../../../modules/onboarding/README.md)                 | `src/eventing/nurturing.pipeline.ts:167` |
| peer subscriber | `guidedOnboardingTurnFailed` | `lw.langy_guided_onboarding.turn_failed` from [langy](../../../../modules/langy/README.md)                  | `src/eventing/nurturing.pipeline.ts:175` |
| peer subscriber | `experimentRan`              | `lw.experiment.ran` from [experiment](../../../../modules/experiment/README.md)                             | `src/eventing/nurturing.pipeline.ts:180` |
| peer subscriber | `evaluationRan`              | `lw.evaluation.ran` from [evaluation](../../../../modules/evaluation/README.md)                             | `src/eventing/nurturing.pipeline.ts:188` |
| peer subscriber | `evaluationCompleted`        | `lw.evaluation.lifecycle_completed` from [evaluation](../../../../modules/evaluation/README.md)             | `src/eventing/nurturing.pipeline.ts:196` |
| peer subscriber | `projectCreated`             | `lw.project.created` from [project](../../../../modules/project/README.md)                                  | `src/eventing/nurturing.pipeline.ts:205` |
| peer subscriber | `subscriptionChanged`        | `lw.billing.subscription_changed` from [billing](../../billing/README.md)                                   | `src/eventing/nurturing.pipeline.ts:210` |
| peer subscriber | `subscriptionStarted`        | `lw.billing.subscription_started` from [billing](../../billing/README.md)                                   | `src/eventing/nurturing.pipeline.ts:218` |
| peer subscriber | `checkoutCompleted`          | `lw.billing.checkout_completed` from [billing](../../billing/README.md)                                     | `src/eventing/nurturing.pipeline.ts:226` |
| peer subscriber | `sessionStarted`             | `lw.auth.session_started` from [auth](../../../../modules/auth/README.md)                                   | `src/eventing/nurturing.pipeline.ts:234` |
| peer subscriber | `ssoAutoAdded`               | `lw.auth.sso_auto_added` from [auth](../../../../modules/auth/README.md)                                    | `src/eventing/nurturing.pipeline.ts:242` |
| peer subscriber | `organizationSignedUp`       | `lw.organization.signed_up` from [organization](../../../../modules/organization/README.md)                 | `src/eventing/nurturing.pipeline.ts:250` |
| peer subscriber | `userRegistered`             | `lw.user.registered` from [user](../../../../modules/user/README.md)                                        | `src/eventing/nurturing.pipeline.ts:258` |
| peer subscriber | `authSignedUp`               | `lw.auth.signed_up` from [auth](../../../../modules/auth/README.md)                                         | `src/eventing/nurturing.pipeline.ts:266` |
| peer subscriber | `membersInvited`             | `lw.organization.members_invited` from [organization](../../../../modules/organization/README.md)           | `src/eventing/nurturing.pipeline.ts:274` |
| peer subscriber | `inviteAccepted`             | `lw.organization.invite_accepted` from [organization](../../../../modules/organization/README.md)           | `src/eventing/nurturing.pipeline.ts:282` |
| peer subscriber | `integrationMethodChosen`    | `lw.organization.integration_method_chosen` from [organization](../../../../modules/organization/README.md) | `src/eventing/nurturing.pipeline.ts:290` |
| peer subscriber | `promptCreated`              | `lw.prompt.created` from [prompt](../../../../modules/prompt/README.md)                                     | `src/eventing/nurturing.pipeline.ts:298` |
| peer subscriber | `workflowCreated`            | `lw.workflow.created` from [workflow](../../../../modules/workflow/README.md)                               | `src/eventing/nurturing.pipeline.ts:306` |
| peer subscriber | `scenarioCreated`            | `lw.scenario.created` from [scenario](../../../../modules/scenario/README.md)                               | `src/eventing/nurturing.pipeline.ts:314` |
| peer subscriber | `scenarioRunSucceeded`       | `lw.simulation_run.finished` from [scenario](../../../../modules/scenario/README.md)                        | `src/eventing/nurturing.pipeline.ts:322` |
| peer subscriber | `simulationRunFinished`      | `lw.simulation_run.finished` from [scenario](../../../../modules/scenario/README.md)                        | `src/eventing/nurturing.pipeline.ts:334` |
| peer subscriber | `firstTraceRecorded`         | `lw.trace.first_trace_recorded` from [trace](../../../../modules/trace/README.md)                           | `src/eventing/nurturing.pipeline.ts:343` |
| peer subscriber | `traceReceived`              | `lw.trace.trace_received` from [trace](../../../../modules/trace/README.md)                                 | `src/eventing/nurturing.pipeline.ts:352` |

## Configuration

| Kind   | Leaf                | Environment variable   | Declared at                              |
| ------ | ------------------- | ---------------------- | ---------------------------------------- |
| secret | `–`                 | `CUSTOMER_IO_API_KEY`  | `src/app/nurturing.app.ts:32`            |
| config | `customerIoRegion`  | `CUSTOMER_IO_REGION`   | `../contract/src/nurturing-types.ts:195` |
| config | `customerIoBaseUrl` | `CUSTOMER_IO_BASE_URL` | `../contract/src/nurturing-types.ts:197` |
| config | `posthogKey`        | `POSTHOG_KEY`          | `../contract/src/nurturing-types.ts:198` |
| config | `posthogHost`       | `POSTHOG_HOST`         | `../contract/src/nurturing-types.ts:199` |

<!-- readme:generated:end -->

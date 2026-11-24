# @langwatch/enterprise-nurturing-process

The server half of [nurturing](../README.md). Product analytics and lifecycle messaging: nurturing learns from the owners' events, keeps its own copies, and alone talks to PostHog and Customer.io.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("nurturing").withRepositories(nurturingRepositories).withChannels(nurturingChannels).withApi(NurturingModule).withEventing(nurturingEventing).withEventing(nurturingProjectUsageEventing).withEventing(nurturingTraceWindowEndEventing)`, `src/nurturing.module.ts:16`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`NurturingApi`)

Nurturing learns from the owners' events (§9); an owner that pushes a fact calls this.

Peers call these through the token, declared at `../contract/src/nurturing-types.ts:262`; nothing else in this package is public.

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

### Pipeline `nurturing_project_usage` (aggregate `nurturing_project_usage_view`)

Declared at `src/eventing/nurturing-project-usage.pipeline.ts:507`.

| Kind                 | Name                                                              | Handles                                                                                           | Declared at                                            |
| -------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| peer subscriber      | `projectPlacement`                                                | `lw.project.created` from [project](../../../../modules/project/README.md)                        | `src/eventing/nurturing-project-usage.pipeline.ts:512` |
| peer subscriber      | `organizationCreated`                                             | `lw.organization.created` from [organization](../../../../modules/organization/README.md)         | `src/eventing/nurturing-project-usage.pipeline.ts:513` |
| peer subscriber      | `memberFoundedOrganization`                                       | `lw.organization.created` from [organization](../../../../modules/organization/README.md)         | `src/eventing/nurturing-project-usage.pipeline.ts:517` |
| peer subscriber      | `memberSignedUp`                                                  | `lw.organization.signed_up` from [organization](../../../../modules/organization/README.md)       | `src/eventing/nurturing-project-usage.pipeline.ts:518` |
| peer subscriber      | `memberInviteAccepted`                                            | `lw.organization.invite_accepted` from [organization](../../../../modules/organization/README.md) | `src/eventing/nurturing-project-usage.pipeline.ts:527` |
| peer subscriber      | `memberSsoAutoAdded`                                              | `lw.auth.sso_auto_added` from [auth](../../../../modules/auth/README.md)                          | `src/eventing/nurturing-project-usage.pipeline.ts:536` |
| peer subscriber      | `memberRemoved`                                                   | `lw.organization.member_removed` from [organization](../../../../modules/organization/README.md)  | `src/eventing/nurturing-project-usage.pipeline.ts:545` |
| peer subscriber      | `memberDisabled`                                                  | `lw.organization.member_disabled` from [organization](../../../../modules/organization/README.md) | `src/eventing/nurturing-project-usage.pipeline.ts:554` |
| peer subscriber      | `memberEnabled`                                                   | `lw.organization.member_enabled` from [organization](../../../../modules/organization/README.md)  | `src/eventing/nurturing-project-usage.pipeline.ts:563` |
| peer subscriber      | `traceDayCount`                                                   | `lw.obs.trace.span_received` from [trace](../../../../modules/trace/README.md)                    | `src/eventing/nurturing-project-usage.pipeline.ts:595` |
| peer subscriber      | `failedTraceDayCount`                                             | `lw.trace.trace_failed` from [trace](../../../../modules/trace/README.md)                         | `src/eventing/nurturing-project-usage.pipeline.ts:596` |
| peer subscriber      | `firstTraceUsageSync`                                             | `lw.trace.first_trace_recorded` from [trace](../../../../modules/trace/README.md)                 | `src/eventing/nurturing-project-usage.pipeline.ts:599` |
| peer subscriber      | `traceUsageSync`                                                  | `lw.trace.trace_received` from [trace](../../../../modules/trace/README.md)                       | `src/eventing/nurturing-project-usage.pipeline.ts:600` |
| peer subscriber      | `evaluationActiveDay`                                             | `lw.evaluation.lifecycle_completed` from [evaluation](../../../../modules/evaluation/README.md)   | `src/eventing/nurturing-project-usage.pipeline.ts:601` |
| peer fold projection | `≈ nurturingProjectUsagePeerFold({ owner: "prompt", store })`     | –                                                                                                 | `src/eventing/nurturing-project-usage.pipeline.ts:579` |
| peer fold projection | `≈ nurturingProjectUsagePeerFold({ owner: "evaluator", store })`  | –                                                                                                 | `src/eventing/nurturing-project-usage.pipeline.ts:583` |
| peer fold projection | `≈ nurturingProjectUsagePeerFold({ owner: "scenario", store })`   | –                                                                                                 | `src/eventing/nurturing-project-usage.pipeline.ts:587` |
| peer fold projection | `≈ nurturingProjectUsagePeerFold({ owner: "simulation", store })` | –                                                                                                 | `src/eventing/nurturing-project-usage.pipeline.ts:591` |

### Pipeline `nurturing_trace_window_end` (aggregate `global`)

Declared at `src/eventing/nurturing-trace-window-end.pipeline.ts:33`.

| Kind            | Name                      | Handles                                                                               | Declared at                                              |
| --------------- | ------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| process manager | `nurturingTraceWindowEnd` | every 1 h (`TRACE_WINDOW_END_INTERVAL_MS = 60 * 60 * 1000`); intents `sweep` (outbox) | `src/eventing/nurturing-trace-window-end.pipeline.ts:39` |

### Pipeline `nurturing` (aggregate `nurturing_signal`)

Declared at `src/eventing/nurturing.pipeline.ts:311`. Events: `nurturingSignalRecordedEventSchema`.

| Kind            | Name                            | Handles                                                                                                          | Declared at                              |
| --------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| command         | `recordSignal`                  | –                                                                                                                | `src/eventing/nurturing.pipeline.ts:647` |
| subscriber      | `deliverSignal`                 | `lw.nurturing.signal_recorded` from [nurturing](../README.md)                                                    | `src/eventing/nurturing.pipeline.ts:316` |
| peer subscriber | `guidedOnboardingRecorded`      | `lw.guided_onboarding.recorded` from [onboarding](../../../../modules/onboarding/README.md)                      | `src/eventing/nurturing.pipeline.ts:321` |
| peer subscriber | `onboardingVariantAssigned`     | `lw.guided_onboarding.variant_assigned` from [onboarding](../../../../modules/onboarding/README.md)              | `src/eventing/nurturing.pipeline.ts:329` |
| peer subscriber | `guidedOnboardingTurnFailed`    | `lw.langy_guided_onboarding.turn_failed` from [langy](../../../../modules/langy/README.md)                       | `src/eventing/nurturing.pipeline.ts:337` |
| peer subscriber | `usageReportReceived`           | `lw.saas.usage_report_received` from [saas](../../saas/README.md)                                                | `src/eventing/nurturing.pipeline.ts:342` |
| peer subscriber | `experimentRan`                 | `lw.experiment.ran` from [experiment](../../../../modules/experiment/README.md)                                  | `src/eventing/nurturing.pipeline.ts:347` |
| peer subscriber | `evaluationRan`                 | `lw.evaluation.ran` from [evaluation](../../../../modules/evaluation/README.md)                                  | `src/eventing/nurturing.pipeline.ts:355` |
| peer subscriber | `evaluationCompleted`           | `lw.evaluation.lifecycle_completed` from [evaluation](../../../../modules/evaluation/README.md)                  | `src/eventing/nurturing.pipeline.ts:363` |
| peer subscriber | `projectCreated`                | `lw.project.created` from [project](../../../../modules/project/README.md)                                       | `src/eventing/nurturing.pipeline.ts:375` |
| peer subscriber | `subscriptionChanged`           | `lw.billing.subscription_changed` from [billing](../../billing/README.md)                                        | `src/eventing/nurturing.pipeline.ts:380` |
| peer subscriber | `subscriptionStarted`           | `lw.billing.subscription_started` from [billing](../../billing/README.md)                                        | `src/eventing/nurturing.pipeline.ts:388` |
| peer subscriber | `checkoutCompleted`             | `lw.billing.checkout_completed` from [billing](../../billing/README.md)                                          | `src/eventing/nurturing.pipeline.ts:396` |
| peer subscriber | `sessionStarted`                | `lw.auth.session_started` from [auth](../../../../modules/auth/README.md)                                        | `src/eventing/nurturing.pipeline.ts:404` |
| peer subscriber | `ssoAutoAdded`                  | `lw.auth.sso_auto_added` from [auth](../../../../modules/auth/README.md)                                         | `src/eventing/nurturing.pipeline.ts:412` |
| peer subscriber | `organizationSignedUp`          | `lw.organization.signed_up` from [organization](../../../../modules/organization/README.md)                      | `src/eventing/nurturing.pipeline.ts:420` |
| peer subscriber | `userRegistered`                | `lw.user.registered` from [user](../../../../modules/user/README.md)                                             | `src/eventing/nurturing.pipeline.ts:428` |
| peer subscriber | `userCreated`                   | `lw.user.created` from [user](../../../../modules/user/README.md)                                                | `src/eventing/nurturing.pipeline.ts:437` |
| peer subscriber | `authSignedUp`                  | `lw.auth.signed_up` from [auth](../../../../modules/auth/README.md)                                              | `src/eventing/nurturing.pipeline.ts:446` |
| peer subscriber | `membersInvited`                | `lw.organization.members_invited` from [organization](../../../../modules/organization/README.md)                | `src/eventing/nurturing.pipeline.ts:454` |
| peer subscriber | `inviteAccepted`                | `lw.organization.invite_accepted` from [organization](../../../../modules/organization/README.md)                | `src/eventing/nurturing.pipeline.ts:462` |
| peer subscriber | `memberRoleChanged`             | `lw.organization.member_role_changed` from [organization](../../../../modules/organization/README.md)            | `src/eventing/nurturing.pipeline.ts:470` |
| peer subscriber | `integrationMethodChosen`       | `lw.organization.integration_method_chosen` from [organization](../../../../modules/organization/README.md)      | `src/eventing/nurturing.pipeline.ts:478` |
| peer subscriber | `promptCreated`                 | `lw.prompt.created` from [prompt](../../../../modules/prompt/README.md)                                          | `src/eventing/nurturing.pipeline.ts:486` |
| peer subscriber | `workflowCreated`               | `lw.workflow.created` from [workflow](../../../../modules/workflow/README.md)                                    | `src/eventing/nurturing.pipeline.ts:494` |
| peer subscriber | `scenarioCreated`               | `lw.scenario.created` from [scenario](../../../../modules/scenario/README.md)                                    | `src/eventing/nurturing.pipeline.ts:502` |
| peer subscriber | `scenarioRunSucceeded`          | `lw.simulation_run.finished` from [scenario](../../../../modules/scenario/README.md)                             | `src/eventing/nurturing.pipeline.ts:510` |
| peer subscriber | `simulationRunFinished`         | `lw.simulation_run.finished` from [scenario](../../../../modules/scenario/README.md)                             | `src/eventing/nurturing.pipeline.ts:522` |
| peer subscriber | `firstTraceRecorded`            | `lw.trace.first_trace_recorded` from [trace](../../../../modules/trace/README.md)                                | `src/eventing/nurturing.pipeline.ts:538` |
| peer subscriber | `traceReceived`                 | `lw.trace.trace_received` from [trace](../../../../modules/trace/README.md)                                      | `src/eventing/nurturing.pipeline.ts:549` |
| peer subscriber | `codingAgentSessionStored`      | `lw.coding_agent.session_stored` from [coding-agent](../../../../modules/coding-agent/README.md)                 | `src/eventing/nurturing.pipeline.ts:564` |
| peer subscriber | `personalTeamCreated`           | `lw.organization.personal_team_created` from [organization](../../../../modules/organization/README.md)          | `src/eventing/nurturing.pipeline.ts:577` |
| peer subscriber | `personalWorkspaceProvisioned`  | `lw.organization.personal_workspace_provisioned` from [organization](../../../../modules/organization/README.md) | `src/eventing/nurturing.pipeline.ts:583` |
| peer subscriber | `personalOwnerListed`           | `lw.project.personal_owner_listed` from [project](../../../../modules/project/README.md)                         | `src/eventing/nurturing.pipeline.ts:589` |
| peer subscriber | `projectTraced`                 | `lw.trace.project_traced` from [trace](../../../../modules/trace/README.md)                                      | `src/eventing/nurturing.pipeline.ts:595` |
| peer subscriber | `firstMessageListed`            | `lw.project.first_message_listed` from [project](../../../../modules/project/README.md)                          | `src/eventing/nurturing.pipeline.ts:601` |
| peer subscriber | `userErased`                    | `lw.user.erased` from [user](../../../../modules/user/README.md)                                                 | `src/eventing/nurturing.pipeline.ts:608` |
| peer subscriber | `appPageOpened`                 | `lw.auth.app_page_opened` from [auth](../../../../modules/auth/README.md)                                        | `src/eventing/nurturing.pipeline.ts:613` |
| peer subscriber | `langyFirstMessageSeen`         | `lw.langy_guided_onboarding.first_message_seen` from [langy](../../../../modules/langy/README.md)                | `src/eventing/nurturing.pipeline.ts:618` |
| peer subscriber | `insightFiled`                  | `lw.insight.filed` from [insight](../../../../modules/insight/README.md)                                         | `src/eventing/nurturing.pipeline.ts:624` |
| peer subscriber | `insightSeen`                   | `lw.insight.seen` from [insight](../../../../modules/insight/README.md)                                          | `src/eventing/nurturing.pipeline.ts:629` |
| peer subscriber | `insightArchived`               | `lw.insight.archived` from [insight](../../../../modules/insight/README.md)                                      | `src/eventing/nurturing.pipeline.ts:635` |
| peer subscriber | `insightKept`                   | `lw.insight.kept` from [insight](../../../../modules/insight/README.md)                                          | `src/eventing/nurturing.pipeline.ts:641` |
| lane aliases    | `≈ MAIN_NURTURING_LANE_ALIASES` | –                                                                                                                | `src/eventing/nurturing.pipeline.ts:648` |

## Configuration

| Kind   | Leaf                | Environment variable   | Declared at                              |
| ------ | ------------------- | ---------------------- | ---------------------------------------- |
| secret | `–`                 | `CUSTOMER_IO_API_KEY`  | `src/app/nurturing.app.ts:48`            |
| config | `customerIoRegion`  | `CUSTOMER_IO_REGION`   | `../contract/src/nurturing.config.ts:8`  |
| config | `customerIoBaseUrl` | `CUSTOMER_IO_BASE_URL` | `../contract/src/nurturing.config.ts:10` |
| config | `posthogKey`        | `POSTHOG_KEY`          | `../contract/src/nurturing.config.ts:11` |
| config | `posthogHost`       | `POSTHOG_HOST`         | `../contract/src/nurturing.config.ts:12` |

<!-- readme:generated:end -->

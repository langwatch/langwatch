# @langwatch/enterprise-nurturing-process

The server half of [nurturing](../README.md). Product analytics and lifecycle messaging: nurturing learns from the owners' events, keeps its own copies, and alone talks to PostHog and Customer.io.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("nurturing").withRepositories(nurturingRepositories).withChannels(nurturingChannels).withApi(NurturingModule).withEventing(nurturingEventing).withEventing(nurturingProjectUsageEventing).withEventing(nurturingTraceWindowEndEventing).withMigrations(…)`, `src/nurturing.module.ts:46`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`NurturingApi`)

Nurturing learns from the owners' events (§9); an owner that pushes a fact calls this.

Peers call these through the token, declared at `../contract/src/nurturing-types.ts:294`; nothing else in this package is public.

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

Declared at `src/eventing/nurturing-project-usage.pipeline.ts:632`.

| Kind                 | Name                                                                                           | Handles                                                                                   | Declared at                                            |
| -------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| peer subscriber      | `firstTraceUsageSync`                                                                          | `lw.trace.first_trace_recorded` from [trace](../../../../modules/trace/README.md)         | `src/eventing/nurturing-project-usage.pipeline.ts:695` |
| peer subscriber      | `traceUsageSync`                                                                               | `lw.trace.trace_received` from [trace](../../../../modules/trace/README.md)               | `src/eventing/nurturing-project-usage.pipeline.ts:696` |
| peer subscriber      | `organizationCreatedSync`                                                                      | `lw.organization.created` from [organization](../../../../modules/organization/README.md) | `src/eventing/nurturing-project-usage.pipeline.ts:697` |
| peer map projection  | `≈ nurturingUserErasureMarksMap(virtualKeys)`                                                  | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:639` |
| peer map projection  | `≈ nurturingIdentityErasureMarksMap(virtualKeys)`                                              | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:640` |
| peer map projection  | `≈ nurturingVirtualKeysMap(virtualKeys)`                                                       | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:641` |
| peer map projection  | `≈ nurturingProjectPlacementsMap(copies)`                                                      | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:642` |
| peer map projection  | `≈ nurturingOrganizationCreationsMap(organizationsCreated)`                                    | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:643` |
| peer map projection  | `≈ nurturingOrganizationAdminsMap(admins)`                                                     | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:644` |
| peer map projection  | `≈ nurturingOrganizationMembersMap(members)`                                                   | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:645` |
| peer map projection  | `≈ nurturingAuthMembersMap(members)`                                                           | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:646` |
| peer map projection  | `≈ nurturingPersonalOwnersOfOrganizationMap(personalProjects)`                                 | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:647` |
| peer map projection  | `≈ nurturingPersonalOwnersOfProjectMap(personalProjects)`                                      | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:648` |
| peer map projection  | `≈ nurturingTracedProjectsOfTraceMap({ tracedProjects, logger })`                              | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:649` |
| peer map projection  | `≈ nurturingTracedProjectsOfProjectMap({ tracedProjects, logger })`                            | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:650` |
| peer map projection  | `≈ nurturingLastTracesMap(lastTraces)`                                                         | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:651` |
| peer map projection  | `≈ nurturingEvaluationDaysMap(sync ? evaluationDays : KEEP_NO_EVALUATION_DAYS)`                | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:652` |
| peer fold projection | `≈ nurturingTraceDaySpansFold(sync ? traceDays.forSource("spans") : KEEP_NO_TRACE_DAYS)`       | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:655` |
| peer fold projection | `≈ nurturingTraceDayFailuresFold(sync ? traceDays.forSource("failures") : KEEP_NO_TRACE_DAYS)` | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:658` |
| peer fold projection | `≈ nurturingOrganizationPlanFold(plans.store)`                                                 | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:662` |
| lane aliases         | `≈ [ ...ORGANIZATION_COPY_LANE_ALIASES, ...PERSONAL_AND_TRACED_PROJECT_LANE_ALIASES, ...NURT…` | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:665` |
| peer fold projection | `≈ nurturingProjectUsagePeerFold({ owner: "prompt", store })`                                  | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:677` |
| peer fold projection | `≈ nurturingProjectUsagePeerFold({ owner: "evaluator", store })`                               | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:681` |
| peer fold projection | `≈ nurturingProjectUsagePeerFold({ owner: "scenario", store })`                                | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:685` |
| peer fold projection | `≈ nurturingProjectUsagePeerFold({ owner: "simulation", store })`                              | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:689` |

### Pipeline `nurturing_trace_window_end` (aggregate `global`)

Declared at `src/eventing/nurturing-trace-window-end.pipeline.ts:34`.

| Kind            | Name                      | Handles                                                                               | Declared at                                              |
| --------------- | ------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| process manager | `nurturingTraceWindowEnd` | every 1 h (`TRACE_WINDOW_END_INTERVAL_MS = 60 * 60 * 1000`); intents `sweep` (outbox) | `src/eventing/nurturing-trace-window-end.pipeline.ts:40` |

### Pipeline `nurturing` (aggregate `nurturing_signal`)

Declared at `src/eventing/nurturing.pipeline.ts:347`. Events: `nurturingSignalRecordedEventSchema`.

| Kind            | Name                            | Handles                                                                                                        | Declared at                              |
| --------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| command         | `recordSignal`                  | –                                                                                                              | `src/eventing/nurturing.pipeline.ts:695` |
| subscriber      | `deliverSignal`                 | `lw.nurturing.signal_recorded` from [nurturing](../README.md)                                                  | `src/eventing/nurturing.pipeline.ts:352` |
| peer subscriber | `guidedOnboardingRecorded`      | `lw.guided_onboarding.recorded` from [onboarding](../../../../modules/onboarding/README.md)                    | `src/eventing/nurturing.pipeline.ts:357` |
| peer subscriber | `onboardingVariantAssigned`     | `lw.guided_onboarding.variant_assigned` from [onboarding](../../../../modules/onboarding/README.md)            | `src/eventing/nurturing.pipeline.ts:365` |
| peer subscriber | `guidedOnboardingTurnFailed`    | `lw.langy_guided_onboarding.turn_failed` from [langy](../../../../modules/langy/README.md)                     | `src/eventing/nurturing.pipeline.ts:373` |
| peer subscriber | `usageReportReceived`           | `lw.saas.usage_report_received` from [saas](../../saas/README.md)                                              | `src/eventing/nurturing.pipeline.ts:378` |
| peer subscriber | `experimentRan`                 | `lw.experiment.ran` from [experiment](../../../../modules/experiment/README.md)                                | `src/eventing/nurturing.pipeline.ts:383` |
| peer subscriber | `evaluationRan`                 | `lw.evaluation.ran` from [evaluation](../../../../modules/evaluation/README.md)                                | `src/eventing/nurturing.pipeline.ts:391` |
| peer subscriber | `evaluationCompleted`           | `lw.evaluation.lifecycle_completed` from [evaluation](../../../../modules/evaluation/README.md)                | `src/eventing/nurturing.pipeline.ts:399` |
| peer subscriber | `subscriptionStarted`           | `lw.billing.subscription_started` from [billing](../../billing/README.md)                                      | `src/eventing/nurturing.pipeline.ts:411` |
| peer subscriber | `scenarioRunsThresholdReached`  | `lw.entitlement.scenario_runs_threshold_reached` from [entitlement](../../../../modules/entitlement/README.md) | `src/eventing/nurturing.pipeline.ts:419` |
| peer subscriber | `scenarioRunGraceEnded`         | `lw.entitlement.scenario_run_grace_ended` from [entitlement](../../../../modules/entitlement/README.md)        | `src/eventing/nurturing.pipeline.ts:427` |
| peer subscriber | `checkoutCompleted`             | `lw.billing.checkout_completed` from [billing](../../billing/README.md)                                        | `src/eventing/nurturing.pipeline.ts:435` |
| peer subscriber | `sessionStarted`                | `lw.auth.session_started` from [auth](../../../../modules/auth/README.md)                                      | `src/eventing/nurturing.pipeline.ts:443` |
| peer subscriber | `ssoAutoAdded`                  | `lw.auth.sso_auto_added` from [auth](../../../../modules/auth/README.md)                                       | `src/eventing/nurturing.pipeline.ts:451` |
| peer subscriber | `organizationSignedUp`          | `lw.organization.signed_up` from [organization](../../../../modules/organization/README.md)                    | `src/eventing/nurturing.pipeline.ts:459` |
| peer subscriber | `userRegistered`                | `lw.user.registered` from [user](../../../../modules/user/README.md)                                           | `src/eventing/nurturing.pipeline.ts:467` |
| peer subscriber | `userCreated`                   | `lw.user.created` from [user](../../../../modules/user/README.md)                                              | `src/eventing/nurturing.pipeline.ts:476` |
| peer subscriber | `authSignedUp`                  | `lw.auth.signed_up` from [auth](../../../../modules/auth/README.md)                                            | `src/eventing/nurturing.pipeline.ts:485` |
| peer subscriber | `membersInvited`                | `lw.organization.members_invited` from [organization](../../../../modules/organization/README.md)              | `src/eventing/nurturing.pipeline.ts:493` |
| peer subscriber | `inviteAccepted`                | `lw.organization.invite_accepted` from [organization](../../../../modules/organization/README.md)              | `src/eventing/nurturing.pipeline.ts:501` |
| peer subscriber | `memberRoleChanged`             | `lw.organization.member_role_changed` from [organization](../../../../modules/organization/README.md)          | `src/eventing/nurturing.pipeline.ts:509` |
| peer subscriber | `memberAdmitted`                | `lw.organization.member_admitted` from [organization](../../../../modules/organization/README.md)              | `src/eventing/nurturing.pipeline.ts:517` |
| peer subscriber | `integrationMethodChosen`       | `lw.organization.integration_method_chosen` from [organization](../../../../modules/organization/README.md)    | `src/eventing/nurturing.pipeline.ts:525` |
| peer subscriber | `promptCreated`                 | `lw.prompt.created` from [prompt](../../../../modules/prompt/README.md)                                        | `src/eventing/nurturing.pipeline.ts:533` |
| peer subscriber | `workflowCreated`               | `lw.workflow.created` from [workflow](../../../../modules/workflow/README.md)                                  | `src/eventing/nurturing.pipeline.ts:541` |
| peer subscriber | `scenarioCreated`               | `lw.scenario.created` from [scenario](../../../../modules/scenario/README.md)                                  | `src/eventing/nurturing.pipeline.ts:549` |
| peer subscriber | `scenarioRunSucceeded`          | `lw.simulation_run.finished` from [scenario](../../../../modules/scenario/README.md)                           | `src/eventing/nurturing.pipeline.ts:557` |
| peer subscriber | `simulationRunFinished`         | `lw.simulation_run.finished` from [scenario](../../../../modules/scenario/README.md)                           | `src/eventing/nurturing.pipeline.ts:569` |
| peer subscriber | `firstTraceRecorded`            | `lw.trace.first_trace_recorded` from [trace](../../../../modules/trace/README.md)                              | `src/eventing/nurturing.pipeline.ts:585` |
| peer subscriber | `traceReceived`                 | `lw.trace.trace_received` from [trace](../../../../modules/trace/README.md)                                    | `src/eventing/nurturing.pipeline.ts:596` |
| peer subscriber | `codingAgentSessionStored`      | `lw.coding_agent.session_stored` from [coding-agent](../../../../modules/coding-agent/README.md)               | `src/eventing/nurturing.pipeline.ts:611` |
| peer subscriber | `userErased`                    | `lw.user.erased` from [user](../../../../modules/user/README.md)                                               | `src/eventing/nurturing.pipeline.ts:624` |
| peer subscriber | `appPageOpened`                 | `lw.auth.app_page_opened` from [auth](../../../../modules/auth/README.md)                                      | `src/eventing/nurturing.pipeline.ts:629` |
| peer subscriber | `virtualKeyCreated`             | `lw.governance.vk_lifecycle` from [gateway](../../../../modules/gateway/README.md)                             | `src/eventing/nurturing.pipeline.ts:635` |
| peer subscriber | `keyBudgetThreshold`            | `lw.governance.budget_crossing` from [gateway](../../../../modules/gateway/README.md)                          | `src/eventing/nurturing.pipeline.ts:640` |
| peer subscriber | `keyFirstRequest`               | `lw.governance.vk_first_request` from [gateway](../../../../modules/gateway/README.md)                         | `src/eventing/nurturing.pipeline.ts:645` |
| peer subscriber | `gatewaySpendWithoutBudget`     | `lw.governance.unbudgeted_spend` from [gateway](../../../../modules/gateway/README.md)                         | `src/eventing/nurturing.pipeline.ts:651` |
| peer subscriber | `governanceSourceConnected`     | `lw.governance.ingestion_source_created` from [governance](../../governance/README.md)                         | `src/eventing/nurturing.pipeline.ts:656` |
| peer subscriber | `governanceSourceLive`          | `lw.governance.ingestion_source_went_live` from [governance](../../governance/README.md)                       | `src/eventing/nurturing.pipeline.ts:661` |
| peer subscriber | `langyFirstMessageSeen`         | `lw.langy_guided_onboarding.first_message_seen` from [langy](../../../../modules/langy/README.md)              | `src/eventing/nurturing.pipeline.ts:666` |
| peer subscriber | `insightFiled`                  | `lw.insight.filed` from [insight](../../../../modules/insight/README.md)                                       | `src/eventing/nurturing.pipeline.ts:672` |
| peer subscriber | `insightSeen`                   | `lw.insight.seen` from [insight](../../../../modules/insight/README.md)                                        | `src/eventing/nurturing.pipeline.ts:677` |
| peer subscriber | `insightArchived`               | `lw.insight.archived` from [insight](../../../../modules/insight/README.md)                                    | `src/eventing/nurturing.pipeline.ts:683` |
| peer subscriber | `insightKept`                   | `lw.insight.kept` from [insight](../../../../modules/insight/README.md)                                        | `src/eventing/nurturing.pipeline.ts:689` |
| lane aliases    | `≈ MAIN_NURTURING_LANE_ALIASES` | –                                                                                                              | `src/eventing/nurturing.pipeline.ts:696` |

## Configuration

| Kind   | Leaf                | Environment variable   | Declared at                              |
| ------ | ------------------- | ---------------------- | ---------------------------------------- |
| secret | `–`                 | `CUSTOMER_IO_API_KEY`  | `src/app/nurturing.app.ts:51`            |
| config | `customerIoRegion`  | `CUSTOMER_IO_REGION`   | `../contract/src/nurturing.config.ts:8`  |
| config | `customerIoBaseUrl` | `CUSTOMER_IO_BASE_URL` | `../contract/src/nurturing.config.ts:10` |
| config | `posthogKey`        | `POSTHOG_KEY`          | `../contract/src/nurturing.config.ts:11` |
| config | `posthogHost`       | `POSTHOG_HOST`         | `../contract/src/nurturing.config.ts:12` |

<!-- readme:generated:end -->

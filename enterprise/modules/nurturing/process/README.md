# @langwatch/enterprise-nurturing-process

The server half of [nurturing](../README.md). Product analytics and lifecycle messaging: nurturing learns from the owners' events, keeps its own copies, and alone talks to PostHog and Customer.io.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("nurturing").withRepositories(nurturingRepositories).withChannels(nurturingChannels).withApi(NurturingModule).withEventing(nurturingEventing).withEventing(nurturingProjectUsageEventing).withEventing(nurturingTraceWindowEndEventing).withMigrations(…)`, `src/nurturing.module.ts:42`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`NurturingApi`)

Nurturing learns from the owners' events (§9); an owner that pushes a fact calls this.

Peers call these through the token, declared at `../contract/src/nurturing-types.ts:263`; nothing else in this package is public.

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

Declared at `src/eventing/nurturing-project-usage.pipeline.ts:560`.

| Kind                 | Name                                                                                           | Handles                                                                                   | Declared at                                            |
| -------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| peer subscriber      | `traceDayCount`                                                                                | `lw.obs.trace.span_received` from [trace](../../../../modules/trace/README.md)            | `src/eventing/nurturing-project-usage.pipeline.ts:615` |
| peer subscriber      | `failedTraceDayCount`                                                                          | `lw.trace.trace_failed` from [trace](../../../../modules/trace/README.md)                 | `src/eventing/nurturing-project-usage.pipeline.ts:616` |
| peer subscriber      | `firstTraceUsageSync`                                                                          | `lw.trace.first_trace_recorded` from [trace](../../../../modules/trace/README.md)         | `src/eventing/nurturing-project-usage.pipeline.ts:619` |
| peer subscriber      | `traceUsageSync`                                                                               | `lw.trace.trace_received` from [trace](../../../../modules/trace/README.md)               | `src/eventing/nurturing-project-usage.pipeline.ts:620` |
| peer subscriber      | `organizationCreatedSync`                                                                      | `lw.organization.created` from [organization](../../../../modules/organization/README.md) | `src/eventing/nurturing-project-usage.pipeline.ts:621` |
| peer map projection  | `≈ nurturingUserErasureMarksMap(virtualKeys)`                                                  | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:567` |
| peer map projection  | `≈ nurturingIdentityErasureMarksMap(virtualKeys)`                                              | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:568` |
| peer map projection  | `≈ nurturingVirtualKeysMap(virtualKeys)`                                                       | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:569` |
| peer map projection  | `≈ nurturingProjectPlacementsMap(copies)`                                                      | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:570` |
| peer map projection  | `≈ nurturingOrganizationCreationsMap(organizationsCreated)`                                    | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:571` |
| peer map projection  | `≈ nurturingOrganizationAdminsMap(admins)`                                                     | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:572` |
| peer map projection  | `≈ nurturingOrganizationMembersMap(members)`                                                   | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:573` |
| peer map projection  | `≈ nurturingAuthMembersMap(members)`                                                           | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:574` |
| peer map projection  | `≈ nurturingPersonalOwnersOfOrganizationMap(personalProjects)`                                 | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:575` |
| peer map projection  | `≈ nurturingPersonalOwnersOfProjectMap(personalProjects)`                                      | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:576` |
| peer map projection  | `≈ nurturingTracedProjectsOfTraceMap({ tracedProjects, logger })`                              | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:577` |
| peer map projection  | `≈ nurturingTracedProjectsOfProjectMap({ tracedProjects, logger })`                            | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:578` |
| peer map projection  | `≈ nurturingLastTracesMap(lastTraces)`                                                         | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:579` |
| peer map projection  | `≈ nurturingEvaluationDaysMap(sync ? evaluationDays : KEEP_NO_EVALUATION_DAYS)`                | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:580` |
| peer fold projection | `≈ nurturingOrganizationPlanFold(plans.store)`                                                 | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:584` |
| lane aliases         | `≈ [ ...ORGANIZATION_COPY_LANE_ALIASES, ...PERSONAL_AND_TRACED_PROJECT_LANE_ALIASES, ...NURT…` | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:587` |
| peer fold projection | `≈ nurturingProjectUsagePeerFold({ owner: "prompt", store })`                                  | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:599` |
| peer fold projection | `≈ nurturingProjectUsagePeerFold({ owner: "evaluator", store })`                               | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:603` |
| peer fold projection | `≈ nurturingProjectUsagePeerFold({ owner: "scenario", store })`                                | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:607` |
| peer fold projection | `≈ nurturingProjectUsagePeerFold({ owner: "simulation", store })`                              | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:611` |

### Pipeline `nurturing_trace_window_end` (aggregate `global`)

Declared at `src/eventing/nurturing-trace-window-end.pipeline.ts:33`.

| Kind            | Name                      | Handles                                                                               | Declared at                                              |
| --------------- | ------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| process manager | `nurturingTraceWindowEnd` | every 1 h (`TRACE_WINDOW_END_INTERVAL_MS = 60 * 60 * 1000`); intents `sweep` (outbox) | `src/eventing/nurturing-trace-window-end.pipeline.ts:39` |

### Pipeline `nurturing` (aggregate `nurturing_signal`)

Declared at `src/eventing/nurturing.pipeline.ts:304`. Events: `nurturingSignalRecordedEventSchema`.

| Kind            | Name                            | Handles                                                                                                     | Declared at                              |
| --------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| command         | `recordSignal`                  | –                                                                                                           | `src/eventing/nurturing.pipeline.ts:604` |
| subscriber      | `deliverSignal`                 | `lw.nurturing.signal_recorded` from [nurturing](../README.md)                                               | `src/eventing/nurturing.pipeline.ts:309` |
| peer subscriber | `guidedOnboardingRecorded`      | `lw.guided_onboarding.recorded` from [onboarding](../../../../modules/onboarding/README.md)                 | `src/eventing/nurturing.pipeline.ts:314` |
| peer subscriber | `onboardingVariantAssigned`     | `lw.guided_onboarding.variant_assigned` from [onboarding](../../../../modules/onboarding/README.md)         | `src/eventing/nurturing.pipeline.ts:322` |
| peer subscriber | `guidedOnboardingTurnFailed`    | `lw.langy_guided_onboarding.turn_failed` from [langy](../../../../modules/langy/README.md)                  | `src/eventing/nurturing.pipeline.ts:330` |
| peer subscriber | `usageReportReceived`           | `lw.saas.usage_report_received` from [saas](../../saas/README.md)                                           | `src/eventing/nurturing.pipeline.ts:335` |
| peer subscriber | `experimentRan`                 | `lw.experiment.ran` from [experiment](../../../../modules/experiment/README.md)                             | `src/eventing/nurturing.pipeline.ts:340` |
| peer subscriber | `evaluationRan`                 | `lw.evaluation.ran` from [evaluation](../../../../modules/evaluation/README.md)                             | `src/eventing/nurturing.pipeline.ts:348` |
| peer subscriber | `evaluationCompleted`           | `lw.evaluation.lifecycle_completed` from [evaluation](../../../../modules/evaluation/README.md)             | `src/eventing/nurturing.pipeline.ts:356` |
| peer subscriber | `subscriptionStarted`           | `lw.billing.subscription_started` from [billing](../../billing/README.md)                                   | `src/eventing/nurturing.pipeline.ts:368` |
| peer subscriber | `checkoutCompleted`             | `lw.billing.checkout_completed` from [billing](../../billing/README.md)                                     | `src/eventing/nurturing.pipeline.ts:376` |
| peer subscriber | `sessionStarted`                | `lw.auth.session_started` from [auth](../../../../modules/auth/README.md)                                   | `src/eventing/nurturing.pipeline.ts:384` |
| peer subscriber | `ssoAutoAdded`                  | `lw.auth.sso_auto_added` from [auth](../../../../modules/auth/README.md)                                    | `src/eventing/nurturing.pipeline.ts:392` |
| peer subscriber | `organizationSignedUp`          | `lw.organization.signed_up` from [organization](../../../../modules/organization/README.md)                 | `src/eventing/nurturing.pipeline.ts:400` |
| peer subscriber | `userRegistered`                | `lw.user.registered` from [user](../../../../modules/user/README.md)                                        | `src/eventing/nurturing.pipeline.ts:408` |
| peer subscriber | `userCreated`                   | `lw.user.created` from [user](../../../../modules/user/README.md)                                           | `src/eventing/nurturing.pipeline.ts:417` |
| peer subscriber | `authSignedUp`                  | `lw.auth.signed_up` from [auth](../../../../modules/auth/README.md)                                         | `src/eventing/nurturing.pipeline.ts:426` |
| peer subscriber | `membersInvited`                | `lw.organization.members_invited` from [organization](../../../../modules/organization/README.md)           | `src/eventing/nurturing.pipeline.ts:434` |
| peer subscriber | `inviteAccepted`                | `lw.organization.invite_accepted` from [organization](../../../../modules/organization/README.md)           | `src/eventing/nurturing.pipeline.ts:442` |
| peer subscriber | `integrationMethodChosen`       | `lw.organization.integration_method_chosen` from [organization](../../../../modules/organization/README.md) | `src/eventing/nurturing.pipeline.ts:450` |
| peer subscriber | `promptCreated`                 | `lw.prompt.created` from [prompt](../../../../modules/prompt/README.md)                                     | `src/eventing/nurturing.pipeline.ts:458` |
| peer subscriber | `workflowCreated`               | `lw.workflow.created` from [workflow](../../../../modules/workflow/README.md)                               | `src/eventing/nurturing.pipeline.ts:466` |
| peer subscriber | `scenarioCreated`               | `lw.scenario.created` from [scenario](../../../../modules/scenario/README.md)                               | `src/eventing/nurturing.pipeline.ts:474` |
| peer subscriber | `scenarioRunSucceeded`          | `lw.simulation_run.finished` from [scenario](../../../../modules/scenario/README.md)                        | `src/eventing/nurturing.pipeline.ts:482` |
| peer subscriber | `simulationRunFinished`         | `lw.simulation_run.finished` from [scenario](../../../../modules/scenario/README.md)                        | `src/eventing/nurturing.pipeline.ts:494` |
| peer subscriber | `firstTraceRecorded`            | `lw.trace.first_trace_recorded` from [trace](../../../../modules/trace/README.md)                           | `src/eventing/nurturing.pipeline.ts:510` |
| peer subscriber | `traceReceived`                 | `lw.trace.trace_received` from [trace](../../../../modules/trace/README.md)                                 | `src/eventing/nurturing.pipeline.ts:521` |
| peer subscriber | `codingAgentSessionStored`      | `lw.coding_agent.session_stored` from [coding-agent](../../../../modules/coding-agent/README.md)            | `src/eventing/nurturing.pipeline.ts:536` |
| peer subscriber | `userErased`                    | `lw.user.erased` from [user](../../../../modules/user/README.md)                                            | `src/eventing/nurturing.pipeline.ts:549` |
| peer subscriber | `appPageOpened`                 | `lw.auth.app_page_opened` from [auth](../../../../modules/auth/README.md)                                   | `src/eventing/nurturing.pipeline.ts:554` |
| peer subscriber | `virtualKeyCreated`             | `lw.governance.vk_lifecycle` from [gateway](../../../../modules/gateway/README.md)                          | `src/eventing/nurturing.pipeline.ts:560` |
| peer subscriber | `keyBudgetThreshold`            | `lw.governance.budget_crossing` from [gateway](../../../../modules/gateway/README.md)                       | `src/eventing/nurturing.pipeline.ts:565` |
| peer subscriber | `keyFirstRequest`               | `lw.governance.vk_first_request` from [gateway](../../../../modules/gateway/README.md)                      | `src/eventing/nurturing.pipeline.ts:570` |
| peer subscriber | `langyFirstMessageSeen`         | `lw.langy_guided_onboarding.first_message_seen` from [langy](../../../../modules/langy/README.md)           | `src/eventing/nurturing.pipeline.ts:575` |
| peer subscriber | `insightFiled`                  | `lw.insight.filed` from [insight](../../../../modules/insight/README.md)                                    | `src/eventing/nurturing.pipeline.ts:581` |
| peer subscriber | `insightSeen`                   | `lw.insight.seen` from [insight](../../../../modules/insight/README.md)                                     | `src/eventing/nurturing.pipeline.ts:586` |
| peer subscriber | `insightArchived`               | `lw.insight.archived` from [insight](../../../../modules/insight/README.md)                                 | `src/eventing/nurturing.pipeline.ts:592` |
| peer subscriber | `insightKept`                   | `lw.insight.kept` from [insight](../../../../modules/insight/README.md)                                     | `src/eventing/nurturing.pipeline.ts:598` |
| lane aliases    | `≈ MAIN_NURTURING_LANE_ALIASES` | –                                                                                                           | `src/eventing/nurturing.pipeline.ts:605` |

## Configuration

| Kind   | Leaf                | Environment variable   | Declared at                              |
| ------ | ------------------- | ---------------------- | ---------------------------------------- |
| secret | `–`                 | `CUSTOMER_IO_API_KEY`  | `src/app/nurturing.app.ts:52`            |
| config | `customerIoRegion`  | `CUSTOMER_IO_REGION`   | `../contract/src/nurturing.config.ts:8`  |
| config | `customerIoBaseUrl` | `CUSTOMER_IO_BASE_URL` | `../contract/src/nurturing.config.ts:10` |
| config | `posthogKey`        | `POSTHOG_KEY`          | `../contract/src/nurturing.config.ts:11` |
| config | `posthogHost`       | `POSTHOG_HOST`         | `../contract/src/nurturing.config.ts:12` |

<!-- readme:generated:end -->

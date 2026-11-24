# @langwatch/enterprise-nurturing-process

The server half of [nurturing](../README.md). Product analytics and lifecycle messaging: nurturing learns from the owners' events, keeps its own copies, and alone talks to PostHog and Customer.io.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("nurturing").withRepositories(nurturingRepositories).withChannels(nurturingChannels).withApi(NurturingModule).withEventing(nurturingEventing).withEventing(nurturingProjectUsageEventing).withEventing(nurturingTraceWindowEndEventing).withMigrations(…)`, `src/nurturing.module.ts:46`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`NurturingApi`)

Nurturing learns from the owners' events (§9); an owner that pushes a fact calls this.

Peers call these through the token, declared at `../contract/src/nurturing-types.ts:283`; nothing else in this package is public.

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

Declared at `src/eventing/nurturing-project-usage.pipeline.ts:611`.

| Kind                 | Name                                                                                           | Handles                                                                                   | Declared at                                            |
| -------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| peer subscriber      | `firstTraceUsageSync`                                                                          | `lw.trace.first_trace_recorded` from [trace](../../../../modules/trace/README.md)         | `src/eventing/nurturing-project-usage.pipeline.ts:674` |
| peer subscriber      | `traceUsageSync`                                                                               | `lw.trace.trace_received` from [trace](../../../../modules/trace/README.md)               | `src/eventing/nurturing-project-usage.pipeline.ts:675` |
| peer subscriber      | `organizationCreatedSync`                                                                      | `lw.organization.created` from [organization](../../../../modules/organization/README.md) | `src/eventing/nurturing-project-usage.pipeline.ts:676` |
| peer map projection  | `≈ nurturingUserErasureMarksMap(virtualKeys)`                                                  | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:618` |
| peer map projection  | `≈ nurturingIdentityErasureMarksMap(virtualKeys)`                                              | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:619` |
| peer map projection  | `≈ nurturingVirtualKeysMap(virtualKeys)`                                                       | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:620` |
| peer map projection  | `≈ nurturingProjectPlacementsMap(copies)`                                                      | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:621` |
| peer map projection  | `≈ nurturingOrganizationCreationsMap(organizationsCreated)`                                    | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:622` |
| peer map projection  | `≈ nurturingOrganizationAdminsMap(admins)`                                                     | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:623` |
| peer map projection  | `≈ nurturingOrganizationMembersMap(members)`                                                   | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:624` |
| peer map projection  | `≈ nurturingAuthMembersMap(members)`                                                           | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:625` |
| peer map projection  | `≈ nurturingPersonalOwnersOfOrganizationMap(personalProjects)`                                 | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:626` |
| peer map projection  | `≈ nurturingPersonalOwnersOfProjectMap(personalProjects)`                                      | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:627` |
| peer map projection  | `≈ nurturingTracedProjectsOfTraceMap({ tracedProjects, logger })`                              | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:628` |
| peer map projection  | `≈ nurturingTracedProjectsOfProjectMap({ tracedProjects, logger })`                            | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:629` |
| peer map projection  | `≈ nurturingLastTracesMap(lastTraces)`                                                         | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:630` |
| peer map projection  | `≈ nurturingEvaluationDaysMap(sync ? evaluationDays : KEEP_NO_EVALUATION_DAYS)`                | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:631` |
| peer fold projection | `≈ nurturingTraceDaySpansFold(sync ? traceDays.forSource("spans") : KEEP_NO_TRACE_DAYS)`       | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:634` |
| peer fold projection | `≈ nurturingTraceDayFailuresFold(sync ? traceDays.forSource("failures") : KEEP_NO_TRACE_DAYS)` | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:637` |
| peer fold projection | `≈ nurturingOrganizationPlanFold(plans.store)`                                                 | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:641` |
| lane aliases         | `≈ [ ...ORGANIZATION_COPY_LANE_ALIASES, ...PERSONAL_AND_TRACED_PROJECT_LANE_ALIASES, ...NURT…` | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:644` |
| peer fold projection | `≈ nurturingProjectUsagePeerFold({ owner: "prompt", store })`                                  | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:656` |
| peer fold projection | `≈ nurturingProjectUsagePeerFold({ owner: "evaluator", store })`                               | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:660` |
| peer fold projection | `≈ nurturingProjectUsagePeerFold({ owner: "scenario", store })`                                | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:664` |
| peer fold projection | `≈ nurturingProjectUsagePeerFold({ owner: "simulation", store })`                              | –                                                                                         | `src/eventing/nurturing-project-usage.pipeline.ts:668` |

### Pipeline `nurturing_trace_window_end` (aggregate `global`)

Declared at `src/eventing/nurturing-trace-window-end.pipeline.ts:34`.

| Kind            | Name                      | Handles                                                                               | Declared at                                              |
| --------------- | ------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| process manager | `nurturingTraceWindowEnd` | every 1 h (`TRACE_WINDOW_END_INTERVAL_MS = 60 * 60 * 1000`); intents `sweep` (outbox) | `src/eventing/nurturing-trace-window-end.pipeline.ts:40` |

### Pipeline `nurturing` (aggregate `nurturing_signal`)

Declared at `src/eventing/nurturing.pipeline.ts:327`. Events: `nurturingSignalRecordedEventSchema`.

| Kind            | Name                            | Handles                                                                                                     | Declared at                              |
| --------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| command         | `recordSignal`                  | –                                                                                                           | `src/eventing/nurturing.pipeline.ts:659` |
| subscriber      | `deliverSignal`                 | `lw.nurturing.signal_recorded` from [nurturing](../README.md)                                               | `src/eventing/nurturing.pipeline.ts:332` |
| peer subscriber | `guidedOnboardingRecorded`      | `lw.guided_onboarding.recorded` from [onboarding](../../../../modules/onboarding/README.md)                 | `src/eventing/nurturing.pipeline.ts:337` |
| peer subscriber | `onboardingVariantAssigned`     | `lw.guided_onboarding.variant_assigned` from [onboarding](../../../../modules/onboarding/README.md)         | `src/eventing/nurturing.pipeline.ts:345` |
| peer subscriber | `guidedOnboardingTurnFailed`    | `lw.langy_guided_onboarding.turn_failed` from [langy](../../../../modules/langy/README.md)                  | `src/eventing/nurturing.pipeline.ts:353` |
| peer subscriber | `usageReportReceived`           | `lw.saas.usage_report_received` from [saas](../../saas/README.md)                                           | `src/eventing/nurturing.pipeline.ts:358` |
| peer subscriber | `experimentRan`                 | `lw.experiment.ran` from [experiment](../../../../modules/experiment/README.md)                             | `src/eventing/nurturing.pipeline.ts:363` |
| peer subscriber | `evaluationRan`                 | `lw.evaluation.ran` from [evaluation](../../../../modules/evaluation/README.md)                             | `src/eventing/nurturing.pipeline.ts:371` |
| peer subscriber | `evaluationCompleted`           | `lw.evaluation.lifecycle_completed` from [evaluation](../../../../modules/evaluation/README.md)             | `src/eventing/nurturing.pipeline.ts:379` |
| peer subscriber | `subscriptionStarted`           | `lw.billing.subscription_started` from [billing](../../billing/README.md)                                   | `src/eventing/nurturing.pipeline.ts:391` |
| peer subscriber | `checkoutCompleted`             | `lw.billing.checkout_completed` from [billing](../../billing/README.md)                                     | `src/eventing/nurturing.pipeline.ts:399` |
| peer subscriber | `sessionStarted`                | `lw.auth.session_started` from [auth](../../../../modules/auth/README.md)                                   | `src/eventing/nurturing.pipeline.ts:407` |
| peer subscriber | `ssoAutoAdded`                  | `lw.auth.sso_auto_added` from [auth](../../../../modules/auth/README.md)                                    | `src/eventing/nurturing.pipeline.ts:415` |
| peer subscriber | `organizationSignedUp`          | `lw.organization.signed_up` from [organization](../../../../modules/organization/README.md)                 | `src/eventing/nurturing.pipeline.ts:423` |
| peer subscriber | `userRegistered`                | `lw.user.registered` from [user](../../../../modules/user/README.md)                                        | `src/eventing/nurturing.pipeline.ts:431` |
| peer subscriber | `userCreated`                   | `lw.user.created` from [user](../../../../modules/user/README.md)                                           | `src/eventing/nurturing.pipeline.ts:440` |
| peer subscriber | `authSignedUp`                  | `lw.auth.signed_up` from [auth](../../../../modules/auth/README.md)                                         | `src/eventing/nurturing.pipeline.ts:449` |
| peer subscriber | `membersInvited`                | `lw.organization.members_invited` from [organization](../../../../modules/organization/README.md)           | `src/eventing/nurturing.pipeline.ts:457` |
| peer subscriber | `inviteAccepted`                | `lw.organization.invite_accepted` from [organization](../../../../modules/organization/README.md)           | `src/eventing/nurturing.pipeline.ts:465` |
| peer subscriber | `memberRoleChanged`             | `lw.organization.member_role_changed` from [organization](../../../../modules/organization/README.md)       | `src/eventing/nurturing.pipeline.ts:473` |
| peer subscriber | `memberAdmitted`                | `lw.organization.member_admitted` from [organization](../../../../modules/organization/README.md)           | `src/eventing/nurturing.pipeline.ts:481` |
| peer subscriber | `integrationMethodChosen`       | `lw.organization.integration_method_chosen` from [organization](../../../../modules/organization/README.md) | `src/eventing/nurturing.pipeline.ts:489` |
| peer subscriber | `promptCreated`                 | `lw.prompt.created` from [prompt](../../../../modules/prompt/README.md)                                     | `src/eventing/nurturing.pipeline.ts:497` |
| peer subscriber | `workflowCreated`               | `lw.workflow.created` from [workflow](../../../../modules/workflow/README.md)                               | `src/eventing/nurturing.pipeline.ts:505` |
| peer subscriber | `scenarioCreated`               | `lw.scenario.created` from [scenario](../../../../modules/scenario/README.md)                               | `src/eventing/nurturing.pipeline.ts:513` |
| peer subscriber | `scenarioRunSucceeded`          | `lw.simulation_run.finished` from [scenario](../../../../modules/scenario/README.md)                        | `src/eventing/nurturing.pipeline.ts:521` |
| peer subscriber | `simulationRunFinished`         | `lw.simulation_run.finished` from [scenario](../../../../modules/scenario/README.md)                        | `src/eventing/nurturing.pipeline.ts:533` |
| peer subscriber | `firstTraceRecorded`            | `lw.trace.first_trace_recorded` from [trace](../../../../modules/trace/README.md)                           | `src/eventing/nurturing.pipeline.ts:549` |
| peer subscriber | `traceReceived`                 | `lw.trace.trace_received` from [trace](../../../../modules/trace/README.md)                                 | `src/eventing/nurturing.pipeline.ts:560` |
| peer subscriber | `codingAgentSessionStored`      | `lw.coding_agent.session_stored` from [coding-agent](../../../../modules/coding-agent/README.md)            | `src/eventing/nurturing.pipeline.ts:575` |
| peer subscriber | `userErased`                    | `lw.user.erased` from [user](../../../../modules/user/README.md)                                            | `src/eventing/nurturing.pipeline.ts:588` |
| peer subscriber | `appPageOpened`                 | `lw.auth.app_page_opened` from [auth](../../../../modules/auth/README.md)                                   | `src/eventing/nurturing.pipeline.ts:593` |
| peer subscriber | `virtualKeyCreated`             | `lw.governance.vk_lifecycle` from [gateway](../../../../modules/gateway/README.md)                          | `src/eventing/nurturing.pipeline.ts:599` |
| peer subscriber | `keyBudgetThreshold`            | `lw.governance.budget_crossing` from [gateway](../../../../modules/gateway/README.md)                       | `src/eventing/nurturing.pipeline.ts:604` |
| peer subscriber | `keyFirstRequest`               | `lw.governance.vk_first_request` from [gateway](../../../../modules/gateway/README.md)                      | `src/eventing/nurturing.pipeline.ts:609` |
| peer subscriber | `gatewaySpendWithoutBudget`     | `lw.governance.unbudgeted_spend` from [gateway](../../../../modules/gateway/README.md)                      | `src/eventing/nurturing.pipeline.ts:614` |
| peer subscriber | `governanceSourceConnected`     | `lw.governance.ingestion_source_created` from [governance](../../governance/README.md)                      | `src/eventing/nurturing.pipeline.ts:620` |
| peer subscriber | `governanceSourceLive`          | `lw.governance.ingestion_source_went_live` from [governance](../../governance/README.md)                    | `src/eventing/nurturing.pipeline.ts:625` |
| peer subscriber | `langyFirstMessageSeen`         | `lw.langy_guided_onboarding.first_message_seen` from [langy](../../../../modules/langy/README.md)           | `src/eventing/nurturing.pipeline.ts:630` |
| peer subscriber | `insightFiled`                  | `lw.insight.filed` from [insight](../../../../modules/insight/README.md)                                    | `src/eventing/nurturing.pipeline.ts:636` |
| peer subscriber | `insightSeen`                   | `lw.insight.seen` from [insight](../../../../modules/insight/README.md)                                     | `src/eventing/nurturing.pipeline.ts:641` |
| peer subscriber | `insightArchived`               | `lw.insight.archived` from [insight](../../../../modules/insight/README.md)                                 | `src/eventing/nurturing.pipeline.ts:647` |
| peer subscriber | `insightKept`                   | `lw.insight.kept` from [insight](../../../../modules/insight/README.md)                                     | `src/eventing/nurturing.pipeline.ts:653` |
| lane aliases    | `≈ MAIN_NURTURING_LANE_ALIASES` | –                                                                                                           | `src/eventing/nurturing.pipeline.ts:660` |

## Configuration

| Kind   | Leaf                | Environment variable   | Declared at                              |
| ------ | ------------------- | ---------------------- | ---------------------------------------- |
| secret | `–`                 | `CUSTOMER_IO_API_KEY`  | `src/app/nurturing.app.ts:49`            |
| config | `customerIoRegion`  | `CUSTOMER_IO_REGION`   | `../contract/src/nurturing.config.ts:8`  |
| config | `customerIoBaseUrl` | `CUSTOMER_IO_BASE_URL` | `../contract/src/nurturing.config.ts:10` |
| config | `posthogKey`        | `POSTHOG_KEY`          | `../contract/src/nurturing.config.ts:11` |
| config | `posthogHost`       | `POSTHOG_HOST`         | `../contract/src/nurturing.config.ts:12` |

<!-- readme:generated:end -->

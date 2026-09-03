# Spec rebind manifest

Generated 2026-09-03 from `check-feature-parity` on `feat/strict-feature-layout-v0` versus `origin/main` (14a41645f2). The gate reports 5,006 unbound scenarios. The logic they describe exists on this branch; the tests that bound them did not travel with it.

```
                     4,994 unbound scenario titles
                              |
        +---------------------+----------------------+
        |                     |                      |
   A. 45 annotated         B. 4,427 bound on      C. 522 never bound
      on this branch,         main by 981 test       on main either
      checker misses          files                  (80 spec files,
      (title drift or            |                    56 of them new
      root outside scan)         |                    on this branch)
                                 |
                    +------------+-------------+
                    |                          |
              967 test files              14 test files
              DELETED with                MOVED and lost
              platform/app                some annotations
              (this document)
```

## The rule

Lift, never rewrite. For every row below: `git show origin/main:<main test file>` into the destination package's `__tests__` beside the code it exercises, rename to the strict grammar (kebab-case, `<subject>.<level>.test.ts`), repoint imports to the moved sources (the row lists where each import went), keep every `@scenario` line verbatim, run it. If the code under test was genuinely retired on this branch, do not port the test: list the scenario titles in the lane report so the spec can be retagged or the file moved to the owning feature's `specs/` directory. Never edit scenario titles to make them match; never add `@unimplemented` to a scenario whose logic exists.

`UNRESOLVED` means every import the test made points at a source with no rename record: the code moved by copy or was split. Find the symbols by name (`grep -rn "export .* <symbol>" packages apps`) before deciding it is retired.

## Destination summary

| destination package | test files | scenarios |
|---|---|---|
| UNRESOLVED | 248 | 862 |
| packages/features/scenario/web | 39 | 379 |
| packages/test-harness | 53 | 275 |
| packages/features/gateway/server | 41 | 274 |
| packages/enterprise/features/licensing/server | 21 | 204 |
| packages/features/trace/server | 38 | 177 |
| packages/features/trace/contract | 30 | 155 |
| packages/features/trace/web | 33 | 118 |
| packages/features/analytics/server | 16 | 116 |
| packages/features/suite/contract | 11 | 110 |
| packages/features/navigation/web | 17 | 98 |
| packages/group-queue | 13 | 95 |
| packages/features/scenario/contract | 21 | 94 |
| packages/features/experiment/contract | 23 | 91 |
| packages/features/langy/web | 25 | 87 |
| packages/features/workflow/web | 19 | 87 |
| packages/eventing | 15 | 84 |
| packages/features/organization/server | 14 | 76 |
| packages/features/experiment/web | 28 | 75 |
| packages/features/langy/server | 6 | 63 |
| packages/features/scenario/server | 14 | 63 |
| packages/features/coding-agent/server | 8 | 58 |
| packages/features/stored-object/server | 9 | 54 |
| packages/features/prompt/server | 6 | 49 |
| packages/features/authz/server | 15 | 46 |
| packages/features/model-provider/web | 15 | 40 |
| packages/enterprise/features/billing/server | 2 | 37 |
| packages/features/analytics/contract | 5 | 35 |
| packages/features/agent/contract | 4 | 34 |
| packages/features/dataset/server | 13 | 34 |
| packages/features/auth/web | 7 | 33 |
| packages/ui-drawer | 11 | 32 |
| packages/features/ops/server | 6 | 31 |
| packages/features/prompt/web | 9 | 30 |
| apps/ui | 3 | 27 |
| packages/features/analytics/web | 8 | 27 |
| packages/features/experiment/server | 8 | 27 |
| packages/features/workflow/contract | 5 | 27 |
| apps/api | 6 | 26 |
| packages/egress | 2 | 24 |
| packages/features/entitlement/server | 4 | 24 |
| packages/features/dataset/web | 2 | 21 |
| packages/features/model-provider/contract | 6 | 21 |
| packages/mail | 6 | 21 |
| packages/features/project/web | 5 | 20 |
| packages/features/model-provider/server | 3 | 17 |
| packages/features/auth/server | 3 | 16 |
| packages/features/organization/web | 6 | 16 |
| packages/api | 4 | 14 |
| packages/features/onboarding/web | 4 | 14 |
| packages/enterprise/features/licensing/contract | 3 | 13 |
| packages/features/prompt/contract | 2 | 13 |
| packages/features/identity/server | 7 | 12 |
| packages/features/dataset/contract | 1 | 11 |
| packages/features/evaluator/web | 3 | 11 |
| packages/features/feature-flag/contract | 4 | 11 |
| packages/features/langy/contract | 2 | 11 |
| packages/enterprise/features/webhook/server | 2 | 10 |
| packages/features/api-key/contract | 1 | 8 |
| packages/features/evaluation/contract | 1 | 8 |
| packages/features/evaluator/contract | 1 | 8 |
| packages/features/metric/contract | 2 | 8 |
| packages/enterprise/features/licensing/web | 3 | 7 |
| packages/features/topic/server | 2 | 7 |
| packages/enterprise/features/governance/server | 1 | 6 |
| packages/features/agent/server | 2 | 6 |
| packages/features/authz/web | 2 | 6 |
| packages/features/agent/web | 1 | 5 |
| packages/design-system | 2 | 4 |
| packages/enterprise/features/billing/web | 1 | 4 |
| packages/enterprise/features/scim/contract | 1 | 4 |
| packages/handled-error | 2 | 4 |
| packages/clickhouse-client | 1 | 2 |
| packages/enterprise | 1 | 2 |
| packages/enterprise/features/governance/web | 1 | 2 |
| packages/features/authz/contract | 1 | 2 |
| packages/features/github/server | 1 | 2 |
| packages/prisma-client | 1 | 2 |
| packages/enterprise/features/scim/server | 1 | 1 |
| packages/features/gateway/web | 1 | 1 |
| packages/features/hosted-mcp/server | 1 | 1 |
| packages/features/monitor/web | 1 | 1 |
| packages/features/project/server | 1 | 1 |


| main test file | scenarios | destination | resolved imports | gone imports | spec files |
|---|---|---|---|---|---|
| platform/app/src/server/routes/__tests__/api-discovery.integration.test.ts | 16 | apps/api | 2 | 2 | packages/api/specs/api-discovery.feature |
| platform/app/src/app/api/__tests__/legacyResponseFieldsOptional.unit.test.ts | 4 | apps/api | 1 | 0 | specs/api-reference/legacy-response-fields-optional.feature |
| platform/app/src/app/api/gateway-spend/__tests__/spendFilterParity.unit.test.ts | 2 | apps/api | 1 | 1 | specs/ai-gateway/gateway-spend-rest.feature |
| platform/app/src/app/api/analytics-sql/__tests__/savedWorkbenchChartsOpenApi.unit.test.ts | 2 | apps/api | 1 | 0 | specs/analytics/lwql-saved-charts.feature<br>specs/analytics/lwql-langy-authoring.feature |
| platform/app/src/app/api/query/__tests__/queryOpenApi.unit.test.ts | 1 | apps/api | 1 | 0 | specs/analytics/lwql-api.feature |
| platform/app/src/app/api/agent-cache/__tests__/agent-cache.service.unit.test.ts | 1 | apps/api | 2 | 1 | specs/agent-cache/agent-cache.feature |
| platform/app/e2e/langy/langy-prompt-optimization.scenario.test.ts | 19 | apps/ui | 5 | 1 | specs/langy/langy-prompt-optimization-loop.feature<br>specs/langy/langy-prompt-optimization-entrypoints.feature |
| platform/app/e2e/langy/langy-workbench-live.scenario.test.ts | 6 | apps/ui | 7 | 2 | specs/langy/langy-ui-actions.feature<br>specs/langy/langy-prompt-optimization-loop.feature<br>specs/experiments-v3/workbench-actions.feature |
| platform/app/e2e/langy/workbench-fake-tab.harness.test.ts | 2 | apps/ui | 1 | 2 | specs/langy/langy-ui-actions.feature |
| platform/app/src/server/api/security/__tests__/api-endpoint-authorization.integration.test.ts | 6 | packages/api | 1 | 1 | specs/security/api-endpoint-authorization.feature |
| platform/app/src/app/api/organization/__tests__/organization-rest-api.integration.test.ts | 5 | packages/api | 3 | 5 | specs/organizations/organization-rest-api.feature |
| platform/app/src/server/api/management/__tests__/managed-service.unit.test.ts | 2 | packages/api | 1 | 6 | specs/rbac/typed-permission-declarations.feature |
| platform/app/src/server/api/__tests__/idempotency.unit.test.ts | 1 | packages/api | 1 | 1 | specs/ai-gateway/idempotency.feature |
| platform/app/src/server/clickhouse/__tests__/safeClickhouseClient.unit.test.ts | 2 | packages/clickhouse-client | 1 | 1 | specs/analytics/clickhouse-column-pruning.feature |
| platform/app/src/pages/settings/__tests__/model-providers.personal-workspace.integration.test.tsx | 2 | packages/design-system | 9 | 8 | specs/ai-gateway/governance/personal-workspace-not-ambient-context.feature |
| platform/app/src/components/__tests__/AnnotationExpectedOutputs.integration.test.tsx | 2 | packages/design-system | 2 | 3 | specs/traces-v2/annotations.feature |
| platform/app/src/app/api/webhooks/__tests__/webhooks-rest-api.integration.test.ts | 20 | packages/egress | 2 | 6 | specs/webhooks/webhook-endpoints.feature<br>specs/ai-gateway/public-rest-api.feature<br>specs/ai-gateway/idempotency.feature |
| platform/app/src/server/webhooks/__tests__/signature.unit.test.ts | 4 | packages/egress | 1 | 0 | specs/webhooks/webhook-endpoints.feature |
| platform/app/ee/governance/services/__tests__/adminWorkspaceViewAudit.service.integration.test.ts | 2 | packages/enterprise | 1 | 2 | specs/ai-gateway/governance/admin-trace-access.feature |
| platform/app/ee/billing/__tests__/webhookService.unit.test.ts | 31 | packages/enterprise/features/billing/server | 7 | 2 | specs/billing/subscription-cancellation.feature<br>specs/billing/annual-events-billing-threshold.feature<br>specs/billing/seat-subscription-retention-policy.feature<br>specs/features/webhook-service-refactor.feature |
| platform/app/ee/billing/__tests__/subscription.service.unit.test.ts | 6 | packages/enterprise/features/billing/server | 4 | 3 | specs/features/subscription-service-refactor.feature |
| platform/app/src/components/subscription/__tests__/SubscriptionPage.tiered.integration.test.tsx | 4 | packages/enterprise/features/billing/web | 4 | 4 | specs/licensing/subscription-page.feature |
| platform/app/ee/governance/__tests__/governanceEnvelopes.unit.test.ts | 6 | packages/enterprise/features/governance/server | 1 | 2 | specs/ai-gateway/budgets.feature<br>specs/webhooks/webhook-endpoints.feature |
| platform/app/src/components/home/__tests__/HomePageBanners.integration.test.tsx | 2 | packages/enterprise/features/governance/web | 4 | 2 | specs/home/langy-home.feature |
| platform/app/src/server/app-layer/subscription/__tests__/self-hosted-plan-provider.unit.test.ts | 6 | packages/enterprise/features/licensing/contract | 1 | 2 | specs/licensing/self-hosted-license-floor.feature |
| platform/app/src/app/api/middleware/__tests__/error-handler.unit.test.ts | 4 | packages/enterprise/features/licensing/contract | 2 | 4 | specs/features/domain-error-contract.feature |
| platform/app/src/server/license-enforcement/__tests__/license-limit-guard.unit.test.ts | 3 | packages/enterprise/features/licensing/contract | 6 | 3 | specs/licensing/expired-license-enforcement.feature<br>specs/licensing/enforcement-members.feature |
| platform/app/src/app/api/dataset/__tests__/dataset-rest-api.integration.test.ts | 35 | packages/enterprise/features/licensing/server | 3 | 5 | specs/features/dataset-rest-api.feature |
| platform/app/src/app/api/dataset/__tests__/dataset-upload-api.integration.test.ts | 28 | packages/enterprise/features/licensing/server | 3 | 6 | specs/features/dataset-file-upload-api.feature<br>specs/datasets/large-dataset-storage.feature |
| platform/app/src/app/api/agents/__tests__/agents-rest-api.integration.test.ts | 21 | packages/enterprise/features/licensing/server | 3 | 6 | specs/agents/agents-rest-api.feature<br>specs/features/dataset-rest-api.feature |
| platform/app/src/app/api/suites/__tests__/suites-api.integration.test.ts | 18 | packages/enterprise/features/licensing/server | 4 | 8 | specs/scenarios/run-actor-on-runs.feature<br>specs/suites/test-suites.feature<br>specs/suites/run-notes.feature<br>specs/api-reference/suites-legacy-alias.feature<br>specs/scenarios/scenario-run-parameters.feature<br>specs/suites/suite-archiving.feature<br>specs/suites/run-note-metadata-convention.feature<br>specs/suites/test-suite-run-plan-reuse.feature |
| platform/app/src/app/api/run-plans/__tests__/run-plans-api.integration.test.ts | 17 | packages/enterprise/features/licensing/server | 4 | 9 | specs/api-reference/run-plans-rest-api.feature |
| platform/app/src/app/api/role-bindings/__tests__/role-bindings-rest-api.integration.test.ts | 13 | packages/enterprise/features/licensing/server | 3 | 10 | specs/rbac/role-bindings-rest-api.feature |
| platform/app/src/app/api/test-suites/__tests__/test-suites-api.integration.test.ts | 12 | packages/enterprise/features/licensing/server | 4 | 8 | specs/api-reference/test-suites-rest-api.feature<br>specs/suites/test-suite-run-plan-reuse.feature |
| platform/app/ee/licensing/__tests__/licenseHandler.integration.test.ts | 10 | packages/enterprise/features/licensing/server | 5 | 3 | specs/licensing/expired-license-enforcement.feature<br>specs/licensing/subscription-handler-integration.feature<br>specs/licensing/license-router.feature |
| platform/app/src/app/api/roles/__tests__/roles-rest-api.integration.test.ts | 9 | packages/enterprise/features/licensing/server | 2 | 5 | specs/rbac/roles-rest-api.feature |
| platform/app/src/app/api/organizations/__tests__/organizations-provisioning-rest-api.integration.test.ts | 9 | packages/enterprise/features/licensing/server | 2 | 6 | specs/organizations/organizations-provisioning-rest-api.feature |
| platform/app/ee/governance/services/__tests__/anomalyRule.thresholdConfig.integration.test.ts | 6 | packages/enterprise/features/licensing/server | 2 | 6 | specs/ai-gateway/governance/anomaly-rule-threshold-schema.feature |
| platform/app/src/app/api/groups/__tests__/groups-rest-api.integration.test.ts | 5 | packages/enterprise/features/licensing/server | 3 | 6 | specs/groups/groups-rest-api.feature |
| platform/app/src/server/api/management/__tests__/management-enterprise-gate.integration.test.ts | 4 | packages/enterprise/features/licensing/server | 2 | 9 | specs/licensing/management-apis-enterprise-gate.feature |
| platform/app/ee/licensing/__tests__/licenseHandler.retention.unit.test.ts | 4 | packages/enterprise/features/licensing/server | 3 | 3 | specs/billing/seat-subscription-retention-policy.feature |
| platform/app/src/app/api/scim-tokens/__tests__/scim-tokens-rest-api.integration.test.ts | 3 | packages/enterprise/features/licensing/server | 2 | 6 | specs/organizations/scim-tokens-rest-api.feature |
| platform/app/ee/governance/services/activity-monitor/__tests__/ingestionSourceTokenAtRest.integration.test.ts | 3 | packages/enterprise/features/licensing/server | 2 | 4 | specs/ai-governance/puller-framework/openai-admin-cost.feature<br>specs/ai-governance/puller-framework/databricks-genie.feature |
| platform/app/src/server/api/routers/__tests__/license.integration.test.ts | 2 | packages/enterprise/features/licensing/server | 5 | 6 | specs/licensing/license-router.feature |
| platform/app/src/app/api/prompts/__tests__/prompts-api.integration.test.ts | 2 | packages/enterprise/features/licensing/server | 3 | 7 | specs/prompts/prompt-soft-delete.feature |
| platform/app/src/app/api/groups/__tests__/groups-router-mount.integration.test.ts | 1 | packages/enterprise/features/licensing/server | 3 | 6 | specs/groups/groups-rest-api.feature |
| platform/app/src/app/api/groups/__tests__/groups-enterprise-gate.integration.test.ts | 1 | packages/enterprise/features/licensing/server | 4 | 6 | specs/licensing/management-apis-enterprise-gate.feature |
| platform/app/ee/scim/__tests__/scim-plan-lapse.integration.test.ts | 1 | packages/enterprise/features/licensing/server | 3 | 7 | specs/licensing/management-apis-enterprise-gate.feature |
| platform/app/src/components/license/__tests__/useLicenseActions.integration.test.ts | 3 | packages/enterprise/features/licensing/web | 3 | 3 | specs/licensing/sso-license-gating.feature<br>specs/licensing/license-activation-feedback.feature |
| platform/app/src/components/__tests__/LicenseStatus.integration.test.tsx | 3 | packages/enterprise/features/licensing/web | 3 | 2 | specs/licensing/expired-license-enforcement.feature |
| platform/app/src/components/settings/__tests__/seatTypeCopy.unit.test.ts | 1 | packages/enterprise/features/licensing/web | 1 | 1 | specs/licensing/seat-type-explained.feature |
| platform/app/ee/scim/__tests__/scim.costCenter.integration.test.ts | 4 | packages/enterprise/features/scim/contract | 1 | 4 | specs/ai-gateway/governance/departments.feature |
| platform/app/ee/scim/__tests__/scim-sync.service.unit.test.ts | 1 | packages/enterprise/features/scim/server | 1 | 0 | specs/identity/scim-connection-sync.feature |
| platform/app/src/server/webhooks/destinations/__tests__/sqsWebhookDestination.unit.test.ts | 8 | packages/enterprise/features/webhook/server | 4 | 1 | specs/webhooks/webhook-endpoints.feature |
| platform/app/src/server/webhooks/destinations/__tests__/httpWebhookDestination.unit.test.ts | 2 | packages/enterprise/features/webhook/server | 2 | 2 | specs/webhooks/webhook-endpoints.feature |
| platform/app/ee/governance/services/pullers/__tests__/databricksGeniePuller.integration.test.ts | 22 | packages/eventing | 6 | 5 | specs/ai-governance/puller-framework/databricks-genie.feature |
| platform/app/ee/webhooks/__tests__/webhookDelivery.process.integration.test.ts | 15 | packages/eventing | 7 | 4 | specs/webhooks/webhook-endpoints.feature |
| platform/app/src/server/event-sourcing/process-manager/stores/__tests__/prismaProcessStore.integration.test.ts | 11 | packages/eventing | 5 | 1 | packages/eventing/specs/process-manager-inbox-key.feature<br>packages/eventing/specs/process-manager-retention.feature<br>specs/webhooks/webhook-endpoints.feature |
| platform/app/src/server/event-sourcing/pipelines/__tests__/foldProjection.contract.unit.test.ts | 6 | packages/eventing | 7 | 2 | packages/eventing/specs/fold-read-back-store.feature<br>packages/eventing/specs/fold-read-window.feature |
| platform/app/src/server/event-sourcing/replay/__tests__/replayService.integration.test.ts | 4 | packages/eventing | 8 | 2 | packages/eventing/specs/projection-replay.feature |
| platform/app/src/server/event-sourcing/pipelines/coding-agent-processing/projections/__tests__/codingAgentSession.store.unit.test.ts | 4 | packages/eventing | 3 | 3 | specs/coding-agent/sessions-screen.feature<br>packages/eventing/specs/fold-read-back-store.feature |
| platform/app/src/server/event-sourcing/queues/groupQueue/__tests__/groupQueue.integration.test.ts | 3 | packages/eventing | 4 | 1 | packages/group-queue/specs/batch-bisection.feature<br>packages/group-queue/specs/pending-counter-conservation.feature<br>packages/group-queue/specs/ready-score-integrity.feature |
| platform/app/src/server/event-sourcing/process-manager/outbox/__tests__/outboxBacklogDrain.integration.test.ts | 3 | packages/eventing | 4 | 1 | packages/eventing/specs/process-outbox-lease-hardening.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/projections/__tests__/traceAnalytics.readBack.unit.test.ts | 3 | packages/eventing | 6 | 2 | specs/analytics/event-sourced-analytics-materialization.feature<br>packages/eventing/specs/fold-read-back-store.feature |
| platform/app/src/server/event-sourcing/pipelines/simulation-processing/projections/__tests__/simulationRunState.store.unit.test.ts | 3 | packages/eventing | 6 | 1 | specs/scenarios/simulation-run-cost-attribution.feature |
| platform/app/src/server/event-sourcing/pipelines/authz-grants/__tests__/aggregateIdentity.unit.test.ts | 3 | packages/eventing | 1 | 3 | specs/rbac/authz-grants.feature |
| platform/app/src/server/event-sourcing/queues/groupQueue/__tests__/tieredBlobStore.azure.integration.test.ts | 2 | packages/eventing | 3 | 4 | specs/migration/object-storage-provider-migration.feature<br>specs/features/scenarios/azure-blob-workload-identity.feature |
| platform/app/src/server/event-sourcing/queues/groupQueue/__tests__/groupQueue.failureLogging.integration.test.ts | 2 | packages/eventing | 3 | 1 | specs/observability/retryable-failure-log-level.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/projections/__tests__/traceAnalyticsRefoldPolicy.unit.test.ts | 2 | packages/eventing | 6 | 1 | specs/trace-processing/hot-trace-fold-amplification.feature |
| platform/app/src/server/app-layer/ops/__tests__/integration/replay-full-rebuild.integration.test.ts | 1 | packages/eventing | 8 | 5 | packages/eventing/specs/projection-replay.feature |
| platform/app/src/server/connected-agents/__tests__/connect.gateway.integration.test.ts | 15 | apps/api (src/features/agent/__tests__/connected-agent-gateway.integration.test.ts) | 5 | 10 | specs/agents/connected-agents.feature |
| platform/app/src/app/api/agents/__tests__/long-poll-route.integration.test.ts | 11 | apps/api (src/features/agent/__tests__/connected-agent-long-poll-route.integration.test.ts) | 5 | 7 | specs/agents/connected-agents.feature |
| platform/app/src/server/connected-agents/__tests__/protocol-and-identity.unit.test.ts | 7 | packages/features/agent/contract (split: connected-agent-protocol.unit.test.ts + connected-agent-identity.unit.test.ts) | 2 | 1 | specs/agents/connected-agents.feature |
| platform/app/src/server/agents/__tests__/agent-test-turn.unit.test.ts | 1 | packages/features/scenario/server (agent-test.service) | 1 | 7 | specs/agents/agent-test-run.feature |
| platform/app/src/server/connected-agents/__tests__/long-poll.unit.test.ts | 3 | packages/features/agent/server | 4 | 5 | specs/agents/connected-agents.feature |
| platform/app/src/server/connected-agents/__tests__/gateway-guards.unit.test.ts | 3 | packages/features/agent/server | 3 | 3 | specs/agents/connected-agents.feature |
| platform/app/src/components/agents/__tests__/AgentTypeSelectorDrawer.integration.test.tsx | 5 | packages/features/agent/web | 2 | 1 | specs/agents/agent-management.feature<br>specs/features/agents/connected-agents-ui.feature |
| platform/app/src/app/api/analytics-sql/__tests__/savedWorkbenchChartsRestApi.integration.test.ts | 23 | packages/features/analytics/contract | 4 | 10 | specs/analytics/lwql-langy-authoring.feature<br>specs/analytics/lwql-saved-charts.feature |
| platform/app/src/server/api/routers/__tests__/automations.router.integration.test.ts | 7 | packages/features/analytics/contract | 1 | 10 | specs/automations/authoring-drawer.feature<br>specs/automations/runaway-automation-containment.feature |
| platform/app/src/server/analytics/saved-workbench-charts/__tests__/savedWorkbenchChart.integration.test.ts | 2 | packages/features/analytics/contract | 4 | 8 | specs/analytics/lwql-saved-charts.feature |
| platform/app/src/app/api/dashboards/__tests__/dashboard-rest-api.integration.test.ts | 2 | packages/features/analytics/contract | 4 | 5 | specs/analytics/dashboard-rest-api.feature |
| platform/app/src/server/filters/__tests__/precondition-matchers.unit.test.ts | 1 | packages/features/analytics/contract | 1 | 0 | specs/monitors/online-evaluation-preconditions.feature |
| platform/app/src/server/analytics/lwql/__tests__/tenantIsolation.integration.test.ts | 25 | packages/features/analytics/server | 1 | 1 | specs/analytics/lwql-api.feature |
| platform/app/src/server/analytics/lwql/__tests__/lwqlViews.integration.test.ts | 19 | packages/features/analytics/server | 5 | 3 | specs/analytics/lwql-api.feature |
| platform/app/src/server/analytics/lwql/__tests__/postgresEngineIsolation.integration.test.ts | 16 | packages/features/analytics/server | 4 | 1 | specs/analytics/lwql-api.feature |
| platform/app/src/app/api/query/__tests__/queryRestAnswerableQuestions.integration.test.ts | 16 | packages/features/analytics/server | 3 | 7 | specs/analytics/lwql-api.feature |
| platform/app/src/app/api/query/__tests__/queryRestServiceProofs.integration.test.ts | 15 | packages/features/analytics/server | 6 | 9 | specs/analytics/lwql-api.feature |
| platform/app/src/server/analytics/lwql/catalog/__tests__/lwqlViewCatalog.unit.test.ts | 7 | packages/features/analytics/server | 4 | 2 | specs/analytics/lwql-api.feature |
| platform/app/src/server/analytics/clickhouse/__tests__/memory-safety.integration.test.ts | 4 | packages/features/analytics/server | 3 | 4 | specs/analytics/clickhouse-memory-safety.feature |
| platform/app/src/server/app-layer/analytics/__tests__/timeseries-row-parser.unit.test.ts | 3 | packages/features/analytics/server | 2 | 1 | specs/analytics/evaluation-pass-rate-consistency.feature |
| platform/app/src/server/app-layer/analytics/__tests__/legacy-shim.unit.test.ts | 2 | packages/features/analytics/server | 2 | 1 | specs/analytics/negate-filters-and-trace-scope.feature |
| platform/app/src/server/analytics/clickhouse/__tests__/memory-safety.test.ts | 2 | packages/features/analytics/server | 3 | 0 | specs/analytics/clickhouse-memory-safety.feature<br>specs/analytics/clickhouse-column-pruning.feature |
| platform/app/src/app/api/query/__tests__/queryRestApi.integration.test.ts | 2 | packages/features/analytics/server | 4 | 7 | specs/analytics/lwql-api.feature |
| platform/app/src/server/app-layer/analytics/__tests__/slim-rollup-builders.unit.test.ts | 1 | packages/features/analytics/server | 2 | 1 | packages/eventing/specs/fold-read-back-store.feature |
| platform/app/src/server/analytics/lwql/__tests__/unknownIdentifier.integration.test.ts | 1 | packages/features/analytics/server | 1 | 1 | specs/analytics/lwql-api.feature |
| platform/app/src/server/analytics/lwql/__tests__/lwqlSchema.unit.test.ts | 1 | packages/features/analytics/server | 5 | 1 | specs/analytics/lwql-api.feature |
| platform/app/src/server/analytics/lwql/__tests__/lwqlDiagnostics.unit.test.ts | 1 | packages/features/analytics/server | 5 | 0 | specs/analytics/lwql-api.feature |
| platform/app/src/server/analytics/lwql/__tests__/lwqlApprovedViewPrefix.unit.test.ts | 1 | packages/features/analytics/server | 3 | 0 | specs/analytics/lwql-api.feature |
| platform/app/src/utils/__tests__/buildMetadataFilterParams.unit.test.ts | 5 | packages/features/analytics/web | 1 | 0 | specs/traces/metadata-tag-filtering.feature |
| platform/app/src/server/api/routers/__tests__/savedWorkbenchCharts.router.integration.test.ts | 5 | packages/features/analytics/web | 3 | 7 | specs/analytics/lwql-saved-charts.feature |
| platform/app/src/server/analytics/clickhouse/__tests__/join-time-bound-partition-column.unit.test.ts | 5 | packages/features/analytics/web | 5 | 1 | specs/analytics/evaluation-runs-join-time-bounds.feature |
| platform/app/src/server/analytics/clickhouse/__tests__/evaluation-runs-join-time-bounds.integration.test.ts | 5 | packages/features/analytics/web | 4 | 4 | specs/analytics/evaluation-runs-join-time-bounds.feature |
| platform/app/src/server/app-layer/analytics/__tests__/route-table.unit.test.ts | 2 | packages/features/analytics/web | 2 | 0 | specs/analytics/negate-filters-and-trace-scope.feature |
| platform/app/src/hooks/__tests__/useSavedViews.unit.test.ts | 2 | packages/features/analytics/web | 3 | 0 | specs/traces/saved-views.feature |
| platform/app/src/components/home/__tests__/TracesOverview.unit.test.tsx | 2 | packages/features/analytics/web | 4 | 1 | specs/home/langy-home.feature |
| platform/app/src/server/analytics/__tests__/registry.unit.test.ts | 1 | packages/features/analytics/web | 1 | 0 | specs/analytics/chart-rendering.feature |
| platform/app/src/server/api-key/__tests__/permission-categories.unit.test.ts | 8 | packages/features/api-key/contract | 1 | 3 | specs/api-keys/scope-based-permissions.feature<br>specs/ai-governance/cli-onboarding/login-user-scoped-key.feature |
| platform/app/src/server/better-auth/__tests__/ssoGate.hook.test.ts | 10 | packages/features/auth/server | 1 | 2 | specs/licensing/sso-license-gating.feature |
| platform/app/src/server/auth0/__tests__/passwordService.integration.test.ts | 4 | packages/features/auth/server | 1 | 1 | specs/settings/change-password-auth0.feature |
| platform/app/src/server/better-auth/__tests__/signInRouterShadow.test.ts | 2 | packages/features/auth/server | 1 | 2 | specs/identity/signin-router.feature |
| platform/app/src/hooks/__tests__/useOrganizationTeamProject.personal-workspace.integration.test.tsx | 17 | packages/features/auth/web | 1 | 4 | specs/ai-gateway/governance/personal-workspace-not-ambient-context.feature |
| platform/app/src/hooks/__tests__/useOrganizationTeamProject.team-membership.integration.test.tsx | 8 | packages/features/auth/web | 1 | 3 | specs/ai-gateway/governance/personal-workspace-not-ambient-context.feature |
| platform/app/src/features/errors/logic/__tests__/applyHandledErrorToForm.unit.test.ts | 4 | packages/features/auth/web | 1 | 0 | specs/features/handled-error-presentation.feature |
| platform/app/src/hooks/__tests__/useRequiredSession.test.tsx | 1 | packages/features/auth/web | 2 | 1 | specs/auth/password-reset.feature |
| platform/app/src/components/checks/__tests__/CheckConfigForm.retiredEvaluator.integration.test.tsx | 1 | packages/features/auth/web | 2 | 4 | specs/npx-installer/07-lean-install.feature |
| platform/app/src/components/__tests__/WorkspaceSwitcherGovernanceSignup.integration.test.tsx | 1 | packages/features/auth/web | 1 | 4 | specs/navigation/workspace-switcher.feature |
| platform/app/src/__tests__/inventoryBouncerExemption.unit.test.ts | 1 | packages/features/auth/web | 1 | 1 | specs/ai-gateway/governance/governance-home-routing.feature |
| platform/app/src/server/api/__tests__/rbac.test.ts | 2 | packages/features/authz/contract | 1 | 1 | specs/rbac/scoped-role-bindings.feature<br>specs/security/api-endpoint-authorization.feature |
| platform/app/src/server/better-auth/__tests__/hooks.test.ts | 10 | packages/features/authz/server | 2 | 2 | specs/features/user-deactivation.feature<br>specs/analytics/posthog-product-milestones.feature<br>specs/auth/phase-1-better-auth-config.feature<br>specs/licensing/sso-license-gating.feature |
| platform/app/src/server/api-key/__tests__/legacy-grant-mint.unit.test.ts | 7 | packages/features/authz/server | 1 | 3 | specs/rbac/authz-grants.feature |
| platform/app/ee/scim/__tests__/scim-offboard-postcondition.integration.test.ts | 6 | packages/features/authz/server | 3 | 4 | specs/identity/scim-connection-sync.feature<br>specs/features/scim-group-mapping.feature |
| platform/app/src/server/app-layer/system-migrations/__tests__/runtime-enrollment.unit.test.ts | 4 | packages/features/authz/server | 2 | 8 | specs/migration/system-migrations-runner.feature<br>specs/identity/identifier-model.feature |
| platform/app/src/server/invites/__tests__/invite.service.unit.test.ts | 3 | packages/features/authz/server | 6 | 1 | specs/members/member-access-editing.feature<br>specs/errors/handled-error-surfaces.feature |
| platform/app/src/server/app-layer/authz/repositories/__tests__/access-listing.cutover.repository.unit.test.ts | 3 | packages/features/authz/server | 1 | 2 | specs/rbac/unified-authorization-engine.feature |
| platform/app/ee/scim/__tests__/scim-grants-write-path.unit.test.ts | 3 | packages/features/authz/server | 1 | 3 | specs/identity/scim-connection-sync.feature |
| platform/app/src/server/role-bindings/__tests__/role-binding.service.unit.test.ts | 2 | packages/features/authz/server | 1 | 3 | specs/rbac/authz-grants.feature |
| platform/app/src/server/api/__tests__/role-api.test.ts | 2 | packages/features/authz/server | 1 | 2 | specs/features/enterprise-feature-guards.feature |
| platform/app/src/server/app-layer/system-migrations/__tests__/runtime-cohort-wiring.unit.test.ts | 1 | packages/features/authz/server | 1 | 8 | specs/migration/system-migrations-runner.feature |
| platform/app/src/server/app-layer/system-migrations/__tests__/newborn-sweep-pass.unit.test.ts | 1 | packages/features/authz/server | 1 | 8 | specs/identity/identity-storage-adapter.feature |
| platform/app/src/server/app-layer/authz/repositories/__tests__/authz-read.cutover.repository.unit.test.ts | 1 | packages/features/authz/server | 1 | 1 | specs/rbac/unified-authorization-engine.feature |
| platform/app/src/server/api-key/__tests__/api-key.service.unit.test.ts | 1 | packages/features/authz/server | 1 | 4 | specs/api-keys/ingest-key-rotation-latency.feature |
| platform/app/src/server/api-key/__tests__/api-key.service.system-managed-guard.unit.test.ts | 1 | packages/features/authz/server | 1 | 3 | specs/security/api-endpoint-authorization.feature |
| platform/app/src/server/api-key/__tests__/api-key.service.safety.unit.test.ts | 1 | packages/features/authz/server | 1 | 4 | specs/api-keys/ingest-key-rotation-latency.feature |
| platform/app/src/components/settings/__tests__/ScopeChipPicker.integration.test.tsx | 5 | packages/features/authz/web | 1 | 0 | specs/components/scope-chip-picker-search.feature |
| platform/app/src/components/settings/__tests__/ProviderScopeChips.integration.test.tsx | 1 | packages/features/authz/web | 1 | 0 | specs/model-providers/role-based-default-models.feature |
| platform/app/src/server/app-layer/github/__tests__/github-pull-request-mapping.integration.test.ts | 22 | packages/features/coding-agent/server | 10 | 8 | specs/coding-agent/pull-request-linkage.feature<br>specs/coding-agent/project-menu-links.feature |
| platform/app/src/server/app-layer/coding-agent/__tests__/coding-agent-sessions-list.service.unit.test.ts | 8 | packages/features/coding-agent/server | 2 | 2 | specs/coding-agent/sessions-screen.feature |
| platform/app/src/server/app-layer/coding-agent/repositories/__tests__/coding-agent-session.clickhouse.repository.unit.test.ts | 6 | packages/features/coding-agent/server | 2 | 1 | specs/coding-agent/session-aggregate.feature |
| platform/app/src/server/app-layer/coding-agent/__tests__/coding-agent-session.service.unit.test.ts | 6 | packages/features/coding-agent/server | 4 | 2 | specs/coding-agent/context-economics.feature<br>specs/coding-agent/session-aggregate.feature |
| platform/app/src/server/app-layer/coding-agent/__tests__/pull-request-usage.integration.test.ts | 5 | packages/features/coding-agent/server | 5 | 6 | specs/coding-agent/pull-request-linkage.feature |
| platform/app/src/server/app-layer/coding-agent/repositories/__tests__/coding-agent-session.clickhouse.repository.integration.test.ts | 4 | packages/features/coding-agent/server | 4 | 1 | packages/features/coding-agent/specs/session-git-context.feature<br>specs/coding-agent/pull-request-linkage.feature |
| platform/app/src/server/app-layer/coding-agent/repositories/__tests__/coding-agent-session-events.repository.integration.test.ts | 4 | packages/features/coding-agent/server | 1 | 2 | specs/coding-agent/pull-request-linkage.feature<br>specs/coding-agent/context-economics.feature |
| platform/app/src/app/api/coding-agent/__tests__/pull-request-usage-api.integration.test.ts | 3 | packages/features/coding-agent/server | 8 | 12 | specs/coding-agent/pull-request-linkage.feature |
| platform/app/src/server/datasets/__tests__/upload-utils.unit.test.ts | 11 | packages/features/dataset/contract | 1 | 1 | specs/features/dataset-file-upload-api.feature |
| platform/app/src/server/stored-objects/__tests__/azure-keyless-byte-paths.unit.test.ts | 5 | packages/features/dataset/server | 4 | 4 | specs/features/scenarios/azure-blob-workload-identity.feature |
| platform/app/src/server/datasets/__tests__/self-hosted-no-s3.unit.test.ts | 5 | packages/features/dataset/server | 3 | 4 | specs/features/dataset-file-upload-api.feature<br>specs/datasets/large-dataset-storage.feature |
| platform/app/src/server/datasets/__tests__/local-dataset-storage.integration.test.ts | 5 | packages/features/dataset/server | 5 | 2 | specs/datasets/large-dataset-storage.feature |
| platform/app/src/server/datasets/__tests__/middleware.test.ts | 4 | packages/features/dataset/server | 1 | 1 | specs/errors/handled-error-surfaces.feature |
| platform/app/src/server/datasets/__tests__/local-dataset-storage.unit.test.ts | 3 | packages/features/dataset/server | 1 | 0 | specs/datasets/dataset-storage-not-writable.feature |
| platform/app/src/server/datasets/__tests__/dataset-service.s3-reads.unit.test.ts | 2 | packages/features/dataset/server | 3 | 3 | specs/datasets/large-dataset-storage.feature |
| platform/app/src/server/datasets/__tests__/dataset-record.repository.unit.test.ts | 2 | packages/features/dataset/server | 1 | 0 | specs/datasets/large-dataset-storage.feature |
| platform/app/src/server/datasets/__tests__/dataset-normalize.job.unit.test.ts | 2 | packages/features/dataset/server | 2 | 0 | specs/datasets/large-dataset-storage.feature<br>specs/datasets/dataset-upload-dropzone.feature |
| platform/app/src/server/datasets/__tests__/azure-dataset-storage.integration.test.ts | 2 | packages/features/dataset/server | 1 | 3 | specs/migration/object-storage-provider-migration.feature<br>specs/features/scenarios/externalize-event-byte-content.feature |
| platform/app/src/tasks/__tests__/backfillDatasetContentToS3.azure.integration.test.ts | 1 | packages/features/dataset/server | 2 | 7 | specs/features/scenarios/externalize-event-byte-content.feature |
| platform/app/src/server/datasets/__tests__/dataset-storage.unit.test.ts | 1 | packages/features/dataset/server | 3 | 2 | specs/features/scenarios/externalize-event-byte-content.feature |
| platform/app/src/server/datasets/__tests__/dataset-service.upload.unit.test.ts | 1 | packages/features/dataset/server | 3 | 2 | specs/datasets/large-dataset-storage.feature |
| platform/app/src/server/datasets/__tests__/azure-dataset-storage.unit.test.ts | 1 | packages/features/dataset/server | 4 | 3 | specs/features/scenarios/externalize-event-byte-content.feature |
| platform/app/src/components/datasets/editor/__tests__/DatasetEditorTable.integration.test.tsx | 14 | packages/features/dataset/web | 1 | 3 | specs/datasets/dataset-editor.feature |
| platform/app/src/components/datasets/__tests__/UploadCSVDrawer.integration.test.tsx | 7 | packages/features/dataset/web | 3 | 4 | specs/datasets/dataset-upload-dropzone.feature |
| platform/app/src/server/license-enforcement/__tests__/member-classification.unit.test.ts | 8 | packages/features/entitlement/server | 1 | 0 | specs/licensing/enforcement-members.feature |
| platform/app/src/server/license-enforcement/__tests__/license-enforcement.repository.unit.test.ts | 7 | packages/features/entitlement/server | 1 | 0 | specs/licensing/enforcement-members.feature<br>specs/features/remove-dead-cost-checker-code.feature |
| platform/app/src/server/app-layer/usage/__tests__/usage-meter-policy.unit.test.ts | 5 | packages/features/entitlement/server | 1 | 0 | specs/features/pricing-model-aware-free-plan.feature |
| platform/app/src/server/app-layer/usage/__tests__/limit-message.unit.test.ts | 4 | packages/features/entitlement/server | 1 | 1 | specs/features/trace-limit-upgrade-message.feature |
| platform/app/src/server/evaluations/__tests__/preconditions.unit.test.ts | 8 | packages/features/evaluation/contract | 3 | 0 | specs/monitors/online-evaluation-preconditions.feature<br>specs/traces/explicit-application-origin.feature |
| platform/app/src/server/gateway/__tests__/guardrailEvaluation.integration.test.ts | 8 | packages/features/evaluator/contract | 2 | 2 | specs/ai-gateway/guardrail-check-endpoint.feature |
| platform/app/src/components/evaluators/__tests__/EvaluatorCategorySelectorDrawer.test.tsx | 7 | packages/features/evaluator/web | 3 | 2 | specs/evaluators/evaluator-management.feature |
| platform/app/src/components/preconditions/__tests__/preconditionFieldUtils.unit.test.ts | 3 | packages/features/evaluator/web | 1 | 0 | specs/monitors/online-evaluation-preconditions.feature |
| platform/app/src/components/evaluations/__tests__/OnlineEvaluationDrawer.preconditions.integration.test.tsx | 1 | packages/features/evaluator/web | 5 | 3 | specs/monitors/online-evaluation-preconditions.feature |
| platform/app/src/server/experiments/__tests__/workbench-versioning.integration.test.ts | 18 | packages/features/experiment/contract | 1 | 5 | specs/experiments-v3/workbench-versioning.feature<br>specs/langy/langy-ui-actions-fallback.feature |
| platform/app/src/server/routes/__tests__/experiments-workbench-rest.integration.test.ts | 9 | packages/features/experiment/contract | 2 | 6 | specs/experiments-v3/workbench-versioning.feature |
| platform/app/src/server/experiments-v3/execution/__tests__/runBoardSnapshot.unit.test.ts | 9 | packages/features/experiment/contract | 4 | 1 | specs/experiments-v3/run-board-snapshot.feature |
| platform/app/src/server/experiments-v3/execution/__tests__/executeWorkflowCell.integration.test.ts | 7 | packages/features/experiment/contract | 4 | 4 | specs/experiments-v3/workflow-agent-target-fields.feature<br>specs/experiments-v3/workflow-target.feature |
| platform/app/src/server/experiments/__tests__/workbench-validation.unit.test.ts | 6 | packages/features/experiment/contract | 1 | 4 | specs/experiments-v3/workbench-versioning.feature |
| platform/app/src/experiments-v3/actions/__tests__/projection.unit.test.ts | 5 | packages/features/experiment/contract | 2 | 1 | specs/experiments-v3/workbench-actions.feature |
| platform/app/src/server/experiments-v3/execution/__tests__/orchestrator.test.ts | 4 | packages/features/experiment/contract | 4 | 0 | specs/experiments-v3/evaluation-execution.feature<br>specs/features/evaluations-v3/evaluator-run-rerun-enhancements.feature |
| platform/app/src/experiments-v3/utils/__tests__/mappingValidation.test.ts | 4 | packages/features/experiment/contract | 2 | 0 | specs/experiments-v3/mapping-validation.feature |
| platform/app/src/server/experiments/__tests__/blankWorkbenchState.unit.test.ts | 3 | packages/features/experiment/contract | 2 | 1 | specs/experiments-v3/workbench-versioning.feature |
| platform/app/src/server/experiments-v3/execution/__tests__/runResultsPersistence.integration.test.ts | 3 | packages/features/experiment/contract | 5 | 4 | specs/experiments-v3/workbench-versioning.feature |
| platform/app/src/experiments-v3/hooks/__tests__/resolveEvaluatorName.unit.test.ts | 3 | packages/features/experiment/contract | 2 | 0 | specs/experiments-v3/evaluator-naming.feature |
| platform/app/src/experiments-v3/actions/__tests__/transforms.evaluators.unit.test.ts | 3 | packages/features/experiment/contract | 1 | 2 | specs/experiments-v3/workbench-actions.feature |
| platform/app/src/experiments-v3/actions/__tests__/payloadSchemas.unit.test.ts | 3 | packages/features/experiment/contract | 2 | 0 | specs/experiments-v3/workbench-actions.feature |
| platform/app/src/server/experiments/__tests__/workbench-comparison-invariant.integration.test.ts | 2 | packages/features/experiment/contract | 2 | 3 | specs/experiments-v3/workbench-actions.feature |
| platform/app/src/server/experiments-v3/execution/__tests__/runResultsFold.unit.test.ts | 2 | packages/features/experiment/contract | 2 | 1 | specs/experiments-v3/workbench-versioning.feature |
| platform/app/src/server/experiments-v3/execution/__tests__/orchestratorStorageDispatch.unit.test.ts | 2 | packages/features/experiment/contract | 5 | 2 | specs/experiments/comparison.feature<br>specs/experiments/comparison-leaderboard.feature |
| platform/app/src/server/experiments-v3/execution/__tests__/evaluatorDispatchGuard.integration.test.ts | 2 | packages/features/experiment/contract | 4 | 4 | specs/experiments-v3/evaluation-execution.feature |
| platform/app/src/server/experiments-v3/execution/__tests__/runInputs.unit.test.ts | 1 | packages/features/experiment/contract | 1 | 0 | specs/experiments-v3/workbench-versioning.feature |
| platform/app/src/server/experiments-v3/execution/__tests__/executionRequest.test.ts | 1 | packages/features/experiment/contract | 1 | 0 | specs/experiments-v3/execution-inputs.feature |
| platform/app/src/server/experiments-v3/execution/__tests__/comparisonSeeding.integration.test.ts | 1 | packages/features/experiment/contract | 4 | 5 | specs/experiments-v3/evaluation-execution.feature |
| platform/app/src/experiments-v3/utils/__tests__/normalizeComparison.test.ts | 1 | packages/features/experiment/contract | 2 | 0 | specs/experiments-v3/workbench-actions.feature |
| platform/app/src/experiments-v3/utils/__tests__/mappingInference.test.ts | 1 | packages/features/experiment/contract | 2 | 1 | specs/experiments-v3/mapping-auto-inference.feature |
| platform/app/src/experiments-v3/execution/__tests__/buildExecutionRequest.unit.test.ts | 1 | packages/features/experiment/contract | 3 | 0 | specs/experiments-v3/evaluation-execution.feature |
| platform/app/src/server/event-sourcing/pipelines/experiment-run-processing/projections/__tests__/experimentRunState.carriedOver.unit.test.ts | 9 | packages/features/experiment/server | 4 | 0 | specs/experiments-v3/run-board-snapshot.feature |
| platform/app/src/server/app-layer/langy/ui-actions/__tests__/uiActionBackendExecutor.unit.test.ts | 7 | packages/features/experiment/server | 4 | 3 | specs/langy/langy-ui-actions-fallback.feature<br>specs/langy/langy-ui-actions.feature<br>specs/experiments-v3/evaluation-execution.feature |
| platform/app/src/server/experiments-v3/execution/__tests__/applyParametersToRows.unit.test.ts | 3 | packages/features/experiment/server | 1 | 0 | specs/experiments-v3/execution-inputs.feature |
| platform/app/src/server/event-sourcing/pipelines/experiment-run-processing/projections/__tests__/experimentRunResultStorage.carriedOver.unit.test.ts | 3 | packages/features/experiment/server | 4 | 0 | specs/experiments-v3/run-board-snapshot.feature |
| platform/app/src/server/routes/__tests__/experiments-execute-run-state.integration.test.ts | 2 | packages/features/experiment/server | 4 | 5 | specs/experiments-v3/evaluation-execution.feature |
| platform/app/src/server/routes/__tests__/experiments-abort-interactive-run.integration.test.ts | 1 | packages/features/experiment/server | 1 | 5 | specs/experiments-v3/execution-backend.feature |
| platform/app/src/server/routes/__tests__/experiments-abort-cross-tenant.integration.test.ts | 1 | packages/features/experiment/server | 1 | 5 | specs/security/api-endpoint-authorization.feature |
| platform/app/src/server/experiments-v3/execution/__tests__/buildTargetMetadata.unit.test.ts | 1 | packages/features/experiment/server | 3 | 0 | specs/experiments-v3/evaluation-execution.feature |
| platform/app/src/experiments-v3/components/__tests__/VersionHistoryPopover.integration.test.tsx | 9 | packages/features/experiment/web | 3 | 4 | specs/experiments-v3/workbench-versioning.feature |
| platform/app/src/experiments-v3/__tests__/WorkbenchUpdateListener.integration.test.tsx | 9 | packages/features/experiment/web | 3 | 1 | specs/langy/langy-ui-actions-fallback.feature<br>specs/experiments-v3/workbench-versioning.feature |
| platform/app/src/server/routes/__tests__/otel.path-aliases.unit.test.ts | 4 | packages/features/experiment/web | 1 | 4 | specs/otlp/endpoint-path-canonicalisation.feature |
| platform/app/src/server/routes/__tests__/collector-validation-diagnostics.unit.test.ts | 4 | packages/features/experiment/web | 1 | 4 | specs/observability/ingest-validation-diagnostics.feature |
| platform/app/src/experiments-v3/components/__tests__/RunViaApiButton.integration.test.tsx | 4 | packages/features/experiment/web | 1 | 0 | specs/run-via-api/dialog.feature |
| platform/app/src/experiments-v3/__tests__/WorkflowTargetFields.integration.test.tsx | 4 | packages/features/experiment/web | 17 | 5 | specs/experiments-v3/workflow-agent-target-fields.feature |
| platform/app/src/experiments-v3/__tests__/StalePageRefusesAgentActions.integration.test.tsx | 4 | packages/features/experiment/web | 12 | 5 | specs/langy/langy-ui-actions.feature |
| platform/app/src/experiments-v3/__tests__/AutosaveEvaluation.integration.test.tsx | 4 | packages/features/experiment/web | 4 | 4 | specs/experiments-v3/workbench-versioning.feature<br>specs/langy/langy-ui-actions-fallback.feature |
| platform/app/src/experiments-v3/components/TargetSection/__tests__/TargetVariablesPanel.test.tsx | 3 | packages/features/experiment/web | 4 | 2 | specs/experiments-v3/mapping-source-types.feature<br>specs/experiments-v3/mapping-source-display.feature<br>specs/experiments-v3/mapping-validation.feature |
| platform/app/src/experiments-v3/__tests__/OptimizeMenuLangyHandoff.integration.test.tsx | 3 | packages/features/experiment/web | 7 | 2 | specs/langy/langy-prompt-optimization-entrypoints.feature |
| platform/app/src/utils/__tests__/posthogErrorCapture.unit.test.ts | 2 | packages/features/experiment/web | 1 | 0 | specs/features/narrow-capture-exception-type.feature |
| platform/app/src/experiments-v3/components/TargetSection/__tests__/TargetSummary.test.tsx | 2 | packages/features/experiment/web | 3 | 0 | specs/experiments-v3/evaluation-execution.feature |
| platform/app/src/experiments-v3/components/TargetSection/__tests__/TargetHeaderMissingMappings.integration.test.tsx | 2 | packages/features/experiment/web | 7 | 1 | specs/experiments-v3/mapping-validation.feature |
| platform/app/src/experiments-v3/actions/__tests__/runScope.unit.test.ts | 2 | packages/features/experiment/web | 2 | 0 | specs/langy/langy-ui-actions.feature<br>specs/experiments-v3/workbench-actions.feature |
| platform/app/src/experiments-v3/actions/__tests__/manifest.unit.test.ts | 2 | packages/features/experiment/web | 1 | 0 | specs/langy/langy-ui-actions.feature<br>specs/experiments-v3/workbench-actions.feature |
| platform/app/src/experiments-v3/actions/__tests__/evaluatorNaming.unit.test.ts | 2 | packages/features/experiment/web | 1 | 2 | specs/experiments-v3/evaluator-naming.feature |
| platform/app/src/experiments-v3/__tests__/RunFlushesPendingSave.integration.test.tsx | 2 | packages/features/experiment/web | 12 | 5 | specs/langy/langy-ui-actions.feature |
| platform/app/src/experiments-v3/__tests__/MappingValidation.integration.test.tsx | 2 | packages/features/experiment/web | 8 | 0 | specs/experiments-v3/mapping-validation.feature |
| platform/app/src/experiments-v3/__tests__/AgentEditDurability.integration.test.tsx | 2 | packages/features/experiment/web | 3 | 4 | specs/langy/langy-ui-actions.feature |
| platform/app/src/server/__tests__/usageStatsWorker.logLevel.unit.test.ts | 1 | packages/features/experiment/web | 1 | 3 | specs/observability/retryable-failure-log-level.feature |
| platform/app/src/experiments-v3/components/__tests__/ComparisonCell.integration.test.tsx | 1 | packages/features/experiment/web | 7 | 0 | specs/experiments-v3/comparison-error-handling.feature |
| platform/app/src/experiments-v3/components/TargetSection/__tests__/TargetCell.integration.test.tsx | 1 | packages/features/experiment/web | 9 | 0 | specs/experiments-v3/evaluation-execution.feature |
| platform/app/src/experiments-v3/components/EvaluatorPanel/__tests__/ComparisonConfigForm.judgePromptParity.unit.test.ts | 1 | packages/features/experiment/web | 1 | 0 | specs/experiments/comparison.feature |
| platform/app/src/experiments-v3/actions/__tests__/narration.unit.test.ts | 1 | packages/features/experiment/web | 2 | 0 | specs/langy/langy-page-activity-narration.feature |
| platform/app/src/experiments-v3/__tests__/useEvaluationsV3Store.unit.test.ts | 1 | packages/features/experiment/web | 2 | 0 | specs/experiments-v3/workbench-actions.feature |
| platform/app/src/experiments-v3/__tests__/WorkbenchUsesFullMenu.integration.test.tsx | 1 | packages/features/experiment/web | 10 | 5 | specs/experiments-v3/workbench-layout.feature |
| platform/app/src/experiments-v3/__tests__/WorkbenchReportsActivityToLangy.integration.test.tsx | 1 | packages/features/experiment/web | 10 | 5 | specs/langy/langy-page-activity-narration.feature |
| platform/app/src/experiments-v3/__tests__/DatasetTabs.integration.test.tsx | 1 | packages/features/experiment/web | 2 | 0 | specs/experiments-v3/dataset-management.feature |
| platform/app/src/server/featureFlag/__tests__/targeting.unit.test.ts | 5 | packages/features/feature-flag/contract | 2 | 3 | specs/ops/internal-feature-flags.feature |
| platform/app/src/server/app-layer/langy/__tests__/langyApiKeyActorSession.unit.test.ts | 3 | packages/features/feature-flag/contract | 1 | 1 | specs/langy/langy-api-key-turns.feature |
| platform/app/src/server/featureFlag/__tests__/frontendFlagsRegistered.unit.test.ts | 2 | packages/features/feature-flag/contract | 1 | 1 | specs/ops/internal-feature-flags.feature |
| platform/app/src/server/analytics/lwql/__tests__/access.unit.test.ts | 1 | packages/features/feature-flag/contract | 2 | 1 | specs/analytics/lwql-saved-charts.feature |
| platform/app/src/app/api/gateway-platform/__tests__/gateway-platform-api.integration.test.ts | 66 | packages/features/gateway/server | 4 | 8 | specs/ai-gateway/public-rest-api.feature<br>specs/ai-gateway/idempotency.feature<br>specs/ai-gateway/budgets.feature |
| platform/app/src/app/api/gateway-spend/__tests__/gateway-spend-rest-api.integration.test.ts | 29 | packages/features/gateway/server | 4 | 8 | specs/ai-gateway/gateway-spend-rest.feature<br>specs/security/api-endpoint-authorization.feature<br>specs/ai-gateway/billing-spend-events.feature<br>specs/ai-gateway/public-rest-api.feature<br>specs/ai-gateway/end-user-attribution.feature<br>specs/webhooks/webhook-endpoints.feature |
| platform/app/src/server/gateway/__tests__/budgetsEveryDimension.integration.test.ts | 22 | packages/features/gateway/server | 5 | 4 | specs/ai-gateway/gateway-budget-targeting.feature<br>specs/ai-gateway/virtual-key-creation.feature<br>specs/ai-gateway/provider-routing.feature<br>specs/ai-gateway/fallback.feature<br>specs/ai-gateway/governance/vk-provider-access.feature |
| platform/app/src/server/gateway/__tests__/virtualKeyTraceProject.integration.test.ts | 17 | packages/features/gateway/server | 3 | 3 | specs/ai-gateway/virtual-key-creation.feature |
| platform/app/src/server/gateway/__tests__/realtimeSession.integration.test.ts | 13 | packages/features/gateway/server | 1 | 3 | specs/ai-gateway/realtime-sessions.feature |
| platform/app/src/server/gateway/__tests__/budgetSiblingSpend.integration.test.ts | 9 | packages/features/gateway/server | 3 | 4 | specs/ai-gateway/budgets.feature |
| platform/app/src/server/gateway/__tests__/spendFiltering.integration.test.ts | 8 | packages/features/gateway/server | 1 | 3 | specs/ai-gateway/gateway-spend-rest.feature |
| platform/app/src/server/gateway/__tests__/virtualKeySpend.integration.test.ts | 7 | packages/features/gateway/server | 2 | 2 | specs/ai-gateway/budgets.feature |
| platform/app/src/server/gateway/__tests__/pulledUsageLedger.integration.test.ts | 7 | packages/features/gateway/server | 2 | 3 | specs/governance/pulled-usage-cost-reporting.feature |
| platform/app/src/server/gateway/__tests__/modelProviderRotation.integration.test.ts | 7 | packages/features/gateway/server | 1 | 3 | specs/ai-gateway/governance/provider-credential-rotation.feature |
| platform/app/src/server/gateway/__tests__/budgetOverview.integration.test.ts | 6 | packages/features/gateway/server | 1 | 4 | specs/ai-gateway/budget-overview.feature |
| platform/app/src/server/event-sourcing/pipelines/gateway-spend-processing/repositories/__tests__/openAdmissions.repository.integration.test.ts | 6 | packages/features/gateway/server | 4 | 1 | specs/ai-gateway/billing-spend-events.feature |
| platform/app/src/server/gateway/__tests__/budgetEnforcement.integration.test.ts | 5 | packages/features/gateway/server | 3 | 5 | specs/ai-gateway/budgets.feature |
| platform/app/src/server/gateway/__tests__/attributedBudgets.integration.test.ts | 5 | packages/features/gateway/server | 3 | 5 | specs/ai-gateway/end-user-attribution.feature<br>specs/ai-gateway/gateway-budget-targeting.feature<br>specs/ai-gateway/budgets.feature |
| platform/app/src/server/routes/__tests__/gateway-internal.vk-lifecycle.integration.test.ts | 4 | packages/features/gateway/server | 1 | 4 | specs/ai-gateway/virtual-key-lifecycle.feature |
| platform/app/src/server/routes/__tests__/gateway-internal.vk-expiry.integration.test.ts | 4 | packages/features/gateway/server | 1 | 3 | specs/ai-gateway/virtual-key-lifecycle.feature |
| platform/app/src/server/routes/__tests__/gateway-internal.config-route.integration.test.ts | 4 | packages/features/gateway/server | 2 | 5 | specs/ai-gateway/governance/provider-credential-rotation.feature<br>specs/ai-gateway/auth-cache.feature |
| platform/app/src/server/modelProviders/__tests__/modelProvider.routingHandle.integration.test.ts | 4 | packages/features/gateway/server | 3 | 3 | specs/ai-gateway/instance-routing-handle.feature |
| platform/app/src/server/gateway/__tests__/budgetUnreachableRefusal.integration.test.ts | 4 | packages/features/gateway/server | 2 | 2 | specs/ai-gateway/gateway-budget-targeting.feature |
| platform/app/ee/governance/__tests__/gatewayDebits.process.unit.test.ts | 4 | packages/features/gateway/server | 1 | 1 | specs/ai-gateway/billing-spend-events.feature<br>specs/ai-gateway/end-user-attribution.feature |
| platform/app/src/server/gateway/__tests__/virtualKeyExpiry.integration.test.ts | 3 | packages/features/gateway/server | 2 | 3 | specs/ai-gateway/virtual-key-lifecycle.feature<br>specs/ai-gateway/virtual-key-creation.feature |
| platform/app/src/server/gateway/__tests__/virtualKeyDirectBudget.integration.test.ts | 3 | packages/features/gateway/server | 2 | 3 | specs/ai-gateway/budgets.feature |
| platform/app/src/server/gateway/__tests__/config.materialiser.integration.test.ts | 3 | packages/features/gateway/server | 3 | 3 | specs/ai-gateway/model-provider-scoping.feature<br>specs/ai-gateway/governance/vk-provider-access.feature |
| platform/app/src/server/gateway/__tests__/budgetNanoExactSpend.integration.test.ts | 3 | packages/features/gateway/server | 3 | 4 | specs/ai-gateway/budgets.feature |
| platform/app/src/server/gateway/__tests__/budgetBucketBreakdown.integration.test.ts | 3 | packages/features/gateway/server | 1 | 5 | specs/ai-gateway/budgets.feature |
| platform/app/src/server/gateway/__tests__/budget.clickhouse.repository.periodStart.integration.test.ts | 3 | packages/features/gateway/server | 1 | 5 | specs/ai-gateway/budgets.feature |
| platform/app/ee/webhooks/__tests__/envelope.unit.test.ts | 3 | packages/features/gateway/server | 1 | 1 | specs/ai-gateway/billing-spend-events.feature<br>specs/webhooks/webhook-endpoints.feature |
| platform/app/src/server/routes/__tests__/elevenlabs-webhook.unit.test.ts | 2 | packages/features/gateway/server | 1 | 0 | specs/ai-gateway/realtime-sessions.feature |
| platform/app/src/server/gateway/__tests__/virtualKey.service.product-managed-guard.unit.test.ts | 2 | packages/features/gateway/server | 1 | 0 | specs/security/api-endpoint-authorization.feature |
| platform/app/src/server/gateway/__tests__/routingModeMigration.integration.test.ts | 2 | packages/features/gateway/server | 2 | 2 | specs/ai-gateway/virtual-key-creation.feature<br>specs/ai-gateway/fallback.feature |
| platform/app/src/server/gateway/__tests__/realtimeSessionWebhook.integration.test.ts | 2 | packages/features/gateway/server | 3 | 4 | specs/ai-gateway/realtime-sessions.feature |
| platform/app/src/server/gateway/__tests__/geminiCredentials.materialiser.unit.test.ts | 2 | packages/features/gateway/server | 1 | 0 | specs/model-providers/google-agent-platform.feature |
| platform/app/src/server/gateway/__tests__/characterPricedSpend.integration.test.ts | 2 | packages/features/gateway/server | 3 | 3 | specs/ai-gateway/audio-endpoints.feature |
| platform/app/ee/webhooks/__tests__/webhookEvents.repository.integration.test.ts | 2 | packages/features/gateway/server | 2 | 2 | specs/webhooks/webhook-endpoints.feature |
| platform/app/ee/governance/__tests__/governanceSignals.unit.test.ts | 2 | packages/features/gateway/server | 1 | 3 | specs/ai-gateway/budgets.feature<br>specs/webhooks/webhook-endpoints.feature |
| platform/app/src/server/modelProviders/__tests__/modelProvider.service.extraHeaders.unit.test.ts | 1 | packages/features/gateway/server | 2 | 3 | specs/model-providers/provider-configuration.feature |
| platform/app/src/server/gateway/__tests__/spendEventsCursor.unit.test.ts | 1 | packages/features/gateway/server | 1 | 1 | specs/ai-gateway/gateway-spend-rest.feature |
| platform/app/src/server/event-sourcing/pipelines/gateway-spend-processing/__tests__/transientKeyDeterminism.unit.test.ts | 1 | packages/features/gateway/server | 1 | 0 | packages/eventing/specs/transient-process-instances.feature |
| platform/app/src/server/event-sourcing/pipelines/gateway-spend-processing/__tests__/spendPriceAgreement.unit.test.ts | 1 | packages/features/gateway/server | 5 | 3 | specs/ai-gateway/billing-spend-events.feature |
| platform/app/src/server/app-layer/traces/__tests__/gateway-cached-call-cost-agreement.unit.test.ts | 1 | packages/features/gateway/server | 3 | 1 | specs/ai-gateway/cache-token-telemetry.feature |
| platform/app/src/server/__tests__/end-user-spend-routing.integration.test.ts | 1 | packages/features/gateway/server | 4 | 5 | specs/ai-gateway/end-user-attribution.feature |
| platform/app/src/server/gateway/__tests__/eligibleModelProviders.parity.integration.test.ts | 1 | packages/features/gateway/web | 2 | 4 | specs/ai-gateway/governance/vk-provider-access.feature |
| platform/app/src/server/app-layer/github/__tests__/github-branch-recheck.worker.unit.test.ts | 2 | packages/features/github/server | 1 | 1 | specs/coding-agent/pull-request-linkage.feature |
| platform/app/src/mcp/__tests__/mcp-request-logging.integration.test.ts | 1 | packages/features/hosted-mcp/server | 1 | 2 | specs/mcp-server/mcp-in-app.feature |
| platform/app/src/server/app-layer/identity/repositories/__tests__/identity-projection.prisma.repository.integration.test.ts | 5 | packages/features/identity/server | 4 | 2 | specs/identity/identifier-model.feature<br>specs/identity/identity-storage-adapter.feature |
| platform/app/src/server/app-layer/identity/repositories/__tests__/identity-newborn.prisma.repository.integration.test.ts | 2 | packages/features/identity/server | 2 | 1 | specs/identity/identity-storage-adapter.feature |
| platform/app/src/server/app-layer/identity/repositories/__tests__/sso-connection-grandfather.integration.test.ts | 1 | packages/features/identity/server | 9 | 2 | specs/identity/sso-connection-lifecycle.feature |
| platform/app/src/server/app-layer/identity/repositories/__tests__/identity-verification.prisma.repository.integration.test.ts | 1 | packages/features/identity/server | 1 | 1 | specs/identity/identity-storage-adapter.feature |
| platform/app/src/server/app-layer/identity/repositories/__tests__/identity-secret-carry.prisma.repository.integration.test.ts | 1 | packages/features/identity/server | 1 | 1 | specs/identity/identity-storage-adapter.feature |
| platform/app/src/server/app-layer/identity/repositories/__tests__/identity-reservations.prisma.repository.integration.test.ts | 1 | packages/features/identity/server | 1 | 1 | specs/identity/identity-storage-adapter.feature |
| platform/app/src/server/app-layer/identity/__tests__/signin-method-policy.unit.test.ts | 1 | packages/features/identity/server | 1 | 3 | specs/identity/signin-router.feature |
| platform/app/src/server/app-layer/langy/__tests__/langy-warm-worker.unit.test.ts | 7 | packages/features/langy/contract | 1 | 3 | specs/langy/langy-worker-prewarm.feature |
| platform/app/src/server/api/routers/__tests__/langy.turnErrors.unit.test.ts | 4 | packages/features/langy/contract | 1 | 7 | specs/langy/langy-model-selection.feature |
| platform/app/src/server/app-layer/langy/__tests__/langy-turn.service.unit.test.ts | 24 | packages/features/langy/server | 4 | 3 | specs/langy/langy-conversation-memory.feature<br>specs/langy/langy-model-selection.feature<br>specs/langy/langy-versioned-prompts.feature<br>specs/langy/langy-stop-and-resume.feature<br>specs/langy/langy-worker-prewarm.feature<br>specs/langy/langy-ui-actions.feature |
| platform/app/src/server/app-layer/langy/ui-actions/__tests__/ui-action.service.unit.test.ts | 19 | packages/features/langy/server | 1 | 0 | specs/langy/langy-ui-actions-fallback.feature<br>specs/langy/langy-ui-actions.feature |
| platform/app/src/server/app-layer/langy/__tests__/langyConversationMemory.unit.test.ts | 14 | packages/features/langy/server | 1 | 1 | specs/langy/langy-conversation-memory.feature |
| platform/app/src/server/app-layer/langy/ui-actions/__tests__/ui-action.service.integration.test.ts | 3 | packages/features/langy/server | 1 | 1 | specs/langy/langy-ui-actions.feature<br>specs/langy/langy-ui-actions-fallback.feature |
| platform/app/src/server/api/routers/__tests__/langy.conversationVisibility.integration.test.ts | 2 | packages/features/langy/server | 4 | 8 | specs/langy/langy-event-sourced-frontend.feature |
| platform/app/src/server/skills/__tests__/setupSkills.unit.test.ts | 1 | packages/features/langy/server | 3 | 1 | specs/skills/empty-state-skill-setup.feature |
| platform/app/src/features/langy/__tests__/LangyExternalLinkGuard.integration.test.tsx | 13 | packages/features/langy/web | 3 | 1 | specs/langy/langy-external-link-guard.feature |
| platform/app/src/features/langy/__tests__/LangyStickToBottom.integration.test.tsx | 12 | packages/features/langy/web | 2 | 0 | specs/langy/langy-follow-the-stream.feature |
| platform/app/src/features/langy/__tests__/ProjectLangyLayout.integration.test.tsx | 6 | packages/features/langy/web | 6 | 2 | specs/langy/langy-worker-prewarm.feature<br>specs/langy/langy-navigation-persistence.feature<br>specs/security/api-endpoint-authorization.feature |
| platform/app/src/features/langy/hooks/__tests__/useLangyFreshness.integration.test.tsx | 5 | packages/features/langy/web | 3 | 3 | specs/langy/langy-event-sourced-frontend.feature |
| platform/app/src/features/langy/__tests__/langyErrorExplainer.unit.test.ts | 5 | packages/features/langy/web | 1 | 0 | specs/langy/langy-model-provider-failures.feature |
| platform/app/src/features/langy/__tests__/LangyInlineModelSetup.integration.test.tsx | 5 | packages/features/langy/web | 7 | 4 | specs/langy/langy-inline-model-setup.feature<br>specs/langy/langy-panel-layout.feature |
| platform/app/src/features/langy/__tests__/LangyPanelNavigate.integration.test.tsx | 4 | packages/features/langy/web | 6 | 4 | specs/langy/langy-agent-driven-navigation.feature |
| platform/app/src/features/langy/__tests__/LangyEventSourcedPanel.integration.test.tsx | 4 | packages/features/langy/web | 6 | 3 | specs/langy/langy-event-sourced-frontend.feature |
| platform/app/src/features/langy/__tests__/LangyDerivedCards.integration.test.tsx | 4 | packages/features/langy/web | 3 | 3 | specs/langy/langy-choice-questions.feature<br>specs/langy/langy-derived-cards.feature<br>specs/langy/langy-derived-stats-presentation.feature |
| platform/app/src/features/langy/__tests__/Composer.midTurn.integration.test.tsx | 4 | packages/features/langy/web | 3 | 0 | specs/langy/langy-composer-feedback-and-cards.feature |
| platform/app/src/features/langy/__tests__/LangyEvalRunCard.integration.test.tsx | 3 | packages/features/langy/web | 3 | 1 | specs/langy/langy-agent-driven-navigation.feature |
| platform/app/src/features/langy/__tests__/LangyConversationHistory.integration.test.tsx | 3 | packages/features/langy/web | 6 | 3 | specs/langy/langy-stop-and-resume.feature |
| platform/app/src/features/langy/hooks/__tests__/useComposerMorph.unit.test.tsx | 2 | packages/features/langy/web | 3 | 1 | specs/home/langy-home-morph.feature |
| platform/app/src/features/langy/__tests__/langyLinkDestination.unit.test.ts | 2 | packages/features/langy/web | 1 | 0 | specs/langy/langy-external-link-guard.feature |
| platform/app/src/features/langy/__tests__/MessageContentInterrupted.integration.test.tsx | 2 | packages/features/langy/web | 2 | 3 | specs/langy/langy-stop-and-resume.feature |
| platform/app/src/features/langy/__tests__/LangyDeclarativeCard.integration.test.tsx | 2 | packages/features/langy/web | 3 | 0 | specs/langy/langy-ui-actions.feature |
| platform/app/src/features/langy/__tests__/ComposerTypingRenders.integration.test.tsx | 2 | packages/features/langy/web | 3 | 0 | specs/langy/langy-composer-feedback-and-cards.feature |
| platform/app/src/features/langy/__tests__/Composer.focusHandoff.integration.test.tsx | 2 | packages/features/langy/web | 3 | 0 | specs/langy/langy-model-selection.feature<br>specs/langy/langy-navigation-persistence.feature |
| platform/app/src/features/langy/components/capabilities/__tests__/LangyCapabilityPendingCard.integration.test.tsx | 1 | packages/features/langy/web | 2 | 0 | specs/langy/langy-stop-and-resume.feature |
| platform/app/src/features/langy/__tests__/StreamingCardFenceForms.integration.test.tsx | 1 | packages/features/langy/web | 1 | 3 | specs/langy/langy-derived-cards.feature |
| platform/app/src/features/langy/__tests__/LangyTraceSampleCard.unit.test.tsx | 1 | packages/features/langy/web | 3 | 0 | specs/langy/langy-trace-explorer-link.feature |
| platform/app/src/features/langy/__tests__/LangyRunningActivityCard.integration.test.tsx | 1 | packages/features/langy/web | 2 | 0 | specs/langy/langy-stop-and-resume.feature |
| platform/app/src/features/langy/__tests__/LangyPanelUiActions.integration.test.tsx | 1 | packages/features/langy/web | 7 | 4 | specs/langy/langy-ui-actions.feature |
| platform/app/src/features/langy/__tests__/LangyConversationRestoreLoading.integration.test.tsx | 1 | packages/features/langy/web | 6 | 3 | specs/langy/langy-navigation-persistence.feature |
| platform/app/src/features/langy/__tests__/LangyComposerRecordedTurn.integration.test.tsx | 1 | packages/features/langy/web | 4 | 0 | specs/langy/langy-event-sourced-frontend.feature |
| platform/app/src/server/app-layer/metrics/repositories/__tests__/metric-data-point.clickhouse.repository.unit.test.ts | 6 | packages/features/metric/contract | 2 | 1 | specs/otlp/canonical-metric-ingestion.feature |
| platform/app/src/server/app-layer/metrics/repositories/__tests__/metric-data-point.clickhouse.repository.integration.test.ts | 2 | packages/features/metric/contract | 3 | 2 | specs/otlp/canonical-metric-ingestion.feature |
| platform/app/src/components/settings/__tests__/ProviderModelSelector.displayName.integration.test.tsx | 10 | packages/features/model-provider/contract | 2 | 0 | specs/model-providers/custom-model-display-name.feature<br>specs/model-providers/custom-model-display-name-resolution.feature |
| platform/app/src/components/settings/__tests__/DefaultModelOverrideDrawer.inheritDirection.integration.test.tsx | 7 | packages/features/model-provider/contract | 4 | 3 | specs/model-providers/role-based-default-models.feature |
| platform/app/src/utils/__tests__/constants.default-model.unit.test.ts | 1 | packages/features/model-provider/contract | 2 | 1 | specs/prompts/prompt-sync-fidelity.feature |
| platform/app/src/server/modelProviders/__tests__/utils.unit.test.ts | 1 | packages/features/model-provider/contract | 2 | 4 | specs/model-providers/latest-alias-resolution.feature |
| platform/app/src/server/modelProviders/__tests__/resolveModelForFeature.codexRestriction.unit.test.ts | 1 | packages/features/model-provider/contract | 1 | 3 | specs/model-providers/model-default-config-cascade.feature |
| platform/app/src/app/api/evaluators/__tests__/evaluators-api.create-model-resolution.integration.test.ts | 1 | packages/features/model-provider/contract | 2 | 4 | specs/evaluators/evaluator-create-model-resolution.feature |
| platform/app/src/server/modelProviders/__tests__/agentPlatformValidation.unit.test.ts | 9 | packages/features/model-provider/server | 1 | 1 | specs/model-providers/google-agent-platform.feature |
| platform/app/src/server/modelProviders/__tests__/modelProvider.testConnection.unit.test.ts | 5 | packages/features/model-provider/server | 1 | 5 | specs/model-providers/credential-validation.feature |
| platform/app/src/hooks/__tests__/useModelProviderApiKeyValidation.unit.test.ts | 3 | packages/features/model-provider/server | 2 | 2 | specs/model-providers/credential-validation.feature |
| platform/app/src/hooks/__tests__/useProviderFormSubmit.integration.test.tsx | 6 | packages/features/model-provider/web | 2 | 2 | specs/model-providers/provider-configuration.feature<br>specs/ai-gateway/gateway-provider-settings.feature<br>specs/model-providers/hierarchical-default-models.feature<br>specs/model-providers/role-based-default-models.feature |
| platform/app/src/components/settings/__tests__/ModelProviderForm.edit-row-resolution.integration.test.tsx | 6 | packages/features/model-provider/web | 5 | 4 | specs/model-providers/scope-and-multi-instance.feature |
| platform/app/src/components/settings/__tests__/ModelProviderForm.credential-requiredness.integration.test.tsx | 4 | packages/features/model-provider/web | 4 | 4 | specs/model-providers/provider-configuration.feature |
| platform/app/src/components/settings/__tests__/LLMModelCostMatchingSpans.integration.test.tsx | 4 | packages/features/model-provider/web | 2 | 2 | specs/model-providers/model-cost-matching-spans-preview.feature |
| platform/app/src/components/settings/__tests__/ModelProviderForm.validation-escape-hatch.integration.test.tsx | 3 | packages/features/model-provider/web | 4 | 4 | specs/model-providers/credential-validation.feature |
| platform/app/src/components/settings/__tests__/ModelProviderForm.credential-preservation.integration.test.tsx | 3 | packages/features/model-provider/web | 5 | 4 | specs/model-providers/provider-configuration.feature |
| platform/app/src/components/settings/__tests__/ModelProviderForm.advanced-gateway.integration.test.tsx | 3 | packages/features/model-provider/web | 5 | 4 | specs/ai-gateway/gateway-provider-settings.feature |
| platform/app/src/utils/__tests__/modelProviderCredentialRules.unit.test.ts | 2 | packages/features/model-provider/web | 1 | 1 | specs/model-providers/provider-configuration.feature |
| platform/app/src/features/onboarding/components/sections/model-provider/__tests__/ModelProviderSetup.validation-escape-hatch.integration.test.tsx | 2 | packages/features/model-provider/web | 3 | 4 | specs/model-providers/credential-validation.feature |
| platform/app/src/components/__tests__/providersWithoutRegistryModels.unit.test.ts | 2 | packages/features/model-provider/web | 1 | 0 | specs/model-providers/google-agent-platform.feature |
| platform/app/src/components/settings/__tests__/ProviderModelSelector.integration.test.tsx | 1 | packages/features/model-provider/web | 1 | 0 | specs/model-providers/model-default-config-cascade.feature |
| platform/app/src/components/settings/__tests__/ModelProviderForm.azure-safety.integration.test.tsx | 1 | packages/features/model-provider/web | 5 | 4 | specs/model-providers/hierarchical-default-models.feature |
| platform/app/src/components/settings/__tests__/DefaultModelOverrideDrawer.displayName.integration.test.tsx | 1 | packages/features/model-provider/web | 3 | 3 | specs/model-providers/custom-model-display-name-resolution.feature |
| platform/app/src/components/__tests__/NoModelsConfiguredCallout.integration.test.tsx | 1 | packages/features/model-provider/web | 2 | 2 | specs/model-providers/no-models-empty-state.feature |
| platform/app/src/components/__tests__/ModelSelector.displayName.integration.test.tsx | 1 | packages/features/model-provider/web | 1 | 2 | specs/model-providers/custom-model-display-name-resolution.feature |
| platform/app/src/components/evaluations/__tests__/OnlineEvaluationsTable.integration.test.tsx | 1 | packages/features/monitor/web | 1 | 0 | specs/analytics/evaluation-pass-rate-consistency.feature |
| platform/app/src/features/navigation/__tests__/ProductSwitcherShell.integration.test.tsx | 19 | packages/features/navigation/web | 14 | 17 | specs/navigation/product-switcher-navigation.feature |
| platform/app/src/features/navigation/__tests__/ProductSidebar.integration.test.tsx | 17 | packages/features/navigation/web | 8 | 7 | specs/navigation/product-sidebars.feature<br>specs/navigation/ops-navigation-v2.feature |
| platform/app/src/features/navigation/__tests__/SettingsShellV2.integration.test.tsx | 14 | packages/features/navigation/web | 14 | 22 | specs/navigation/settings-shell-v2.feature<br>specs/navigation/ops-navigation-v2.feature |
| platform/app/src/features/navigation/__tests__/MobileShell.integration.test.tsx | 10 | packages/features/navigation/web | 14 | 18 | specs/navigation/mobile-chrome.feature |
| platform/app/src/features/navigation/__tests__/IconRailShell.integration.test.tsx | 8 | packages/features/navigation/web | 15 | 17 | specs/navigation/icon-rail-navigation.feature |
| platform/app/src/components/__tests__/MainMenu.codingAgentLinks.integration.test.tsx | 8 | packages/features/navigation/web | 8 | 4 | specs/coding-agent/project-menu-links.feature |
| platform/app/src/features/navigation/logic/__tests__/resolveSettingsBackTarget.unit.test.ts | 4 | packages/features/navigation/web | 1 | 0 | specs/navigation/navigation-v2-landing.feature<br>specs/navigation/navigation-v2-product-memory.feature |
| platform/app/src/features/navigation/__tests__/useNavigationV2Tracking.integration.test.tsx | 4 | packages/features/navigation/web | 3 | 1 | specs/navigation/navigation-v2-product-memory.feature |
| platform/app/src/features/navigation/__tests__/opsMenuReachability.unit.test.ts | 3 | packages/features/navigation/web | 1 | 0 | specs/identity/sso-onboarding-tiers.feature<br>specs/navigation/ops-navigation-v2.feature |
| platform/app/src/components/__tests__/MainMenu.agentTesting.integration.test.tsx | 3 | packages/features/navigation/web | 8 | 4 | specs/suites/new-simulations-callout.feature<br>specs/features/agent-testing/page-structure.feature |
| platform/app/src/features/navigation/logic/__tests__/resolveOrgSwitchDestination.unit.test.ts | 2 | packages/features/navigation/web | 1 | 0 | specs/navigation/navigation-v2-landing.feature |
| platform/app/src/features/navigation/logic/__tests__/resolveShellRoute.unit.test.ts | 1 | packages/features/navigation/web | 1 | 0 | specs/navigation/product-switcher-navigation.feature |
| platform/app/src/features/navigation/__tests__/isSettingsMenuItemActive.unit.test.ts | 1 | packages/features/navigation/web | 1 | 0 | specs/navigation/settings-shell-v2.feature |
| platform/app/src/features/command-bar/__tests__/useCommandSearch.test.ts | 1 | packages/features/navigation/web | 1 | 0 | specs/traces-v2/default-drawer-routing.feature |
| platform/app/src/components/sidebar/__tests__/sideMenuDensity.integration.test.tsx | 1 | packages/features/navigation/web | 3 | 1 | specs/navigation/product-sidebars.feature |
| platform/app/src/components/__tests__/MainMenu.orgScopedFlag.integration.test.tsx | 1 | packages/features/navigation/web | 7 | 4 | specs/features/agent-testing/page-structure.feature |
| platform/app/src/components/__tests__/MainMenu.navigation.integration.test.tsx | 1 | packages/features/navigation/web | 7 | 4 | specs/traces-v2/default-drawer-routing.feature |
| platform/app/src/features/onboarding/components/sections/ViaClaudeCodeScreen.analytics.unit.test.tsx | 9 | packages/features/onboarding/web | 2 | 2 | specs/analytics/posthog-product-milestones.feature |
| platform/app/src/features/onboarding/components/sections/observability/__tests__/CodePreview.copy.integration.test.tsx | 3 | packages/features/onboarding/web | 1 | 1 | specs/api-keys/token-created-snippets.feature |
| platform/app/src/features/onboarding/hooks/__tests__/use-onboarding-flow.unit.test.tsx | 1 | packages/features/onboarding/web | 4 | 2 | specs/features/onboarding/intent-fork.feature |
| platform/app/src/features/onboarding/components/sections/__tests__/IntentSelectionScreen.integration.test.tsx | 1 | packages/features/onboarding/web | 2 | 0 | specs/features/onboarding/intent-fork.feature |
| platform/app/src/server/app-layer/ops/__tests__/integration/process-ops.integration.test.ts | 15 | packages/features/ops/server | 4 | 1 | specs/ops/process-manager-visibility.feature<br>specs/ops/dead-letter-recovery.feature |
| platform/app/src/server/app-layer/bug-reports/__tests__/bug-reports.integration.test.ts | 12 | packages/features/ops/server | 1 | 2 | specs/support/bug-reports.feature |
| platform/app/src/server/app-layer/system-migrations/repositories/__tests__/cohort-eligibility.integration.test.ts | 1 | packages/features/ops/server | 1 | 1 | specs/migration/system-migrations-runner.feature |
| platform/app/src/server/app-layer/ops/__tests__/manager-explorer-fleet.unit.test.ts | 1 | packages/features/ops/server | 4 | 0 | specs/ops/process-manager-visibility.feature |
| platform/app/src/server/app-layer/ops/__tests__/integration/latency-tiles.integration.test.ts | 1 | packages/features/ops/server | 6 | 1 | packages/features/ops/specs/dashboard-latency-windows.feature |
| platform/app/src/server/api/routers/__tests__/bugReports.gating.unit.test.ts | 1 | packages/features/ops/server | 1 | 3 | specs/support/bug-reports.feature |
| platform/app/src/server/api/routers/__tests__/enterprise-guards.integration.test.ts | 18 | packages/features/organization/server | 6 | 8 | specs/features/enterprise-feature-guards.feature |
| platform/app/src/server/api/routers/__tests__/personal-workspace-invariants.integration.test.ts | 16 | packages/features/organization/server | 7 | 8 | specs/ai-gateway/governance/personal-workspace-integrity.feature |
| platform/app/src/app/api/organization/__tests__/organization-members-rest-api.integration.test.ts | 16 | packages/features/organization/server | 6 | 7 | specs/organizations/organization-members-rest-api.feature |
| platform/app/src/server/api/routers/__tests__/organization.setMemberDisabled.integration.test.ts | 9 | packages/features/organization/server | 8 | 6 | specs/licensing/seat-reconciliation.feature |
| platform/app/src/server/invites/__tests__/invite-resilience.unit.test.ts | 3 | packages/features/organization/server | 3 | 0 | specs/identity/resilient-invitations.feature |
| platform/app/src/server/invites/__tests__/invite-ask-again.unit.test.ts | 2 | packages/features/organization/server | 3 | 1 | specs/identity/resilient-invitations.feature |
| platform/app/src/server/api/routers/onboarding/__tests__/onboarding.personal-workspace.integration.test.ts | 2 | packages/features/organization/server | 4 | 5 | specs/ai-governance/personal-portal/default-catalog.feature<br>specs/features/onboarding/intent-fork.feature |
| platform/app/src/server/api/routers/__tests__/personal-workspace-lifecycle.integration.test.ts | 2 | packages/features/organization/server | 4 | 7 | specs/ai-gateway/governance/personal-workspace-integrity.feature |
| platform/app/src/server/api/routers/__tests__/organization.base-key-redaction.integration.test.ts | 2 | packages/features/organization/server | 5 | 5 | specs/api-keys/project-key-read-access.feature |
| platform/app/src/server/api/routers/__tests__/computeEffectiveTeamRoleUpdates.unit.test.ts | 2 | packages/features/organization/server | 1 | 0 | specs/members/member-role-team-restrictions.feature |
| platform/app/src/server/app-layer/organizations/__tests__/organization.provisioning-compensation.integration.test.ts | 1 | packages/features/organization/server | 4 | 1 | specs/organizations/organizations-provisioning-rest-api.feature |
| platform/app/src/server/app-layer/organizations/__tests__/organization.prisma.repository.governance-filter.integration.test.ts | 1 | packages/features/organization/server | 1 | 1 | specs/ai-gateway/governance/ui-contract.feature |
| platform/app/src/server/app-layer/organizations/__tests__/organization.createAndAssign.primaryIntent.integration.test.ts | 1 | packages/features/organization/server | 1 | 1 | specs/features/onboarding/intent-fork.feature |
| platform/app/src/server/api/routers/__tests__/organization.member-roles.planLimit.integration.test.ts | 1 | packages/features/organization/server | 5 | 6 | specs/licensing/seat-reconciliation.feature |
| platform/app/src/components/settings/__tests__/seatTypeExplanation.integration.test.tsx | 3 | packages/features/organization/web | 3 | 1 | specs/licensing/seat-type-explained.feature |
| platform/app/src/components/settings/__tests__/AddMembersForm.liteMemberNeedsTeam.integration.test.tsx | 3 | packages/features/organization/web | 1 | 1 | specs/members/member-role-team-restrictions.feature |
| platform/app/src/components/members/__tests__/JoinRequestsTable.integration.test.tsx | 3 | packages/features/organization/web | 2 | 0 | specs/identity/join-requests.feature |
| platform/app/src/components/agents/__tests__/AgentEditorDrawersFromRegistry.integration.test.tsx | 3 | packages/features/organization/web | 3 | 4 | specs/features/scenarios/scenarios-editor-ui-regressions.feature |
| platform/app/src/components/settings/__tests__/GroupBindingInputRow.integration.test.tsx | 2 | packages/features/organization/web | 1 | 2 | specs/members/member-access-editing.feature |
| platform/app/src/components/agents/__tests__/AgentHttpEditorDrawer.integration.test.tsx | 2 | packages/features/organization/web | 2 | 5 | specs/scenarios/scenario-input-mapping.feature<br>specs/agents/agent-session-echo.feature |
| platform/app/src/components/home/__tests__/RecentItemsSection.test.ts | 1 | packages/features/project/server | 2 | 0 | specs/home/recent-items-ui.feature |
| platform/app/src/components/home/__tests__/useHomeComposition.unit.test.ts | 6 | packages/features/project/web | 1 | 0 | specs/home/signal-focused-home-rollout.feature<br>specs/home/langy-home.feature |
| platform/app/src/components/home/__tests__/LangyHomeLantern.integration.test.tsx | 6 | packages/features/project/web | 5 | 3 | specs/home/langy-home-morph.feature<br>specs/home/langy-home.feature |
| platform/app/src/components/home/__tests__/WelcomeHeader.test.ts | 4 | packages/features/project/web | 1 | 0 | specs/home/welcome-header.feature |
| platform/app/src/features/briefing/components/LangyBriefing.unit.test.tsx | 2 | packages/features/project/web | 2 | 0 | specs/home/signal-focused-home-rollout.feature |
| platform/app/src/components/home/__tests__/LangyHomeHero.integration.test.tsx | 2 | packages/features/project/web | 8 | 3 | specs/home/langy-home.feature |
| platform/app/src/server/prompt-config/__tests__/runtimeParameters.integration.test.ts | 8 | packages/features/prompt/contract | 2 | 3 | specs/prompts/prompt-runtime-parameters.feature |
| platform/app/src/server/prompt-config/__tests__/prompt-tags.integration.test.ts | 5 | packages/features/prompt/contract | 3 | 2 | specs/features/prompts/custom-prompt-tags.feature<br>specs/prompts/prompt-tags.feature |
| platform/app/src/server/suites/__tests__/suite.service.unit.test.ts | 36 | packages/features/prompt/server | 2 | 6 | specs/suites/test-suite-run-plan-reuse.feature<br>specs/agents/connected-agents.feature<br>specs/suites/run-plan-identity-by-name.feature<br>specs/scenarios/scenario-run-parameters.feature<br>specs/suites/test-suites.feature<br>specs/suites/archived-scenario-exclusion.feature<br>specs/suites/suite-stale-prompt-references.feature<br>specs/suites/suite-run-dependency-refactor.feature<br>specs/suites/suite-workflow.feature |
| platform/app/src/server/suites/__tests__/connected-targets.unit.test.ts | 4 | packages/features/prompt/server | 2 | 8 | specs/agents/connected-agents.feature<br>specs/scenarios/scenario-run-parameters.feature |
| platform/app/src/server/experiments-v3/execution/__tests__/dataLoader.integration.test.ts | 3 | packages/features/prompt/server | 3 | 3 | specs/experiments-v3/workbench-versioning.feature<br>specs/experiments-v3/evaluation-execution.feature |
| platform/app/src/server/app-layer/langy/streaming/__tests__/langyNavigateFallback.unit.test.ts | 3 | packages/features/prompt/server | 1 | 8 | specs/langy/langy-agent-driven-navigation.feature |
| platform/app/src/server/app-layer/langy/streaming/__tests__/langyNavigateFallback.integration.test.ts | 2 | packages/features/prompt/server | 1 | 7 | specs/langy/langy-agent-driven-navigation.feature |
| platform/app/src/server/app-layer/langy/__tests__/langyPromptRegistry.unit.test.ts | 1 | packages/features/prompt/server | 2 | 0 | specs/langy/langy-versioned-prompts.feature |
| platform/app/src/components/prompts/__tests__/PromptEditorDrawer.test.tsx | 8 | packages/features/prompt/web | 15 | 8 | specs/studio/prompt-library-roundtrip.feature<br>specs/prompts/prompt-editor-outputs.feature<br>specs/prompts/locked-input-variable.feature<br>specs/experiments-v3/prompt-editor-drawer-display.feature |
| platform/app/src/prompts/utils/__tests__/llmPromptConfigUtils.test.ts | 7 | packages/features/prompt/web | 3 | 1 | specs/model-config/unified-reasoning-form.feature<br>specs/workflows/workflow-default-prompt-validation.feature |
| platform/app/src/prompts/__tests__/VersionHistoryListPopover.test.tsx | 5 | packages/features/prompt/web | 1 | 4 | specs/prompts/prompt-version-detail-visibility.feature<br>specs/prompts/prompt-version-history-author.feature |
| platform/app/src/prompts/hooks/__tests__/usePromptConfigForm.systemPromptRequired.integration.test.tsx | 3 | packages/features/prompt/web | 4 | 0 | specs/workflows/workflow-default-prompt-validation.feature |
| platform/app/src/components/prompts/__tests__/PromptEditorDrawerDirtyBaseline.integration.test.tsx | 3 | packages/features/prompt/web | 7 | 6 | specs/prompts/prompt-editor-dirty-state.feature |
| platform/app/src/prompts/forms/fields/message-history-fields/__tests__/PromptMessagesField.test.tsx | 1 | packages/features/prompt/web | 1 | 2 | specs/prompts/editing-modes.feature |
| platform/app/src/prompts/components/__tests__/DeployPromptDialog.overflow.integration.test.tsx | 1 | packages/features/prompt/web | 3 | 4 | specs/prompts/deploy-prompt-dialog.feature |
| platform/app/src/components/outputs/__tests__/OutputsSection.test.tsx | 1 | packages/features/prompt/web | 1 | 1 | specs/prompts/prompt-editor-outputs.feature |
| platform/app/src/components/llmPromptConfigs/__tests__/LLMModelDisplay.displayName.integration.test.tsx | 1 | packages/features/prompt/web | 1 | 2 | specs/model-providers/custom-model-display-name.feature |
| platform/app/src/server/app-layer/simulations/result-atoms/__tests__/result-atoms.service.unit.test.ts | 13 | packages/features/scenario/contract | 1 | 3 | specs/features/agent-testing/results-atoms.feature |
| platform/app/src/server/scenarios/__tests__/scenario-versioning.integration.test.ts | 11 | packages/features/scenario/contract | 1 | 4 | specs/scenarios/scenario-versioning.feature |
| platform/app/src/components/simulations/__tests__/audio-sequential-playback.integration.test.tsx | 10 | packages/features/scenario/contract | 2 | 2 | specs/components/audio-sequential-playback.feature |
| platform/app/src/components/simulations/__tests__/ScenarioMessageRenderer.integration.test.tsx | 10 | packages/features/scenario/contract | 2 | 2 | specs/features/scenarios/externalize-event-byte-content.feature<br>specs/features/scenarios/voice-message-view-trace-button.feature<br>specs/features/scenarios/voice-message-render-regressions.feature |
| platform/app/src/server/scenarios/__tests__/scenario-version-restore.integration.test.ts | 7 | packages/features/scenario/contract | 1 | 6 | specs/scenarios/scenario-version-restore.feature |
| platform/app/src/server/scenarios/execution/__tests__/field-mapping-schema.unit.test.ts | 6 | packages/features/scenario/contract | 1 | 1 | specs/scenarios/scenario-input-mapping.feature |
| platform/app/src/server/app-layer/simulations/__tests__/scenario-run-export-sweep.integration.test.ts | 6 | packages/features/scenario/contract | 3 | 2 | specs/scenarios/scenario-run-export.feature |
| platform/app/src/server/app-layer/simulations/result-atoms/__tests__/atom-sql.unit.test.ts | 4 | packages/features/scenario/contract | 3 | 1 | specs/features/agent-testing/results-atoms.feature<br>specs/agents/agent-test-run.feature |
| platform/app/src/server/agents/__tests__/agent-test-run.unit.test.ts | 4 | packages/features/scenario/contract | 1 | 5 | specs/agents/agent-test-run.feature |
| platform/app/src/server/scenarios/execution/__tests__/connected-agent-execution.unit.test.ts | 3 | packages/features/scenario/contract | 5 | 3 | specs/agents/connected-agents.feature |
| platform/app/src/server/scenarios/execution/__tests__/agent-test-prefetch.unit.test.ts | 3 | packages/features/scenario/contract | 1 | 2 | specs/agents/agent-test-run.feature |
| platform/app/src/server/scenarios/__tests__/child-execution-contract.unit.test.ts | 3 | packages/features/scenario/contract | 1 | 2 | specs/scenarios/child-execution-contract.feature |
| platform/app/src/server/app-layer/simulations/__tests__/list-page-limit.unit.test.ts | 3 | packages/features/scenario/contract | 2 | 0 | specs/scenarios/simulation-runs-api.feature |
| platform/app/src/components/simulations/__tests__/ScenarioRunDetailDrawer.integration.test.tsx | 2 | packages/features/scenario/contract | 4 | 3 | specs/features/scenarios/run-view-side-by-side-layout.feature |
| platform/app/src/app/api/simulation-runs/__tests__/simulation-runs-batch-filter.integration.test.ts | 2 | packages/features/scenario/contract | 3 | 7 | specs/features/simulation-runs-batch-filter.feature |
| platform/app/src/app/api/simulation-runs/__tests__/simulation-run-platform-url.integration.test.ts | 2 | packages/features/scenario/contract | 3 | 7 | specs/langy/langy-agent-driven-navigation.feature |
| platform/app/src/server/suites/__tests__/suite-set-id.unit.test.ts | 1 | packages/features/scenario/contract | 1 | 1 | specs/suites/suite-workflow.feature |
| platform/app/src/server/queues/__tests__/makeQueueName.unit.test.ts | 1 | packages/features/scenario/contract | 1 | 1 | specs/background/redis-cluster-compatibility.feature |
| platform/app/src/server/event-sourcing/pipelines/simulation-processing/repositories/__tests__/simulationRunState.agentInstance.integration.test.ts | 1 | packages/features/scenario/contract | 6 | 2 | specs/scenarios/served-agent-instance-on-runs.feature |
| platform/app/src/server/app-layer/suites/__tests__/suite-run-actor.unit.test.ts | 1 | packages/features/scenario/contract | 1 | 3 | specs/scenarios/run-actor-on-runs.feature |
| platform/app/src/server/app-layer/simulations/__tests__/last-result-summaries.integration.test.ts | 1 | packages/features/scenario/contract | 2 | 3 | specs/suites/test-suite-run-plan-reuse.feature |
| platform/app/src/server/app-layer/simulations/__tests__/simulation.clickhouse.repository.integration.test.ts | 13 | packages/features/scenario/server | 1 | 2 | specs/features/simulation-runs-batch-filter.feature<br>specs/features/simulation-runs-batch-completion.feature<br>specs/scenarios/simulation-runs-api.feature<br>specs/agents/agent-test-run.feature<br>specs/scenarios/scenario-events-scoped-archive.feature |
| platform/app/src/server/app-layer/simulations/run-configurations/__tests__/run-configurations.integration.test.ts | 12 | packages/features/scenario/server | 6 | 9 | specs/features/agent-testing/run-configuration-history.feature |
| platform/app/src/server/app-layer/simulations/__tests__/batch-history-note.integration.test.ts | 7 | packages/features/scenario/server | 1 | 2 | specs/suites/run-note-metadata-convention.feature<br>specs/suites/run-notes.feature |
| platform/app/src/server/scenarios/__tests__/cancellation-event-sourcing.integration.test.ts | 5 | packages/features/scenario/server | 2 | 4 | specs/features/suites/cancel-queued-running-jobs.feature |
| platform/app/src/server/app-layer/suites/__tests__/suite-run-parameters.integration.test.ts | 5 | packages/features/scenario/server | 7 | 6 | specs/scenarios/run-configuration-on-runs.feature<br>specs/scenarios/secret-run-parameters.feature<br>specs/scenarios/scenario-run-parameters.feature |
| platform/app/src/server/app-layer/simulations/__tests__/batch-history-actor.integration.test.ts | 4 | packages/features/scenario/server | 1 | 2 | specs/scenarios/run-actor-on-runs.feature |
| platform/app/src/app/api/simulation-runs/__tests__/simulation-runs-batch-summary.integration.test.ts | 4 | packages/features/scenario/server | 2 | 7 | specs/features/simulation-runs-batch-completion.feature |
| platform/app/src/server/scenarios/__tests__/scenario-processor-failure-handler.unit.test.ts | 3 | packages/features/scenario/server | 1 | 1 | specs/scenarios/scenario-failure-handler.feature |
| platform/app/src/app/api/export/scenario-runs/__tests__/scenario-run-export-route.integration.test.ts | 3 | packages/features/scenario/server | 2 | 7 | specs/scenarios/scenario-run-export.feature |
| platform/app/src/server/scenarios/__tests__/scenario-processor-drain.unit.test.ts | 2 | packages/features/scenario/server | 1 | 1 | specs/scenarios/queued-run-orphan-recovery.feature |
| platform/app/src/server/scenarios/__tests__/scenario-processor-agent-instance.unit.test.ts | 2 | packages/features/scenario/server | 1 | 1 | specs/scenarios/served-agent-instance-on-runs.feature |
| platform/app/src/tasks/__tests__/backfillStalledSimulationRuns.clickhouse.integration.test.ts | 1 | packages/features/scenario/server | 1 | 1 | specs/scenarios/queued-run-orphan-recovery.feature |
| platform/app/src/server/scenarios/__tests__/scenario-processor-served-instance.integration.test.ts | 1 | packages/features/scenario/server | 2 | 2 | specs/scenarios/served-agent-instance-on-runs.feature |
| platform/app/src/server/event-sourcing/pipelines/simulation-processing/repositories/__tests__/simulationRunState.clickhouse.repository.integration.test.ts | 1 | packages/features/scenario/server | 2 | 2 | specs/scenarios/event-driven-execution-prep.feature |
| platform/app/src/components/agent-testing/__tests__/runDialog.integration.test.tsx | 78 | packages/features/scenario/web | 11 | 4 | specs/features/agent-testing/parameter-autocomplete.feature<br>specs/features/agent-testing/comparison-mode.feature<br>specs/features/agent-testing/run-dialog.feature<br>specs/suites/run-notes.feature<br>specs/suites/test-suite-run-plan-reuse.feature<br>specs/features/agent-testing/results-tabs.feature<br>specs/features/agent-testing/cases-table.feature |
| platform/app/src/components/agent-testing/__tests__/runPlanDetail.integration.test.tsx | 58 | packages/features/scenario/web | 16 | 4 | specs/features/agent-testing/comparison-mode.feature<br>specs/suites/run-notes.feature<br>specs/features/agent-testing/results-tabs.feature<br>specs/scenarios/resolved-run-models-on-runs.feature |
| platform/app/src/components/agent-testing/__tests__/casesTable.integration.test.tsx | 46 | packages/features/scenario/web | 8 | 3 | specs/features/agent-testing/suites-rail.feature<br>specs/features/agent-testing/cases-table.feature<br>specs/features/agent-testing/page-structure.feature<br>specs/scenarios/scenario-test-suite-assignment.feature |
| platform/app/src/components/agent-testing/__tests__/wideRunDrawer.integration.test.tsx | 30 | packages/features/scenario/web | 14 | 3 | specs/features/agent-testing/side-by-side-run-drawer.feature<br>specs/scenarios/scenario-version-on-runs.feature<br>specs/features/agent-testing/live-single-scenario-run.feature<br>specs/features/agent-testing/case-version-history.feature |
| platform/app/src/components/agent-testing/__tests__/suitesRail.integration.test.tsx | 27 | packages/features/scenario/web | 8 | 3 | specs/features/agent-testing/suites-rail.feature<br>specs/suites/test-suites.feature |
| platform/app/src/components/scenarios/__tests__/ScenarioFormDrawer.integration.test.tsx | 17 | packages/features/scenario/web | 10 | 4 | specs/scenarios/scenario-editor-loading-state.feature<br>specs/scenarios/save-and-run-redirect.feature |
| platform/app/src/components/agent-testing/__tests__/runPlansList.integration.test.tsx | 17 | packages/features/scenario/web | 7 | 1 | specs/features/agent-testing/results-tabs.feature |
| platform/app/src/components/agent-testing/__tests__/caseModal.integration.test.tsx | 14 | packages/features/scenario/web | 6 | 4 | specs/features/agent-testing/cases-table.feature<br>specs/features/agent-testing/case-version-history.feature<br>specs/features/agent-testing/parameter-autocomplete.feature |
| platform/app/src/components/agent-testing/__tests__/caseVersionHistory.integration.test.tsx | 12 | packages/features/scenario/web | 12 | 3 | specs/features/agent-testing/case-version-history.feature |
| platform/app/src/components/agent-testing/__tests__/caseFiling.integration.test.tsx | 8 | packages/features/scenario/web | 6 | 4 | specs/features/agent-testing/page-structure.feature<br>specs/suites/test-suite-run-plan-reuse.feature<br>specs/scenarios/scenario-test-suite-assignment.feature<br>specs/features/agent-testing/cases-table.feature<br>specs/features/agent-testing/case-version-history.feature |
| platform/app/src/components/simulations/__tests__/MediaPart.integration.test.tsx | 7 | packages/features/scenario/web | 1 | 1 | specs/traces-v2/media-rendering.feature<br>specs/features/scenarios/externalize-event-byte-content.feature |
| platform/app/src/components/suites/__tests__/ExternalSetsSidebar.integration.test.tsx | 6 | packages/features/scenario/web | 4 | 0 | specs/features/suites/external-sdk-ci-sets-in-sidebar.feature<br>specs/features/suites/all-runs-batch-origin-label.feature |
| platform/app/src/components/scenarios/__tests__/ScenarioFormDrawer.mapping-gate.integration.test.tsx | 6 | packages/features/scenario/web | 10 | 4 | specs/features/scenarios/workflow-agent-mapping-layer.feature<br>specs/features/scenarios/minimal-input-mapping.feature |
| platform/app/src/components/scenarios/__tests__/RunScenarioModalTargetSelector.integration.test.tsx | 6 | packages/features/scenario/web | 2 | 3 | specs/agents/agent-dev-tunnel.feature<br>specs/features/suites/run-scenario-target-selector-modal-stability.feature<br>specs/features/scenarios/unified-agent-target-section.feature |
| platform/app/src/components/suites/__tests__/SuiteSidebar.integration.test.tsx | 4 | packages/features/scenario/web | 3 | 0 | specs/features/suites/rename-suites-to-runs.feature<br>specs/features/suites/remove-redundant-suites-label.feature<br>specs/components/search-input.feature |
| platform/app/src/components/agents/__tests__/AgentListDrawer.test.tsx | 4 | packages/features/scenario/web | 2 | 3 | specs/agents/agent-management.feature |
| platform/app/src/server/app-layer/simulations/run-configurations/__tests__/run-configurations.service.unit.test.ts | 3 | packages/features/scenario/web | 2 | 4 | specs/features/agent-testing/run-configuration-history.feature |
| platform/app/src/pages/__tests__/simulationsAgentTestingRedirect.integration.test.tsx | 3 | packages/features/scenario/web | 3 | 4 | specs/features/agent-testing/page-structure.feature<br>specs/suites/new-simulations-callout.feature |
| platform/app/src/pages/__tests__/agentTestingRouteGuards.integration.test.tsx | 3 | packages/features/scenario/web | 10 | 6 | specs/features/agent-testing/page-structure.feature |
| platform/app/src/hooks/__tests__/useScenarioTabFollow.integration.test.tsx | 3 | packages/features/scenario/web | 1 | 1 | specs/scenarios/scenario-tab-handoff.feature |
| platform/app/src/components/shared/__tests__/AICreateModal.test.tsx | 3 | packages/features/scenario/web | 2 | 0 | specs/scenarios/ai-create-modal-close-button-flake.feature |
| platform/app/src/components/agents/__tests__/AgentWorkflowEditorDrawer.save-gate.integration.test.tsx | 3 | packages/features/scenario/web | 6 | 3 | specs/features/scenarios/minimal-input-mapping.feature |
| platform/app/src/components/suites/__tests__/SuiteRunConfirmationParameters.integration.test.tsx | 2 | packages/features/scenario/web | 2 | 4 | specs/scenarios/scenario-run-parameters.feature<br>specs/scenarios/secret-run-parameters.feature |
| platform/app/src/components/scenarios/__tests__/ScenarioFormParameters.integration.test.tsx | 2 | packages/features/scenario/web | 9 | 4 | specs/scenarios/secret-run-parameters.feature<br>specs/scenarios/scenario-run-parameters.feature |
| platform/app/src/components/agents/__tests__/AgentCodeEditorDrawer.save-gate.integration.test.tsx | 2 | packages/features/scenario/web | 6 | 4 | specs/features/scenarios/minimal-input-mapping.feature |
| platform/app/src/components/__tests__/drawerRegistry.preload.integration.test.tsx | 2 | packages/features/scenario/web | 2 | 1 | specs/navigation/drawer-chunk-warmup.feature |
| platform/app/src/prompts/hooks/__tests__/useAllPromptsForProject.unit.test.ts | 1 | packages/features/scenario/web | 1 | 2 | specs/prompts/prompt-list-copy-counts.feature |
| platform/app/src/pages/__tests__/scenariosIndexDrawerWarmup.integration.test.tsx | 1 | packages/features/scenario/web | 4 | 6 | specs/navigation/drawer-chunk-warmup.feature |
| platform/app/src/pages/[project]/__tests__/agents-empty-state.integration.test.tsx | 1 | packages/features/scenario/web | 3 | 7 | specs/features/agents/connected-agents-ui.feature |
| platform/app/src/components/suites/__tests__/SuiteFormDrawer.integration.test.tsx | 1 | packages/features/scenario/web | 4 | 5 | specs/suites/suite-model-selection.feature |
| platform/app/src/components/suites/__tests__/SimulationsPageDrawerWarmup.integration.test.tsx | 1 | packages/features/scenario/web | 5 | 5 | specs/navigation/drawer-chunk-warmup.feature |
| platform/app/src/components/simulations/__tests__/ScenarioRunDetailDrawerParameters.integration.test.tsx | 1 | packages/features/scenario/web | 13 | 4 | specs/scenarios/secret-run-parameters.feature |
| platform/app/src/components/scenarios/__tests__/SimulationModelSelect.displayName.integration.test.tsx | 1 | packages/features/scenario/web | 1 | 2 | specs/model-providers/custom-model-display-name.feature |
| platform/app/src/components/scenarios/__tests__/ScenarioRunModelDialog.integration.test.tsx | 1 | packages/features/scenario/web | 1 | 2 | specs/scenarios/scenario-model-selection.feature |
| platform/app/src/components/scenarios/__tests__/ScenarioFormDrawer.save-and-run.integration.test.tsx | 1 | packages/features/scenario/web | 10 | 4 | specs/features/agent-testing/live-single-scenario-run.feature |
| platform/app/src/components/scenarios/__tests__/NestedDrawerTyping.integration.test.tsx | 1 | packages/features/scenario/web | 9 | 4 | specs/features/suites/nested-drawer-typing.feature |
| platform/app/src/components/copilot-kit/__tests__/TraceMessage.test.tsx | 1 | packages/features/scenario/web | 2 | 3 | specs/prompts/undefined-variable-banner-stability.feature |
| platform/app/src/components/agents/__tests__/AgentWorkflowEditorDrawer.unit.test.tsx | 1 | packages/features/scenario/web | 6 | 3 | specs/features/scenarios/workflow-agent-mapping-unwired-fields.feature |
| platform/app/src/components/agent-testing/__tests__/resultsTabWindow.integration.test.tsx | 1 | packages/features/scenario/web | 4 | 3 | specs/features/agent-testing/results-tabs.feature |
| platform/app/src/tasks/__tests__/objectStorageMigration.integration.test.ts | 14 | packages/features/stored-object/server | 2 | 2 | specs/migration/object-storage-provider-migration.feature |
| platform/app/src/server/stored-objects/__tests__/stored-objects.service.unit.test.ts | 8 | packages/features/stored-object/server | 3 | 5 | specs/features/scenarios/externalize-event-byte-content.feature |
| platform/app/src/server/stored-objects/__tests__/azure-credentials.unit.test.ts | 8 | packages/features/stored-object/server | 1 | 1 | specs/features/scenarios/azure-blob-workload-identity.feature |
| platform/app/src/server/stored-objects/__tests__/stored-objects.ingest-read.integration.test.ts | 6 | packages/features/stored-object/server | 3 | 6 | specs/features/scenarios/externalize-event-byte-content.feature |
| platform/app/src/server/stored-objects/__tests__/project-storage-destination.unit.test.ts | 6 | packages/features/stored-object/server | 1 | 3 | specs/features/scenarios/externalize-event-byte-content.feature<br>specs/migration/object-storage-provider-migration.feature |
| platform/app/src/server/stored-objects/__tests__/azure-blob-driver.unit.test.ts | 5 | packages/features/stored-object/server | 2 | 1 | specs/features/scenarios/azure-blob-workload-identity.feature<br>specs/features/scenarios/externalize-event-byte-content.feature |
| platform/app/src/server/stored-objects/__tests__/stored-objects-factory.unit.test.ts | 4 | packages/features/stored-object/server | 1 | 5 | specs/features/scenarios/azure-blob-workload-identity.feature |
| platform/app/src/server/stored-objects/__tests__/azure-blob-driver.integration.test.ts | 2 | packages/features/stored-object/server | 3 | 7 | specs/migration/object-storage-provider-migration.feature<br>specs/features/scenarios/externalize-event-byte-content.feature |
| platform/app/src/server/stored-objects/__tests__/azure-blob-driver.realazure.integration.test.ts | 1 | packages/features/stored-object/server | 1 | 4 | specs/features/scenarios/azure-blob-workload-identity.feature |
| platform/app/src/server/app-layer/simulations/result-atoms/__tests__/result-atoms.clickhouse.repository.integration.test.ts | 45 | packages/features/suite/contract | 2 | 3 | specs/features/agent-testing/results-atoms.feature |
| platform/app/src/server/suites/__tests__/plan-identity.integration.test.ts | 24 | packages/features/suite/contract | 4 | 12 | specs/suites/run-plan-identity-by-name.feature |
| platform/app/src/server/suites/__tests__/scope-membership.integration.test.ts | 11 | packages/features/suite/contract | 1 | 6 | specs/suites/run-plan-dynamic-scopes.feature |
| platform/app/src/server/suites/__tests__/plan-config.unit.test.ts | 9 | packages/features/suite/contract | 2 | 1 | specs/scenarios/run-configuration-on-runs.feature<br>specs/suites/run-plan-identity-by-name.feature |
| platform/app/src/server/suites/__tests__/target-key.unit.test.ts | 7 | packages/features/suite/contract | 1 | 0 | specs/suites/run-plan-identity-by-name.feature |
| platform/app/src/server/suites/__tests__/test-suite-run.integration.test.ts | 5 | packages/features/suite/contract | 2 | 8 | specs/suites/test-suite-run-plan-reuse.feature |
| platform/app/src/server/app-layer/suites/__tests__/suite-run.service.unit.test.ts | 4 | packages/features/suite/contract | 3 | 3 | specs/scenarios/scenario-version-on-runs.feature<br>specs/suites/run-note-metadata-convention.feature<br>specs/scenarios/scenario-run-parameters.feature |
| platform/app/src/server/suites/__tests__/suite-run-version-stamp.integration.test.ts | 2 | packages/features/suite/contract | 1 | 6 | specs/scenarios/scenario-version-on-runs.feature |
| platform/app/src/server/suites/__tests__/suite-run-actor-stamp.integration.test.ts | 1 | packages/features/suite/contract | 1 | 6 | specs/scenarios/run-actor-on-runs.feature |
| platform/app/src/server/suites/__tests__/scope.unit.test.ts | 1 | packages/features/suite/contract | 1 | 0 | specs/suites/run-plan-dynamic-scopes.feature |
| platform/app/src/server/suites/__tests__/platform-path.unit.test.ts | 1 | packages/features/suite/contract | 1 | 2 | specs/features/agent-testing/page-structure.feature |
| platform/app/src/server/langevals/__tests__/stagedFetch.unit.test.ts | 6 | packages/features/topic/server | 1 | 2 | specs/langevals-staging/staged-payload.feature |
| platform/app/src/server/evaluations/__tests__/runEvaluation.retiredEvaluator.unit.test.ts | 1 | packages/features/topic/server | 1 | 2 | specs/npx-installer/07-lean-install.feature |
| platform/app/src/server/api/routers/__tests__/annotation.integration.test.ts | 25 | packages/features/trace/contract | 7 | 6 | specs/traces-v2/anchored-comments.feature<br>specs/traces-v2/trace-edit-overlay.feature<br>specs/traces-v2/bulk-actions.feature |
| platform/app/src/server/traces/edit-overlay/__tests__/applyTraceEditOverlay.unit.test.ts | 12 | packages/features/trace/contract | 4 | 1 | specs/traces-v2/trace-edit-overlay.feature<br>specs/traces-v2/trace-edit-mode.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/subscribers/__tests__/evaluationTrigger.subscriber.unit.test.ts | 12 | packages/features/trace/contract | 5 | 2 | specs/traces/explicit-application-origin.feature<br>specs/monitors/online-evaluator-loop-prevention.feature<br>specs/evaluations/evaluation-trigger-subscriber.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/projections/services/__tests__/trace-attribute-accumulation.service.unit.test.ts | 11 | packages/features/trace/contract | 2 | 1 | specs/trace-processing/vercel-ai-telemetry-metadata.feature |
| platform/app/src/server/tracer/__tests__/buildReadableAnnotation.test.ts | 8 | packages/features/trace/contract | 1 | 0 | specs/datasets/dataset-annotations-mapping.feature<br>specs/traces-v2/trace-list-annotations-column.feature |
| platform/app/src/server/event-sourcing/pipelines/automations/process-manager/__tests__/triggerSettlementIntentHandlers.unit.test.ts | 8 | packages/features/trace/contract | 5 | 3 | specs/automations/runaway-automation-containment.feature<br>specs/automations/process-manager-dispatch.feature |
| platform/app/src/server/traces/edit-overlay/__tests__/redactTraceEditOverlayPatch.unit.test.ts | 7 | packages/features/trace/contract | 6 | 0 | specs/traces-v2/trace-edit-overlay.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/projections/__tests__/traceSummaryTraceName.unit.test.ts | 7 | packages/features/trace/contract | 5 | 2 | specs/analytics/trace-name-filter-and-group-by.feature |
| platform/app/src/server/data-privacy/__tests__/applyOtlpSpanContentDrop.unit.test.ts | 7 | packages/features/trace/contract | 1 | 3 | specs/data-privacy/content-drop.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/projections/services/__tests__/trace-io-accumulation.service.unit.test.ts | 6 | packages/features/trace/contract | 4 | 1 | specs/traces-v2/media-rendering.feature<br>specs/trace-processing/io-accumulation.feature |
| platform/app/src/server/api/routers/__tests__/sharedTrace.get.unit.test.ts | 6 | packages/features/trace/contract | 2 | 5 | packages/features/share/specs/share.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/commands/__tests__/recordSpanCommand.contentDrop.test.ts | 5 | packages/features/trace/contract | 4 | 4 | specs/data-privacy/content-drop.feature |
| platform/app/src/server/app-layer/traces/__tests__/span-cost-enrichment.service.unit.test.ts | 5 | packages/features/trace/contract | 1 | 3 | specs/model-providers/model-cost-scoping.feature<br>specs/coding-agent/cache-write-ttl-pricing.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/projections/__tests__/traceSummaryClaudeCodeLift.unit.test.ts | 4 | packages/features/trace/contract | 3 | 2 | specs/coding-agent/trace-fidelity.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/projections/__tests__/traceSummary.storageAnchor.unit.test.ts | 4 | packages/features/trace/contract | 2 | 1 | specs/traces/trace-summary-storage-anchor.feature |
| platform/app/src/server/clickhouse/__tests__/privateClickhouseDataIsolation.integration.test.ts | 4 | packages/features/trace/contract | 3 | 3 | specs/private-dataplane/data-isolation.feature |
| platform/app/src/server/app-layer/evaluations/__tests__/evaluation-execution.service.unit.test.ts | 4 | packages/features/trace/contract | 4 | 3 | specs/evaluators/absent-score-is-not-zero.feature<br>specs/monitors/online-evaluator-loop-prevention.feature |
| platform/app/src/server/traces/mappers/__tests__/redaction.privacyMetadata.unit.test.ts | 2 | packages/features/trace/contract | 2 | 0 | specs/data-privacy/content-visibility.feature<br>specs/data-privacy/content-drop.feature |
| platform/app/src/server/traces/edit-overlay/__tests__/correctedDatasetMapping.unit.test.ts | 2 | packages/features/trace/contract | 4 | 0 | specs/traces-v2/trace-edit-overlay.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/projections/__tests__/traceSummaryRefoldPolicy.unit.test.ts | 2 | packages/features/trace/contract | 7 | 1 | specs/trace-processing/hot-trace-fold-amplification.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/commands/__tests__/recordSpanCommand.test.ts | 2 | packages/features/trace/contract | 2 | 1 | specs/monitors/online-evaluator-loop-prevention.feature<br>specs/data-privacy/secrets-redaction.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/commands/__tests__/recordSpanCommand.oversized.unit.test.ts | 2 | packages/features/trace/contract | 3 | 3 | specs/trace-processing/large-trace-blob-offload.feature |
| platform/app/ee/governance/subscribers/__tests__/traceAlertTriggerMatch.subscriber.unit.test.ts | 2 | packages/features/trace/contract | 4 | 4 | specs/automations/runaway-automation-containment.feature |
| platform/app/ee/governance/services/pullers/__tests__/pullerWorkerConversationRouting.unit.test.ts | 2 | packages/features/trace/contract | 1 | 4 | specs/ai-gateway/governance/ingestion-sources.feature |
| platform/app/src/server/traces/edit-overlay/__tests__/traceMetadataEditableKeys.unit.test.ts | 1 | packages/features/trace/contract | 1 | 0 | specs/traces-v2/trace-edit-mode.feature |
| platform/app/src/server/event-sourcing/projections/foldCache/__tests__/foldCacheLeanTrace.integration.test.ts | 1 | packages/features/trace/contract | 8 | 1 | specs/trace-processing/large-trace-blob-offload.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/projections/services/span-cost.service.unit.test.ts | 1 | packages/features/trace/contract | 3 | 0 | specs/coding-agent/trace-fidelity.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/projections/services/__tests__/spanCostDerivation.unit.test.ts | 1 | packages/features/trace/contract | 2 | 3 | specs/trace-processing/codex-bundled-cost.feature |
| platform/app/src/server/app-layer/traces/__tests__/trace-list.page-window.unit.test.ts | 1 | packages/features/trace/contract | 2 | 0 | specs/components/pagination.feature |
| platform/app/src/server/app-layer/evaluations/__tests__/evaluation-execution.nativeSecrets.integration.test.ts | 1 | packages/features/trace/contract | 3 | 1 | specs/evaluators/secrets-and-redaction-aware-detection.feature |
| platform/app/src/app/api/agent-cache/__tests__/agent-cache.integration.test.ts | 19 | packages/features/trace/server | 4 | 7 | specs/agent-cache/agent-cache.feature |
| platform/app/src/server/stored-objects/__tests__/trace-media-extraction.integration.test.ts | 16 | packages/features/trace/server | 11 | 7 | specs/trace-processing/trace-media-blob-extraction.feature<br>specs/traces-v2/media-rendering.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/projections/__tests__/traceSummaryOrigin.unit.test.ts | 14 | packages/features/trace/server | 2 | 1 | specs/traces/trace-type-classification.feature<br>specs/traces/explicit-application-origin.feature |
| platform/app/src/server/tracer/__tests__/tracesMapping.test.ts | 9 | packages/features/trace/server | 2 | 0 | specs/datasets/dataset-annotations-mapping.feature<br>specs/monitors/formatted-trace-mapping.feature |
| platform/app/src/server/stored-objects/__tests__/content-extractor.unit.test.ts | 9 | packages/features/trace/server | 2 | 0 | specs/features/scenarios/externalize-event-byte-content.feature<br>specs/trace-processing/trace-media-blob-extraction.feature |
| platform/app/src/server/traces/__tests__/projection-search.integration.test.ts | 7 | packages/features/trace/server | 5 | 5 | specs/traces/trace-search-projection.feature |
| platform/app/src/app/api/traces/[[...route]]/__tests__/search-traces.unit.test.ts | 7 | packages/features/trace/server | 4 | 5 | specs/traces/trace-search-projection.feature |
| platform/app/src/app/api/traces/[[...route]]/__tests__/get-trace.unit.test.ts | 7 | packages/features/trace/server | 4 | 4 | specs/traces/partial-trace-id-resolution.feature |
| platform/app/src/server/traces/projection/__tests__/compile-projection.unit.test.ts | 6 | packages/features/trace/server | 4 | 0 | specs/traces/trace-search-projection.feature |
| platform/app/src/server/api/routers/__tests__/sharedTrace.shareSafe.unit.test.ts | 6 | packages/features/trace/server | 5 | 1 | packages/features/share/specs/share.feature<br>specs/traces-v2/sessions-lens.feature |
| platform/app/src/app/api/traces/[[...route]]/__tests__/update-metadata.unit.test.ts | 6 | packages/features/trace/server | 4 | 5 | specs/trace-processing/update-trace-metadata.feature |
| platform/app/src/server/traces/edit-overlay/__tests__/traceEditOverlay.service.unit.test.ts | 5 | packages/features/trace/server | 3 | 0 | specs/traces-v2/anchored-comments.feature<br>specs/traces-v2/trace-edit-overlay.feature |
| platform/app/src/server/traces/__tests__/trace-service-edit-overlay.unit.test.ts | 5 | packages/features/trace/server | 8 | 3 | specs/traces-v2/trace-edit-overlay.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/projections/__tests__/traceAnalytics.storageAnchor.unit.test.ts | 5 | packages/features/trace/server | 6 | 2 | specs/analytics/event-sourced-analytics-materialization.feature |
| platform/app/src/server/app-layer/traces/__tests__/coding-agent-cost-agreement.unit.test.ts | 5 | packages/features/trace/server | 7 | 4 | specs/trace-processing/coding-agent-cost.feature<br>specs/coding-agent/cache-write-ttl-pricing.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/subscribers/__tests__/loopPrevention.integration.test.ts | 4 | packages/features/trace/server | 16 | 8 | specs/monitors/online-evaluator-loop-prevention.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/projections/__tests__/traceSummary.store.persistGate.unit.test.ts | 4 | packages/features/trace/server | 4 | 0 | specs/traces/trace-summary-storage-anchor.feature |
| platform/app/src/server/app-layer/traces/repositories/__tests__/session-groups.clickhouse.repository.integration.test.ts | 4 | packages/features/trace/server | 2 | 3 | specs/traces-v2/sessions-lens.feature |
| platform/app/src/server/app-layer/traces/__tests__/model-cost-span-preview.integration.test.ts | 4 | packages/features/trace/server | 2 | 4 | specs/model-providers/model-cost-matching-spans-preview.feature<br>specs/traces-v2/span-unmapped-cost-suggestion.feature |
| platform/app/src/server/app-layer/traces/__tests__/large-trace-blob-offload.integration.test.ts | 4 | packages/features/trace/server | 7 | 2 | specs/trace-processing/large-trace-blob-offload.feature |
| platform/app/src/server/traces/__tests__/clickhouse-trace-updated-axis.integration.test.ts | 3 | packages/features/trace/server | 3 | 4 | specs/traces/trace-search-projection.feature |
| platform/app/src/server/app-layer/traces/repositories/__tests__/span-storage.clickhouse.repository.integration.test.ts | 3 | packages/features/trace/server | 3 | 1 | specs/traces-v2/trace-list-events-column.feature |
| platform/app/src/server/app-layer/clients/clickhouse/__tests__/cold-scan-detector.coverage.unit.test.ts | 3 | packages/features/trace/server | 1 | 0 | specs/ops/clickhouse-cold-scan-coverage.feature |
| platform/app/src/server/traces/__tests__/trace-service-claude-enrichment.unit.test.ts | 2 | packages/features/trace/server | 6 | 3 | specs/traces/trace-search-token-fields.feature |
| platform/app/src/server/traces/__tests__/clickhouse-trace-existence.integration.test.ts | 2 | packages/features/trace/server | 1 | 4 | specs/traces-v2/bulk-actions.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/projections/__tests__/traceSummaryCodexTokens.unit.test.ts | 2 | packages/features/trace/server | 2 | 1 | specs/coding-agent/trace-fidelity.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/__tests__/spanCommandSharding.test.ts | 2 | packages/features/trace/server | 2 | 3 | specs/trace-processing/span-command-sharding.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/__tests__/recordSpanCommand.dedup.integration.test.ts | 2 | packages/features/trace/server | 15 | 3 | specs/traces/record-span-gq-dedup.feature |
| platform/app/src/server/app-layer/usage/__tests__/usage.service.unit.test.ts | 2 | packages/features/trace/server | 7 | 5 | specs/licensing/usage-enforcement-plan-resolution.feature<br>specs/billing/usage-metering-availability.feature |
| platform/app/src/server/app-layer/traces/__tests__/edge-offload.unit.test.ts | 2 | packages/features/trace/server | 3 | 1 | specs/trace-processing/large-trace-blob-offload.feature |
| platform/app/src/server/utils/__tests__/ttlCache.unit.test.ts | 1 | packages/features/trace/server | 1 | 1 | specs/agent-cache/agent-cache.feature |
| platform/app/src/server/traces/edit-overlay/__tests__/traceEditOverlay.repository.unit.test.ts | 1 | packages/features/trace/server | 2 | 0 | specs/traces-v2/trace-edit-overlay.feature |
| platform/app/src/server/traces/__tests__/clickhouse-trace-prefix.integration.test.ts | 1 | packages/features/trace/server | 1 | 4 | specs/traces/partial-trace-id-resolution.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/projections/__tests__/traceSummaryCopilotTokens.unit.test.ts | 1 | packages/features/trace/server | 2 | 2 | specs/ai-governance/ingestion-sources/copilot-cli-otlp.feature |
| platform/app/src/server/app-layer/traces/repositories/__tests__/trace-list.clickhouse.repository.integration.test.ts | 1 | packages/features/trace/server | 4 | 2 | specs/traces-v2/data-layer.feature |
| platform/app/src/server/app-layer/traces/__tests__/trace-list.timestamp.unit.test.ts | 1 | packages/features/trace/server | 2 | 1 | specs/traces/trace-summary-storage-anchor.feature |
| platform/app/src/server/app-layer/clients/clickhouse/__tests__/windowed-read.unit.test.ts | 1 | packages/features/trace/server | 1 | 0 | specs/clickhouse/windowed-read-fallback.feature |
| platform/app/src/server/api-key/__tests__/agent-sandbox-key.unit.test.ts | 1 | packages/features/trace/server | 1 | 4 | specs/agent-cache/agent-cache.feature |
| platform/app/src/server/modelProviders/__tests__/providerValidation.unit.test.ts | 23 | packages/features/trace/web | 2 | 1 | specs/model-providers/credential-validation.feature |
| platform/app/src/server/api/routers/__tests__/roleBinding.applyMemberBindings.integration.test.ts | 9 | packages/features/trace/web | 1 | 2 | specs/members/member-access-editing.feature |
| platform/app/src/components/__tests__/SetupWithAgentButton.integration.test.tsx | 9 | packages/features/trace/web | 4 | 3 | specs/skills/empty-state-skill-setup.feature<br>specs/ai-governance/personal-portal/connect-your-agent-button.feature |
| platform/app/src/components/suites/__tests__/AllRunsPanel.integration.test.tsx | 8 | packages/features/trace/web | 5 | 3 | specs/features/suites/all-runs-group-by.feature<br>specs/features/suites/all-runs-panel.feature<br>specs/features/suites/suite-bugfixes-1956.feature |
| platform/app/src/shared/traces/__tests__/media-refs.unit.test.ts | 7 | packages/features/trace/web | 1 | 0 | specs/traces-v2/media-rendering.feature |
| platform/app/src/hooks/__tests__/useSimulationUpdateListener.unit.test.ts | 6 | packages/features/trace/web | 3 | 1 | specs/scenarios/scenario-tab-handoff.feature<br>specs/features/suites/real-time-run-updates.feature |
| platform/app/src/server/api/security/__tests__/secured-apps-rbac.integration.test.ts | 5 | packages/features/trace/web | 1 | 8 | specs/security/api-endpoint-authorization.feature |
| platform/app/src/server/modelProviders/__tests__/modelProvider.service.unit.test.ts | 4 | packages/features/trace/web | 2 | 1 | specs/model-providers/provider-configuration.feature<br>specs/model-providers/azure-safety-provider.feature |
| platform/app/src/features/errors/logic/__tests__/resolveErrorCopy.traceId.unit.test.ts | 4 | packages/features/trace/web | 1 | 0 | specs/errors/handled-error-surfaces.feature |
| platform/app/src/components/suites/__tests__/RunHistoryEmptyState.integration.test.tsx | 4 | packages/features/trace/web | 5 | 3 | specs/features/suites/suite-empty-state.feature<br>specs/scenarios/scenario-run-export.feature |
| platform/app/src/components/__tests__/MainMenu.noProject.integration.test.tsx | 4 | packages/features/trace/web | 4 | 4 | specs/navigation/project-scoped-destinations.feature |
| platform/app/src/utils/trace.test.ts | 3 | packages/features/trace/web | 1 | 0 | specs/optimization-studio/component-execution.feature |
| platform/app/src/server/api/routers/__tests__/modelProviders.getAllForProject.authz.unit.test.ts | 3 | packages/features/trace/web | 1 | 5 | specs/model-providers/provider-configuration.feature |
| platform/app/src/components/ui/__tests__/dialog-backdrop.integration.test.tsx | 3 | packages/features/trace/web | 1 | 1 | specs/features/dialog-backdrop-transparency-blur.feature |
| platform/app/src/components/sidebar/__tests__/PresenceMenuItem.unit.test.tsx | 3 | packages/features/trace/web | 2 | 1 | specs/traces-v2/presence-toggle-placement.feature |
| platform/app/src/shared/traces/__tests__/mediaParts.unit.test.ts | 2 | packages/features/trace/web | 1 | 0 | specs/traces-v2/media-rendering.feature |
| platform/app/src/hooks/__tests__/useModelProviderForm.integration.test.tsx | 2 | packages/features/trace/web | 2 | 4 | specs/model-providers/provider-configuration.feature |
| platform/app/src/features/command-bar/__tests__/commandBarAgentTesting.integration.test.tsx | 2 | packages/features/trace/web | 2 | 3 | specs/features/agent-testing/page-structure.feature |
| platform/app/src/features/briefing/components/QuietHeadline.integration.test.tsx | 2 | packages/features/trace/web | 5 | 2 | specs/home/signal-focused-home-rollout.feature |
| platform/app/src/components/executable-panel/__tests__/ExecutionOutputPanel.ifElse.integration.test.tsx | 2 | packages/features/trace/web | 2 | 2 | specs/workflows/studio-if-else-node.feature |
| platform/app/src/server/stored-objects/__tests__/value-media-extractor.unit.test.ts | 1 | packages/features/trace/web | 3 | 1 | specs/trace-processing/trace-media-blob-extraction.feature |
| platform/app/src/server/stored-objects/__tests__/media-walk-parity.unit.test.ts | 1 | packages/features/trace/web | 5 | 2 | specs/trace-processing/trace-media-blob-extraction.feature |
| platform/app/src/server/scenarios/__tests__/simulation-runner.unit.test.ts | 1 | packages/features/trace/web | 1 | 0 | specs/features/scenarios/scenario-id-format.feature |
| platform/app/src/server/modelProviders/__tests__/credentialFieldClassification.unit.test.ts | 1 | packages/features/trace/web | 2 | 1 | specs/features/platform-evaluator-and-model-provider-tools.feature |
| platform/app/src/server/api/routers/__tests__/modelProviders.getAllForProject.masking.unit.test.ts | 1 | packages/features/trace/web | 1 | 7 | specs/model-providers/provider-configuration.feature |
| platform/app/src/features/skills/logic/__tests__/setupPrompt.unit.test.ts | 1 | packages/features/trace/web | 1 | 0 | specs/skills/empty-state-skill-setup.feature |
| platform/app/src/features/errors/components/__tests__/ErrorActions.integration.test.tsx | 1 | packages/features/trace/web | 1 | 0 | specs/features/handled-error-presentation.feature |
| platform/app/src/features/command-bar/__tests__/CommandPaletteOpenChat.integration.test.tsx | 1 | packages/features/trace/web | 10 | 3 | specs/support/crisp-bubble-suppression.feature |
| platform/app/src/features/command-bar/__tests__/CommandPaletteInlinePanel.integration.test.tsx | 1 | packages/features/trace/web | 9 | 3 | specs/home/langy-home.feature |
| platform/app/src/components/suites/__tests__/SuitesPageLayout.integration.test.tsx | 1 | packages/features/trace/web | 5 | 4 | specs/features/suites/remove-redundant-suites-label.feature |
| platform/app/src/components/suites/__tests__/ExternalSetDetailPanel.integration.test.tsx | 1 | packages/features/trace/web | 4 | 3 | specs/features/suites/suite-bugfixes-1956.feature |
| platform/app/src/components/ops/featureFlags/__tests__/FeatureFlagsContent.sectionOrder.integration.test.tsx | 1 | packages/features/trace/web | 1 | 4 | specs/ops/internal-feature-flags.feature |
| platform/app/src/components/__tests__/HoverableBigText.unmount.integration.test.tsx | 1 | packages/features/trace/web | 1 | 0 | specs/components/hoverable-big-text-overflow.feature |
| platform/app/src/server/api/routers/__tests__/httpProxyTracing.integration.test.ts | 16 | packages/features/workflow/contract | 1 | 8 | specs/agents/http-agent-tracing.feature |
| platform/app/src/server/api/routers/__tests__/httpProxy.integration.test.ts | 8 | packages/features/workflow/contract | 1 | 9 | specs/agents/http-agent-test-parity.feature |
| platform/app/src/server/experiments-v3/execution/__tests__/resultMapper.test.ts | 1 | packages/features/workflow/contract | 3 | 0 | specs/experiments-v3/comparison-error-handling.feature |
| platform/app/src/server/experiments-v3/execution/__tests__/activeDatasetMappings.integration.test.ts | 1 | packages/features/workflow/contract | 3 | 4 | specs/experiments-v3/evaluation-execution.feature |
| platform/app/src/app/api/workflows/post_event/__tests__/post-event-abort.test.ts | 1 | packages/features/workflow/contract | 1 | 2 | specs/experiments-v3/execution-backend.feature |
| platform/app/src/utils/__tests__/crispBubblePolicy.unit.test.ts | 13 | packages/features/workflow/web | 1 | 0 | specs/support/crisp-bubble-suppression.feature |
| platform/app/src/components/__tests__/MissingModelToast.integration.test.tsx | 10 | packages/features/workflow/web | 1 | 2 | specs/model-providers/missing-model-popup.feature |
| platform/app/src/optimization_studio/components/properties/__tests__/EntryPointPropertiesPanel.integration.test.tsx | 8 | packages/features/workflow/web | 6 | 3 | specs/workflows/entry-point-node.feature<br>specs/workflows/run-until-here-dialog.feature |
| platform/app/src/optimization_studio/components/__tests__/RunUntilHereDialog.integration.test.tsx | 8 | packages/features/workflow/web | 4 | 0 | specs/workflows/run-until-here-dialog.feature |
| platform/app/src/components/__tests__/UpgradeModal.integration.test.tsx | 8 | packages/features/workflow/web | 1 | 7 | specs/licensing/proration-preview.feature<br>specs/rbac/lite-member-restrictions.feature |
| platform/app/src/optimization_studio/components/properties/__tests__/EndPropertiesPanel.integration.test.tsx | 7 | packages/features/workflow/web | 3 | 1 | specs/workflows/end-node-evaluator-results.feature |
| platform/app/src/optimization_studio/components/properties/__tests__/IfElsePropertiesPanel.integration.test.tsx | 5 | packages/features/workflow/web | 5 | 1 | specs/workflows/studio-if-else-node.feature |
| platform/app/src/components/run-via-api/__tests__/runSnippets.unit.test.ts | 5 | packages/features/workflow/web | 1 | 0 | specs/run-via-api/snippet-generator.feature |
| platform/app/src/features/errors/components/__tests__/HandledErrorAlert.integration.test.tsx | 4 | packages/features/workflow/web | 2 | 0 | specs/features/handled-error-presentation.feature |
| platform/app/src/__tests__/navigationDestinationsAreRouted.unit.test.ts | 4 | packages/features/workflow/web | 1 | 0 | specs/navigation/destination-route-registration.feature |
| platform/app/src/utils/__tests__/routes.unit.test.ts | 3 | packages/features/workflow/web | 1 | 0 | specs/navigation/workspace-switcher.feature |
| platform/app/src/features/errors/logic/__tests__/showErrorToast.unit.test.ts | 3 | packages/features/workflow/web | 1 | 1 | specs/features/handled-error-presentation.feature |
| platform/app/src/server/tracer/__tests__/metadataLabels.integration.test.ts | 2 | packages/features/workflow/web | 1 | 1 | specs/langy/langy-otel-tracing.feature |
| platform/app/src/components/sidebar/__tests__/SupportMenu.chatPlacement.integration.test.tsx | 2 | packages/features/workflow/web | 2 | 1 | specs/navigation/product-sidebars.feature |
| platform/app/src/utils/__tests__/trpcError.missing-model.unit.test.ts | 1 | packages/features/workflow/web | 1 | 0 | specs/model-providers/missing-model-popup.feature |
| platform/app/src/server/api/routers/__tests__/workflows.generateCommitMessage.unit.test.ts | 1 | packages/features/workflow/web | 2 | 4 | specs/model-providers/missing-model-popup.feature |
| platform/app/src/optimization_studio/components/node-selection-panel/__tests__/LlmSignatureNodeDraggable.unit.test.tsx | 1 | packages/features/workflow/web | 2 | 3 | specs/workflows/workflow-node-owned-llm.feature |
| platform/app/src/optimization_studio/components/__tests__/RunUntilHereDialog.loop.integration.test.tsx | 1 | packages/features/workflow/web | 5 | 1 | specs/workflows/run-until-here-dialog.feature |
| platform/app/src/optimization_studio/components/__tests__/ResultsPanel.integration.test.tsx | 1 | packages/features/workflow/web | 4 | 2 | specs/workflows/studio-evaluations-panel.feature |
| platform/app/src/server/event-sourcing/queues/groupQueue/__tests__/scripts.integration.test.ts | 33 | packages/group-queue | 7 | 2 | packages/group-queue/specs/tenant-soft-cap.feature<br>packages/group-queue/specs/payload-store-blob-hardening.feature<br>packages/group-queue/specs/payload-store-content-addressed.feature<br>specs/queue-pausing/queue-pausing.feature<br>packages/group-queue/specs/staged-job-id-identity.feature<br>packages/group-queue/specs/pending-counter-conservation.feature |
| platform/app/src/server/event-sourcing/queues/groupQueue/__tests__/stagedJobIdIdentity.integration.test.ts | 17 | packages/group-queue | 9 | 3 | packages/group-queue/specs/staged-job-id-identity.feature |
| platform/app/src/server/event-sourcing/queues/groupQueue/__tests__/groupQueue.poisonGuard.integration.test.ts | 9 | packages/group-queue | 5 | 2 | packages/group-queue/specs/poison-group-park-guard.feature |
| platform/app/src/server/event-sourcing/queues/groupQueue/__tests__/groupQueue.decodeDrop.integration.test.ts | 9 | packages/group-queue | 7 | 2 | packages/group-queue/specs/staged-job-id-identity.feature<br>packages/group-queue/specs/decode-drop-durability.feature |
| platform/app/src/server/event-sourcing/queues/groupQueue/__tests__/blobSweeper.integration.test.ts | 9 | packages/group-queue | 3 | 0 | packages/group-queue/specs/payload-store-content-addressed.feature |
| platform/app/src/server/event-sourcing/queues/groupQueue/__tests__/jobEnvelopeAttempt.unit.test.ts | 5 | packages/group-queue | 3 | 1 | packages/group-queue/specs/staged-job-id-identity.feature |
| platform/app/src/server/event-sourcing/queues/groupQueue/__tests__/jobEnvelope.decodeFailure.unit.test.ts | 4 | packages/group-queue | 4 | 1 | packages/group-queue/specs/decode-drop-durability.feature |
| platform/app/src/server/event-sourcing/queues/groupQueue/__tests__/blobLeases.integration.test.ts | 3 | packages/group-queue | 3 | 0 | packages/group-queue/specs/payload-store-content-addressed.feature |
| platform/app/src/server/event-sourcing/queues/groupQueue/__tests__/tenantCap.unit.test.ts | 2 | packages/group-queue | 1 | 0 | packages/group-queue/specs/tenant-soft-cap.feature |
| platform/app/src/server/event-sourcing/queues/groupQueue/__tests__/tieredBlobStore.unit.test.ts | 1 | packages/group-queue | 3 | 1 | specs/features/scenarios/externalize-event-byte-content.feature |
| platform/app/src/server/event-sourcing/queues/groupQueue/__tests__/jobEnvelope.unit.test.ts | 1 | packages/group-queue | 4 | 1 | specs/migration/object-storage-provider-migration.feature |
| platform/app/src/server/event-sourcing/queues/groupQueue/__tests__/jobEnvelope.codec.unit.test.ts | 1 | packages/group-queue | 4 | 1 | specs/migration/object-storage-provider-migration.feature |
| platform/app/src/server/event-sourcing/queues/groupQueue/__tests__/groupQueue.gq2.integration.test.ts | 1 | packages/group-queue | 3 | 2 | packages/group-queue/specs/payload-cost.feature |
| platform/app/src/server/app-layer/identity/__tests__/sso-onboarding-refusals.unit.test.ts | 2 | packages/handled-error | 1 | 0 | specs/identity/sso-onboarding-tiers.feature |
| platform/app/src/server/app-layer/identity/__tests__/legacy-sso-string-writes.unit.test.ts | 2 | packages/handled-error | 1 | 2 | specs/identity/sso-connection-lifecycle.feature<br>specs/identity/sso-onboarding-tiers.feature |
| platform/app/src/server/mailer/providers/__tests__/resolver.unit.test.ts | 10 | packages/mail | 1 | 1 | specs/ops/email-providers.feature |
| platform/app/src/server/mailer/providers/__tests__/resend.unit.test.ts | 3 | packages/mail | 2 | 1 | specs/ops/email-providers.feature |
| platform/app/src/server/mailer/__tests__/automationLimitEmail.unit.test.tsx | 3 | packages/mail | 1 | 1 | specs/automations/runaway-automation-containment.feature |
| platform/app/src/server/mailer/providers/__tests__/smtp.unit.test.ts | 2 | packages/mail | 2 | 1 | specs/ops/email-providers.feature |
| platform/app/src/server/better-auth/__tests__/passwordReset.test.ts | 2 | packages/mail | 2 | 2 | specs/auth/password-reset.feature |
| platform/app/ee/billing/__tests__/licensePurchaseHandler.unit.test.ts | 1 | packages/mail | 1 | 3 | specs/licensing/self-serving-license-purchase.feature |
| platform/app/ee/admin/__tests__/impersonation.service.unit.test.ts | 2 | packages/prisma-client | 1 | 1 | specs/identity/mfa-and-session-shape.feature |
| platform/app/src/app/api/teams/__tests__/teams-rest-api.integration.test.ts | 31 | packages/test-harness | 2 | 4 | specs/teams/teams-rest-api.feature |
| platform/app/src/server/clickhouse/__tests__/clickhouseClient.integration.test.ts | 15 | packages/test-harness | 1 | 2 | specs/private-dataplane/clickhouse-routing.feature |
| platform/app/src/server/api/routers/suites/__tests__/test-suite.router.integration.test.ts | 14 | packages/test-harness | 1 | 4 | specs/suites/test-suites.feature<br>specs/scenarios/scenario-test-suite-assignment.feature<br>specs/suites/test-suite-run-plan-reuse.feature |
| platform/app/src/server/stored-objects/__tests__/scenario-events-ingest.integration.test.ts | 12 | packages/test-harness | 2 | 8 | specs/features/scenarios/externalize-event-byte-content.feature<br>specs/scenarios/scenario-events-scoped-archive.feature |
| platform/app/src/server/stored-objects/__tests__/files-route.integration.test.ts | 10 | packages/test-harness | 2 | 7 | specs/features/scenarios/externalize-event-byte-content.feature |
| platform/app/src/server/api/routers/__tests__/traceEditOverlay.integration.test.ts | 9 | packages/test-harness | 2 | 6 | specs/traces-v2/trace-edit-overlay.feature |
| platform/app/src/app/api/workflows/__tests__/workflows-api.integration.test.ts | 9 | packages/test-harness | 1 | 7 | specs/workflows/evaluate-via-api.feature |
| platform/app/src/test-utils/__tests__/shardFailureReporter.unit.test.ts | 8 | packages/test-harness | 1 | 1 | specs/ci/unit-shard-hard-floor.feature |
| platform/app/src/server/modelProviders/__tests__/modelProvider.rowForModel.integration.test.ts | 8 | packages/test-harness | 1 | 5 | specs/model-providers/scope-and-multi-instance.feature |
| platform/app/src/server/api/routers/__tests__/organization.invites.integration.test.ts | 8 | packages/test-harness | 4 | 7 | specs/identity/resilient-invitations.feature<br>specs/members/update-pending-invitation.feature |
| platform/app/src/server/modelProviders/__tests__/modelProvider.noProject.integration.test.ts | 7 | packages/test-harness | 1 | 6 | specs/model-providers/providers-without-a-project.feature<br>specs/model-providers/credential-validation.feature |
| platform/app/src/server/modelProviders/__tests__/modelProvider.authz.integration.test.ts | 7 | packages/test-harness | 1 | 4 | specs/model-providers/scope-and-multi-instance.feature<br>specs/ai-gateway/gateway-provider-settings.feature |
| platform/app/src/server/data-privacy/__tests__/dataPrivacyPolicy.service.integration.test.ts | 7 | packages/test-harness | 1 | 6 | specs/data-privacy/policy-configuration.feature<br>specs/data-privacy/secrets-redaction.feature<br>specs/data-privacy/pii-redaction.feature |
| platform/app/src/server/agents/__tests__/connected-agent.service.integration.test.ts | 7 | packages/test-harness | 1 | 5 | specs/agents/connected-agents.feature |
| platform/app/src/app/api/scenario-events/__tests__/browser-tab-handoff.integration.test.ts | 7 | packages/test-harness | 2 | 6 | specs/scenarios/scenario-tab-handoff.feature<br>specs/features/agent-testing/page-structure.feature |
| platform/app/src/server/suites/__tests__/connected-targets.integration.test.ts | 6 | packages/test-harness | 1 | 9 | specs/agents/connected-agents.feature |
| platform/app/src/server/modelProviders/__tests__/modelDefaults.service.scopeExclusivity.integration.test.ts | 6 | packages/test-harness | 1 | 5 | specs/model-providers/model-default-config-cascade.feature |
| platform/app/src/server/agents/__tests__/agent.service.fields.integration.test.ts | 6 | packages/test-harness | 1 | 3 | specs/experiments-v3/workflow-agent-target-fields.feature |
| platform/app/src/app/api/scenarios/__tests__/scenarios-api.integration.test.ts | 6 | packages/test-harness | 1 | 5 | specs/scenarios/scenario-versioning.feature<br>specs/scenarios/scenario-api.feature |
| platform/app/src/server/organizations/__tests__/resolveCallerProjectScope.integration.test.ts | 5 | packages/test-harness | 2 | 2 | specs/coding-agent/pull-request-linkage.feature |
| platform/app/src/server/modelProviders/__tests__/modelProvider.credentialPreservation.integration.test.ts | 5 | packages/test-harness | 2 | 4 | specs/model-providers/provider-configuration.feature |
| platform/app/src/server/api/routers/suites/__tests__/suite-scope.router.integration.test.ts | 5 | packages/test-harness | 1 | 4 | specs/suites/run-plan-dynamic-scopes.feature |
| platform/app/src/server/api/routers/scenarios/__tests__/scenario-version.router.integration.test.ts | 5 | packages/test-harness | 1 | 4 | specs/scenarios/scenario-versioning.feature<br>specs/scenarios/scenario-version-restore.feature |
| platform/app/src/test-utils/__tests__/cleanupTestRows.integration.test.ts | 4 | packages/test-harness | 1 | 1 | specs/setup/test-teardown-safety.feature |
| platform/app/src/server/modelProviders/__tests__/seedOnboardingDefaults.merge.integration.test.ts | 4 | packages/test-harness | 1 | 5 | specs/model-providers/onboarding-flow.feature |
| platform/app/src/server/modelProviders/__tests__/modelProvider.deleteScope.integration.test.ts | 4 | packages/test-harness | 1 | 4 | specs/model-providers/provider-deletion.feature |
| platform/app/src/server/api/routers/__tests__/workflows.node-llm-materialization.integration.test.ts | 4 | packages/test-harness | 3 | 6 | specs/workflows/workflow-node-owned-llm.feature |
| platform/app/src/server/api/__tests__/getUserProtectionsForProject.integration.test.ts | 4 | packages/test-harness | 1 | 6 | specs/data-privacy/content-visibility.feature |
| platform/app/src/app/api/agents/__tests__/call-route.integration.test.ts | 4 | packages/test-harness | 2 | 5 | specs/agents/connected-agents.feature |
| platform/app/ee/governance/routers/__tests__/aiTools.integration.test.ts | 4 | packages/test-harness | 1 | 6 | specs/ai-governance/personal-portal/default-catalog.feature<br>specs/ai-governance/personal-portal/tool-catalog-rbac.feature<br>specs/ai-governance/personal-portal/admin-catalog-editor.feature |
| platform/app/src/server/scenarios/__tests__/scenarioSuiteModelPersistence.integration.test.ts | 3 | packages/test-harness | 1 | 3 | specs/scenarios/simulation-run-model-resolution.feature<br>specs/suites/suite-model-selection.feature<br>specs/scenarios/scenario-model-selection.feature |
| platform/app/src/server/prompt-config/__tests__/prompt-list-copy-counts.integration.test.ts | 3 | packages/test-harness | 2 | 2 | specs/prompts/prompt-list-copy-counts.feature |
| platform/app/src/server/modelProviders/__tests__/modelDefaults.read.bindingVisibility.integration.test.ts | 3 | packages/test-harness | 1 | 5 | specs/rbac/scoped-role-bindings.feature<br>specs/model-providers/role-based-default-models.feature |
| platform/app/src/server/datasets/__tests__/dataset-record-counts.integration.test.ts | 3 | packages/test-harness | 1 | 5 | specs/datasets/datasets-list-page.feature |
| platform/app/src/server/app-layer/projects/__tests__/coding-agent-activity.integration.test.ts | 3 | packages/test-harness | 1 | 4 | specs/coding-agent/project-menu-links.feature |
| platform/app/src/app/api/model-providers/__tests__/model-providers-api.integration.test.ts | 3 | packages/test-harness | 2 | 5 | specs/features/platform-evaluator-and-model-provider-tools.feature |
| platform/app/src/app/api/evaluators/__tests__/evaluators-api.integration.test.ts | 3 | packages/test-harness | 1 | 4 | specs/features/platform-evaluator-and-model-provider-tools.feature<br>specs/evaluators/evaluator-update-settings.feature |
| platform/app/src/server/scenarios/execution/__tests__/codex-coding-defaults.integration.test.ts | 2 | packages/test-harness | 3 | 4 | specs/scenarios/simulation-run-model-resolution.feature<br>specs/model-providers/codex-account-provider.feature |
| platform/app/src/server/nlpgo/__tests__/lambda-payload-staging.e2e.integration.test.ts | 2 | packages/test-harness | 1 | 1 | specs/nlp-go/lambda-invoke-payload-staging.feature |
| platform/app/src/server/modelProviders/__tests__/modelProvider.multiInstance.integration.test.ts | 2 | packages/test-harness | 1 | 3 | specs/model-providers/scope-and-multi-instance.feature |
| platform/app/src/server/app-layer/langy/__tests__/langySessionKey.integration.test.ts | 2 | packages/test-harness | 1 | 8 | specs/langy/langy-session-key.feature |
| platform/app/src/server/api/routers/__tests__/traceEditOverlay.redaction.integration.test.ts | 2 | packages/test-harness | 2 | 8 | specs/traces-v2/trace-edit-overlay.feature |
| platform/app/src/server/api/routers/__tests__/dataset.getAll.integration.test.ts | 2 | packages/test-harness | 1 | 6 | specs/datasets/datasets-list-page.feature |
| platform/app/src/app/api/agents/__tests__/connected-agents-rest.integration.test.ts | 2 | packages/test-harness | 1 | 4 | specs/agents/connected-agents.feature |
| platform/app/src/server/workflows/__tests__/runWorkflow.legacy-default-llm.integration.test.ts | 1 | packages/test-harness | 1 | 4 | specs/workflows/workflow-node-owned-llm.feature |
| platform/app/src/server/teams/__tests__/team.service.last-admin-concurrency.integration.test.ts | 1 | packages/test-harness | 1 | 2 | specs/members/member-role-team-restrictions.feature |
| platform/app/src/server/routes/__tests__/annotations-anchor-scope.integration.test.ts | 1 | packages/test-harness | 1 | 3 | specs/traces-v2/anchored-comments.feature |
| platform/app/src/server/role/__tests__/role-service-delete-bound.integration.test.ts | 1 | packages/test-harness | 2 | 4 | specs/rbac/roles-rest-api.feature |
| platform/app/src/server/modelProviders/__tests__/modelDefaults.collapseDuplicatesMigration.integration.test.ts | 1 | packages/test-harness | 1 | 1 | specs/model-providers/model-default-config-cascade.feature |
| platform/app/src/server/invites/__tests__/invite.service.createInvites.integration.test.ts | 1 | packages/test-harness | 4 | 4 | specs/organizations/organization-members-rest-api.feature |
| platform/app/src/server/app-layer/organizations/__tests__/organization.last-admin-concurrency.integration.test.ts | 1 | packages/test-harness | 2 | 1 | specs/organizations/organization-members-rest-api.feature |
| platform/app/src/app/api/projects/__tests__/projects-filtered-listing.integration.test.ts | 1 | packages/test-harness | 2 | 3 | specs/ai-governance/cli-onboarding/login-user-scoped-key.feature |
| platform/app/src/app/api/api-keys/__tests__/api-keys-management-rest-api.integration.test.ts | 1 | packages/test-harness | 3 | 4 | specs/api-keys/api-keys-management-rest-api.feature |
| platform/app/src/components/evaluations/__tests__/GuardrailsDrawer.test.tsx | 5 | packages/ui-drawer | 3 | 4 | specs/monitors/guardrails-drawer.feature |
| platform/app/src/components/__tests__/LegacyTraceDrawerRedirect.integration.test.tsx | 5 | packages/ui-drawer | 1 | 2 | specs/traces-v2/default-drawer-routing.feature |
| platform/app/src/components/evaluators/__tests__/EvaluatorTypeSelectorDrawer.azure-byok.integration.test.tsx | 4 | packages/ui-drawer | 1 | 5 | specs/evaluators/azure-safety-byok-gating.feature |
| platform/app/src/components/evaluators/__tests__/EvaluatorListDrawer.test.tsx | 4 | packages/ui-drawer | 1 | 4 | specs/evaluators/evaluator-management.feature |
| platform/app/src/components/evaluators/__tests__/CodeEvaluatorEditorDrawer.integration.test.tsx | 4 | packages/ui-drawer | 3 | 5 | specs/evaluators/evaluator-management.feature |
| platform/app/src/features/automations/providers/dataset/__tests__/client.integration.test.tsx | 3 | packages/ui-drawer | 1 | 2 | specs/automations/authoring-drawer.feature |
| platform/app/src/components/evaluators/__tests__/EvaluatorTypeSelectorDrawer.test.tsx | 3 | packages/ui-drawer | 1 | 5 | specs/evaluators/evaluator-management.feature |
| platform/app/src/hooks/__tests__/useDrawer.traceV2Routing.integration.test.ts | 1 | packages/ui-drawer | 1 | 1 | specs/traces-v2/default-drawer-routing.feature |
| platform/app/src/components/__tests__/drawerRegistry.legacyAutomation.integration.test.tsx | 1 | packages/ui-drawer | 3 | 2 | specs/automations/authoring-drawer.feature |
| platform/app/src/components/__tests__/AddOrEditDatasetDrawer.defaults.integration.test.tsx | 1 | packages/ui-drawer | 1 | 2 | specs/datasets/dataset-annotations-mapping.feature |
| platform/app/src/components/__tests__/AddAnnotationQueueDrawer.invalidation.integration.test.tsx | 1 | packages/ui-drawer | 2 | 5 | specs/traces-v2/bulk-actions.feature |
| platform/app/src/server/suites/__tests__/test-suite-membership.integration.test.ts | 23 | UNRESOLVED | 0 | 7 | specs/suites/default-suite.feature<br>specs/suites/test-suite-membership-invariant.feature<br>specs/suites/test-suites.feature<br>specs/scenarios/scenario-test-suite-assignment.feature |
| platform/app/src/server/api/routers/__tests__/virtualKeys.scopeRbac.integration.test.ts | 17 | UNRESOLVED | 0 | 6 | specs/ai-gateway/governance/vk-scope-rbac.feature |
| platform/app/src/components/__tests__/WorkspaceSwitcher.integration.test.tsx | 16 | UNRESOLVED | 0 | 3 | specs/navigation/workspace-switcher.feature |
| platform/app/src/server/api/__tests__/permission-declaration.types.unit.test.ts | 14 | UNRESOLVED | 0 | 3 | specs/rbac/typed-permission-declarations.feature |
| platform/app/ee/sso/__tests__/sso-gate.test.ts | 13 | UNRESOLVED | 0 | 6 | specs/licensing/sso-license-gating.feature<br>specs/auth/sso-oidc-providers.feature |
| platform/app/src/utils/ssrfProtection.unit.test.ts | 12 | UNRESOLVED | 0 | 1 | specs/security/ssrf-blocking.feature<br>specs/features/scenarios/on-prem-hostname-validation.feature |
| platform/app/src/server/home/__tests__/recent-items.integration.test.ts | 12 | UNRESOLVED | 0 | 5 | specs/home/recent-items-backend.feature |
| platform/app/src/server/routes/__tests__/auth-cli-personal-project.integration.test.ts | 11 | UNRESOLVED | 0 | 8 | specs/ai-governance/cli-onboarding/me-credentials.feature<br>specs/ai-governance/cli-onboarding/login-unified.feature<br>specs/ai-governance/cli-onboarding/authorize-project-picker.feature |
| platform/app/src/server/routes/__tests__/auth-cli-personal-guard.integration.test.ts | 11 | UNRESOLVED | 0 | 7 | specs/ai-gateway/governance/cli-login.feature<br>specs/ai-gateway/governance/cli-login-personal-guard.feature |
| platform/app/src/server/clickhouse/__tests__/resilientClient.unit.test.ts | 11 | UNRESOLVED | 0 | 1 | specs/analytics/clickhouse-structured-logging-alerting.feature<br>specs/analytics/clickhouse-concurrency-resilience.feature |
| platform/app/src/server/better-auth/__tests__/index.test.ts | 11 | UNRESOLVED | 0 | 1 | specs/auth/phase-1-better-auth-config.feature<br>specs/licensing/sso-license-gating.feature<br>specs/identity/mfa-and-session-shape.feature<br>specs/identity/passkeys.feature |
| platform/app/src/server/app-layer/authz/__tests__/trpc-middleware.unit.test.ts | 11 | UNRESOLVED | 0 | 3 | specs/rbac/typed-permission-declarations.feature |
| platform/app/src/server/routes/__tests__/auth-cli-login-key.integration.test.ts | 10 | UNRESOLVED | 0 | 9 | specs/ai-governance/cli-onboarding/login-user-scoped-key.feature |
| platform/app/src/server/app-layer/automations/__tests__/runaway-containment.service.integration.test.ts | 10 | UNRESOLVED | 0 | 5 | specs/automations/runaway-automation-containment.feature |
| platform/app/src/server/routes/__tests__/mcp-authorize.redirect-uri-binding.integration.test.ts | 9 | UNRESOLVED | 0 | 5 | specs/mcp-server/mcp-in-app.feature |
| platform/app/src/server/modelProviders/__tests__/resolveModelForFeature.unit.test.ts | 9 | UNRESOLVED | 0 | 1 | specs/model-providers/model-default-config-cascade.feature<br>specs/model-providers/model-resolver-and-registry.feature |
| platform/app/src/server/app-layer/traces/__tests__/audio-model-cost.unit.test.ts | 9 | UNRESOLVED | 0 | 3 | specs/trace-processing/audio-model-cost.feature |
| platform/app/src/server/app-layer/__tests__/redis-ownership.unit.test.ts | 9 | UNRESOLVED | 0 | 2 | specs/server/redis-client-ownership.feature |
| platform/app/src/utils/__tests__/lambdaFetch.unit.test.ts | 8 | UNRESOLVED | 0 | 4 | specs/nlp-go/lambda-invoke-payload-staging.feature |
| platform/app/src/utils/__tests__/evaluatorSlug.unit.test.ts | 8 | UNRESOLVED | 0 | 1 | specs/monitors/evaluator-slug.feature |
| platform/app/src/server/routes/__tests__/github-install.integration.test.ts | 8 | UNRESOLVED | 0 | 6 | specs/integrations/github-connection.feature<br>specs/coding-agent/pull-request-linkage.feature |
| platform/app/src/server/routes/__tests__/auth-cli-ingestion-key-project.integration.test.ts | 8 | UNRESOLVED | 0 | 7 | specs/ai-gateway/governance/ingest-api-key-lifecycle.feature<br>specs/ai-governance/cli-wrappers/instrument-command.feature |
| platform/app/src/server/app-layer/projects/__tests__/project-service-update.unit.test.ts | 8 | UNRESOLVED | 0 | 2 | specs/projects/edit-project-team.feature |
| platform/app/src/server/api/routers/__tests__/experiments.archive.integration.test.ts | 8 | UNRESOLVED | 0 | 7 | specs/experiments-v3/experiment-archive.feature |
| platform/app/src/server/__tests__/storage.createS3Client.unit.test.ts | 8 | UNRESOLVED | 0 | 4 | specs/features/scenarios/externalize-event-byte-content.feature |
| platform/app/src/mcp/__tests__/mcp-sse-relay.integration.test.ts | 8 | UNRESOLVED | 0 | 3 | specs/mcp-server/mcp-in-app.feature |
| platform/app/src/components/__tests__/GraphicsQualityProvider.integration.test.tsx | 8 | UNRESOLVED | 0 | 3 | specs/components/adaptive-graphics-quality.feature |
| platform/app/scripts/__tests__/check-openapi-route-coverage.unit.test.ts | 8 | UNRESOLVED | 0 | 3 | packages/api/specs/openapi-route-coverage.feature |
| platform/app/src/server/shutdown/__tests__/runGracefulShutdown.unit.test.ts | 7 | UNRESOLVED | 0 | 2 | specs/background/worker-graceful-shutdown.feature |
| platform/app/src/app/api/middleware/__tests__/dual-auth.unit.test.ts | 7 | UNRESOLVED | 0 | 3 | specs/rbac/credential-arbitration.feature |
| platform/app/src/server/shutdown/__tests__/budget.unit.test.ts | 6 | UNRESOLVED | 0 | 1 | specs/background/worker-graceful-shutdown.feature |
| platform/app/src/server/scenarios/execution/__tests__/ingest-lag.service.unit.test.ts | 6 | UNRESOLVED | 0 | 2 | specs/scenarios/remote-trace-judging.feature |
| platform/app/src/server/routes/__tests__/gateway-internal.spend-ingest.integration.test.ts | 6 | UNRESOLVED | 0 | 4 | specs/ai-gateway/billing-spend-events.feature |
| platform/app/src/server/evaluations/native/__tests__/registry.unit.test.ts | 6 | UNRESOLVED | 0 | 2 | specs/evaluators/secrets-and-redaction-aware-detection.feature |
| platform/app/src/server/connected-agents/__tests__/parameter-spec.unit.test.ts | 6 | packages/features/agent/server (services/__tests__/connected-agent-parameter-spec.service.unit.test.ts) | 0 | 1 | specs/agents/connected-agents.feature |
| platform/app/src/server/clickhouse/__tests__/schemaLock.unit.test.ts | 6 | UNRESOLVED | 0 | 1 | specs/ci/clickhouse-schema-lock.feature |
| platform/app/src/server/api/routers/__tests__/savedViews.integration.test.ts | 6 | UNRESOLVED | 0 | 6 | specs/traces/saved-views.feature |
| platform/app/src/server/api/routers/__tests__/personalVirtualKeys.scopeRbac.integration.test.ts | 6 | UNRESOLVED | 0 | 6 | specs/ai-gateway/governance/vk-scope-rbac.feature |
| platform/app/src/server/api/__tests__/authz-declaration-sweep.unit.test.ts | 6 | UNRESOLVED | 0 | 2 | specs/rbac/typed-permission-declarations.feature<br>specs/rbac/unified-authorization-engine.feature |
| platform/app/src/server/__tests__/db.guard-wiring.integration.test.ts | 6 | UNRESOLVED | 0 | 1 | specs/server/prisma-driver-adapter.feature |
| platform/app/src/components/ops/featureFlags/__tests__/FeatureFlagRulesDialog.integration.test.tsx | 6 | UNRESOLVED | 0 | 4 | specs/ops/internal-feature-flags.feature |
| platform/app/src/app/api/experiments/__tests__/cicd-execution.integration.test.ts | 6 | UNRESOLVED | 0 | 3 | specs/experiments-v3/ci-cd-execution.feature |
| platform/app/src/server/shutdown/__tests__/httpServerClosePhase.unit.test.ts | 5 | UNRESOLVED | 0 | 2 | specs/background/worker-graceful-shutdown.feature |
| platform/app/src/server/routes/__tests__/langy-api-wait-mode.unit.test.ts | 5 | UNRESOLVED | 0 | 7 | specs/langy/langy-api-key-turns.feature |
| platform/app/src/server/routes/__tests__/langy-api-refusal-chain.unit.test.ts | 5 | UNRESOLVED | 0 | 7 | specs/langy/langy-api-key-turns.feature |
| platform/app/src/server/routes/__tests__/evaluator-input-coercion.unit.test.ts | 5 | UNRESOLVED | 0 | 1 | specs/evaluators/evaluator-management.feature<br>specs/experiments-v3/evaluator-as-target.feature |
| platform/app/src/server/modelProviders/__tests__/seedOnboardingDefaults.unit.test.ts | 5 | UNRESOLVED | 0 | 1 | specs/model-providers/onboarding-flow.feature |
| platform/app/src/server/experiments/__tests__/experiment-slug-deduplication.integration.test.ts | 5 | UNRESOLVED | 0 | 3 | specs/experiments-v3/experiment-slug-deduplication.feature |
| platform/app/src/server/data-retention/__tests__/platform-default-override.unit.test.ts | 5 | UNRESOLVED | 0 | 1 | specs/data-retention/platform-default-override.feature |
| platform/app/src/server/data-privacy/__tests__/legacyPrivacyMapping.unit.test.ts | 5 | UNRESOLVED | 0 | 1 | specs/data-privacy/privacy-migration.feature |
| platform/app/src/server/better-auth/__tests__/secondaryStorage.unit.test.ts | 5 | UNRESOLVED | 0 | 3 | specs/server/redis-client-ownership.feature |
| platform/app/src/server/app-layer/langy/__tests__/langyApiKeyIdentity.unit.test.ts | 5 | UNRESOLVED | 0 | 1 | specs/langy/langy-api-key-turns.feature |
| platform/app/src/server/api/routers/__tests__/user.register.unit.test.ts | 5 | UNRESOLVED | 0 | 7 | specs/auth/signup-does-not-strand-an-account.feature<br>specs/licensing/sso-license-gating.feature<br>specs/analytics/posthog-product-milestones.feature |
| platform/app/src/server/api/routers/__tests__/team.update.lastAdminGuard.integration.test.ts | 5 | UNRESOLVED | 0 | 2 | specs/members/member-role-team-restrictions.feature |
| platform/app/src/server/api/routers/__tests__/seat-change-team-admin-guard.integration.test.ts | 5 | UNRESOLVED | 0 | 2 | specs/members/member-role-team-restrictions.feature |
| platform/app/src/server/api/routers/__tests__/prompts.duplicate.integration.test.ts | 5 | UNRESOLVED | 0 | 5 | specs/prompts/duplicate-prompt.feature |
| platform/app/src/server/api/__tests__/ops-scope-resolution.unit.test.ts | 5 | UNRESOLVED | 0 | 2 | specs/rbac/ops-scope-status-probe.feature |
| platform/app/src/hooks/__tests__/useOrgQueryParamSelection.integration.test.ts | 5 | UNRESOLVED | 0 | 2 | specs/ai-gateway/governance/org-query-param-switch.feature |
| platform/app/src/components/ops/featureFlags/__tests__/ruleEditing.unit.test.ts | 5 | UNRESOLVED | 0 | 1 | specs/ops/internal-feature-flags.feature |
| platform/app/src/app/api/experiments/__tests__/runs-list.integration.test.ts | 5 | UNRESOLVED | 0 | 2 | specs/experiments-v3/experiments-list.feature |
| platform/app/ee/webhooks/__tests__/webhookEndpoint.service.integration.test.ts | 5 | UNRESOLVED | 0 | 2 | specs/webhooks/webhook-endpoints.feature |
| platform/app/ee/webhooks/__tests__/eventRegistry.unit.test.ts | 5 | UNRESOLVED | 0 | 2 | specs/webhooks/webhook-endpoints.feature |
| platform/app/ee/governance/services/__tests__/aiToolEntry.defaultCatalog.integration.test.ts | 5 | UNRESOLVED | 0 | 3 | specs/ai-governance/personal-portal/default-catalog.feature |
| platform/app/src/utils/__tests__/filterProvidersByScope.unit.test.ts | 4 | UNRESOLVED | 0 | 1 | specs/model-providers/scope-filter.feature |
| platform/app/src/tasks/__tests__/backfillDatasetContentToS3.unit.test.ts | 4 | UNRESOLVED | 0 | 2 | specs/datasets/large-dataset-storage.feature |
| platform/app/src/server/suites/__tests__/default-suite-migration.integration.test.ts | 4 | UNRESOLVED | 0 | 3 | specs/suites/default-suite.feature |
| platform/app/src/server/scenarios/__tests__/scenario-processor-prefetch-logging.unit.test.ts | 4 | UNRESOLVED | 0 | 2 | specs/scenarios/execution-blocked-by-configuration.feature |
| platform/app/src/server/routes/__tests__/gateway-guardrail-check.integration.test.ts | 4 | UNRESOLVED | 0 | 3 | specs/ai-gateway/guardrail-check-endpoint.feature |
| platform/app/src/server/routes/__tests__/experiments-route-auth.test.ts | 4 | UNRESOLVED | 0 | 1 | specs/experiments-v3/execution-backend.feature<br>specs/experiments-v3/experiments-list.feature |
| platform/app/src/server/onboarding-checks/__tests__/onboarding-checks.integration.test.ts | 4 | UNRESOLVED | 0 | 3 | specs/home/onboarding-progress-backend.feature |
| platform/app/src/server/modelProviders/__tests__/registry.azure-safety.unit.test.ts | 4 | UNRESOLVED | 0 | 1 | specs/model-providers/azure-safety-provider.feature |
| platform/app/src/server/license-enforcement/__tests__/limit-message.unit.test.ts | 4 | UNRESOLVED | 0 | 2 | specs/features/trace-limit-upgrade-message.feature |
| platform/app/src/server/gateway/__tests__/traceDestinationBackfill.integration.test.ts | 4 | UNRESOLVED | 0 | 2 | specs/ai-gateway/virtual-key-creation.feature |
| platform/app/src/server/gateway/__tests__/budgetScopeReach.integration.test.ts | 4 | UNRESOLVED | 0 | 3 | specs/ai-gateway/budgets.feature |
| platform/app/src/server/event-sourcing/projections/global/__tests__/billableEventsDocs.unit.test.ts | 4 | UNRESOLVED | 0 | 1 | specs/billing/billable-events-copy.feature |
| platform/app/src/server/event-sourcing/pipelines/authz-grants/subscribers/__tests__/authzAuditTrail.subscriber.unit.test.ts | 4 | UNRESOLVED | 0 | 4 | specs/rbac/authz-grants.feature |
| platform/app/src/server/evaluations/__tests__/getEvaluatorModelSettingFields.unit.test.ts | 4 | UNRESOLVED | 0 | 1 | specs/evaluators/evaluator-create-model-resolution.feature |
| platform/app/src/server/clickhouse/__tests__/statementLimit.unit.test.ts | 4 | UNRESOLVED | 0 | 3 | specs/clickhouse/single-client-access.feature |
| platform/app/src/server/app-layer/automations/__tests__/runaway-containment.deps.unit.test.ts | 4 | UNRESOLVED | 0 | 6 | specs/automations/runaway-automation-containment.feature |
| platform/app/src/server/app-layer/__tests__/app-close.unit.test.ts | 4 | UNRESOLVED | 0 | 3 | specs/background/worker-graceful-shutdown.feature |
| platform/app/src/server/api/routers/__tests__/seat-change-last-team-admin.integration.test.ts | 4 | UNRESOLVED | 0 | 3 | specs/members/member-role-team-restrictions.feature |
| platform/app/src/server/api/routers/__tests__/evaluators.integration.test.ts | 4 | UNRESOLVED | 0 | 6 | specs/evaluators/evaluator-management.feature<br>specs/monitors/evaluator-slug.feature |
| platform/app/src/server/api/__tests__/rbac.fork.unit.test.ts | 4 | UNRESOLVED | 0 | 5 | specs/rbac/unified-authorization-engine.feature<br>specs/rbac/typed-permission-declarations.feature<br>specs/licensing/seat-reconciliation.feature |
| platform/app/src/server/__tests__/prismaPgAdapter.unit.test.ts | 4 | UNRESOLVED | 0 | 1 | specs/server/prisma-driver-adapter.feature |
| platform/app/src/components/ui/__tests__/toaster.integration.test.tsx | 4 | UNRESOLVED | 0 | 2 | specs/components/toasts.feature |
| platform/app/src/__tests__/env-create.unit.test.ts | 4 | UNRESOLVED | 0 | 1 | specs/features/scenarios/externalize-event-byte-content.feature<br>specs/features/setup/fresh-clone-dev-setup.feature |
| platform/app/scripts/__tests__/experiments-api-reference.unit.test.ts | 4 | UNRESOLVED | 0 | 0 | specs/api-reference/experiments-rest-api.feature |
| platform/app/ee/scim/__tests__/scim-deprovision.service.unit.test.ts | 4 | UNRESOLVED | 0 | 1 | specs/features/scim-group-mapping.feature<br>specs/identity/scim-connection-sync.feature |
| platform/app/ee/governance/services/department/__tests__/department.service.integration.test.ts | 4 | UNRESOLVED | 0 | 3 | specs/ai-gateway/governance/departments.feature |
| platform/app/src/utils/__tests__/evaluateFpsSample.unit.test.ts | 3 | UNRESOLVED | 0 | 1 | specs/components/adaptive-graphics-quality.feature |
| platform/app/src/test-utils/__tests__/typecheckProjects.unit.test.ts | 3 | UNRESOLVED | 0 | 0 | specs/setup/typescript-7.feature |
| platform/app/src/server/user-avatar/__tests__/avatar.unit.test.ts | 3 | UNRESOLVED | 0 | 1 | specs/settings/user-avatar.feature |
| platform/app/src/server/traces/__tests__/trace-usage.service.unit.test.ts | 3 | UNRESOLVED | 0 | 4 | specs/billing/usage-metering-availability.feature<br>specs/licensing/enforcement-messages.feature |
| platform/app/src/server/suites/__tests__/test-suite-vocabulary-migration.integration.test.ts | 3 | UNRESOLVED | 0 | 3 | specs/suites/test-suites.feature |
| platform/app/src/server/stored-objects/__tests__/storage-registry.unit.test.ts | 3 | UNRESOLVED | 0 | 2 | specs/features/scenarios/externalize-event-byte-content.feature |
| platform/app/src/server/stored-objects/__tests__/cross-tenant-lookup.unit.test.ts | 3 | UNRESOLVED | 0 | 3 | specs/features/scenarios/externalize-event-byte-content.feature |
| platform/app/src/server/routes/__tests__/workflows-run-not-found.integration.test.ts | 3 | UNRESOLVED | 0 | 2 | specs/run-via-api/run-workflow-typed-errors.feature |
| platform/app/src/server/modelProviders/__tests__/wireFormat.unit.test.ts | 3 | UNRESOLVED | 0 | 1 | specs/model-providers/scope-and-multi-instance.feature |
| platform/app/src/server/mailer/providers/__tests__/ses-proxy.unit.test.ts | 3 | UNRESOLVED | 0 | 2 | specs/ops/email-providers.feature |
| platform/app/src/server/experiments-v3/services/__tests__/runBoardSnapshot.integration.test.ts | 3 | UNRESOLVED | 0 | 3 | specs/experiments-v3/run-board-snapshot.feature |
| platform/app/src/server/evaluations/native/__tests__/apiKeysAndSecretsDetection.unit.test.ts | 3 | UNRESOLVED | 0 | 1 | specs/evaluators/secrets-and-redaction-aware-detection.feature |
| platform/app/src/server/app-layer/traces/__tests__/long-context-model-cost.unit.test.ts | 3 | UNRESOLVED | 0 | 3 | specs/trace-processing/long-context-model-cost.feature |
| platform/app/src/server/app-layer/suites/__tests__/suite-run-models.unit.test.ts | 3 | UNRESOLVED | 0 | 4 | specs/scenarios/resolved-run-models-on-runs.feature |
| platform/app/src/server/app-layer/github/__tests__/github-pull-request-mapping.host.unit.test.ts | 3 | UNRESOLVED | 0 | 3 | specs/integrations/github-connection.feature |
| platform/app/src/server/app-layer/github/__tests__/github-pull-request-event.unit.test.ts | 3 | UNRESOLVED | 0 | 2 | specs/coding-agent/pull-request-linkage.feature |
| platform/app/src/server/app-layer/authz/__tests__/scope-lineage-guard.unit.test.ts | 3 | UNRESOLVED | 0 | 1 | specs/rbac/typed-permission-declarations.feature |
| platform/app/src/server/app-layer/authz/__tests__/engine-gate.unit.test.ts | 3 | UNRESOLVED | 0 | 2 | specs/rbac/unified-authorization-engine.feature<br>specs/migration/authz-grants-rollout.feature |
| platform/app/src/server/app-layer/analytics/__tests__/monitor-pass-rate.integration.test.ts | 3 | UNRESOLVED | 0 | 5 | specs/analytics/evaluation-pass-rate-consistency.feature |
| platform/app/src/server/api/routers/__tests__/llmModelCosts.scopeRbac.integration.test.ts | 3 | UNRESOLVED | 0 | 6 | specs/coding-agent/cache-write-ttl-pricing.feature<br>specs/model-providers/model-cost-scoping.feature |
| platform/app/src/server/__tests__/dataplane-s3.unit.test.ts | 3 | UNRESOLVED | 0 | 1 | specs/private-dataplane/s3-routing.feature |
| platform/app/src/mcp/__tests__/mcp-streamable-reconnect.integration.test.ts | 3 | UNRESOLVED | 0 | 3 | specs/mcp-server/mcp-in-app.feature |
| platform/app/src/features/onboarding/components/sections/__tests__/ModelProviderStepScreen.integration.test.tsx | 3 | UNRESOLVED | 0 | 2 | specs/features/onboarding/model-provider-step.feature |
| platform/app/src/experiments-v3/actions/__tests__/transforms.datasets.unit.test.ts | 3 | UNRESOLVED | 0 | 2 | specs/experiments-v3/workbench-actions.feature |
| platform/app/src/components/ops/featureFlags/__tests__/targetingSummary.unit.test.ts | 3 | UNRESOLVED | 0 | 1 | specs/ops/internal-feature-flags.feature |
| platform/app/src/app/api/prompts/__tests__/prompt-tags.integration.test.ts | 3 | UNRESOLVED | 0 | 5 | specs/features/prompts/custom-prompt-tags.feature |
| platform/app/scripts/__tests__/hono-route-table.unit.test.ts | 3 | UNRESOLVED | 0 | 1 | packages/api/specs/openapi-route-coverage.feature |
| platform/app/ee/governance/services/__tests__/routingPolicy.changeEvents.integration.test.ts | 3 | UNRESOLVED | 0 | 3 | specs/ai-gateway/auth-cache.feature |
| platform/app/ee/governance/services/__tests__/departmentSpend.service.integration.test.ts | 3 | UNRESOLVED | 0 | 5 | specs/ai-gateway/governance/departments.feature |
| platform/app/src/utils/__tests__/queryRetryPolicy.unit.test.ts | 2 | UNRESOLVED | 0 | 1 | specs/licensing/proration-preview.feature |
| platform/app/src/server/suites/__tests__/test-suite-membership.unit.test.ts | 2 | UNRESOLVED | 0 | 1 | specs/suites/test-suites.feature<br>specs/suites/test-suite-membership-invariant.feature |
| platform/app/src/server/suites/__tests__/test-suite-execution-config-ui-guard.unit.test.ts | 2 | UNRESOLVED | 0 | 0 | specs/suites/test-suite-run-plan-reuse.feature |
| platform/app/src/server/suites/__tests__/suite.repository.unit.test.ts | 2 | UNRESOLVED | 0 | 1 | specs/suites/suite-archiving.feature |
| platform/app/src/server/suites/__tests__/suite-target-mappings.unit.test.ts | 2 | UNRESOLVED | 0 | 1 | specs/scenarios/scenario-input-mapping.feature |
| platform/app/src/server/stored-objects/__tests__/uri.unit.test.ts | 2 | UNRESOLVED | 0 | 1 | specs/features/scenarios/externalize-event-byte-content.feature |
| platform/app/src/server/scenarios/__tests__/scenario-versioning.unit.test.ts | 2 | UNRESOLVED | 0 | 1 | specs/scenarios/scenario-version-restore.feature<br>specs/scenarios/scenario-versioning.feature |
| platform/app/src/server/routes/__tests__/gateway-internal.health-route.integration.test.ts | 2 | UNRESOLVED | 0 | 1 | specs/ai-gateway/gateway-health.feature |
| platform/app/src/server/routes/__tests__/auth-cli-virtual-key.integration.test.ts | 2 | UNRESOLVED | 0 | 5 | specs/ai-gateway/governance/cli-login.feature |
| platform/app/src/server/rbac/__tests__/role-binding-resolver.poisoned-binding.unit.test.ts | 2 | UNRESOLVED | 0 | 1 | specs/groups/groups-rest-api.feature |
| platform/app/src/server/modelProviders/__tests__/modelProvider.repository.unit.test.ts | 2 | UNRESOLVED | 0 | 2 | specs/model-providers/scope-and-multi-instance.feature |
| platform/app/src/server/modelProviders/__tests__/llmModelCost.unit.test.ts | 2 | UNRESOLVED | 0 | 2 | specs/coding-agent/cache-write-ttl-pricing.feature |
| platform/app/src/server/event-sourcing/pipelines/trace-processing/projections/__tests__/traceAnalytics.foldEquivalence.unit.test.ts | 2 | UNRESOLVED | 0 | 2 | specs/analytics/event-sourced-analytics-materialization.feature<br>packages/eventing/specs/fold-read-back-store.feature |
| platform/app/src/server/evaluators/__tests__/codeEvaluator.unit.test.ts | 2 | UNRESOLVED | 0 | 1 | specs/evaluators/evaluator-management.feature |
| platform/app/src/server/evaluators/__tests__/codeEvaluator.errors.integration.test.ts | 2 | UNRESOLVED | 0 | 4 | specs/evaluators/evaluator-management.feature |
| platform/app/src/server/clickhouse/__tests__/schemaLock.integration.test.ts | 2 | UNRESOLVED | 0 | 0 | specs/ci/clickhouse-schema-lock.feature |
| platform/app/src/server/clickhouse/__tests__/clientAccessBoundary.unit.test.ts | 2 | UNRESOLVED | 0 | 0 | specs/clickhouse/single-client-access.feature |
| platform/app/src/server/app-layer/traces/__tests__/trace-read-derivation.service.unit.test.ts | 2 | UNRESOLVED | 0 | 1 | packages/eventing/specs/fold-coalescing.feature |
| platform/app/src/server/app-layer/permissions/__tests__/imperative.unit.test.ts | 2 | UNRESOLVED | 0 | 3 | specs/rbac/typed-permission-declarations.feature |
| platform/app/src/server/app-layer/github/__tests__/githubHost.unit.test.ts | 2 | UNRESOLVED | 0 | 2 | specs/integrations/github-connection.feature |
| platform/app/src/server/app-layer/evaluations/__tests__/monitor-performance.integration.test.ts | 2 | UNRESOLVED | 0 | 6 | specs/analytics/evaluation-pass-rate-consistency.feature |
| platform/app/src/server/api/v1/__tests__/project-service.unit.test.ts | 2 | UNRESOLVED | 0 | 5 | specs/api-reference/run-plans-rest-api.feature |
| platform/app/src/server/api/routers/__tests__/user.setPassword.unit.test.ts | 2 | UNRESOLVED | 0 | 5 | specs/identity/passkeys.feature |
| platform/app/src/server/api/routers/__tests__/user.deactivation.unit.test.ts | 2 | UNRESOLVED | 0 | 6 | specs/features/user-deactivation.feature |
| platform/app/src/server/api/routers/__tests__/project.regenerateApiKey.integration.test.ts | 2 | UNRESOLVED | 0 | 5 | specs/api-keys/project-key-rotation.feature |
| platform/app/src/server/api/routers/__tests__/apiKey.nameById.unit.test.ts | 2 | UNRESOLVED | 0 | 3 | specs/api-keys/unified-api-keys.feature |
| platform/app/src/server/api/__tests__/rbac.legacy-fallback.unit.test.ts | 2 | UNRESOLVED | 0 | 2 | specs/rbac/unified-authorization-engine.feature<br>specs/migration/authz-grants-rollout.feature |
| platform/app/src/server/api/__tests__/rbac.langy.unit.test.ts | 2 | UNRESOLVED | 0 | 1 | specs/security/api-endpoint-authorization.feature |
| platform/app/src/server/api/__tests__/public-surface.unit.test.ts | 2 | UNRESOLVED | 0 | 2 | packages/features/share/specs/share.feature |
| platform/app/src/server/api-key/__tests__/auth-middleware.org-refusals.unit.test.ts | 2 | UNRESOLVED | 0 | 3 | specs/errors/handled-error-surfaces.feature |
| platform/app/src/server/api-key/__tests__/auth-middleware.ceiling.unit.test.ts | 2 | UNRESOLVED | 0 | 6 | specs/langy/langy-session-key.feature<br>specs/rbac/credential-arbitration.feature |
| platform/app/src/server/agents/__tests__/agent-fields.unit.test.ts | 2 | UNRESOLVED | 0 | 3 | specs/experiments-v3/workflow-agent-target-fields.feature |
| platform/app/src/pages/governance/__tests__/governancePageGuards.unit.test.ts | 2 | UNRESOLVED | 0 | 1 | specs/ai-governance/rbac/delegated-governance-viewer.feature |
| platform/app/src/hooks/__tests__/useDrawer.stacking.integration.test.tsx | 2 | UNRESOLVED | 0 | 1 | specs/traces-v2/drawer-stacking.feature |
| platform/app/src/features/traces-v2/components/TraceDrawer/__tests__/attributeValueEquality.unit.test.ts | 2 | UNRESOLVED | 0 | 1 | specs/traces-v2/trace-edit-mode.feature |
| platform/app/src/experiments-v3/actions/__tests__/transforms.targets.unit.test.ts | 2 | UNRESOLVED | 0 | 2 | specs/experiments-v3/workbench-actions.feature |
| platform/app/src/experiments-v3/actions/__tests__/transforms.duplicateTarget.unit.test.ts | 2 | UNRESOLVED | 0 | 2 | specs/experiments-v3/workbench-actions.feature |
| platform/app/src/components/ui/layouts/__tests__/SectionNavigationLayout.modeSeam.integration.test.tsx | 2 | UNRESOLVED | 0 | 3 | specs/navigation/shared-section-navigation-layout.feature |
| platform/app/src/components/ui/__tests__/toaster.actionColor.unit.test.ts | 2 | UNRESOLVED | 0 | 1 | specs/components/toasts.feature |
| platform/app/src/components/ops/dashboard/__tests__/axisTicks.unit.test.ts | 2 | UNRESOLVED | 0 | 1 | specs/ops/ops-dashboard-density.feature |
| platform/app/src/components/annotations/__tests__/annotationScores.unit.test.ts | 2 | UNRESOLVED | 0 | 1 | specs/traces-v2/trace-list-annotations-column.feature |
| platform/app/src/components/__tests__/usePeriodSelector.unit.test.ts | 2 | UNRESOLVED | 0 | 1 | specs/features/suites/suite-runs-time-filter.feature |
| platform/app/src/app/api/triggers/__tests__/trigger-condition-required.integration.test.ts | 2 | UNRESOLVED | 0 | 3 | specs/automations/authoring-drawer.feature |
| platform/app/src/app/api/simulation-runs/__tests__/scenario-run-platform-url.unit.test.ts | 2 | UNRESOLVED | 0 | 2 | specs/langy/langy-agent-driven-navigation.feature |
| platform/app/ee/scim/__tests__/scim-token.service.unit.test.ts | 2 | UNRESOLVED | 0 | 1 | specs/identity/scim-connection-sync.feature |
| platform/app/ee/governance/services/activity-monitor/__tests__/ingestionSourceKeySuppression.unit.test.ts | 2 | UNRESOLVED | 0 | 4 | specs/ai-gateway/governance/ingestion-sources.feature |
| platform/app/ee/governance/services/activity-monitor/__tests__/ingestionSourceHiddenFields.unit.test.ts | 2 | UNRESOLVED | 0 | 4 | specs/ai-governance/puller-framework/databricks-genie.feature |
| platform/app/ee/governance/services/__tests__/platformIngestionTemplates.seeds.unit.test.ts | 2 | UNRESOLVED | 0 | 1 | specs/ai-governance/personal-portal/default-catalog.feature<br>specs/ai-gateway/governance/ingestion-templates-catalog.feature |
| platform/app/ee/governance/services/__tests__/cliBootstrap.orphanedAdmin.integration.test.ts | 2 | UNRESOLVED | 0 | 4 | specs/ai-gateway/governance/cli-login.feature |
| platform/app/ee/governance/__tests__/gatewayDebitsChangeEvents.unit.test.ts | 2 | UNRESOLVED | 0 | 3 | specs/ai-gateway/budgets.feature |
| platform/app/ee/event-sourcing/pipelines/pulled-usage-processing/__tests__/pulledUsagePricing.unit.test.ts | 2 | UNRESOLVED | 0 | 1 | specs/governance/pulled-usage-cost-reporting.feature |
| packages/api/src/__tests__/builder.unit.test.ts | 2 | UNRESOLVED | 0 | 0 | specs/rbac/typed-permission-declarations.feature |
| platform/app/src/utils/platformHref.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/langy/langy-agent-driven-navigation.feature |
| platform/app/src/utils/__tests__/originColors.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/traces/saved-views.feature |
| platform/app/src/server/users/__tests__/errors.unit.test.ts | 1 | UNRESOLVED | 0 | 2 | specs/auth/signup-does-not-strand-an-account.feature |
| platform/app/src/server/user-avatar/__tests__/avatar.service.unit.test.ts | 1 | UNRESOLVED | 0 | 2 | specs/settings/user-avatar.feature |
| platform/app/src/server/tracer/collector/piiCheck.dlpDisabled.unit.test.ts | 1 | UNRESOLVED | 0 | 3 | specs/setup/memory-footprint.feature |
| platform/app/src/server/suites/__tests__/test-suite-execution-settings-migration.integration.test.ts | 1 | UNRESOLVED | 0 | 3 | specs/suites/test-suite-run-plan-reuse.feature |
| platform/app/src/server/stored-objects/__tests__/no-retention-gc.unit.test.ts | 1 | UNRESOLVED | 0 | 0 | specs/features/scenarios/externalize-event-byte-content.feature |
| platform/app/src/server/stored-objects/__tests__/inactive-azure-s3-traffic.integration.test.ts | 1 | UNRESOLVED | 0 | 7 | specs/migration/object-storage-provider-migration.feature |
| platform/app/src/server/scenarios/__tests__/scenario.processor.otel-isolation.integration.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/scenarios/simulation-runner.feature |
| platform/app/src/server/scenarios/__tests__/scenario.integration.test.ts | 1 | UNRESOLVED | 0 | 4 | specs/scenarios/scenario-run-parameters.feature |
| platform/app/src/server/routes/_lib/__tests__/internal-secret.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/security/api-endpoint-authorization.feature |
| platform/app/src/server/routes/__tests__/workflows-post-event-model-not-set.integration.test.ts | 1 | UNRESOLVED | 0 | 4 | specs/workflows/workflow-node-owned-llm.feature |
| platform/app/src/server/routes/__tests__/sso-oidc-signin.integration.test.ts | 1 | UNRESOLVED | 0 | 0 | specs/auth/sso-oidc-providers.feature |
| platform/app/src/server/routes/__tests__/internal-routes-auth.integration.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/security/api-endpoint-authorization.feature |
| platform/app/src/server/routes/__tests__/experiments-results-archived.test.ts | 1 | UNRESOLVED | 0 | 8 | specs/experiments-v3/experiment-archive.feature |
| platform/app/src/server/routes/__tests__/evaluations-legacy-skipped-cost.integration.test.ts | 1 | UNRESOLVED | 0 | 7 | specs/experiments/comparison.feature |
| platform/app/src/server/routes/__tests__/auth-cli-budget-status.integration.test.ts | 1 | UNRESOLVED | 0 | 5 | specs/ai-gateway/cli-token-revoke-on-deactivation.feature |
| platform/app/src/server/rbac/__tests__/role-binding-resolver.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/rbac/scoped-role-bindings.feature |
| platform/app/src/server/rbac/__tests__/role-binding-resolver.ceiling.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/api-keys/scope-based-permissions.feature |
| platform/app/src/server/modelProviders/__tests__/modelNotConfiguredError.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/evaluators/evaluator-create-model-resolution.feature |
| platform/app/src/server/modelProviders/__tests__/geminiDoor.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/model-providers/google-agent-platform.feature |
| platform/app/src/server/modelProviders/__tests__/deprecatedProviderCreate.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/model-providers/google-agent-platform.feature |
| platform/app/src/server/gateway/__tests__/gatewayJwt.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/ai-gateway/virtual-key-lifecycle.feature |
| platform/app/src/server/featureFlag/__tests__/featureFlagStore.postgres.unit.test.ts | 1 | UNRESOLVED | 0 | 2 | specs/trace-processing/large-trace-blob-offload.feature |
| platform/app/src/server/event-sourcing/pipelines/gateway-spend-processing/__tests__/spendSettlement.integration.test.ts | 1 | UNRESOLVED | 0 | 0 | specs/ai-gateway/billing-spend-events.feature |
| platform/app/src/server/event-sourcing/pipelines/authz-grants/projections/__tests__/authzGrantsWrite.projection.unit.test.ts | 1 | UNRESOLVED | 0 | 2 | specs/rbac/authz-grants.feature |
| platform/app/src/server/event-sourcing/pipelines/authz-grants/__tests__/wireInvariants.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/rbac/authz-grants.feature |
| platform/app/src/server/event-sourcing/__tests__/projectionMetadata.unit.test.ts | 1 | UNRESOLVED | 0 | 2 | specs/ops/state-projection-visibility.feature |
| platform/app/src/server/evaluations/__tests__/evaluation.inputs.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/traces-v2/evaluation-inputs-lazy-load.feature |
| platform/app/src/server/data-retention/__tests__/retroactiveUpdate.unit.test.ts | 1 | UNRESOLVED | 0 | 2 | specs/data-retention/pr-4147-regressions.feature |
| platform/app/src/server/data-retention/__tests__/pinnedTrace.unit.test.ts | 1 | UNRESOLVED | 0 | 2 | specs/data-retention/pr-4147-regressions.feature |
| platform/app/src/server/data-privacy/__tests__/dataPrivacyPolicy.authz.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/data-privacy/policy-configuration.feature |
| platform/app/src/server/clickhouse/__tests__/managedClient.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/clickhouse/single-client-access.feature |
| platform/app/src/server/clickhouse/__tests__/clientImportBoundary.unit.test.ts | 1 | UNRESOLVED | 0 | 0 | specs/private-dataplane/clickhouse-routing.feature |
| platform/app/src/server/clickhouse/__tests__/aggregatingDimensions.integration.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/clickhouse/aggregating-rollup-dimensions.feature |
| platform/app/src/server/auth/__tests__/permissions.unit.test.ts | 1 | UNRESOLVED | 0 | 4 | specs/errors/handled-error-surfaces.feature |
| platform/app/src/server/app-layer/projects/__tests__/projectSlug.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/navigation/gateway-url-move.feature |
| platform/app/src/server/app-layer/permissions/__tests__/permissions.facade.unit.test.ts | 1 | UNRESOLVED | 0 | 3 | specs/rbac/typed-permission-declarations.feature |
| platform/app/src/server/app-layer/langy/ui-actions/__tests__/handlerFailedRemediation.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/langy/langy-ui-actions.feature |
| platform/app/src/server/app-layer/evaluations/repositories/__tests__/evaluation-run.resolver-window.unit.test.ts | 1 | UNRESOLVED | 0 | 2 | specs/clickhouse/bounded-reads.feature |
| platform/app/src/server/app-layer/evaluations/repositories/__tests__/evaluation-analytics.logLevel.unit.test.ts | 1 | UNRESOLVED | 0 | 0 | specs/observability/retryable-failure-log-level.feature |
| platform/app/src/server/app-layer/automations/__tests__/matchEverything.unit.test.ts | 1 | UNRESOLVED | 0 | 3 | specs/automations/authoring-drawer.feature |
| platform/app/src/server/app-layer/authz/__tests__/engine-gate-reporting.unit.test.ts | 1 | UNRESOLVED | 0 | 3 | specs/rbac/unified-authorization-engine.feature |
| platform/app/src/server/app-layer/authz/__tests__/engine-gate-browser-safety.unit.test.ts | 1 | UNRESOLVED | 0 | 0 | specs/rbac/authz-grants.feature |
| platform/app/src/server/api/routers/__tests__/storedObjects.probePermission.integration.test.ts | 1 | UNRESOLVED | 0 | 7 | specs/traces-v2/media-rendering.feature |
| platform/app/src/server/api/routers/__tests__/secrets.reserved-names.unit.test.ts | 1 | UNRESOLVED | 0 | 6 | specs/security/api-endpoint-authorization.feature |
| platform/app/src/server/api/routers/__tests__/publicEnv.test.ts | 1 | UNRESOLVED | 0 | 3 | specs/licensing/sso-license-gating.feature |
| platform/app/src/server/api/routers/__tests__/monitors.preconditionValidation.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/monitors/online-evaluation-preconditions.feature |
| platform/app/src/server/api/routers/__tests__/github.access-order.unit.test.ts | 1 | UNRESOLVED | 0 | 8 | specs/security/api-endpoint-authorization.feature |
| platform/app/src/server/api/routers/__tests__/agents.integration.test.ts | 1 | UNRESOLVED | 0 | 6 | specs/agents/agent-test-run.feature |
| platform/app/src/server/api/__tests__/modelNotConfigured.trpc.unit.test.ts | 1 | UNRESOLVED | 0 | 2 | specs/model-providers/model-resolver-and-registry.feature |
| platform/app/src/server/api-key/__tests__/api-key.service.verify-mint.unit.test.ts | 1 | UNRESOLVED | 0 | 5 | specs/rbac/authz-grants.feature |
| platform/app/src/server/__tests__/subscriptionHandler.unit.test.ts | 1 | UNRESOLVED | 0 | 3 | specs/licensing/subscription-handler-integration.feature |
| platform/app/src/server/__tests__/scim-schemas-access-groups.integration.test.ts | 1 | UNRESOLVED | 0 | 0 | specs/api-reference/scim-api-reference.feature |
| platform/app/src/server/__tests__/env-mode-guard.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/setup/memory-footprint.feature |
| platform/app/src/server/__tests__/db.lazy.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/server/prisma-driver-adapter.feature |
| platform/app/src/pages/settings/__tests__/integrations-github-error.integration.test.tsx | 1 | UNRESOLVED | 0 | 7 | specs/integrations/github-connection.feature |
| platform/app/src/optimization_studio/utils/__tests__/datasetUtils.unit.test.ts | 1 | UNRESOLVED | 0 | 2 | specs/experiments-v3/mapping-source-types.feature |
| platform/app/src/hooks/__tests__/traceDrawerV2Routing.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/traces-v2/default-drawer-routing.feature |
| platform/app/src/hooks/__tests__/isOrgScopedPermission.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/webhooks/webhook-endpoints.feature |
| platform/app/src/features/traces-v2/components/TraceDrawer/terminalView/__tests__/injectedNotice.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/coding-agent/terminal-view.feature |
| platform/app/src/features/automations/state/__tests__/subFlow.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/automations/authoring-drawer.feature |
| platform/app/src/features/automations/state/__tests__/subFlow.integration.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/automations/authoring-drawer.feature |
| platform/app/src/experiments-v3/actions/__tests__/transforms.mappings.unit.test.ts | 1 | UNRESOLVED | 0 | 2 | specs/experiments-v3/workbench-actions.feature |
| platform/app/src/components/ui/layouts/__tests__/SectionNavigationLayout.browser.test.tsx | 1 | UNRESOLVED | 0 | 1 | specs/navigation/shared-section-navigation-layout.feature |
| platform/app/src/components/ui/__tests__/drawer-backdrop.integration.test.tsx | 1 | UNRESOLVED | 0 | 2 | specs/features/drawer-backdrop-transparency-blur.feature |
| platform/app/src/components/agents/__tests__/getAgentEditorDrawer.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/features/scenarios/workflow-agent-mapping-layer.feature |
| platform/app/src/components/__tests__/ModelMultiSelect.displayName.integration.test.tsx | 1 | UNRESOLVED | 0 | 3 | specs/model-providers/custom-model-display-name.feature |
| platform/app/src/app/api/experiments/__tests__/create-broadcast.integration.test.ts | 1 | UNRESOLVED | 0 | 5 | specs/experiments-v3/workbench-versioning.feature |
| platform/app/scripts/__tests__/scim-api-reference.unit.test.ts | 1 | UNRESOLVED | 0 | 2 | specs/api-reference/scim-api-reference.feature |
| platform/app/ee/webhooks/__tests__/webhookDelivery.ladder.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/webhooks/webhook-endpoints.feature |
| platform/app/ee/webhooks/__tests__/deliveryControls.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/webhooks/webhook-endpoints.feature |
| platform/app/ee/scim/__tests__/scim-discovery-policy.integration.test.ts | 1 | UNRESOLVED | 0 | 2 | specs/api-reference/scim-api-reference.feature |
| platform/app/ee/governance/services/activity-monitor/__tests__/traceDestinationTenancy.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/ai-gateway/governance/ingestion-sources.feature |
| platform/app/ee/governance/services/__tests__/ingestionKey.rotation.unit.test.ts | 1 | UNRESOLVED | 0 | 4 | specs/api-keys/ingest-key-rotation-latency.feature |
| platform/app/ee/governance/services/__tests__/ingestionKey.resolution.integration.test.ts | 1 | UNRESOLVED | 0 | 4 | specs/ai-gateway/governance/ingest-api-key-lifecycle.feature |
| platform/app/ee/governance/services/__tests__/cliTokenRevocation.service.integration.test.ts | 1 | UNRESOLVED | 0 | 4 | specs/ai-gateway/cli-token-revoke-on-deactivation.feature |
| platform/app/ee/governance/__tests__/governanceDelivery.unit.test.ts | 1 | UNRESOLVED | 0 | 1 | specs/webhooks/webhook-endpoints.feature |

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  AUTHZ_AGGREGATE_READ_EVENT_TYPE,
  authzAggregateReadEventDataSchema,
} from "@langwatch/authz-contract";
import {
  SCIM_COST_CENTER_CHANGED_EVENT_TYPE,
  scimCostCenterChangedEventDataSchema,
} from "@langwatch/enterprise-scim-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  ORGANIZATION_CREATED_EVENT_TYPE,
  organizationCreatedEventDataSchema,
  type OrganizationCreatedEventData,
  ORGANIZATION_MEMBER_DEPARTMENT_CHANGED_EVENT_TYPE,
  ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
  organizationMemberDepartmentChangedEventDataSchema,
  organizationMemberDisabledEventDataSchema,
  organizationMemberEnabledEventDataSchema,
  organizationMemberRemovedEventDataSchema,
} from "@langwatch/organization-contract";
import {
  PROJECT_AGGREGATE_RULE_CHANGED_EVENT_TYPE,
  PROJECT_ARCHIVED_EVENT_TYPE,
  PROJECT_CREATED_EVENT_TYPE,
  PROJECT_DEPARTMENT_ASSIGNED_EVENT_TYPE,
  PROJECT_REVIVED_EVENT_TYPE,
  projectAggregateRuleChangedEventDataSchema,
  projectArchivedEventDataSchema,
  projectCreatedEventDataSchema,
  projectDepartmentAssignedEventDataSchema,
  projectRevivedEventDataSchema,
} from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";

import type { GovernanceModule } from "../app/governance.app.ts";
import type { GovernanceRepositories } from "../repositories/governance.repositories.ts";
import { auditAggregateRead } from "./aggregate-read-audit.subscriber.ts";
import {
  OutboxAggregateReconcile,
  runAggregateReconcile,
  runAggregateSweep,
} from "./aggregate-reconcile.intent.ts";
import {
  AGGREGATE_RECONCILE_INITIAL_STATE,
  AGGREGATE_RECONCILE_INTENT,
  AGGREGATE_RECONCILE_MAX_ATTEMPTS,
  AGGREGATE_RECONCILE_PROCESS_NAME,
  AGGREGATE_SWEEP_INTENT,
  AGGREGATE_SWEEP_INTERVAL_MS,
  aggregateReconcileIntentSchema,
  aggregateReconcileStateSchema,
  aggregateSweepIntentSchema,
  aggregateSweepWake,
} from "./aggregate-reconcile.process.ts";
import {
  enqueueAffectedAggregates,
  enqueueChangedAggregate,
  enqueueMemberAggregates,
} from "./aggregate-reconcile.subscriber.ts";
import { pruneAnomalyAlertDeliveries } from "./anomaly-alert-delivery.intent.ts";
import {
  ANOMALY_ALERT_DELIVERY_INITIAL_STATE,
  ANOMALY_ALERT_DELIVERY_MAX_ATTEMPTS,
  ANOMALY_ALERT_DELIVERY_PROCESS_NAME,
  ANOMALY_ALERT_DELIVERY_PRUNE_INTENT,
  ANOMALY_ALERT_DELIVERY_PRUNE_INTERVAL_MS,
  ANOMALY_ALERT_DELIVERY_REQUEST_INTENT,
  anomalyAlertDeliveryIntentSchema,
  anomalyAlertDeliveryPruneSchema,
  anomalyAlertDeliveryPruneWake,
  anomalyAlertDeliveryStateSchema,
} from "./anomaly-alert-delivery.process.ts";
import { runGovernanceTraceFacts } from "./governance-trace-facts.intent.ts";
import {
  GOVERNANCE_TRACE_FACTS_INITIAL_STATE,
  GOVERNANCE_TRACE_FACTS_INTERVAL_MS,
  GOVERNANCE_TRACE_FACTS_PROCESS_NAME,
  governanceTraceFactsPassSchema,
  governanceTraceFactsStateSchema,
  governanceTraceFactsWake,
} from "./governance-trace-facts.process.ts";
import { assignScimCostCenterDepartment } from "./scim-cost-center.subscriber.ts";
import { runSpendSpikeEvaluation } from "./spend-spike-evaluation.intent.ts";
import {
  SPEND_SPIKE_EVALUATION_INITIAL_STATE,
  SPEND_SPIKE_EVALUATION_INTERVAL_MS,
  SPEND_SPIKE_EVALUATION_PROCESS_NAME,
  spendSpikeEvaluationPassSchema,
  spendSpikeEvaluationStateSchema,
  spendSpikeEvaluationWake,
} from "./spend-spike-evaluation.process.ts";

export const GOVERNANCE_ACTIVITY_MONITOR_PIPELINE_NAME = "governance_activity_monitor";

/** Seeds only an organization with no entries, so a redelivered fact seeds nothing twice. */
export function seedDefaultAiToolCatalog({
  catalog,
}: {
  catalog: Pick<GovernanceModule, "aiToolEnsureDefaultCatalog">;
}): (data: OrganizationCreatedEventData) => Promise<void> {
  return async ({ organizationId }) => {
    await catalog.aiToolEnsureDefaultCatalog({ organizationId });
  };
}

/**
 * `global`: one pass evaluates every spend_spike rule; one pulls every tenant's governance traces.
 * A created organization gets the standard AI-tool catalogue, and a SCIM cost center its
 * department, from governance's own side (§9).
 */
function buildGovernanceActivityMonitor({
  app,
  processStore,
}: EventingSetup<
  unknown,
  Pick<
    GovernanceModule,
    | "evaluateSpendSpikes"
    | "connectAnomalyAlertOutbox"
    | "requestAnomalyAlertDelivery"
    | "pullGovernanceTraceFacts"
    | "aiToolEnsureDefaultCatalog"
    | "departmentResolveByNameOrCreate"
    | "departmentAssignUser"
    | "aggregateReconciler"
    | "connectAggregateReconcileOutbox"
    | "governanceAuditWorkspaceView"
  >
>): StaticPipelineDefinition<never> {
  app.connectAnomalyAlertOutbox({ processStore });
  app.connectAggregateReconcileOutbox({ processStore });
  const reconciler = app.aggregateReconciler;
  const aggregateOutbox = OutboxAggregateReconcile.create(processStore);
  const affected = (trigger: string) =>
    enqueueAffectedAggregates({ reconciler, outbox: aggregateOutbox, trigger });
  const memberChanged = (trigger: string) =>
    enqueueMemberAggregates({ reconciler, outbox: aggregateOutbox, trigger });
  return (
    definePipeline({
      name: GOVERNANCE_ACTIVITY_MONITOR_PIPELINE_NAME,
      aggregate: defineAggregate({ type: "global" }),
    })
      .withEvents([])
      .withPeerSubscriber("seedDefaultAiToolCatalog", {
        eventType: ORGANIZATION_CREATED_EVENT_TYPE,
        data: organizationCreatedEventDataSchema,
        handle: seedDefaultAiToolCatalog({ catalog: app }),
      })
      .withPeerSubscriber("assignScimCostCenterDepartment", {
        eventType: SCIM_COST_CENTER_CHANGED_EVENT_TYPE,
        data: scimCostCenterChangedEventDataSchema,
        handle: assignScimCostCenterDepartment({ departments: app }),
      })
      .withProcessManager(SPEND_SPIKE_EVALUATION_PROCESS_NAME, (pm) =>
        pm
          .state(spendSpikeEvaluationStateSchema, SPEND_SPIKE_EVALUATION_INITIAL_STATE)
          .schedule({ everyMs: SPEND_SPIKE_EVALUATION_INTERVAL_MS })
          .onWake(spendSpikeEvaluationWake)
          .intent(
            "pass",
            spendSpikeEvaluationPassSchema,
            runSpendSpikeEvaluation({
              evaluate: () => app.evaluateSpendSpikes(),
              deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
              now: () => nowInstant().epochMilliseconds,
            }),
          )
          // One pass at a time; an open alert per rule keeps a repeated pass from firing twice.
          .outbox({ maxAttempts: 1, concurrency: 1, batchSize: 1, leaseDurationMs: 5 * 60 * 1000 }),
      )
      .withProcessManager(ANOMALY_ALERT_DELIVERY_PROCESS_NAME, (pm) =>
        pm
          .state(anomalyAlertDeliveryStateSchema, ANOMALY_ALERT_DELIVERY_INITIAL_STATE)
          .intent(
            ANOMALY_ALERT_DELIVERY_REQUEST_INTENT,
            anomalyAlertDeliveryIntentSchema,
            (intent, context) => app.requestAnomalyAlertDelivery(intent, context),
          )
          .intent(
            ANOMALY_ALERT_DELIVERY_PRUNE_INTENT,
            anomalyAlertDeliveryPruneSchema,
            pruneAnomalyAlertDeliveries(processStore),
          )
          .schedule({ everyMs: ANOMALY_ALERT_DELIVERY_PRUNE_INTERVAL_MS })
          .onWake(anomalyAlertDeliveryPruneWake)
          .outbox({ maxAttempts: ANOMALY_ALERT_DELIVERY_MAX_ATTEMPTS }),
      )
      .withProcessManager(GOVERNANCE_TRACE_FACTS_PROCESS_NAME, (pm) =>
        pm
          .state(governanceTraceFactsStateSchema, GOVERNANCE_TRACE_FACTS_INITIAL_STATE)
          .schedule({ everyMs: GOVERNANCE_TRACE_FACTS_INTERVAL_MS })
          .onWake(governanceTraceFactsWake)
          .intent(
            "pass",
            governanceTraceFactsPassSchema,
            runGovernanceTraceFacts({
              pull: (window) => app.pullGovernanceTraceFacts(window),
              deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
              now: () => nowInstant().epochMilliseconds,
            }),
          )
          // A failed window is re-driven whole; its rows replace by key.
          .outbox({
            maxAttempts: 10,
            concurrency: 1,
            batchSize: 1,
            leaseDurationMs: 5 * 60 * 1000,
          }),
      )
      // M8487-RECONCILE-PM: project facts enqueue the aggregates they touch; each reconciles under its lock.
      .withPeerSubscriber("reconcileAggregatesOnProjectCreated", {
        eventType: PROJECT_CREATED_EVENT_TYPE,
        data: projectCreatedEventDataSchema,
        handle: affected("project-created"),
      })
      .withPeerSubscriber("reconcileAggregatesOnProjectArchived", {
        eventType: PROJECT_ARCHIVED_EVENT_TYPE,
        data: projectArchivedEventDataSchema,
        handle: affected("project-archived"),
      })
      .withPeerSubscriber("reconcileAggregatesOnDepartmentAssigned", {
        eventType: PROJECT_DEPARTMENT_ASSIGNED_EVENT_TYPE,
        data: projectDepartmentAssignedEventDataSchema,
        handle: affected("department-assigned"),
      })
      .withPeerSubscriber("reconcileAggregatesOnProjectRevived", {
        eventType: PROJECT_REVIVED_EVENT_TYPE,
        data: projectRevivedEventDataSchema,
        handle: affected("project-revived"),
      })
      .withPeerSubscriber("reconcileAggregateOnRuleChanged", {
        eventType: PROJECT_AGGREGATE_RULE_CHANGED_EVENT_TYPE,
        data: projectAggregateRuleChangedEventDataSchema,
        handle: enqueueChangedAggregate({ outbox: aggregateOutbox }),
      })
      .withPeerSubscriber("reconcileAggregatesOnMemberRemoved", {
        eventType: ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
        data: organizationMemberRemovedEventDataSchema,
        handle: memberChanged("member-removed"),
      })
      .withPeerSubscriber("reconcileAggregatesOnMemberDepartmentChanged", {
        eventType: ORGANIZATION_MEMBER_DEPARTMENT_CHANGED_EVENT_TYPE,
        data: organizationMemberDepartmentChangedEventDataSchema,
        handle: memberChanged("member-department-changed"),
      })
      // M8487-DISABLED-SEAT: a disabled seat reconciles like a removal.
      .withPeerSubscriber("reconcileAggregatesOnMemberDisabled", {
        eventType: ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
        data: organizationMemberDisabledEventDataSchema,
        handle: memberChanged("member-disabled"),
      })
      // M8487-MEMBER-ENABLED: a seat given back reconciles the same way, so the project rejoins.
      .withPeerSubscriber("reconcileAggregatesOnMemberEnabled", {
        eventType: ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE,
        data: organizationMemberEnabledEventDataSchema,
        handle: memberChanged("member-enabled"),
      })
      // M8487-AUDIT-PIPELINE: authz's aggregate-read fact becomes the admin workspace view row.
      .withPeerSubscriber("auditAggregateRead", {
        eventType: AUTHZ_AGGREGATE_READ_EVENT_TYPE,
        data: authzAggregateReadEventDataSchema,
        handle: auditAggregateRead({ views: app }),
      })
      .withProcessManager(AGGREGATE_RECONCILE_PROCESS_NAME, (pm) =>
        pm
          .state(aggregateReconcileStateSchema, AGGREGATE_RECONCILE_INITIAL_STATE)
          .intent(
            AGGREGATE_RECONCILE_INTENT,
            aggregateReconcileIntentSchema,
            runAggregateReconcile(reconciler),
          )
          .intent(
            AGGREGATE_SWEEP_INTENT,
            aggregateSweepIntentSchema,
            runAggregateSweep({
              reconciler,
              outbox: aggregateOutbox,
              deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
              now: () => nowInstant().epochMilliseconds,
            }),
          )
          .schedule({ everyMs: AGGREGATE_SWEEP_INTERVAL_MS })
          .onWake(aggregateSweepWake)
          .outbox({ maxAttempts: AGGREGATE_RECONCILE_MAX_ATTEMPTS }),
      )
      .build()
  );
}

export const governanceActivityMonitorEventing = defineEventingModule({
  pipeline: GOVERNANCE_ACTIVITY_MONITOR_PIPELINE_NAME,
  build: (setup: EventingSetup<GovernanceRepositories, GovernanceModule>) =>
    buildGovernanceActivityMonitor(setup),
});

import type {
  NotificationCadence,
  TriggerAction,
  TriggerSummary,
} from "@langwatch/automation-contract";
import {
  triggerFiltersNeedEvaluation,
  NOTIFY_TRIGGER_ACTIONS,
} from "@langwatch/automation-contract";
import {
  AutomationTraceTriggerCatalogue,
  type AutomationTriggerMatchRecorder,
} from "@langwatch/automation-server";
import type { TriggerContext } from "@langwatch/eventing";
import {
  OtelTraceAlertMetricsAdapter,
  type TraceAlertTriggerMatchChannel,
  TraceAlertTriggerMatchSubscriber,
  type GovernanceTraceEvent,
  type TraceAlertOriginGuard,
  type TraceAlertTriggerReader,
  type GovernanceTraceSummary,
  type TraceAlertTrigger,
} from "@langwatch/enterprise-governance-server";
import type { TraceProcessingEvent, TraceSummaryData } from "@langwatch/trace-contract";
import { passesTraceOriginGuards } from "@langwatch/trace-server";

/**
 * For every trace, asks which automations watch and writes one MATCH per
 * automation. Key blockers are now cleared.
 */
export function createWorkerTraceAlertTriggerHandler(options: {
  triggers: AutomationTraceTriggerCatalogue;
  matches: AutomationTriggerMatchRecorder;
}): (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) => Promise<void> {
  const subscriber = TraceAlertTriggerMatchSubscriber.create({
    triggers: new WorkerTraceAlertTriggerAdapter(options.triggers),
    matches: new WorkerTraceAlertTriggerMatchAdapter(options.matches),
    originGuard: new WorkerTraceAlertOriginGuardAdapter(),
    metrics: OtelTraceAlertMetricsAdapter.create(),
  });

  return (event, context) =>
    subscriber.handle(event, context as TriggerContext<GovernanceTraceSummary>);
}

/**
 * Renames a project's trace automations onto the shape the subscriber reads.
 *
 * The explicit return type is load-bearing: without it `actionClass` widens to
 * `string` and this stops satisfying the port, which the compiler would report
 * far from here.
 */
class WorkerTraceAlertTriggerAdapter implements TraceAlertTriggerReader {
  constructor(private readonly catalogue: AutomationTraceTriggerCatalogue) {}

  async activeForProject(projectId: string): Promise<TraceAlertTrigger[]> {
    const triggers = await this.catalogue.getActiveTraceTriggersForProject(projectId);
    return triggers.map((trigger: TriggerSummary) => ({
      id: trigger.id,
      action: trigger.action,
      actionClass: NOTIFY_TRIGGER_ACTIONS.has(trigger.action)
        ? ("notify" as const)
        : ("persist" as const),
      traceDebounceMs: trigger.traceDebounceMs,
      notificationCadence: trigger.notificationCadence,
      // An automation whose condition can only be answered after an evaluation
      // is left to the evaluation pipeline. Matching it here would test a
      // result that does not exist yet, so it would never fire at all.
      hasEvaluationFilters: triggerFiltersNeedEvaluation(trigger.filters),
    }));
  }
}

/**
 * Writes one durable match; the casts round-trip validated values through the
 * port.
 */
class WorkerTraceAlertTriggerMatchAdapter implements TraceAlertTriggerMatchChannel {
  constructor(private readonly matches: AutomationTriggerMatchRecorder) {}

  async send(input: {
    tenantId: string;
    occurredAt: number;
    triggerId: string;
    traceId: string;
    action: string;
    actionClass: "notify" | "persist";
    traceDebounceMs: number;
    notificationCadence: string | null;
  }): Promise<void> {
    await this.matches.send({
      ...input,
      action: input.action as TriggerAction,
      notificationCadence: input.notificationCadence as NotificationCadence,
    });
  }
}

/**
 * The same origin guard every other trace subscriber runs behind.
 *
 * It is the package's own function rather than a re-statement, and that matters
 * for one reason above the rest: it is what keeps a topic-clustering re-emit
 * over thousands of historical traces from re-firing every alert a customer has
 * ever configured.
 */
class WorkerTraceAlertOriginGuardAdapter implements TraceAlertOriginGuard {
  passes(input: { event: GovernanceTraceEvent; state: GovernanceTraceSummary }): boolean {
    return passesTraceOriginGuards(input.event, input.state as TraceSummaryData);
  }
}

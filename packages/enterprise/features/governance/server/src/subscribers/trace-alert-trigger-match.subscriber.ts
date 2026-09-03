import type {
  GovernanceTraceContext,
  GovernanceTraceEvent,
} from "../ports/governance-subscriber.port";
import {
  TraceAlertMetricsPort,
  TraceAlertOriginGuardPort,
  TraceAlertTriggerMatchPort,
  TraceAlertTriggerPort,
} from "../ports/governance-subscriber.port";

export class TraceAlertTriggerMatchSubscriber {
  private constructor(
    private readonly triggers: TraceAlertTriggerPort,
    private readonly matches: TraceAlertTriggerMatchPort,
    private readonly originGuard: TraceAlertOriginGuardPort,
    private readonly metrics: TraceAlertMetricsPort,
  ) {}

  static create(options: {
    triggers: TraceAlertTriggerPort;
    matches: TraceAlertTriggerMatchPort;
    originGuard: TraceAlertOriginGuardPort;
    metrics: TraceAlertMetricsPort;
  }): TraceAlertTriggerMatchSubscriber {
    return new TraceAlertTriggerMatchSubscriber(
      options.triggers,
      options.matches,
      options.originGuard,
      options.metrics,
    );
  }

  async handle(
    event: GovernanceTraceEvent,
    context: GovernanceTraceContext,
  ): Promise<void> {
    if (!this.originGuard.passes({ event, state: context.state })) return;
    if (!context.aggregateId) return;

    const triggers = await this.triggers.activeForProject(context.tenantId);
    let recorded = 0;
    for (const trigger of triggers) {
      if (trigger.hasEvaluationFilters) continue;
      await this.matches.send({
        tenantId: context.tenantId,
        occurredAt: event.occurredAt,
        triggerId: trigger.id,
        traceId: context.aggregateId,
        action: trigger.action,
        actionClass: trigger.actionClass,
        traceDebounceMs: trigger.traceDebounceMs,
        notificationCadence: trigger.notificationCadence,
      });
      recorded++;
    }
    this.metrics.countRecorded(recorded);
  }
}

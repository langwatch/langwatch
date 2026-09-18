import {
  type GovernanceTraceContext,
  type GovernanceTraceEvent,
  type TraceAlertMetricsSink,
  type TraceAlertOriginGuard,
  type TraceAlertTriggerMatchChannel,
  type TraceAlertTriggerReader,
} from "../app/governance.members.ts";

export class TraceAlertTriggerMatchSubscriber {
  private constructor(
    private readonly triggers: TraceAlertTriggerReader,
    private readonly matches: TraceAlertTriggerMatchChannel,
    private readonly originGuard: TraceAlertOriginGuard,
    private readonly metrics: TraceAlertMetricsSink,
  ) {}

  static create(options: {
    triggers: TraceAlertTriggerReader;
    matches: TraceAlertTriggerMatchChannel;
    originGuard: TraceAlertOriginGuard;
    metrics: TraceAlertMetricsSink;
  }): TraceAlertTriggerMatchSubscriber {
    return new TraceAlertTriggerMatchSubscriber(
      options.triggers,
      options.matches,
      options.originGuard,
      options.metrics,
    );
  }

  async handle(event: GovernanceTraceEvent, context: GovernanceTraceContext): Promise<void> {
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

import { AppGovernanceKpisAdapter } from "@langwatch/enterprise-api/governance/governance-kpis.adapter";
import { AppGovernanceOcsfEventsAdapter } from "@langwatch/enterprise-api/governance/governance-ocsf-events.adapter";
import {
  GOVERNANCE_KPIS_SYNC_WINDOW_MS,
  GOVERNANCE_OCSF_EVENTS_SYNC_WINDOW_MS,
  GovernanceKpisSubscriber,
  GovernanceOcsfSubscriber,
  type GovernanceSubscriberDiagnosticsSink,
  type GovernanceTraceContext,
  type GovernanceTraceEvent,
} from "@langwatch/enterprise-governance-server";
import { throttledWindow, type SubscriberSpec, type TriggerContext } from "@langwatch/eventing";
import { createLogger, type Logger } from "@langwatch/observability";
import type { TraceProcessingEvent, TraceSummaryData } from "@langwatch/trace-contract";

// Two Governance roll-ups (KPIs and OCSF events) built as full subscriber
// specs here so the OSS trace pipeline doesn't import @ee
export type WorkerGovernanceRollups = {
  governanceKpisSync: SubscriberSpec<TraceProcessingEvent> & { fold: "traceSummary" };
  governanceOcsfEventsSync: SubscriberSpec<TraceProcessingEvent> & { fold: "traceSummary" };
};

export function createWorkerGovernanceRollups(options: {
  /** The tenant-keyed ClickHouse client this process resolves everything through. */
  resolveClickHouseClient: (tenantId: string) => Promise<unknown>;
  logger?: Logger;
}): WorkerGovernanceRollups {
  const diagnostics = new WorkerGovernanceSubscriberDiagnostics(
    options.logger ?? createLogger("langwatch:trace-processing:governance-subscribers"),
  );
  const resolveClient = options.resolveClickHouseClient as never;

  const kpis = GovernanceKpisSubscriber.create({
    contributions: new AppGovernanceKpisAdapter(resolveClient),
    diagnostics,
  });
  const ocsf = GovernanceOcsfSubscriber.create({
    events: new AppGovernanceOcsfEventsAdapter(resolveClient),
    diagnostics,
  });

  return {
    governanceKpisSync: {
      fold: "traceSummary" as const,
      when: (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) =>
        kpis.when(event, context as unknown as GovernanceTraceContext),
      ...throttledWindow<TraceProcessingEvent>({
        makeId: (event) => `${event.tenantId}:${event.aggregateId}`,
        windowMs: GOVERNANCE_KPIS_SYNC_WINDOW_MS,
      }),
      handler: (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) =>
        kpis.handle(event, context as unknown as GovernanceTraceContext),
    },
    governanceOcsfEventsSync: {
      fold: "traceSummary" as const,
      when: (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) =>
        ocsf.when(event, context as unknown as GovernanceTraceContext),
      ...throttledWindow<TraceProcessingEvent>({
        makeId: (event) => `${event.tenantId}:${event.aggregateId}`,
        windowMs: GOVERNANCE_OCSF_EVENTS_SYNC_WINDOW_MS,
      }),
      handler: (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) =>
        ocsf.handle(event, context as unknown as GovernanceTraceContext),
    },
  };
}

// Reports row write failures; logs and continues so a KPI failure doesn't
// fail the trace fold that produced it
class WorkerGovernanceSubscriberDiagnostics implements GovernanceSubscriberDiagnosticsSink {
  constructor(private readonly logger: Logger) {}

  warn(input: { code: string; tenantId: string; traceId: string }): void {
    this.logger.warn(input, input.code);
  }

  capture(error: unknown): void {
    this.logger.error({ error }, "governance subscriber projection failed");
  }
}

/** Re-exported for the composition root's own event typing. */
export type { GovernanceTraceEvent };

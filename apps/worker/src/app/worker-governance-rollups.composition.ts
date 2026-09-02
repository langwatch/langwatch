import { AppGovernanceKpisAdapter } from "@langwatch/enterprise-api/governance/governance-kpis.adapter";
import { AppGovernanceOcsfEventsAdapter } from "@langwatch/enterprise-api/governance/governance-ocsf-events.adapter";
import {
  GOVERNANCE_KPIS_SYNC_WINDOW_MS,
  GOVERNANCE_OCSF_EVENTS_SYNC_WINDOW_MS,
  GovernanceKpisSubscriber,
  GovernanceOcsfSubscriber,
  GovernanceSubscriberDiagnosticsPort,
  type GovernanceTraceContext,
  type GovernanceTraceEvent,
} from "@langwatch/enterprise-governance-server";
import { throttledWindow, type SubscriberSpec, type TriggerContext } from "@langwatch/eventing";
import { createLogger, type Logger } from "@langwatch/observability";
import type { TraceProcessingEvent, TraceSummaryData } from "@langwatch/trace-contract";

/**
 * The two Governance roll-ups that ride the trace fold.
 *
 * `reactor:governanceKpisSync` writes one hour-bucketed spend and token
 * contribution per governed trace; `reactor:governanceOcsfEventsSync` writes
 * the SIEM export row a customer's security team reads. Both are in the
 * byte-frozen registry, so a consumer that omitted them would leave two kinds
 * of work redelivering forever — which is why they are MOUNTED here rather
 * than left as the "honest absence" the definition's optional parameters would
 * otherwise permit.
 *
 * THEY ARE FULL SUBSCRIBER SPECS BY THE TIME THE PIPELINE SEES THEM, and that
 * is the whole reason this file exists: the OSS trace pipeline must not import
 * `@ee`, so the composition root builds the two specs — window, predicate and
 * handler — and hands them over as data.
 *
 * THE WINDOW IS THE FEATURE'S OWN. Both roll-ups throttle per trace on a
 * constant the governance package exports, not a number chosen here: while
 * both graphs ingest, a window spelled differently on either side would write
 * two contributions for one trace and double a customer's reported spend.
 */
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

/**
 * Where a governance roll-up reports a row it could not write.
 *
 * It LOGS and continues rather than raising, which is the subscribers' own
 * contract: a KPI contribution that fails must not fail the trace fold that
 * produced it. The application additionally forwards the error to its capture
 * sink; this process has none, so the log line is the whole record — and
 * saying so here is better than composing a capture that swallows.
 */
class WorkerGovernanceSubscriberDiagnostics extends GovernanceSubscriberDiagnosticsPort {
  constructor(private readonly logger: Logger) {
    super();
  }

  warn(input: { code: string; tenantId: string; traceId: string }): void {
    this.logger.warn(input, input.code);
  }

  capture(error: unknown): void {
    this.logger.error({ error }, "governance subscriber projection failed");
  }
}

/** Re-exported for the composition root's own event typing. */
export type { GovernanceTraceEvent };

import type { CanonicalLogRecord } from "@langwatch/log-contract";
import type { CanonicalMetricDataPoint } from "@langwatch/metric-contract";
import { createLogger } from "@langwatch/observability";
import type { NormalizedSpan, SpanReceivedEventData, TraceApi } from "@langwatch/trace-contract";
import { decodeOtlpSpan } from "@langwatch/trace-contract/otlp-decoding";

import { liftLogContribution } from "../rules/coding-agent-log-facts.rules.ts";
import { liftMetricContribution } from "../rules/coding-agent-metric-facts.rules.ts";
import { liftSpanContribution } from "../rules/coding-agent-span-facts.rules.ts";
import type { CodingAgentCommandDispatcherService } from "./coding-agent-command-dispatcher.service.ts";

const logger = createLogger("langwatch:coding-agent:received-facts");

/** Lifts received spans, log records and metric points into session facts (main's dispatch). */
export class CodingAgentReceivedFactsService {
  private constructor(
    private readonly traces: TraceApi,
    private readonly commands: CodingAgentCommandDispatcherService,
  ) {}

  static create({
    traces,
    commands,
  }: {
    traces: TraceApi;
    commands: CodingAgentCommandDispatcherService;
  }): CodingAgentReceivedFactsService {
    return new CodingAgentReceivedFactsService(traces, commands);
  }

  /** Decodes with trace's contract decoder, canonicalises through trace's API as ingest does. */
  async contributeReceivedSpan({
    tenantId,
    occurredAt,
    data,
  }: {
    tenantId: string;
    occurredAt: number;
    data: SpanReceivedEventData;
  }): Promise<void> {
    let span: NormalizedSpan;
    try {
      span = this.decodeCanonicalSpan({ tenantId, data });
    } catch (error) {
      // Completing quietly beats blocking the trace's whole group on one unreadable span.
      logger.error(
        { tenantId, traceId: String(data.span.traceId), error },
        "codingAgentSpanFactsDispatch: span failed decoding; completing without contributing",
      );
      return;
    }
    await this.commands.contributeSpanFacts(liftSpanContribution({ tenantId, occurredAt, span }));
  }

  private decodeCanonicalSpan({
    tenantId,
    data,
  }: {
    tenantId: string;
    data: SpanReceivedEventData;
  }): NormalizedSpan {
    const span = decodeOtlpSpan({
      tenantId,
      otlpSpan: data.span,
      otlpResource: data.resource,
      otlpInstrumentationScope: data.instrumentationScope,
    });
    const canonical = this.traces.canonicalizeSpanAttributes({
      spanAttributes: span.spanAttributes,
      events: span.events,
      span,
    });
    return { ...span, spanAttributes: canonical.attributes, events: canonical.events };
  }

  async contributeReceivedLogRecord(record: CanonicalLogRecord): Promise<void> {
    const lifted = liftLogContribution({ record, traces: this.traces });
    if (lifted.outcome === "ignored") return;
    await this.commands.contributeLogFacts(lifted.contribution);
  }

  async contributeReceivedMetricPoint(point: CanonicalMetricDataPoint): Promise<void> {
    const lifted = liftMetricContribution(point);
    if (lifted.outcome === "ignored") return;
    await this.commands.contributeMetricFacts(lifted.contribution);
  }
}

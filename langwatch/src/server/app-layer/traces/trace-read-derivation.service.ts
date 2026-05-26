import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { SpanCostService } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/span-cost.service";
import {
  deriveScenarioRoleMetricsFromSpans,
  type ScenarioRoleMetrics,
} from "~/server/event-sourcing/pipelines/trace-processing/projections/services/scenario-role-metrics.derivation";
import {
  deriveTraceEventsFromSpans,
  type DerivedTraceEvent,
} from "~/server/event-sourcing/pipelines/trace-processing/projections/services/trace-events.derivation";

/** Minimal span reader this service needs (satisfied by SpanStorageService). */
export interface NormalizedSpanReader {
  getNormalizedSpansByTraceId(params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<NormalizedSpan[]>;
}

interface DeriveParams {
  tenantId: string;
  traceId: string;
  occurredAtMs?: number;
}

/**
 * Derives trace-summary fields that used to be accumulated on the hot fold
 * path. Moving them here keeps the fold O(1) per span: scenario role
 * cost/latency are computed from stored_spans once, when simulation metrics
 * are needed, instead of being maintained per-span for every trace on the
 * platform. See scenario-role-metrics.derivation.ts for the aggregation logic
 * and its parity with the legacy incremental fold.
 */
export class TraceReadDerivationService {
  private readonly spanCostService = new SpanCostService();

  constructor(private readonly spans: NormalizedSpanReader) {}

  async deriveScenarioRoleMetrics(
    params: DeriveParams,
  ): Promise<ScenarioRoleMetrics> {
    const spans = await this.spans.getNormalizedSpansByTraceId(params);
    return deriveScenarioRoleMetricsFromSpans({
      spans,
      spanCostService: this.spanCostService,
    });
  }

  async deriveEvents(params: DeriveParams): Promise<DerivedTraceEvent[]> {
    const spans = await this.spans.getNormalizedSpansByTraceId(params);
    return deriveTraceEventsFromSpans(spans);
  }
}

/**
 * @see ADR-097
 * The trace span a settled realtime voice session leaves, via the shared ingestion seam.
 */
import type { GatewayRealtimeSessionRecord, SpendUsage } from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import type { Instant } from "@langwatch/time";
import { DEFAULT_PII_REDACTION_LEVEL } from "@langwatch/trace-contract";

import {
  settlementSpanAttributes,
  settlementSpanId,
} from "../../../rules/gateway-realtime-settlement-span.rules.ts";

const logger = createLogger("langwatch:gateway:realtime-settlement-span");

/** The span name a settled voice session appears under in the trace explorer. */
const SPAN_NAME = "realtime.session.settled";

/**
 * Writes one already-normalized span (the gateway's voice-settlement span)
 * through the same seam OTLP and REST route through, so its dedup gate makes
 * a resent webhook write the span once rather than adding a second cost.
 */
export interface GatewaySpanIngestion {
  ingestNormalizedSpan(input: {
    tenantId: string;
    span: {
      traceId: string;
      spanId: string;
      name: string;
      kind: number;
      startTimeUnixNano: string;
      endTimeUnixNano: string;
      attributes: unknown[];
      events: unknown[];
      links: unknown[];
      status: { message: string | null; code: number | null };
      droppedAttributesCount: number;
      droppedEventsCount: number;
      droppedLinksCount: number;
    };
    resource: null;
    instrumentationScope: null;
    piiRedactionLevel: string;
  }): Promise<void>;
}

export class GatewayRealtimeSettlementSpanService {
  static create(): GatewayRealtimeSettlementSpanService {
    return new GatewayRealtimeSettlementSpanService();
  }

  private constructor() {}

  /**
   * Records what a voice session used, in the trace the mint opened. Never throws: the money is
   * already on the spend record by the time this runs, so a failure here costs a visible number
   * rather than a charge, and raising would roll back an already-accepted settlement.
   */
  async recordRealtimeSessionSpan(params: {
    session: GatewayRealtimeSessionRecord;
    usage: SpendUsage;
    costNanoUsd: number;
    durationMs: number;
    occurredAt: Instant;
    /**
     * Absent on a deployment that composes no trace storage. The settlement
     * span is then not written, which is the honest answer: there is no trace
     * to write it into. The spend record is unaffected either way.
     */
    spanIngestion?: GatewaySpanIngestion | undefined;
  }): Promise<void> {
    const { session } = params;
    // No trace means the mint predates the trace id being carried, or the
    // request arrived with no trace context. Inventing a trace here would put a
    // cost in the explorer under an id nothing else references.
    if (!session.traceId) {
      return;
    }

    const endMs = params.occurredAt.epochMilliseconds;
    const startMs = Math.max(0, endMs - Math.max(0, params.durationMs));
    const attributes = settlementSpanAttributes({
      session,
      usage: params.usage,
      costNanoUsd: params.costNanoUsd,
    });

    try {
      // ingestNormalizedSpan, not the raw command — the seam both OTLP and REST
      // collectors route through, whose (tenant, trace, span) dedup gate makes
      // a resent webhook or retried usage report write this span once, not
      // twice. `traceIngestion`, not `traces`: App.traces is a read-only TraceModule,
      // and reaching for traces?.collection silently no-ops with no span written.
      if (!params.spanIngestion) {
        return;
      }

      await params.spanIngestion.ingestNormalizedSpan({
        tenantId: session.projectId,
        span: {
          traceId: session.traceId,
          spanId: settlementSpanId(session.id),
          name: SPAN_NAME,
          kind: 3,
          startTimeUnixNano: String(startMs * 1_000_000),
          endTimeUnixNano: String(endMs * 1_000_000),
          attributes,
          events: [],
          links: [],
          status: { message: null, code: null },
          droppedAttributesCount: 0,
          droppedEventsCount: 0,
          droppedLinksCount: 0,
        },
        resource: null,
        instrumentationScope: null,
        piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
      });
    } catch (error) {
      logger.warn(
        { error, sessionId: session.id },
        "a voice session settled but its cost was not written to the trace; the spend record is unaffected",
      );
    }
  }
}

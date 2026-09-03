/**
 * Writes one already-normalized span into the deployment's trace storage.
 *
 * The gateway emits exactly one span of its own — the settlement of a brokered
 * voice session — and it goes through the same normalized-span seam the OTLP
 * and REST collectors route through, so its (tenant, trace, span) dedup gate
 * makes a resent webhook write the span once rather than adding a second cost
 * to the trace.
 */
export abstract class GatewaySpanIngestionPort {
  abstract ingestNormalizedSpan(input: {
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

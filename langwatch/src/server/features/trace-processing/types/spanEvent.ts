import type { Event } from "../library";
import type { SpanIngestionWriteJobData } from "../../span-ingestion/types";

/**
 * Event representing a span that was ingested.
 * In our this case, spans are the "events" that drive projection aggregation.
 */
export interface SpanEvent extends Event<string> {
  aggregateId: string; // traceId
  timestamp: number;
  type: "span.ingested";
  data: SpanIngestionWriteJobData;
  metadata?: {
    tenantId: string;
    collectedAtUnixMs: number;
  };
}

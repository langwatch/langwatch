import type { PIIRedactionLevel } from "~/server/event-sourcing/trace-processing/schema";
import type { OtlpInstrumentationScope, OtlpResource, OtlpSpan } from "./otlp";

/**
 * The ingest envelope for one span, carried from the OTLP edge to the worker
 * that normalizes and canonicalises it. Still raw wire — `CanonicalSpan` is
 * what the `recordSpan` command accepts.
 */
export interface RecordSpanCommandData {
  tenantId: string;
  span: OtlpSpan;
  resource: OtlpResource | null;
  instrumentationScope: OtlpInstrumentationScope | null;
  piiRedactionLevel?: PIIRedactionLevel;
  occurredAt: number;
  /**
   * ADR-099: over `COMMAND_INLINE_THRESHOLD` the edge spools the full span to
   * S3 and sets this to the object key, leaving `span` with its identifying
   * fields only. The worker fetches the spool, reconstitutes, then deletes it.
   */
  spoolRef?: string;
}

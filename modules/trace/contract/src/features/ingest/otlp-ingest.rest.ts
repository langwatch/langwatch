/**
 * The OTLP receiver's own errors and small pure helpers. Ports live in the
 * server transport file instead, keeping this contract free of the DOM-lib
 * `Request` dependency neither the browser SDK nor another module needs.
 */
import type {
  OtlpIngestCredential,
  OtlpIngestCredentialInput,
  OtlpIngestProject,
} from "@langwatch/otlp/door";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";

export type OtlpTraceCollectionResult = Readonly<{
  rejectedSpans?: number;
  /** Spans that failed to dispatch (queue outage) — transient, unlike drops. */
  ingestionFailures?: number;
  ingestionFailureMessage?: string;
  errorMessage?: string;
}>;

/** OTLP operations are part of Trace's one public process API. */
/** One OTLP trace export, for the tenant it belongs to. */
export type OtlpTracesInput = {
  tenantId: string;
  traceRequest: IExportTraceServiceRequest;
  /**
   * In-process backfill only (seed plan Q1 (a)): admits spans up to this many days old, at most
   * `SPAN_BACKFILL_MAX_PAST_DAYS`, instead of `SPAN_MAX_PAST_MS`. The OTLP door never sets it.
   */
  backfillMaxPastDays?: number;
};

export type TraceOtlpIngestApi = Readonly<{
  otlpCredential(input: OtlpIngestCredentialInput): Promise<OtlpIngestCredential>;
  otlpMarkCredentialUsed(input: { apiKeyId: string }): void;
  otlpUsageLimit(input: { project: OtlpIngestProject; customerTraceIds: string[] }): Promise<void>;
  otlpTraces(input: OtlpTracesInput): Promise<OtlpTraceCollectionResult>;
}>;

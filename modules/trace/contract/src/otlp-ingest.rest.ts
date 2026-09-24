/**
 * The OTLP receiver's own errors and small pure helpers. Ports live in the
 * server transport file instead, keeping this contract free of the DOM-lib
 * `Request` dependency neither the browser SDK nor another module needs.
 */
import { HandledError } from "@langwatch/handled-error";
import type { OtlpReceiverPolicy } from "@langwatch/otlp";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";

export type OtlpIngestCredentialInput = Readonly<{
  authorization: string | null;
  xAuthToken: string | null;
  xProjectId: string | null;
}>;

export type OtlpIngestProject = Readonly<{
  id: string;
  teamId: string;
  organizationId: string;
}>;

export type OtlpIngestIdentity = Readonly<{
  apiKeyId: string | null;
  organizationId: string;
  ingestSourceType: string | null;
  ingestionTemplateId: string | null;
  sourcePolicy?:
    | { status: "ready"; policies: Record<"traces" | "logs" | "metrics", OtlpReceiverPolicy> }
    | { status: "failed"; error: unknown };
}>;

/** A resolved receiver credential; a refusal is thrown, and the receiver renders it. */
export type OtlpIngestCredential = Readonly<{
  project: OtlpIngestProject;
  identity: OtlpIngestIdentity;
}>;

export type OtlpTraceCollectionResult = Readonly<{
  rejectedSpans?: number;
  /** Spans that failed to dispatch (queue outage) — transient, unlike drops. */
  ingestionFailures?: number;
  ingestionFailureMessage?: string;
  errorMessage?: string;
}>;

export type OtlpLogCollectionOutcome =
  | Readonly<{
      outcome: "collected";
      rejectedLogRecords: number;
      errorMessage?: string | undefined;
    }>
  | Readonly<{ outcome: "unavailable"; errorMessage: string }>
  | Readonly<{ outcome: "not-served"; errorMessage: string }>;

export type OtlpMetricCollectionOutcome =
  | Readonly<{
      outcome: "collected";
      rejectedDataPoints: number;
      errorMessage?: string | undefined;
    }>
  | Readonly<{ outcome: "unavailable"; errorMessage: string }>
  | Readonly<{ outcome: "not-served"; errorMessage: string }>;

/** OTLP operations are part of Trace's one public process API. */
export type TraceOtlpIngestApi = Readonly<{
  otlpCredential(input: OtlpIngestCredentialInput): Promise<OtlpIngestCredential>;
  otlpMarkCredentialUsed(input: { apiKeyId: string }): void;
  otlpUsageLimit(input: { project: OtlpIngestProject; customerTraceIds: string[] }): Promise<void>;
  otlpTraces(input: {
    tenantId: string;
    traceRequest: IExportTraceServiceRequest;
  }): Promise<OtlpTraceCollectionResult>;
  otlpLogs(input: {
    tenantId: string;
    organizationId: string;
    logRequest: unknown;
  }): Promise<OtlpLogCollectionOutcome>;
  otlpMetrics(input: {
    tenantId: string;
    organizationId: string;
    metricRequest: unknown;
  }): Promise<OtlpMetricCollectionOutcome>;
  otlpReportError(
    error: Error,
    context: Readonly<{ projectId: string; customerTraceIds: string[] }>,
  ): void;
}>;

/**
 * An ingestion key arrived on a process that resolves no source billing.
 */
export class OtlpIngestSourceBillingUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(sourceType: string) {
    super(
      "service_unavailable",
      "This deployment cannot resolve the billing treatment for an ingestion key's source, so it will not record traffic sent on one.",
      {
        meta: { sourceType },
        httpStatus: 503,
        fault: "platform",
        retryable: true,
      },
    );
    this.name = "OtlpIngestSourceBillingUnavailableError";
  }
}

/**
 * Classifies a token by prefix without exposing the value. `sk-lw-` keys
 * classify as `legacy` — the ingest discriminator lives on the resolved row,
 * not the token prefix.
 */
export function classifyTokenType(token: string): "pat" | "legacy" | "unknown" {
  if (token.startsWith("pat-lw-")) return "pat";
  if (token.startsWith("sk-lw-")) return "legacy";
  return "unknown";
}

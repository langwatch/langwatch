/**
 * The OTLP receiver's own errors and small pure helpers. Ports live in the
 * server transport file instead, keeping this contract free of the DOM-lib
 * `Request` dependency neither the browser SDK nor another module needs.
 */
import type { OtlpSourcePolicy } from "@langwatch/otlp";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import { z } from "zod";

/** The exporter base a `/v1/traces` suffix was appended to; the receiver checks it. */
export const otlpTraceAliasParamsSchema = z.object({ otlpBase: z.string() });

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
  sourcePolicy?: OtlpSourcePolicy;
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

/** OTLP operations are part of Trace's one public process API. */
export type TraceOtlpIngestApi = Readonly<{
  otlpCredential(input: OtlpIngestCredentialInput): Promise<OtlpIngestCredential>;
  otlpMarkCredentialUsed(input: { apiKeyId: string }): void;
  otlpUsageLimit(input: { project: OtlpIngestProject; customerTraceIds: string[] }): Promise<void>;
  otlpTraces(input: {
    tenantId: string;
    traceRequest: IExportTraceServiceRequest;
  }): Promise<OtlpTraceCollectionResult>;
  otlpReportError(
    error: Error,
    context: Readonly<{ projectId: string; customerTraceIds: string[] }>,
  ): void;
}>;

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

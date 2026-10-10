/**
 * The OTLP receiver's own errors and small pure helpers. Ports live in the
 * server transport file instead, keeping this contract free of the DOM-lib
 * `Request` dependency neither the browser SDK nor another module needs.
 */
import { otlpSourcePolicySchema } from "@langwatch/otlp/door";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import { z } from "zod";

/** The exporter base a `/v1/traces` suffix was appended to; the receiver checks it. */
export const otlpTraceAliasParamsSchema = z.object({ otlpBase: z.string() });

export type OtlpIngestCredentialInput = Readonly<{
  authorization: string | null;
  xAuthToken: string | null;
  xProjectId: string | null;
}>;

const otlpIngestProjectSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  organizationId: z.string(),
});
export type OtlpIngestProject = Readonly<z.infer<typeof otlpIngestProjectSchema>>;

/** A resolved receiver credential, handed by the OTLP ingest door as the route's session. */
export const otlpIngestCredentialSchema = z.object({
  project: otlpIngestProjectSchema,
  identity: z.object({
    apiKeyId: z.string().nullable(),
    organizationId: z.string(),
    ingestSourceType: z.string().nullable(),
    ingestionTemplateId: z.string().nullable(),
    sourcePolicy: otlpSourcePolicySchema.optional(),
  }),
});
/** A refusal is thrown, and the receiver renders it. */
export type OtlpIngestCredential = Readonly<z.infer<typeof otlpIngestCredentialSchema>>;

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

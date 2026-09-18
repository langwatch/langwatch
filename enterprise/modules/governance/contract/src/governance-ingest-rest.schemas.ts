// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What the `/api/ingest` receivers read off the path. An exporter is
 * configured with `{base}/api/ingest/otel/{sourceId}` and appends OTLP's own
 * suffix, so the source id is the whole of the declared input.
 */
import { z } from "zod";

export const governanceIngestSourceParamsSchema = z.object({ sourceId: z.string().min(1) });

export const governanceIngestReceiptSchema = z.object({
  accepted: z.literal(true),
  bytes: z.number(),
  events: z.number().optional(),
  eventId: z.string().optional(),
  rejectedSpans: z.number().optional(),
  hint: z.string().optional(),
  logRecords: z.number().optional(),
  costEvents: z.number().optional(),
  ledgerRows: z.number().optional(),
  metrics: z.number().optional(),
  acceptedDataPoints: z.number().optional(),
  partialSuccess: z
    .object({ rejectedDataPoints: z.number(), errorMessage: z.string().optional() })
    .optional(),
});
export const governanceIngestRefusalSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
  accepted: z.literal(false).optional(),
});

export const governanceIngestHeadersSchema = z.object({
  authorization: z.string().optional(),
  "content-type": z.string().optional(),
  "content-encoding": z.string().optional(),
  "x-forwarded-for": z.string().optional(),
  "x-real-ip": z.string().optional(),
});

export type GovernanceIngestHeaders = z.infer<typeof governanceIngestHeadersSchema>;
export type GovernanceIngestReceipt = z.infer<typeof governanceIngestReceiptSchema>;
export type GovernanceIngestRefusal = z.infer<typeof governanceIngestRefusalSchema>;

export type GovernanceIngestResponse =
  | Readonly<{
      status: 202;
      body: GovernanceIngestReceipt;
      headers: Record<string, string>;
    }>
  | Readonly<{
      status: 400 | 401 | 404 | 429 | 503;
      body: GovernanceIngestRefusal;
      headers: Record<string, string>;
    }>;

export type GovernanceIngestOtlpInput = Readonly<{
  sourceId: string;
  raw: Uint8Array;
  headers: GovernanceIngestHeaders;
}>;

export type GovernanceIngestWebhookInput = Readonly<{
  sourceId: string;
  raw: string;
  headers: GovernanceIngestHeaders;
}>;

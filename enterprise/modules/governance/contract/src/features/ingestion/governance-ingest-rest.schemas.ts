import type { Named } from "@langwatch/module";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What the `/api/ingest` receivers read off the path. An exporter is
 * configured with `{base}/api/ingest/otel/{sourceId}` and appends OTLP's own
 * suffix, so the source id is the whole of the declared input.
 */
import { z } from "zod";

const governanceIngestSourceParamsSchemaDefinition = z.object({ sourceId: z.string().min(1) });
export interface GovernanceIngestSourceParamsSchema extends Named<
  typeof governanceIngestSourceParamsSchemaDefinition
> {}
export const governanceIngestSourceParamsSchema: GovernanceIngestSourceParamsSchema =
  governanceIngestSourceParamsSchemaDefinition;

const governanceIngestReceiptSchemaDefinition = z.object({
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
export interface GovernanceIngestReceiptSchema extends Named<
  typeof governanceIngestReceiptSchemaDefinition
> {}
export const governanceIngestReceiptSchema: GovernanceIngestReceiptSchema =
  governanceIngestReceiptSchemaDefinition;
const governanceIngestHeadersSchemaDefinition = z.object({
  authorization: z.string().optional(),
  "content-type": z.string().optional(),
  "content-encoding": z.string().optional(),
  "x-forwarded-for": z.string().optional(),
  "x-real-ip": z.string().optional(),
});
export interface GovernanceIngestHeadersSchema extends Named<
  typeof governanceIngestHeadersSchemaDefinition
> {}
export const governanceIngestHeadersSchema: GovernanceIngestHeadersSchema =
  governanceIngestHeadersSchemaDefinition;

export type GovernanceIngestHeaders = z.infer<typeof governanceIngestHeadersSchema>;
export type GovernanceIngestReceipt = z.infer<typeof governanceIngestReceiptSchema>;

/** A receiver's acknowledgement; every refusal is a thrown `HandledError` instead. */
export type GovernanceIngestResponse = Readonly<{
  status: 202;
  body: GovernanceIngestReceipt;
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

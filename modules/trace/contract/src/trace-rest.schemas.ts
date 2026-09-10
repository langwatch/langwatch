/**
 * Shapes for the v1 trace REST family (`/api/traces`): the search body's
 * additive half, the path/query params the two `:traceId` reads share, and the
 * metadata PATCH body and answer. The deployment's own analytics filter
 * vocabulary is the other half of the search body and stays a process concern
 * (it is built from that process's own list-input schema).
 */
import { z } from "zod";

import { projectionRequestSchema, type ProjectionRequest } from "./trace-projection.types.ts";
import type { TraceDateField } from "./trace-legacy-read.types.ts";

/**
 * The additive half of the search body; the other half is the deployment's
 * shared analytics filter vocabulary. A mount merges the two. The describe()
 * text here is the public API documentation for these fields.
 */
export const traceSearchBodyExtensions = {
  scrollId: z.string().optional().nullable(),
  format: z
    .enum(["digest", "json"])
    .optional()
    .describe("Output format: 'digest' (AI-readable trace digest) or 'json' (full raw data)"),
  includeSpans: z
    .boolean()
    .optional()
    .describe(
      "When true, fetches full span data for each trace. Useful for bulk export. Default false.",
    ),
  llmMode: z.boolean().optional(),
  dateField: z
    .enum(["occurred", "updated"])
    .default("occurred")
    .describe(
      "Which timestamp the startDate/endDate window filters on. 'occurred' (default) " +
        "selects traces by when they happened. 'updated' selects traces by when they were " +
        "last modified — use this for incremental ETL ('give me everything changed since my " +
        "last pull'), since a trace can occur long before it gains a later evaluation or " +
        "annotation.",
    ),
  ...projectionRequestSchema.shape,
} as const;

/** What a caller may send to `POST /search`. Everything else is the deployment's filter vocabulary. */
export type TraceSearchBody = ProjectionRequest &
  Readonly<{
    startDate: string | number;
    endDate: string | number;
    pageSize?: number | undefined;
    scrollId?: string | null | undefined;
    format?: "digest" | "json" | undefined;
    includeSpans?: boolean | undefined;
    llmMode?: boolean | undefined;
    dateField: TraceDateField;
  }>;

export const traceIdParamsSchema = z.object({
  traceId: z
    .string()
    .min(1)
    .describe(
      "The trace ID — either the full 32-char ID or a unique prefix (≥ 8 chars). Prefix lookup is scoped to the authenticated project.",
    ),
});

export const traceFormatQuerySchema = z.object({
  format: z
    .string()
    .optional()
    .describe("Output format: 'digest' (AI-readable) or 'json' (full raw data, default)"),
  llmMode: z.string().optional().describe("Deprecated: use format=digest instead"),
});

export const traceMetadataResponseSchema = z.object({ traceId: z.string() });

export const transcriptResponseSchema = z.object({
  agent: z.string(),
  sessionId: z.string().nullable(),
  entries: z.array(z.object({}).passthrough()),
  totals: z.object({
    modelCalls: z.number(),
    toolCalls: z.number(),
    tokens: z.number(),
    costUsd: z.number(),
  }),
  subAgents: z.array(z.object({}).passthrough()),
});

export const traceSearchResponseSchema = z.object({
  traces: z.array(z.any()),
  pagination: z.object({
    totalHits: z.number(),
    scrollId: z.string().optional(),
    skipped: z
      .number()
      .optional()
      .describe(
        "Number of traces dropped from this page because they failed to serialize. Present only when non-zero, so a caller can tell that traces.length is below the page size for a reason other than reaching the end of the result set.",
      ),
    updatedThrough: z
      .number()
      .optional()
      .describe(
        "Only when dateField is 'updated'. Epoch milliseconds: the upper bound this scroll actually covered, which is at or before the endDate you asked for. The scroll reads every trace as of the moment it started, so anything written after that instant belongs to the next pull. Start your next incremental pull from this value — resuming from the endDate you requested would step over the difference and lose those traces. The bound is inclusive on both sides, so a trace last written at exactly this millisecond arrives in this pull and again in the next one: pulls are at-least-once, and applying them idempotently is what keeps that from becoming a duplicate.",
      ),
  }),
  schema: z
    .object({
      from: z.string(),
      columns: z.array(
        z.object({
          path: z.string(),
          type: z.string(),
          collection: z.boolean(),
        }),
      ),
    })
    .optional()
    .describe(
      "Present only when 'select' is provided. Describes the resolved columns — " +
        "the dotted path, its value type, and whether it belongs to a nested child " +
        "collection — so callers can pre-allocate a typed reader.",
    ),
});

export const traceNotFoundBodySchema = z.object({ message: z.string() });
export const traceAmbiguousPrefixBodySchema = z.object({
  message: z.string(),
  candidateTraceIds: z.array(z.string()),
});

/** The credential a v1 trace route reads: an API key's id and the member it acts as, if any. */
export const tracesRestCredentialSchema = z.object({
  apiKeyId: z.string().nullable(),
  userId: z.string().nullable(),
});

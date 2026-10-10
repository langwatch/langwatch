/**
 * Shapes for the v1 trace REST family (`/api/traces`) and the deprecated
 * `/api/trace` family: search body's additive half, shared `:traceId`
 * params, metadata PATCH. Analytics filter vocabulary stays a process concern.
 */
import { sharedFiltersInputSchema } from "@langwatch/analytics-contract";
import { flexibleDateSchema } from "@langwatch/api/dates";
import { principalRefSchema } from "@langwatch/authorization";
import type { Named } from "@langwatch/module";
import { Temporal, toEpochMs } from "@langwatch/time";
import { z } from "zod";

import {
  projectionRequestSchema,
  type ProjectionRequest,
} from "./features/ingest/trace-projection.types.ts";
import { discoverResultSchema } from "./features/list/trace-list-view.ts";
import {
  evaluationSchema,
  traceInputSchema,
  traceOutputSchema,
  traceSchema,
} from "./trace-format.schemas.ts";
import type { TraceDateField } from "./trace-legacy-read.types.ts";

/** Longest `filter` string the boundary accepts; a shape ceiling, not a cost one. */
const MAX_TRACE_FILTER_LENGTH = 4_000;

/**
 * The additive half of the search body; the other half is the deployment's
 * shared analytics filter vocabulary. A mount merges the two. The describe()
 * text here is the public API documentation for these fields.
 */
export const traceSearchBodyExtensions = {
  scrollId: z.string().optional().nullable(),
  filter: z
    .string()
    .max(MAX_TRACE_FILTER_LENGTH)
    .optional()
    .describe(
      "A trace filter string in the same language the Trace Explorer's search bar speaks — " +
        "`status:error AND model:gpt-*`, `trace.attribute.langwatch.user_id:alice`, a quoted " +
        "phrase for free text. Combined with `filters`/`query`/`traceIds` rather than replacing " +
        "them, so every condition sent must hold. A malformed filter, or one naming a field the " +
        "language does not have, is a 422 that names the `filter` field.",
    ),
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

/**
 * Offset pagination was dropped for ClickHouse (deep OFFSET degrades badly;
 * keyset `scrollId` replaced it). Kept on the schema so sending it produces
 * an explanatory error, not silent discard.
 */
const pageOffsetInput = z
  .number()
  .optional()
  .describe(
    "Removed. Offset pagination is no longer supported and any value other " +
      "than 0 is rejected. Page with the scrollId returned by the previous " +
      "response instead. The field remains on the schema so that sending it " +
      "produces an explanatory error rather than being silently discarded.",
  )
  .refine((value) => value === undefined || value === 0, {
    message:
      "pageOffset is no longer supported \u2014 offset pagination was removed. Use the scrollId returned by the previous response to fetch the next page.",
  });

/**
 * The filter half of the search body: the shared analytics filter vocabulary
 * plus the paging and ordering the list read understands. `projectId` comes
 * from the credential, and the two dates are re-added in flexible form.
 */
const traceSearchFilterSchema = z.object({
  ...sharedFiltersInputSchema.omit({ projectId: true, startDate: true, endDate: true }).shape,
  pageOffset: pageOffsetInput,
  // Non-negative integers only (#2163): a fractional or negative page size
  // reaches ClickHouse as a LIMIT and fails there instead of at the boundary.
  pageSize: z.number().int().positive().optional(),
  groupBy: z.string().optional(),
  sortBy: z.string().optional(),
  sortDirection: z.string().optional(),
  updatedAt: z.number().optional(),
  scrollId: z.string().optional().nullable(),
});

/** The whole trace, as `GET /:traceId` answers it: too open a shape to enumerate. */
const traceDetailResponseSchemaDefinition = z.object({}).passthrough();
export interface TraceDetailResponseSchema extends Named<
  typeof traceDetailResponseSchemaDefinition
> {}
export const traceDetailResponseSchema: TraceDetailResponseSchema =
  traceDetailResponseSchemaDefinition;

/** The v1 search body: the filter vocabulary, the flexible dates, the additive half last. */
const traceSearchBodySchemaDefinition = z.object({
  ...traceSearchFilterSchema.shape,
  startDate: flexibleDateSchema,
  endDate: flexibleDateSchema,
  ...traceSearchBodyExtensions,
});
export interface TraceSearchBodySchema extends Named<typeof traceSearchBodySchemaDefinition> {}
export const traceSearchBodySchema: TraceSearchBodySchema = traceSearchBodySchemaDefinition;

/** Shape of a caller's `POST /search` request; deployment provides filter vocabulary. */
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
    filter?: string | undefined;
  }>;

/**
 * The `:id` segment of the deprecated `/api/trace/:id` reads — separate from
 * {@link traceIdParamsSchema} because the superseded family spells the
 * parameter `id`, and it must match the path exactly.
 */
const traceLegacyIdParamsSchemaDefinition = z.object({
  id: z.string().min(1).describe("The trace ID."),
});
export interface TraceLegacyIdParamsSchema extends Named<
  typeof traceLegacyIdParamsSchemaDefinition
> {}
export const traceLegacyIdParamsSchema: TraceLegacyIdParamsSchema =
  traceLegacyIdParamsSchemaDefinition;

/** The `:threadId` segment of the deprecated `/api/thread/:threadId` read. */
const traceLegacyThreadParamsSchemaDefinition = z.object({
  threadId: z.string().min(1).describe("The thread ID."),
});
export interface TraceLegacyThreadParamsSchema extends Named<
  typeof traceLegacyThreadParamsSchemaDefinition
> {}
export const traceLegacyThreadParamsSchema: TraceLegacyThreadParamsSchema =
  traceLegacyThreadParamsSchemaDefinition;

/**
 * The deprecated family's trace, under the component names the generated clients name their
 * types after (`Trace`, `Metadata`, `Metrics`, ...). Each `.meta()` names a copy: the shared
 * trace schema, and every other route built from it, stay unnamed.
 */
const legacyEvaluationSchema = evaluationSchema
  .safeExtend({
    timestamps: evaluationSchema.shape.timestamps.meta({ id: "EvaluationTimestamps" }),
  })
  .meta({ id: "Evaluation" });

const legacyTraceSchema = traceSchema
  .safeExtend({
    metadata: traceSchema.shape.metadata.meta({ id: "Metadata" }),
    timestamps: traceSchema.shape.timestamps.meta({ id: "Timestamps" }),
    input: traceInputSchema.meta({ id: "Input" }).optional(),
    output: traceOutputSchema.meta({ id: "Output" }).optional(),
    metrics: traceSchema.shape.metrics.unwrap().meta({ id: "Metrics" }).optional(),
    evaluations: z.array(legacyEvaluationSchema).optional(),
  })
  .meta({ id: "Trace" });

/** `GET /api/trace/:id` in json format: the trace, its evaluations, the span tree as text. */
const traceLegacyReadResponseSchemaDefinition = legacyTraceSchema.safeExtend({
  ascii_tree: z.string(),
});
export interface TraceLegacyReadResponseSchema extends Named<
  typeof traceLegacyReadResponseSchemaDefinition
> {}
export const traceLegacyReadResponseSchema: TraceLegacyReadResponseSchema =
  traceLegacyReadResponseSchemaDefinition;

/** `POST /api/trace/search`: the page of traces and the scroll to the next one. */
const traceLegacySearchResponseSchemaDefinition = z
  .object({
    traces: z.array(legacyTraceSchema),
    pagination: z.object({ totalHits: z.number(), scrollId: z.string().nullish() }),
  })
  .meta({ id: "SearchResponse" });
export interface TraceLegacySearchResponseSchema extends Named<
  typeof traceLegacySearchResponseSchemaDefinition
> {}
export const traceLegacySearchResponseSchema: TraceLegacySearchResponseSchema =
  traceLegacySearchResponseSchemaDefinition;

/** `POST /api/trace/:id/share`: the public path the trace now answers at. */
const traceLegacyShareResponseSchemaDefinition = z.object({
  status: z.literal("success"),
  path: z.string(),
});
export interface TraceLegacyShareResponseSchema extends Named<
  typeof traceLegacyShareResponseSchemaDefinition
> {}
export const traceLegacyShareResponseSchema: TraceLegacyShareResponseSchema =
  traceLegacyShareResponseSchemaDefinition;

/** `POST /api/trace/:id/unshare`: the public path is gone. */
const traceLegacyUnshareResponseSchemaDefinition = z.object({ status: z.literal("success") });
export interface TraceLegacyUnshareResponseSchema extends Named<
  typeof traceLegacyUnshareResponseSchemaDefinition
> {}
export const traceLegacyUnshareResponseSchema: TraceLegacyUnshareResponseSchema =
  traceLegacyUnshareResponseSchemaDefinition;

const traceIdParamsSchemaDefinition = z.object({
  traceId: z
    .string()
    .min(1)
    .describe(
      "The trace ID — either the full 32-char ID or a unique prefix (≥ 8 chars). Prefix lookup is scoped to the authenticated project.",
    ),
});
export interface TraceIdParamsSchema extends Named<typeof traceIdParamsSchemaDefinition> {}
export const traceIdParamsSchema: TraceIdParamsSchema = traceIdParamsSchemaDefinition;

const traceFormatQuerySchemaDefinition = z.object({
  format: z
    .string()
    .optional()
    .describe("Output format: 'digest' (AI-readable) or 'json' (full raw data, default)"),
  llmMode: z.string().optional().describe("Deprecated: use format=digest instead"),
});
export interface TraceFormatQuerySchema extends Named<typeof traceFormatQuerySchemaDefinition> {}
export const traceFormatQuerySchema: TraceFormatQuerySchema = traceFormatQuerySchemaDefinition;

const traceMetadataResponseSchemaDefinition = z.object({ traceId: z.string() });
export interface TraceMetadataResponseSchema extends Named<
  typeof traceMetadataResponseSchemaDefinition
> {}
export const traceMetadataResponseSchema: TraceMetadataResponseSchema =
  traceMetadataResponseSchemaDefinition;

const traceMetadataValueSchema = z.union([
  z.string().max(4096),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.record(z.string(), z.unknown()),
]);

const traceMetadataUpdateSchemaDefinition = z
  .record(z.string(), traceMetadataValueSchema)
  .refine((metadata) => Object.keys(metadata).length > 0, {
    message: "metadata must contain at least one key",
  })
  .refine((metadata) => JSON.stringify(metadata).length <= 32768, {
    message: "total metadata payload must not exceed 32KB",
  });
export interface TraceMetadataUpdateSchema extends Named<
  typeof traceMetadataUpdateSchemaDefinition
> {}
export const traceMetadataUpdateSchema: TraceMetadataUpdateSchema =
  traceMetadataUpdateSchemaDefinition;

export type TraceMetadataUpdate = z.infer<typeof traceMetadataUpdateSchema>;

const traceMetadataBodySchemaDefinition = z.object({ metadata: traceMetadataUpdateSchema });
export interface TraceMetadataBodySchema extends Named<typeof traceMetadataBodySchemaDefinition> {}
export const traceMetadataBodySchema: TraceMetadataBodySchema = traceMetadataBodySchemaDefinition;

const trackEventResponseSchemaDefinition = z.object({
  message: z.literal("Event tracked"),
});
export interface TrackEventResponseSchema extends Named<
  typeof trackEventResponseSchemaDefinition
> {}
export const trackEventResponseSchema: TrackEventResponseSchema =
  trackEventResponseSchemaDefinition;

const transcriptResponseSchema = z.object({
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

/** The transcript route's own output: unknown top-level keys pass through unchanged. */
const transcriptRestResponseSchemaDefinition = transcriptResponseSchema.passthrough();
export interface TranscriptRestResponseSchema extends Named<
  typeof transcriptRestResponseSchemaDefinition
> {}
export const transcriptRestResponseSchema: TranscriptRestResponseSchema =
  transcriptRestResponseSchemaDefinition;

const traceSearchResponseSchemaDefinition = z.object({
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
export interface TraceSearchResponseSchema extends Named<
  typeof traceSearchResponseSchemaDefinition
> {}
export const traceSearchResponseSchema: TraceSearchResponseSchema =
  traceSearchResponseSchemaDefinition;

const traceNotFoundBodySchemaDefinition = z.object({ message: z.string() });
export interface TraceNotFoundBodySchema extends Named<typeof traceNotFoundBodySchemaDefinition> {}
export const traceNotFoundBodySchema: TraceNotFoundBodySchema = traceNotFoundBodySchemaDefinition;
const traceAmbiguousPrefixBodySchemaDefinition = z.object({
  message: z.string(),
  candidateTraceIds: z.array(z.string()),
});
export interface TraceAmbiguousPrefixBodySchema extends Named<
  typeof traceAmbiguousPrefixBodySchemaDefinition
> {}
export const traceAmbiguousPrefixBodySchema: TraceAmbiguousPrefixBodySchema =
  traceAmbiguousPrefixBodySchemaDefinition;

/** The credential a v1 trace route reads: an API key's id and the member it acts as, if any. */
const tracesRestCredentialSchemaDefinition = z.object({
  principal: principalRefSchema.nullable(),
});
export interface TracesRestCredentialSchema extends Named<
  typeof tracesRestCredentialSchemaDefinition
> {}
export const tracesRestCredentialSchema: TracesRestCredentialSchema =
  tracesRestCredentialSchemaDefinition;

/** Values per page when a facets caller names a field and no limit. */
const DEFAULT_FACET_VALUE_LIMIT = 50;

/** Digits only, which is how epoch milliseconds arrive on a query string. */
const EPOCH_MILLIS = /^\d+$/;

/** The calendar date at the front of an ISO string, if it starts with one. */
const ISO_CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Whether an ISO-shaped bound names a day that exists, by the month's real length. */
function namesARealDay(value: string): boolean {
  const match = ISO_CALENDAR_DATE.exec(value);
  if (!match) return true;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const daysInMonth = Temporal.PlainYearMonth.from({ year, month }).daysInMonth;
  return day >= 1 && day <= daysInMonth;
}

/**
 * A facets window bound as a query string, not a string-or-number union: a
 * `number` arm loses precision going through the generated Go client.
 */
const facetWindowBoundSchema = z
  .string()
  .refine(
    (value) =>
      EPOCH_MILLIS.test(value) || (namesARealDay(value) && Number.isFinite(toEpochMs(value))),
    { message: "Expected epoch milliseconds or a date string" },
  );

/** `GET /api/v1/traces/facets`: with `field`, one field's values, paged. */
const traceFacetsQuerySchemaDefinition = z.object({
  field: z.string().min(1).max(512).optional(),
  prefix: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(DEFAULT_FACET_VALUE_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
  startDate: facetWindowBoundSchema.optional(),
  endDate: facetWindowBoundSchema.optional(),
});
export interface TraceFacetsQuerySchema extends Named<typeof traceFacetsQuerySchemaDefinition> {}
export const traceFacetsQuerySchema: TraceFacetsQuerySchema = traceFacetsQuerySchemaDefinition;

export type TraceFacetsQuery = z.infer<typeof traceFacetsQuerySchema>;

/** One facet's values, paged, as `GET /facets?field=...` answers them. */
const traceFacetValuesResponseSchemaDefinition = z.object({
  values: z.array(z.object({ value: z.string(), label: z.string().optional(), count: z.number() })),
  total: z.number().describe("Distinct values the field holds in the window, before paging."),
  hasMore: z.boolean(),
});
export interface TraceFacetValuesResponseSchema extends Named<
  typeof traceFacetValuesResponseSchemaDefinition
> {}
export const traceFacetValuesResponseSchema: TraceFacetValuesResponseSchema =
  traceFacetValuesResponseSchemaDefinition;

/**
 * `GET /facets` answers one of two shapes depending on `field`, which the route's output
 * validator cannot name as one object; the union below is what its docs publish.
 */
const traceFacetsResponseSchemaDefinition = z.object({}).passthrough();
export interface TraceFacetsResponseSchema extends Named<
  typeof traceFacetsResponseSchemaDefinition
> {}
export const traceFacetsResponseSchema: TraceFacetsResponseSchema =
  traceFacetsResponseSchemaDefinition;

/** `GET /facets`: the discovery payload without `field`, one field's paged values with it. */
const traceFacetsAnswerSchemaDefinition = z.union([
  z.object({
    ...discoverResultSchema.shape,
    pending: z
      .boolean()
      .describe(
        "True when the payload is still being computed and what you have is the last committed one, possibly empty. Call again shortly.",
      ),
  }),
  traceFacetValuesResponseSchema,
]);
export interface TraceFacetsAnswerSchema extends Named<typeof traceFacetsAnswerSchemaDefinition> {}
export const traceFacetsAnswerSchema: TraceFacetsAnswerSchema = traceFacetsAnswerSchemaDefinition;

export type TraceFacetsAnswer = z.infer<typeof traceFacetsAnswerSchema>;

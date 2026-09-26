/**
 * Shapes for the v1 trace REST family (`/api/traces`) and the deprecated
 * `/api/trace` family: search body's additive half, shared `:traceId`
 * params, metadata PATCH. Analytics filter vocabulary stays a process concern.
 */
import { sharedFiltersInputSchema } from "@langwatch/analytics-contract";
import { flexibleDateSchema } from "@langwatch/api/dates";
import { Temporal, toEpochMs } from "@langwatch/time";
import { z } from "zod";

import { traceSchema } from "./trace-format.schemas.ts";
import type { TraceDateField } from "./trace-legacy-read.types.ts";
import { discoverResultSchema } from "./trace-list-view.ts";
import { projectionRequestSchema, type ProjectionRequest } from "./trace-projection.types.ts";

/** Longest `filter` string the boundary accepts; a shape ceiling, not a cost one. */
export const MAX_TRACE_FILTER_LENGTH = 4_000;

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
export const traceSearchFilterSchema = z.object({
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
export const traceDetailResponseSchema = z.object({}).passthrough();

/** The v1 search body: the filter vocabulary, the flexible dates, the additive half last. */
export const traceSearchBodySchema = z.object({
  ...traceSearchFilterSchema.shape,
  startDate: flexibleDateSchema,
  endDate: flexibleDateSchema,
  ...traceSearchBodyExtensions,
});

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
export const traceLegacyIdParamsSchema = z.object({
  id: z.string().min(1).describe("The trace ID."),
});

/** The `:threadId` segment of the deprecated `/api/thread/:threadId` read. */
export const traceLegacyThreadParamsSchema = z.object({
  threadId: z.string().min(1).describe("The thread ID."),
});

/** `GET /api/trace/:id` in json format: the trace, its evaluations, the span tree as text. */
export const traceLegacyReadResponseSchema = z.object({
  ...traceSchema.shape,
  ascii_tree: z.string(),
});

/** `POST /api/trace/search`: the page of traces and the scroll to the next one. */
export const traceLegacySearchResponseSchema = z.object({
  traces: z.array(traceSchema),
  pagination: z.object({ totalHits: z.number(), scrollId: z.string().nullish() }),
});

/** `POST /api/trace/:id/share`: the public path the trace now answers at. */
export const traceLegacyShareResponseSchema = z.object({
  status: z.literal("success"),
  path: z.string(),
});

/** `POST /api/trace/:id/unshare`: the public path is gone. */
export const traceLegacyUnshareResponseSchema = z.object({ status: z.literal("success") });

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

const traceMetadataValueSchema = z.union([
  z.string().max(4096),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.record(z.string(), z.unknown()),
]);

export const traceMetadataUpdateSchema = z
  .record(z.string(), traceMetadataValueSchema)
  .refine((metadata) => Object.keys(metadata).length > 0, {
    message: "metadata must contain at least one key",
  })
  .refine((metadata) => JSON.stringify(metadata).length <= 32768, {
    message: "total metadata payload must not exceed 32KB",
  });

export type TraceMetadataUpdate = z.infer<typeof traceMetadataUpdateSchema>;

export const traceMetadataBodySchema = z.object({ metadata: traceMetadataUpdateSchema });

export const trackEventResponseSchema = z.object({
  message: z.literal("Event tracked"),
});

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

/** The transcript route's own output: unknown top-level keys pass through unchanged. */
export const transcriptRestResponseSchema = transcriptResponseSchema.passthrough();

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

/** Values per page when a facets caller names a field and no limit. */
export const DEFAULT_FACET_VALUE_LIMIT = 50;

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
export const facetWindowBoundSchema = z
  .string()
  .refine(
    (value) =>
      EPOCH_MILLIS.test(value) || (namesARealDay(value) && Number.isFinite(toEpochMs(value))),
    { message: "Expected epoch milliseconds or a date string" },
  );

/** `GET /api/v1/traces/facets`: with `field`, one field's values, paged. */
export const traceFacetsQuerySchema = z.object({
  field: z.string().min(1).max(512).optional(),
  prefix: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(DEFAULT_FACET_VALUE_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
  startDate: facetWindowBoundSchema.optional(),
  endDate: facetWindowBoundSchema.optional(),
});

export type TraceFacetsQuery = z.infer<typeof traceFacetsQuerySchema>;

/** One facet's values, paged, as `GET /facets?field=...` answers them. */
export const traceFacetValuesResponseSchema = z.object({
  values: z.array(z.object({ value: z.string(), label: z.string().optional(), count: z.number() })),
  total: z.number().describe("Distinct values the field holds in the window, before paging."),
  hasMore: z.boolean(),
});

/**
 * `GET /facets` answers one of two shapes depending on `field`, which the route's output
 * validator cannot name as one object; the union below is what its docs publish.
 */
export const traceFacetsResponseSchema = z.object({}).passthrough();

/** `GET /facets`: the discovery payload without `field`, one field's paged values with it. */
export const traceFacetsAnswerSchema = z.union([
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

export type TraceFacetsAnswer = z.infer<typeof traceFacetsAnswerSchema>;

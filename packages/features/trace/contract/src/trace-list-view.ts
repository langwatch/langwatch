/**
 * The trace list's read models: one row, one page, and the facet payloads the sidebar renders.
 * These live in the contract rather than beside the ClickHouse-backed service that builds them
 * because they are what the trace transport PUBLISHES.
 */
import { evaluationSummarySchema } from "@langwatch/evaluation-contract";
import { z } from "zod";
import {
  eventMetricValuesSchema,
  facetValueAggregatesSchema,
  traceListCursorSchema,
} from "./trace-list.queries";
import { traceMediaRefSchema } from "./trace-media-ref";

/** Which half of the sidebar a facet is listed under. */
const facetGroupSchema = z.enum(["trace", "evaluation", "span", "metadata", "prompt"]);

export const traceListViewItemSchema = z.object({
  traceId: z.string(),
  timestamp: z.number(),
  name: z.string(),
  serviceName: z.string(),
  durationMs: z.number(),
  /** Grand list-price cost. `nonBilledCost` is the bundled (theoretical)
   *  portion; billed = totalCost - nonBilledCost. */
  totalCost: z.number(),
  nonBilledCost: z.number(),
  totalTokens: z.number(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  /**
   * Cache + reasoning token sums folded onto the trace summary's reserved attribute keys. Null
   * when the trace's model never reported them (no prompt caching, or a provider like Anthropic
   * that emits no reasoning count).
   */
  cacheReadTokens: z.number().nullable(),
  cacheCreationTokens: z.number().nullable(),
  reasoningTokens: z.number().nullable(),
  /**
   * How full the context window already was when the trace's first model call ran.
   */
  contextSizeTokens: z.number().nullable(),
  models: z.array(z.string()),
  /** Trace-level labels (the `langwatch.labels` attribute), decoded from
   *  the JSON-encoded array stored on the summary. Empty when unset. */
  labels: z.array(z.string()),
  /** The managed prompt last used in the trace, for the Prompt column.
   *  `promptId` filters by `lastUsedPrompt`; `promptVersionNumber` is the
   *  displayed "v{N}". Both null when the trace used no managed prompt. */
  promptId: z.string().nullable(),
  promptVersionNumber: z.number().nullable(),
  status: z.enum(["ok", "error", "warning"]),
  spanCount: z.number(),
  /**
   * Stored payload size of the trace in bytes — the MATERIALIZED `_size_bytes` column on
   * `trace_summaries` (see migration 00032). Drives the optional Size column and is sortable. 0
   * when the column is absent on older rows that have not yet had the value drift onto disk.
   */
  sizeBytes: z.number(),
  input: z.string().nullable(),
  output: z.string().nullable(),
  /** Compact fold-derived media refs for the winning IO; absent when media-free. */
  inputMediaRefs: z.array(traceMediaRefSchema).optional(),
  outputMediaRefs: z.array(traceMediaRefSchema).optional(),
  error: z.string().nullable(),
  conversationId: z.string().nullable(),
  userId: z.string().nullable(),
  origin: z.string(),
  tokensEstimated: z.boolean(),
  ttft: z.number().nullable(),
  traceName: z.string(),
  rootSpanType: z.string().nullable(),
});

export type TraceListItem = z.infer<typeof traceListViewItemSchema>;

export const traceListPageSchema = z.object({
  items: z.array(traceListViewItemSchema),
  totalHits: z.number(),
  evaluations: z.record(z.string(), z.array(evaluationSummarySchema)),
  nextCursor: traceListCursorSchema.nullable(),
});

export type TraceListPage = z.infer<typeof traceListPageSchema>;

/** The counts and ranges the list's own filter bar renders. */
export const traceListFacetCountsSchema = z.object({
  origin: z.record(z.string(), z.number()),
  status: z.record(z.string(), z.number()),
  service: z.record(z.string(), z.number()),
  model: z.record(z.string(), z.number()),
  ranges: z.object({
    tokens: z.object({ min: z.number(), max: z.number() }),
    cost: z.object({ min: z.number(), max: z.number() }),
    latency: z.object({ min: z.number(), max: z.number() }),
  }),
});

export type TraceListFacetCounts = z.infer<typeof traceListFacetCountsSchema>;

export const categoricalFacetDescriptorSchema = z.object({
  key: z.string(),
  kind: z.literal("categorical"),
  label: z.string(),
  group: facetGroupSchema,
  topValues: z.array(
    z.object({
      value: z.string(),
      label: z.string().optional(),
      count: z.number(),
      aggregates: facetValueAggregatesSchema.optional(),
      /** Set only on the event facet: per-metric-key value tallies for the
       *  inline drilldown (see {@link EventMetricValues}). */
      eventMetrics: z.array(eventMetricValuesSchema).optional(),
    }),
  ),
  totalDistinct: z.number(),
});

export type CategoricalFacetDescriptor = z.infer<typeof categoricalFacetDescriptorSchema>;

export const rangeFacetDescriptorSchema = z.object({
  key: z.string(),
  kind: z.literal("range"),
  label: z.string(),
  group: facetGroupSchema,
  min: z.number(),
  max: z.number(),
  /** Present only for `isDiscrete`-flagged integer facets: the distinct values
   *  + counts for the tick-list presentation, plus the true distinct count
   *  (the sidebar shows the slider instead above its threshold). */
  discrete: z
    .object({
      values: z.array(z.object({ value: z.number(), count: z.number() })),
      distinctCount: z.number(),
    })
    .optional(),
});

export type RangeFacetDescriptor = z.infer<typeof rangeFacetDescriptorSchema>;

export const dynamicKeysFacetDescriptorSchema = z.object({
  key: z.string(),
  kind: z.literal("dynamic_keys"),
  label: z.string(),
  group: facetGroupSchema,
  topKeys: z.array(z.object({ value: z.string(), count: z.number() })),
  totalDistinct: z.number(),
});

export type DynamicKeysFacetDescriptor = z.infer<typeof dynamicKeysFacetDescriptorSchema>;

export const facetDescriptorSchema = z.union([
  categoricalFacetDescriptorSchema,
  rangeFacetDescriptorSchema,
  dynamicKeysFacetDescriptorSchema,
]);

export type FacetDescriptor = z.infer<typeof facetDescriptorSchema>;

export const discoverResultSchema = z.object({
  facets: z.array(facetDescriptorSchema),
  /**
   * True when the cache was cold and a background compute was kicked off. Callers should treat
   * this as a loading signal — the SSE `discover_updated` push will land the real values
   * shortly.
   */
  pending: z.boolean(),
});

export type DiscoverResult = z.infer<typeof discoverResultSchema>;

/** One facet's values, paged, as the sidebar drilldown reads them. */
export const facetValuesResultSchema = z.object({
  values: z.array(z.object({ value: z.string(), label: z.string().optional(), count: z.number() })),
  totalDistinct: z.number(),
});

export type FacetValuesResult = z.infer<typeof facetValuesResultSchema>;

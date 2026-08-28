/**
 * The trace list's read models: one row, one page, and the facet payloads the
 * sidebar renders.
 *
 * These live in the contract rather than beside the ClickHouse-backed service
 * that builds them because they are what the trace transport PUBLISHES. A
 * tRPC router built inside a generic `create<TContext extends ...>` resolves
 * its output types against the constraint rather than the instantiation, so a
 * payload type declared in the application narrows for every client the
 * moment the transport moves into a package. Keeping the shape here is what
 * makes that move type-preserving.
 */
import type { EvaluationSummary } from "@langwatch/evaluation-contract";
import type { FacetValueAggregates, TraceListCursor } from "./trace-list.repository";
import type { TraceMediaRef } from "./trace-media-ref";

export interface TraceListItem {
  traceId: string;
  timestamp: number;
  name: string;
  serviceName: string;
  durationMs: number;
  /** Grand list-price cost. `nonBilledCost` is the bundled (theoretical)
   *  portion; billed = totalCost - nonBilledCost. */
  totalCost: number;
  nonBilledCost: number;
  totalTokens: number;
  inputTokens: number | null;
  outputTokens: number | null;
  /**
   * Cache + reasoning token sums folded onto the trace summary's reserved
   * attribute keys. Null when the trace's model never reported them (no prompt
   * caching, or a provider like Anthropic that emits no reasoning count). The
   * list cell keeps showing the input+output delta; these drive the hover
   * breakdown so a cached turn's true processed-token count is one hover away.
   */
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  reasoningTokens: number | null;
  /**
   * How full the context window already was when the trace's first model call
   * ran. Deliberately not a sum: an agent turn re-sends its conversation on
   * every call, so the summed cache reads above run into the millions while
   * this stays the one number a reader means by "how big was my context".
   */
  contextSizeTokens: number | null;
  models: string[];
  /** Trace-level labels (the `langwatch.labels` attribute), decoded from
   *  the JSON-encoded array stored on the summary. Empty when unset. */
  labels: string[];
  /** The managed prompt last used in the trace, for the Prompt column.
   *  `promptId` filters by `lastUsedPrompt`; `promptVersionNumber` is the
   *  displayed "v{N}". Both null when the trace used no managed prompt. */
  promptId: string | null;
  promptVersionNumber: number | null;
  status: "ok" | "error" | "warning";
  spanCount: number;
  /**
   * Stored payload size of the trace in bytes — the MATERIALIZED
   * `_size_bytes` column on `trace_summaries` (see migration 00032). Drives
   * the optional Size column and is sortable. 0 when the column is absent on
   * older rows that have not yet had the value drift onto disk.
   */
  sizeBytes: number;
  input: string | null;
  output: string | null;
  /** Compact fold-derived media refs for the winning IO; absent when media-free. */
  inputMediaRefs?: TraceMediaRef[];
  outputMediaRefs?: TraceMediaRef[];
  error: string | null;
  conversationId: string | null;
  userId: string | null;
  origin: string;
  tokensEstimated: boolean;
  ttft: number | null;
  traceName: string;
  rootSpanType: string | null;
}

export interface TraceListPage {
  items: TraceListItem[];
  totalHits: number;
  evaluations: Record<string, EvaluationSummary[]>;
  nextCursor: TraceListCursor | null;
}

/** The counts and ranges the list's own filter bar renders. */
export interface TraceListFacetCounts {
  origin: Record<string, number>;
  status: Record<string, number>;
  service: Record<string, number>;
  model: Record<string, number>;
  ranges: {
    tokens: { min: number; max: number };
    cost: { min: number; max: number };
    latency: { min: number; max: number };
  };
}

export interface CategoricalFacetDescriptor {
  key: string;
  kind: "categorical";
  label: string;
  group: "trace" | "evaluation" | "span" | "metadata" | "prompt";
  topValues: {
    value: string;
    label?: string;
    count: number;
    aggregates?: FacetValueAggregates;
  }[];
  totalDistinct: number;
}

export interface RangeFacetDescriptor {
  key: string;
  kind: "range";
  label: string;
  group: "trace" | "evaluation" | "span" | "metadata" | "prompt";
  min: number;
  max: number;
  /** Present only for `isDiscrete`-flagged integer facets: the distinct values
   *  + counts for the tick-list presentation, plus the true distinct count
   *  (the sidebar shows the slider instead above its threshold). */
  discrete?: {
    values: { value: number; count: number }[];
    distinctCount: number;
  };
}

export interface DynamicKeysFacetDescriptor {
  key: string;
  kind: "dynamic_keys";
  label: string;
  group: "trace" | "evaluation" | "span" | "metadata" | "prompt";
  topKeys: { value: string; count: number }[];
  totalDistinct: number;
}

export type FacetDescriptor =
  | CategoricalFacetDescriptor
  | RangeFacetDescriptor
  | DynamicKeysFacetDescriptor;

export interface DiscoverResult {
  facets: FacetDescriptor[];
  /**
   * True when the cache was cold and a background compute was kicked
   * off. Callers should treat this as a loading signal — the SSE
   * `discover_updated` push will land the real values shortly. False
   * means `facets` is the latest committed payload (possibly stale
   * within the SWR window, with a background refresh already in
   * flight).
   */
  pending: boolean;
}

/** One facet's values, paged, as the sidebar drilldown reads them. */
export interface FacetValuesResult {
  values: { value: string; label?: string; count: number }[];
  totalDistinct: number;
}

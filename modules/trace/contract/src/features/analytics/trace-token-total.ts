import type { TraceSummaryData } from "../ingest/trace-projection.ts";
import {
  RESERVED_CACHE_CREATION_TOKENS,
  RESERVED_CACHE_READ_TOKENS,
} from "./trace-analytics-fold.ts";

/**
 * Every token a trace's model calls processed: the input left after the cache, the output, and
 * the cache reads and writes. The input count is the fresh remainder (the canonical usage shape),
 * so the cache buckets add to it. Spec: specs/trace-processing/trace-token-totals.feature.
 */
export function traceTotalTokensOf(
  summary: Pick<TraceSummaryData, "totalPromptTokenCount" | "totalCompletionTokenCount"> & {
    attributes: Readonly<Record<string, string | undefined>>;
  },
): number {
  return (
    (summary.totalPromptTokenCount ?? 0) +
    (summary.totalCompletionTokenCount ?? 0) +
    reservedTokenSumOf(summary.attributes[RESERVED_CACHE_READ_TOKENS]) +
    reservedTokenSumOf(summary.attributes[RESERVED_CACHE_CREATION_TOKENS])
  );
}

function reservedTokenSumOf(raw: string | undefined): number {
  const value = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

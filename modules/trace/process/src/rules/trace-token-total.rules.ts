import {
  RESERVED_CACHE_CREATION_TOKENS,
  RESERVED_CACHE_READ_TOKENS,
} from "@langwatch/trace-contract";

const CACHE_TOKENS_SQL =
  `toUInt64OrZero(Attributes['${RESERVED_CACHE_READ_TOKENS}'])` +
  ` + toUInt64OrZero(Attributes['${RESERVED_CACHE_CREATION_TOKENS}'])`;

/** `traceTotalTokensOf` over a `trace_summaries` row: input, output and both cache buckets. */
export const TRACE_SUMMARY_TOTAL_TOKENS_SQL = `(coalesce(TotalPromptTokenCount, 0) + coalesce(TotalCompletionTokenCount, 0) + ${CACHE_TOKENS_SQL})`;

/** The same total for filters, NULL when the trace has no input or no output count. */
export const TRACE_SUMMARY_TOTAL_TOKENS_FILTER_SQL = `(TotalPromptTokenCount + TotalCompletionTokenCount + ${CACHE_TOKENS_SQL})`;

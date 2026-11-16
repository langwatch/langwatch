import {
  RESERVED_CACHE_CREATION_TOKENS,
  RESERVED_CACHE_READ_TOKENS,
} from "@langwatch/trace-contract";

const CACHE_TOKENS_SQL =
  `toUInt64OrZero(Attributes['${RESERVED_CACHE_READ_TOKENS}'])` +
  ` + toUInt64OrZero(Attributes['${RESERVED_CACHE_CREATION_TOKENS}'])`;

/**
 * A trace's total tokens for filters (input, output, both cache buckets); NULL without an input
 * or output count.
 */
export const TRACE_SUMMARY_TOTAL_TOKENS_FILTER_SQL = `(TotalPromptTokenCount + TotalCompletionTokenCount + ${CACHE_TOKENS_SQL})`;

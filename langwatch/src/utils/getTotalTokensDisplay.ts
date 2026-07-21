import type { Trace } from "@langwatch/contracts/tracer";

export const getTotalTokensDisplay = (trace: Trace) =>
  (trace.metrics?.completion_tokens ?? 0) +
  (trace.metrics?.prompt_tokens ?? 0) +
  " tokens" +
  (trace.metrics?.tokens_estimated ? " (estimated)" : "");

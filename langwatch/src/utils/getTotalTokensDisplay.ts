import type { ElasticSearchTrace } from "../server/tracer/types";

export const getTotalTokensDisplay = (trace: ElasticSearchTrace) =>
  (trace.metrics.completion_tokens ?? 0) +
  (trace.metrics.prompt_tokens ?? 0) +
  " tokens" +
  (trace.metrics.tokens_estimated ? " (estimated)" : "");

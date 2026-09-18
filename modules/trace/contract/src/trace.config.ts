import { Config, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/**
 * Span pipeline config: lane count and tokenizer settings. Kept in original
 * types so producer/consumer clamp identically and deployments can use existing values.
 */
export const traceConfig = Config.define((c) => ({
  spanProcessingShards: c.env("TRACE_SPAN_PROCESSING_SHARDS", z.string().optional()),
  tokenizer: {
    bpeDirectory: c.env("TIKTOKENS_PATH", z.string().optional()),
    fetchTimeoutMs: c.env(
      "TIKTOKEN_FETCH_TIMEOUT_MS",
      z.union([z.string(), z.number()]).optional(),
    ),
  },
}));

export type TraceServerConfig = ConfigOf<typeof traceConfig>;

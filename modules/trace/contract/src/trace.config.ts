import { Config, publicBaseUrl, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/**
 * Span pipeline config: lane count and tokenizer settings, kept in original types so producer
 * and consumer clamp identically. `publicBaseUrl` is the shared origin `platformUrl` links to.
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
  publicBaseUrl,
}));

export type TraceServerConfig = ConfigOf<typeof traceConfig>;

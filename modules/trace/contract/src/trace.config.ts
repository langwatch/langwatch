import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * Span pipeline config: lane count and tokenizer settings. Kept in original
 * types so producer/consumer clamp identically and deployments can use existing values.
 */
export const traceServerConfigDefinition = RuntimeConfig.define({
  spanProcessingShards: Config.value(z.string().optional(), {
    env: "TRACE_SPAN_PROCESSING_SHARDS",
  }),
  tokenizer: {
    bpeDirectory: Config.value(z.string().optional(), { env: "TIKTOKENS_PATH" }),
    fetchTimeoutMs: Config.value(z.union([z.string(), z.number()]).optional(), {
      env: "TIKTOKEN_FETCH_TIMEOUT_MS",
    }),
  },
});

export type TraceServerConfig = ConfigValue<typeof traceServerConfigDefinition>;

export const traceServerConfigSchema = compileRuntimeConfig(traceServerConfigDefinition);

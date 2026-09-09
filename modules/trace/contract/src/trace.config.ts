import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * The span pipeline's lane count, and where the tokenizer finds its
 * vocabulary.
 *
 * `processingShards` is carried as written because the producing and
 * consuming processes must clamp it identically, and the pipeline owns that
 * clamp. `fetchTimeoutMs` is carried as a string or a number on purpose: the
 * tokenizer accepts `10s` and reads it as ten, and a numeric leaf here would
 * refuse a value the deployment has been running with.
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

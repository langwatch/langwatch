import { z } from "zod";

import { Config, RuntimeConfig } from "./runtime-config.ts";

/**
 * SDK identity a process exports operational telemetry under. Both `apiKey` and `endpoint`
 * optional. Each reader still owns its own self-ingest refusal since the block doesn't know
 * the reader's listener addresses.
 */
export const observabilityConfigDefinition = RuntimeConfig.define({
  apiKey: Config.optionalSecret({ env: "LANGWATCH_API_KEY" }),
  endpoint: Config.optionalUrl({ env: "LANGWATCH_ENDPOINT" }),
  processorType: Config.value(z.enum(["simple", "batch"]).default("batch"), {
    env: "LANGWATCH_PROCESSOR_TYPE",
  }),
});

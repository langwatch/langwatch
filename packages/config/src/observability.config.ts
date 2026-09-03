import { z } from "zod";

import { Config, RuntimeConfig } from "./runtime-config";

/**
 * The LangWatch SDK identity a process exports its own operational telemetry
 * under, at the deployment's own spelling.
 *
 * `apiKey` and `endpoint` stay optional: a process given neither exports no
 * telemetry and says so at boot rather than refusing to start. Every reader
 * of this block still owns its OWN self-ingest refusal — a process pointed at
 * its own public origin must not export into itself — because that refusal
 * needs the reader's own listener addresses, which this shared block does not
 * know.
 */
export const observabilityConfigDefinition = RuntimeConfig.define({
  apiKey: Config.secret({ optional: true, env: "LANGWATCH_API_KEY" }),
  endpoint: Config.url({ optional: true, env: "LANGWATCH_ENDPOINT" }),
  processorType: Config.value(z.enum(["simple", "batch"]).default("batch"), {
    env: "LANGWATCH_PROCESSOR_TYPE",
  }),
});

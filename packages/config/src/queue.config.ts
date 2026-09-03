import { z } from "zod";

import { Config, RuntimeConfig } from "./runtime-config";

/**
 * GroupQueue's own dispatch knobs, at the deployment's own spelling.
 *
 * Every process that dispatches or consumes through GroupQueue reads these
 * identically: a producer and a consumer clamping concurrency or choosing a
 * wire codec differently would disagree about the budget one is spending and
 * the other is enforcing. `resolveGroupQueuePolicyFromEnv` owns the parse,
 * defaults and cross-field rules; this module only supplies the raw leaves.
 */
export const groupQueueConfigDefinition = RuntimeConfig.define({
  globalConcurrency: Config.value(z.string().optional(), { env: "GLOBAL_QUEUE_CONCURRENCY" }),
  zstdWritesEnabled: Config.value(z.string().optional(), {
    env: "GROUP_QUEUE_ZSTD_WRITES_ENABLED",
  }),
  msgpackWritesEnabled: Config.value(z.string().optional(), {
    env: "GROUP_QUEUE_MSGPACK_WRITES_ENABLED",
  }),
  tenantConcurrencyCap: Config.value(z.string().optional(), {
    env: "LANGWATCH_DISPATCH_TENANT_CAP",
  }),
  globalConcurrencyBudget: Config.value(z.string().optional(), {
    env: "LANGWATCH_DISPATCH_GLOBAL_BUDGET",
  }),
});

import { z } from "zod";

import { Config, RuntimeConfig } from "./runtime-config.ts";

/**
 * GroupQueue's dispatch knobs. Every process reads these identically; producer and consumer
 * must not disagree about concurrency or wire codec. This module supplies raw leaves only.
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

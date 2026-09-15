import { z } from "zod";

import { Config, RuntimeConfig } from "./runtime-config.ts";

/**
 * The one Redis endpoint processes connect to via GroupQueue or cache. All three optional;
 * a process given none composes without Redis and says so at boot.
 */
export const redisConfigDefinition = RuntimeConfig.define({
  url: Config.value(z.string().optional(), { env: "REDIS_URL" }),
  clusterEndpoints: Config.value(z.string().optional(), { env: "REDIS_CLUSTER_ENDPOINTS" }),
  dbIndex: Config.value(z.string().optional(), { env: "REDIS_DB_INDEX" }),
});

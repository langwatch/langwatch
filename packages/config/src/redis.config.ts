import { z } from "zod";

import { Config, RuntimeConfig } from "./runtime-config";

/**
 * The one Redis endpoint every process that dispatches through GroupQueue or
 * shares a cache connects to, at the deployment's own spelling.
 *
 * All three optional: a process given none composes without Redis and says so
 * at boot rather than refusing to start, which `RedisConfigService.resolve`
 * turns into a named unconfigured reason rather than a connection built over a
 * blank string.
 */
export const redisConfigDefinition = RuntimeConfig.define({
  url: Config.value(z.string().optional(), { env: "REDIS_URL" }),
  clusterEndpoints: Config.value(z.string().optional(), { env: "REDIS_CLUSTER_ENDPOINTS" }),
  dbIndex: Config.value(z.string().optional(), { env: "REDIS_DB_INDEX" }),
});

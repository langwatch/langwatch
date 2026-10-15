import { langySecrets, type LangyServerConfig } from "@langwatch/langy-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { ScopedSecrets } from "@langwatch/secrets";

import type { LangyChannels } from "../langy.channels.ts";
import { RedisLangyLocalWorkspaceChannel } from "../redis/redis.langy-local-workspace.channel.ts";
import { UnavailableLangyWorkerChannel } from "../unavailable.langy-worker.channel.ts";
import { HttpLangyWorkerMetricsChannel } from "./http.langy-worker-metrics.channel.ts";
import { HttpLangyWorkerChannel } from "./http.langy-worker.channel.ts";

/**
 * The worker manager is reached over HTTP; an unconfigured one answers "unavailable".
 * Workspace nudges travel over Redis pub/sub, across every app replica.
 */
export class HttpLangyChannels {
  static readonly requires = ["redis"] as const;

  static async create({
    config,
    secrets,
    redis,
  }: {
    config: LangyServerConfig;
    secrets: ScopedSecrets;
    redis: RedisConnection;
  }): Promise<LangyChannels> {
    const worker = await secrets.into(langySecrets.internal, (internalSecret) => {
      const metrics = HttpLangyWorkerMetricsChannel.create();
      return config.agentUrl && internalSecret
        ? HttpLangyWorkerChannel.create({ agentUrl: config.agentUrl, internalSecret, metrics })
        : UnavailableLangyWorkerChannel.create(metrics);
    });
    return { worker, workspace: RedisLangyLocalWorkspaceChannel.create(redis) };
  }
}

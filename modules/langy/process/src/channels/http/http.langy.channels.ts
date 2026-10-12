import { langySecrets, type LangyServerConfig } from "@langwatch/langy-contract";
import type { ScopedSecrets } from "@langwatch/secrets";

import type { LangyChannels } from "../langy.channels.ts";
import { UnavailableLangyWorkerChannel } from "../unavailable.langy-worker.channel.ts";
import { HttpLangyWorkerMetricsChannel } from "./http.langy-worker-metrics.channel.ts";
import { HttpLangyWorkerChannel } from "./http.langy-worker.channel.ts";

/** The worker manager is reached over HTTP; an unconfigured one answers "unavailable". */
export class HttpLangyChannels {
  static readonly requires = [] as const;

  static async create({
    config,
    secrets,
  }: {
    config: LangyServerConfig;
    secrets: ScopedSecrets;
  }): Promise<LangyChannels> {
    const worker = await secrets.into(langySecrets.internal, (internalSecret) => {
      const metrics = HttpLangyWorkerMetricsChannel.create();
      return config.agentUrl && internalSecret
        ? HttpLangyWorkerChannel.create({ agentUrl: config.agentUrl, internalSecret, metrics })
        : UnavailableLangyWorkerChannel.create(metrics);
    });
    return { worker };
  }
}

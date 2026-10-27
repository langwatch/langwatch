import type { PlatformHealthServerConfig } from "@langwatch/platform-health-contract";

import type { PlatformHealthChannels } from "../platform-health.channels.ts";
import { HttpSubsystemProbeChannel } from "./http.subsystem-probe.channel.ts";

/** The canaries reach the deployment's own public origin over HTTP. */
export class HttpPlatformHealthChannels {
  static readonly requires = [] as const;

  static create({ config }: { config: PlatformHealthServerConfig }): PlatformHealthChannels {
    return {
      canaries: HttpSubsystemProbeChannel.create({ publicBaseUrl: config.publicBaseUrl ?? "" }),
    };
  }
}

import {
  nurturingSecrets,
  type NurturingServerConfig,
} from "@langwatch/enterprise-nurturing-contract";
import type { ScopedSecrets } from "@langwatch/secrets";

import type { NurturingChannels } from "../nurturing.channels.ts";
import { HttpCustomerIoChannel } from "./http.customer-io.channel.ts";
import { HttpPostHogChannel } from "./http.posthog.channel.ts";

/** Lifecycle messages go to Customer.io and product events to PostHog, each only when keyed. */
export class HttpNurturingChannels {
  static readonly requires = [] as const;

  static async create({
    config,
    secrets,
  }: {
    config: NurturingServerConfig;
    secrets: ScopedSecrets;
  }): Promise<NurturingChannels> {
    const customerIo = await secrets.into(nurturingSecrets.customerIoApiKey, (key) =>
      key
        ? HttpCustomerIoChannel.create({
            config: {
              customerIoApiKey: key,
              customerIoRegion: config.customerIoRegion,
              customerIoBaseUrl: config.customerIoBaseUrl,
            },
          })
        : void 0,
    );
    const { posthogKey: key, posthogHost: host } = config;
    const posthog = key
      ? HttpPostHogChannel.create({ targets: () => [{ key, ...(host ? { host } : {}) }] })
      : void 0;
    return { customerIo, posthog };
  }
}

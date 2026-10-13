import type { ModelProviderServerConfig } from "@langwatch/model-provider-contract";
import type { BoundApis } from "@langwatch/process";
import { nlpInternalSecret, type ScopedSecrets } from "@langwatch/secrets";
import { TraceApi } from "@langwatch/trace-contract";

import { executionProxyBaseUrlOf } from "../model-provider-connection-ping.channel.ts";
import type { ModelProviderChannels } from "../model-provider.channels.ts";
import { HttpModelProviderCodexGatewayPingChannel } from "./http.model-provider-codex-gateway-ping.channel.ts";
import { HttpModelProviderConnectionPingChannel } from "./http.model-provider-connection-ping.channel.ts";

/** Test Connection generates once through the engine's proxy, or through the AI gateway. */
export class HttpModelProviderChannels {
  static readonly requires = [] as const;
  static readonly binds = { traces: TraceApi } as const;

  static async create({
    config,
    secrets,
    bound,
  }: {
    config: ModelProviderServerConfig;
    secrets: ScopedSecrets;
    bound: BoundApis<typeof HttpModelProviderChannels.binds>;
  }): Promise<ModelProviderChannels> {
    const connectionPing = await secrets.into(nlpInternalSecret, (internalSecret) =>
      HttpModelProviderConnectionPingChannel.create({
        executionProxyBaseUrl: executionProxyBaseUrlOf(config),
        nlpInternalSecret: internalSecret,
      }),
    );
    return {
      connectionPing,
      // The control plane's own address for the gateway first, as on main (codexGatewayModel.ts).
      codexGatewayPing: HttpModelProviderCodexGatewayPingChannel.create({
        gatewayBaseUrl:
          config.gatewayInternalUrl ?? config.gatewayPublicUrl ?? config.gatewayLegacyUrl,
      }),
      spans: bound.traces,
    };
  }
}

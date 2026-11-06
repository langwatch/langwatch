import type { EvaluationServerConfig } from "@langwatch/evaluation-contract";
import { GatewayApi } from "@langwatch/gateway-contract";
import type { BoundApis } from "@langwatch/process";

import type { EvaluationChannels } from "../evaluation.channels.ts";
import { NullLangevalsChannel } from "../null.langevals.channel.ts";
import { HttpLangevalsChannel } from "./http.langevals.channel.ts";

/**
 * langevals is posted to over HTTP when the deployment names its endpoint. The spend ledger is
 * bound to gateway, not a peer, so gateway may keep depending on evaluation (record §5).
 */
export class HttpEvaluationChannels {
  static readonly requires = [] as const;
  static readonly binds = { spend: GatewayApi } as const;

  static create({
    config,
    bound,
  }: {
    config: EvaluationServerConfig;
    bound: BoundApis<typeof HttpEvaluationChannels.binds>;
  }): EvaluationChannels {
    return {
      langevals: config.langevalsEndpoint
        ? HttpLangevalsChannel.create({ config })
        : NullLangevalsChannel.create(),
      spend: bound.spend,
    };
  }
}

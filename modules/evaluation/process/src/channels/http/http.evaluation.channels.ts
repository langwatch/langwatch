import type { EvaluationServerConfig } from "@langwatch/evaluation-contract";
import { GatewayApi } from "@langwatch/gateway-contract";
import { InstantEvalApi } from "@langwatch/instant-eval-contract";
import type { BoundApis } from "@langwatch/process";

import type { EvaluationChannels } from "../evaluation.channels.ts";
import { NullLangevalsChannel } from "../null.langevals.channel.ts";
import { HttpLangevalsChannel } from "./http.langevals.channel.ts";

/**
 * langevals is posted to over HTTP when the deployment names its endpoint. The spend ledger and
 * kept Instant Evals results are bound to gateway and instant-eval, not peers, so each may keep
 * depending on evaluation, directly or through gateway (record §5).
 */
export class HttpEvaluationChannels {
  static readonly requires = [] as const;
  static readonly binds = { spend: GatewayApi, instantEvalResults: InstantEvalApi } as const;

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
      instantEvalResults: bound.instantEvalResults,
    };
  }
}

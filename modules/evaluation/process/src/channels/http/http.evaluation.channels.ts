import type { EvaluationServerConfig } from "@langwatch/evaluation-contract";

import type { EvaluationChannels } from "../evaluation.channels.ts";
import { NullLangevalsChannel } from "../null.langevals.channel.ts";
import { HttpLangevalsChannel } from "./http.langevals.channel.ts";

/** langevals is posted to over HTTP when the deployment names its endpoint. */
export class HttpEvaluationChannels {
  static readonly requires = [] as const;

  static create({ config }: { config: EvaluationServerConfig }): EvaluationChannels {
    return {
      langevals: config.langevalsEndpoint
        ? HttpLangevalsChannel.create({ config })
        : NullLangevalsChannel.create(),
    };
  }
}

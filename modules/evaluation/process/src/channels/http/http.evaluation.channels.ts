import type { EvaluationServerConfig } from "@langwatch/evaluation-contract";

import type { EvaluationChannels } from "../evaluation.channels.ts";
import { NullLangevalsChannel } from "../null.langevals.channel.ts";
import { HttpLangevalsChannel } from "./http.langevals.channel.ts";

/** Evaluators are posted to over HTTP when the deployment names langevals or the Go runtime. */
export class HttpEvaluationChannels {
  static readonly requires = [] as const;

  static create({ config }: { config: EvaluationServerConfig }): EvaluationChannels {
    return {
      langevals:
        config.langevalsEndpoint || config.evaluatorRuntime.endpoint
          ? HttpLangevalsChannel.create({ config })
          : NullLangevalsChannel.create(),
    };
  }
}

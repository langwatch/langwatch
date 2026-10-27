import type { EvaluationServerConfig } from "@langwatch/evaluation-contract";

import type { EvaluationChannels } from "../evaluation.channels.ts";
import { NullLangevalsChannel } from "../null.langevals.channel.ts";
import { MemoryLangevalsChannel } from "./memory.langevals.channel.ts";

/** Without an endpoint every evaluation answers skipped; with one, a test scripts the answers. */
export class MemoryEvaluationChannels {
  static readonly requires = [] as const;

  static create({ config }: { config: EvaluationServerConfig }): EvaluationChannels {
    return {
      langevals: config.langevalsEndpoint
        ? MemoryLangevalsChannel.create()
        : NullLangevalsChannel.create(),
    };
  }
}

import type { LangevalsChannel } from "./langevals.channel.ts";

/** Every channel evaluation holds; langevals answers skipped where no endpoint is set. */
export interface EvaluationChannels {
  readonly langevals: LangevalsChannel;
}

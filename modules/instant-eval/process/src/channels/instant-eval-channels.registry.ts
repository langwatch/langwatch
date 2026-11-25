import { defineChannels } from "@langwatch/process";

import { BoundInstantEvalChannels } from "./instant-eval.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const instantEvalChannels = defineChannels({
  live: BoundInstantEvalChannels,
  memory: BoundInstantEvalChannels,
});

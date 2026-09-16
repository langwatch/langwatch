import { HttpOttlTransformChannel } from "./http/http.ottl-transform.channel.ts";
import { MemoryOttlTransformChannel } from "./memory/memory.ottl-transform.channel.ts";

/** The two tiers behind `GovernanceOttlGateway`. */
export const governanceChannels = {
  live: HttpOttlTransformChannel,
  memory: MemoryOttlTransformChannel,
};

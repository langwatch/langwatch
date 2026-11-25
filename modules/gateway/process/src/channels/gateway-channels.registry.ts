import { defineChannels } from "@langwatch/process";

import { HttpGatewayChannels } from "./http/http.gateway.channels.ts";
import { MemoryGatewayChannels } from "./memory/memory.gateway.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const gatewayChannels = defineChannels({
  live: HttpGatewayChannels,
  memory: MemoryGatewayChannels,
});

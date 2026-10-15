import { defineRepositories } from "@langwatch/process";

import { LiveGatewayRepositories } from "./live/live.gateway.repositories.ts";
import { MemoryGatewayRepositories } from "./memory/memory.gateway.repositories.ts";

export const gatewayRepositories = defineRepositories({
  live: LiveGatewayRepositories,
  memory: MemoryGatewayRepositories,
});

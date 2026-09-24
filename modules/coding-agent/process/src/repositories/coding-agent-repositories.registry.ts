import { defineRepositories } from "@langwatch/kernel";

import { LiveCodingAgentRepositories } from "./live/live.coding-agent.repositories.ts";
import { MemoryCodingAgentRepositories } from "./memory/memory.coding-agent.repositories.ts";

/**
 * The two tiers a process selects between: `live` reaches the real stores,
 * `memory` stands them in. Neither is named after a database — the live
 * tier's required members already say it is ClickHouse and Redis.
 */
export const codingAgentRepositories = defineRepositories({
  live: LiveCodingAgentRepositories,
  memory: MemoryCodingAgentRepositories,
});

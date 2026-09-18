import { defineRepositories } from "@langwatch/kernel";
import { ClickHouseCodingAgentRepositories } from "./clickhouse/clickhouse.coding-agent.repositories.ts";
import { MemoryCodingAgentRepositories } from "./memory/memory.coding-agent.repositories.ts";

/**
 * The two tiers a process selects between: `live` reaches the real stores,
 * `memory` stands them in. Neither is named after a database — the live
 * tier's folder and required member already say it's ClickHouse.
 */
export const codingAgentRepositories = defineRepositories({
  live: ClickHouseCodingAgentRepositories,
  memory: MemoryCodingAgentRepositories,
});

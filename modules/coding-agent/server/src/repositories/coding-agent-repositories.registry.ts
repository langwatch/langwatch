import { defineRepositories } from "@langwatch/runtime-composition";
import { ClickHouseCodingAgentRepositories } from "./clickhouse/clickhouse.coding-agent.repositories.ts";
import { MemoryCodingAgentRepositories } from "./memory/memory.coding-agent.repositories.ts";

/**
 * The two tiers a process selects between: `live` reaches the real stores,
 * `memory` stands them in. Neither is named after a database — every row this
 * module owns is a projection in ClickHouse, which the live tier's folder and
 * the member it requires already say.
 */
export const codingAgentRepositories = defineRepositories({
  live: ClickHouseCodingAgentRepositories,
  memory: MemoryCodingAgentRepositories,
});

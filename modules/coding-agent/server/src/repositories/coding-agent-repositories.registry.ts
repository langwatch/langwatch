import { defineRepositories } from "@langwatch/runtime-composition";
import { ClickHouseCodingAgentRepositories } from "./clickhouse/clickhouse.coding-agent.repositories.ts";
import { MemoryCodingAgentRepositories } from "./memory/memory.coding-agent.repositories.ts";

/**
 * The two tiers a process selects between. There is no Postgres tier: every
 * row this module owns is a projection in ClickHouse, so the durable tier is
 * named for the store it reads.
 */
export const codingAgentRepositories = defineRepositories({
  clickhouse: ClickHouseCodingAgentRepositories,
  memory: MemoryCodingAgentRepositories,
});

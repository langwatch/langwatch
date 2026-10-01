import { defineRepositories } from "@langwatch/kernel";

import { ClickHouseInstantEvalRepositories } from "./clickhouse/clickhouse.instant-eval.repositories.ts";
import { MemoryInstantEvalRepositories } from "./memory/memory.instant-eval.repositories.ts";

/**
 * The two tiers a process selects between: `live` is both tables in the one
 * routing ClickHouse member, `memory` stands them in. The module never
 * builds a client itself — the tier it was installed with hands it rows.
 */
export const instantEvalRepositories = defineRepositories({
  live: ClickHouseInstantEvalRepositories,
  memory: MemoryInstantEvalRepositories,
});

import { defineRepositories } from "@langwatch/process";

import { LiveInstantEvalRepositories } from "./live/live.instant-eval.repositories.ts";
import { MemoryInstantEvalRepositories } from "./memory/memory.instant-eval.repositories.ts";

/**
 * The two tiers a process selects between: `live` is the tables in the one
 * routing ClickHouse and the shared state in Redis, `memory` stands them in. The module never
 * builds a client itself — the tier it was installed with hands it rows.
 */
export const instantEvalRepositories = defineRepositories({
  live: LiveInstantEvalRepositories,
  memory: MemoryInstantEvalRepositories,
});

import { defineRepositories } from "@langwatch/process";

import { LiveExperimentRepositories } from "./live/live.experiment.repositories.ts";
import { MemoryExperimentRepositories } from "./memory/memory.experiment.repositories.ts";

export const experimentRepositories = defineRepositories({
  live: LiveExperimentRepositories,
  memory: MemoryExperimentRepositories,
});

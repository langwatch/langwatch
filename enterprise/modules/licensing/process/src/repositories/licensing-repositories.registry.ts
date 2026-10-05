import { defineRepositories } from "@langwatch/process";

import { LiveLicensingRepositories } from "./live/live.licensing.repositories.ts";
import { MemoryLicensingRepositories } from "./memory/memory.licensing.repositories.ts";

/** Licence rows in Postgres, sealed through the deployment's cipher; windows in Redis. */
export const licensingRepositories = defineRepositories({
  live: LiveLicensingRepositories,
  memory: MemoryLicensingRepositories,
});

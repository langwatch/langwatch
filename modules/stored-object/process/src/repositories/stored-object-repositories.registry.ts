import { defineRepositories } from "@langwatch/process";

import { LiveStoredObjectRepositories } from "./live/live.stored-object.repositories.ts";
import { MemoryStoredObjectRepositories } from "./memory/memory.stored-object.repositories.ts";

export const storedObjectRepositories = defineRepositories({
  live: LiveStoredObjectRepositories,
  memory: MemoryStoredObjectRepositories,
});

import { defineRepositories } from "@langwatch/process";

import { LivePresenceRepositories } from "./live/live.presence.repositories.ts";
import { MemoryPresenceRepositories } from "./memory/memory.presence.repositories.ts";

/**
 * Sessions live for a TTL, so they sit in the process's Redis; the settings presence answers from
 * are its owners' Postgres rows, read through their shares (R40). Memory serves tests only (§7).
 */
export const presenceRepositories = defineRepositories({
  live: LivePresenceRepositories,
  memory: MemoryPresenceRepositories,
});

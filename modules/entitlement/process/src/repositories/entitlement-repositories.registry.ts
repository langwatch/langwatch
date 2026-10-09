import { defineRepositories } from "@langwatch/process";

import { LiveEntitlementRepositories } from "./live/live.entitlement.repositories.ts";
import { MemoryEntitlementRepositories } from "./memory/memory.entitlement.repositories.ts";

export const entitlementRepositories = defineRepositories({
  live: LiveEntitlementRepositories,
  memory: MemoryEntitlementRepositories,
});

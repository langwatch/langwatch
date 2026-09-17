import { defineRepositories } from "@langwatch/kernel";
import { MemoryEntitlementRepositories } from "./memory/memory.entitlement.repositories.ts";
import { PostgresEntitlementRepositories } from "./prisma/prisma.entitlement.repositories.ts";

export const entitlementRepositories = defineRepositories({
  live: PostgresEntitlementRepositories,
  memory: MemoryEntitlementRepositories,
});

import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryEntitlementRepositories } from "./memory/memory.entitlement.repositories.ts";
import { PostgresEntitlementRepositories } from "./prisma/prisma.entitlement.repositories.ts";

export const entitlementRepositories = defineRepositories({
  postgres: PostgresEntitlementRepositories,
  memory: MemoryEntitlementRepositories,
});

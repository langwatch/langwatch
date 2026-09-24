import type { StoresMemberSource } from "@langwatch/kernel";

import { memoryObjectStorage } from "./object-storage-memory.ts";

/**
 * Selects every module's memory repositories without opening external clients.
 * Object storage is answered by its memory twin (ADR-158); the two server targets answer
 * "not configured".
 */
export function memoryStores(): StoresMemberSource {
  const objectStorage = memoryObjectStorage();
  return Object.freeze({
    tier: "memory" as const,
    order: Object.freeze(["objectStorage", "clickhouseAdmin", "databaseTarget"]),
    read(name: string): unknown {
      if (name === "objectStorage") return objectStorage;
      // The memory tier has no ClickHouse or PostgreSQL server: LangWatchQL is unavailable.
      if (name === "clickhouseAdmin" || name === "databaseTarget") return { configured: false };
      throw new Error(
        `Memory stores provide no raw "${name}" client; use the module's memory repository.`,
      );
    },
  });
}

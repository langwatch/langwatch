import { InMemoryProcessStore } from "@langwatch/eventing";

import type { StoresMemberSource } from "./members.ts";
import { memoryObjectStorage } from "./object-storage-memory.ts";

/** The memory stores, plus the one process store the composition also hands to eventing. */
export type MemoryStores = StoresMemberSource & { readonly processStore: InMemoryProcessStore };

/**
 * Selects every module's memory repositories without opening external clients.
 * Object storage is answered by its memory twin (ADR-158); the two server targets answer
 * "not configured". One process store stands in for the Postgres live eventing shares (R41 A).
 */
export function memoryStores(): MemoryStores {
  const objectStorage = memoryObjectStorage();
  const processStore = InMemoryProcessStore.createForLocalDevelopment();
  return Object.freeze({
    tier: "memory" as const,
    order: Object.freeze(["objectStorage", "processStore", "clickhouseAdmin", "databaseTarget"]),
    processStore,
    read(name: string): unknown {
      if (name === "objectStorage") return objectStorage;
      if (name === "processStore") return processStore;
      // The memory tier has no ClickHouse or PostgreSQL server: LangWatchQL is unavailable.
      if (name === "clickhouseAdmin" || name === "databaseTarget") return { configured: false };
      throw new Error(
        `Memory stores provide no raw "${name}" client; use the module's memory repository.`,
      );
    },
  });
}

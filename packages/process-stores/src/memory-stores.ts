import type { StoresMemberSource } from "@langwatch/kernel";

import { memoryObjectStorage } from "./object-storage-memory.ts";

/**
 * Selects every module's memory repositories without opening external clients.
 * Object storage is the one member answered here, by its memory twin (ADR-158).
 */
export function memoryStores(): StoresMemberSource {
  const objectStorage = memoryObjectStorage();
  return Object.freeze({
    tier: "memory" as const,
    order: Object.freeze(["objectStorage"]),
    read(name: string): unknown {
      if (name === "objectStorage") return objectStorage;
      throw new Error(
        `Memory stores provide no raw "${name}" client; use the module's memory repository.`,
      );
    },
  });
}

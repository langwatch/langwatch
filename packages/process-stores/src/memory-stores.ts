import type { StoresMemberSource } from "@langwatch/kernel";

/** Selects every module's memory repositories without opening external clients. */
export function memoryStores(): StoresMemberSource {
  return Object.freeze({
    tier: "memory" as const,
    order: Object.freeze([]),
    read(name: string): never {
      throw new Error(
        `Memory stores provide no raw "${name}" client; use the module's memory repository.`,
      );
    },
  });
}

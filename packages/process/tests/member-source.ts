import type { StoresMemberSource } from "@langwatch/process-stores";

import type { Tier } from "../src/tiers.ts";

/** A stores source over a plain record, for tests that name what their registries require. */
export function memberSourceOf(members: object): StoresMemberSource {
  const values = members as Readonly<Record<string, unknown>>;
  return {
    order: Object.keys(values),
    read(name: string): unknown {
      const value = values[name];
      if (value === void 0) throw new Error(`This process has no "${name}" store.`);
      return value;
    },
  };
}

/** The same source, stating the live tier, for tests that drive live repositories over doubles. */
export function liveMemberSourceOf(members: object): StoresMemberSource {
  const tier: Tier = "live";
  return { ...memberSourceOf(members), tier };
}

/** The same source, stating the memory tier, as `memoryStores()` does (record §4). */
export function memoryMemberSourceOf(members: object): StoresMemberSource {
  const tier: Tier = "memory";
  return { ...memberSourceOf(members), tier };
}

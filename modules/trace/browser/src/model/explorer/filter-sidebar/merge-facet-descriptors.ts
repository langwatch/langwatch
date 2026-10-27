import type { FacetDescriptor } from "@langwatch/trace-contract";

export type FacetCountState = "settled" | "stale" | "pending";

/**
 * Which descriptors the sidebar renders and what its counts mean: counts from
 * the filtered read, key lists and the warm start from the discovery, whose
 * counts are for another window and so read `pending` until the first lands.
 */
export function mergeFacetDescriptors({
  discovered,
  filtered,
  filteredIsPlaceholder,
}: {
  discovered: FacetDescriptor[] | undefined;
  filtered: FacetDescriptor[] | undefined;
  filteredIsPlaceholder: boolean;
}): { descriptors: FacetDescriptor[]; countState: FacetCountState } {
  if (!filtered) {
    return { descriptors: discovered ?? [], countState: "pending" };
  }

  const keyLists = (discovered ?? []).filter((d) => d.kind === "dynamic_keys");

  return {
    descriptors: [...filtered.filter((d) => d.kind !== "dynamic_keys"), ...keyLists],
    countState: filteredIsPlaceholder ? "stale" : "settled",
  };
}

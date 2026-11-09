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

/** The deferred facets to count now: listed without values, their section open. */
export function deferredFacetKeysToLoad({
  descriptors,
  isOpen,
}: {
  descriptors: FacetDescriptor[];
  isOpen: (key: string) => boolean;
}): string[] {
  return descriptors
    .filter((d) => d.kind === "categorical" && d.deferred === true && isOpen(d.key))
    .map((d) => d.key);
}

/**
 * Deferred facets with the values their keyed read counted, once it answers
 * this query; `deferred: false` keeps the section listed even when empty.
 */
export function fillDeferredFacets({
  descriptors,
  loaded,
  loadedIsPlaceholder,
}: {
  descriptors: FacetDescriptor[];
  loaded: FacetDescriptor[] | undefined;
  loadedIsPlaceholder: boolean;
}): FacetDescriptor[] {
  if (!loaded || loadedIsPlaceholder) return descriptors;
  const byKey = new Map(loaded.map((d) => [d.key, d]));
  return descriptors.map((d) => {
    const counted = d.kind === "categorical" && d.deferred === true ? byKey.get(d.key) : undefined;
    return counted?.kind === "categorical" ? { ...counted, deferred: false } : d;
  });
}

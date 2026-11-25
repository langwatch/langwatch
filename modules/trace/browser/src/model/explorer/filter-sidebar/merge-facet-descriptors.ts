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
  filteredMatchesNothing = false,
}: {
  discovered: FacetDescriptor[] | undefined;
  filtered: FacetDescriptor[] | undefined;
  filteredIsPlaceholder: boolean;
  /** The query matches no trace: the discovered descriptors, each with nothing counted. */
  filteredMatchesNothing?: boolean;
}): { descriptors: FacetDescriptor[]; countState: FacetCountState } {
  if (filteredMatchesNothing) {
    return { descriptors: (discovered ?? []).map(withoutCounts), countState: "settled" };
  }

  if (!filtered) {
    return { descriptors: discovered ?? [], countState: "pending" };
  }

  const keyLists = (discovered ?? []).filter((d) => d.kind === "dynamic_keys");

  return {
    descriptors: [...filtered.filter((d) => d.kind !== "dynamic_keys"), ...keyLists],
    countState: filteredIsPlaceholder ? "stale" : "settled",
  };
}

/** A descriptor as a read matching no trace returns it: no value, a zero span. */
function withoutCounts(descriptor: FacetDescriptor): FacetDescriptor {
  if (descriptor.kind === "categorical") {
    return { ...descriptor, topValues: [], totalDistinct: 0 };
  }
  if (descriptor.kind === "range") {
    const { discrete: _discrete, ...rest } = descriptor;
    return { ...rest, min: 0, max: 0 };
  }
  return descriptor;
}

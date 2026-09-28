import type { DiscoverDescriptors } from "../../hooks/discoverCache";

export type FacetCountState = "settled" | "stale" | "pending";

/**
 * Which descriptors the sidebar renders, and what its counts mean.
 *
 * Counts come from the filtered read; `discover` supplies the attribute key
 * lists it does not repeat and, until the first filtered payload lands, the
 * rows themselves so the sidebar has something to show. Those warm-start
 * rows carry no count the user can read (`pending`): a discover count is for
 * a snapped window without the query, and would not match the table. While a
 * newer filtered payload is in flight the previous one stays, marked `stale`.
 */
export function mergeFacetDescriptors({
  discovered,
  filtered,
  filteredIsPlaceholder,
}: {
  discovered: DiscoverDescriptors | undefined;
  filtered: DiscoverDescriptors | undefined;
  filteredIsPlaceholder: boolean;
}): { descriptors: DiscoverDescriptors; countState: FacetCountState } {
  if (!filtered) {
    return { descriptors: discovered ?? [], countState: "pending" };
  }
  const keyLists = (discovered ?? []).filter((d) => d.kind === "dynamic_keys");
  return {
    descriptors: [
      ...filtered.filter((d) => d.kind !== "dynamic_keys"),
      ...keyLists,
    ],
    countState: filteredIsPlaceholder ? "stale" : "settled",
  };
}

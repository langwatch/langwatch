/**
 * @vitest-environment node
 *
 * Which descriptors the sidebar renders and what its counts mean, from the
 * two reads it merges: discover (value lists, attribute keys, warm start)
 * and the filtered read (the counts). See specs/traces-v2/search.feature
 * ("Facet count updates" and "Numbers that agree").
 */
import { describe, expect, it } from "vitest";
import type { DiscoverDescriptors } from "../../../hooks/discoverCache";
import { mergeFacetDescriptors } from "../mergeFacetDescriptors";

const statusUnfiltered = {
  kind: "categorical",
  key: "status",
  label: "Status",
  group: "trace",
  topValues: [{ value: "error", count: 33 }],
  totalDistinct: 1,
} as const;
const statusFiltered = {
  ...statusUnfiltered,
  topValues: [{ value: "error", count: 4 }],
} as const;
const metadataKeys = {
  kind: "dynamic_keys",
  key: "metadataKeys",
  label: "Trace attribute keys",
  group: "metadata",
  topKeys: [{ value: "metadata.env", count: 10 }],
  totalDistinct: 1,
} as const;

const discovered = [statusUnfiltered, metadataKeys] as DiscoverDescriptors;
const filtered = [statusFiltered] as DiscoverDescriptors;

describe("mergeFacetDescriptors", () => {
  describe("given no filtered payload has landed yet", () => {
    /** @scenario "Counts next to values are hidden until the filtered counts land" */
    it("renders the discovered rows with their counts pending", () => {
      const merged = mergeFacetDescriptors({
        discovered,
        filtered: undefined,
        filteredIsPlaceholder: false,
      });
      expect(merged.countState).toBe("pending");
      expect(merged.descriptors).toEqual(discovered);
    });

    it("renders nothing rather than a count when discover is empty too", () => {
      const merged = mergeFacetDescriptors({
        discovered: undefined,
        filtered: undefined,
        filteredIsPlaceholder: false,
      });
      expect(merged).toEqual({ descriptors: [], countState: "pending" });
    });
  });

  describe("given a filtered payload", () => {
    /** @scenario "Facet counts update when a filter is applied" */
    it("takes the counts from the filtered payload", () => {
      const merged = mergeFacetDescriptors({
        discovered,
        filtered,
        filteredIsPlaceholder: false,
      });
      expect(merged.countState).toBe("settled");
      expect(merged.descriptors).toContainEqual(statusFiltered);
      expect(merged.descriptors).not.toContainEqual(statusUnfiltered);
    });

    it("keeps the attribute key lists from discover", () => {
      const merged = mergeFacetDescriptors({
        discovered,
        filtered,
        filteredIsPlaceholder: false,
      });
      expect(merged.descriptors).toContainEqual(metadataKeys);
    });

    it("marks the previous query's counts stale while a newer one loads", () => {
      const merged = mergeFacetDescriptors({
        discovered,
        filtered,
        filteredIsPlaceholder: true,
      });
      expect(merged.countState).toBe("stale");
    });
  });
});

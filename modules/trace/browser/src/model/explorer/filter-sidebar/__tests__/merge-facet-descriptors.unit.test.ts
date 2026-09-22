/**
 * @vitest-environment node
 * Which descriptors the sidebar renders while the counted read is in flight.
 * @see specs/traces-v2/search.feature
 */

import type { FacetDescriptor } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { mergeFacetDescriptors } from "../merge-facet-descriptors.ts";

const categorical = (key: string, count: number): FacetDescriptor => ({
  key,
  kind: "categorical",
  label: key,
  group: "trace",
  topValues: [{ value: "error", count }],
  totalDistinct: 1,
});

const keyList: FacetDescriptor = {
  key: "metadata",
  kind: "dynamic_keys",
  label: "Metadata",
  group: "metadata",
  topKeys: [{ value: "metadata.environment", count: 3 }],
  totalDistinct: 1,
};

describe("given no counted payload yet", () => {
  it("shows the discovered rows, with their counts not to be read", () => {
    const merged = mergeFacetDescriptors({
      discovered: [categorical("status", 9), keyList],
      filtered: undefined,
      filteredIsPlaceholder: false,
    });

    expect(merged.countState).toBe("pending");
    expect(merged.descriptors).toHaveLength(2);
  });
});

describe("given a counted payload", () => {
  it("takes its counts and keeps the key lists the counted read does not repeat", () => {
    const merged = mergeFacetDescriptors({
      discovered: [categorical("status", 9), keyList],
      filtered: [categorical("status", 2)],
      filteredIsPlaceholder: false,
    });

    expect(merged.countState).toBe("settled");
    expect(merged.descriptors).toEqual([categorical("status", 2), keyList]);
  });

  it("marks the previous query's counts stale while a newer one is in flight", () => {
    const merged = mergeFacetDescriptors({
      discovered: [keyList],
      filtered: [categorical("status", 2)],
      filteredIsPlaceholder: true,
    });

    expect(merged.countState).toBe("stale");
  });
});

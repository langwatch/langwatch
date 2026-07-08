import { describe, expect, it } from "vitest";
import { pinnedSourceFromColumn } from "../trace-summary.clickhouse.repository";

/**
 * Both read paths (summary + list) map the stored `PinnedSource` column through
 * this helper. The empty string is the column default for every never-pinned or
 * unpinned trace, so it MUST degrade to `null` (unpinned) — otherwise the Pin
 * button and the "pinned" facet would treat unpinned traces as pinned.
 */
describe("pinnedSourceFromColumn", () => {
  it("maps 'manual' and 'share' through unchanged", () => {
    expect(pinnedSourceFromColumn("manual")).toBe("manual");
    expect(pinnedSourceFromColumn("share")).toBe("share");
  });

  it("treats the empty-string default as unpinned", () => {
    expect(pinnedSourceFromColumn("")).toBeNull();
  });

  it("degrades an unexpected legacy value to unpinned rather than leaking it", () => {
    expect(pinnedSourceFromColumn("legacy-value")).toBeNull();
  });

  it("treats null / undefined as unpinned", () => {
    expect(pinnedSourceFromColumn(null)).toBeNull();
    expect(pinnedSourceFromColumn(undefined)).toBeNull();
  });
});

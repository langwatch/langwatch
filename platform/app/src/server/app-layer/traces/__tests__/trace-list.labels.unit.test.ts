import { describe, expect, it } from "vitest";
import { parseLabels } from "../trace-list.service";

/**
 * `parseLabels` decodes the `langwatch.labels` summary attribute (a
 * JSON-encoded string array). Its graceful-degradation branches — malformed
 * JSON, non-array payloads, non-string / empty elements — are exactly the
 * kind that silently regress, so they're pinned here.
 */
describe("parseLabels", () => {
  describe("given a well-formed JSON string array", () => {
    it("returns the labels", () => {
      expect(parseLabels('["prod","beta"]')).toEqual(["prod", "beta"]);
    });
  });

  describe("given a missing or empty value", () => {
    it("returns no labels", () => {
      expect(parseLabels(undefined)).toEqual([]);
      expect(parseLabels("")).toEqual([]);
    });
  });

  describe("given malformed or non-array JSON", () => {
    it("degrades to no labels rather than throwing", () => {
      expect(parseLabels("not json")).toEqual([]);
      expect(parseLabels('"notarray"')).toEqual([]);
      expect(parseLabels('{"a":1}')).toEqual([]);
    });
  });

  describe("given an array with non-string / empty elements", () => {
    it("keeps only the non-empty strings", () => {
      expect(parseLabels('["a", 2, "", "b", null]')).toEqual(["a", "b"]);
    });
  });
});

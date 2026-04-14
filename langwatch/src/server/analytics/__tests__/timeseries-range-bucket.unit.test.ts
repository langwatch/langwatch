import { describe, expect, it } from "vitest";
import { rangeBucketWithDate } from "../timeseries";

describe("rangeBucketWithDate()", () => {
  describe("when bucket has both key_as_string and from_as_string", () => {
    it("overrides key_as_string with from_as_string", () => {
      const bucket = {
        key: "current",
        key_as_string: "current",
        from: 1735689600000,
        from_as_string: "2025-01-01T00:00:00.000Z",
        to: 1738368000000,
        to_as_string: "2025-02-01T00:00:00.000Z",
        doc_count: 42,
      };

      const result = rangeBucketWithDate(bucket);

      expect(result.key_as_string).toBe("2025-01-01T00:00:00.000Z");
    });

    it("preserves all other bucket fields", () => {
      const bucket = {
        key: "previous",
        key_as_string: "previous",
        from_as_string: "2024-12-01T00:00:00.000Z",
        doc_count: 35,
        some_agg: { value: 100 },
      };

      const result = rangeBucketWithDate(bucket);

      expect(result.key).toBe("previous");
      expect(result.doc_count).toBe(35);
      expect(result.some_agg).toEqual({ value: 100 });
    });
  });

  describe("when bucket has no key_as_string", () => {
    it("sets key_as_string to from_as_string", () => {
      const bucket = {
        key: "current",
        from_as_string: "2025-01-01T00:00:00.000Z",
        doc_count: 10,
      };

      const result = rangeBucketWithDate(bucket);

      expect(result.key_as_string).toBe("2025-01-01T00:00:00.000Z");
    });
  });

  describe("when bucket is undefined", () => {
    it("returns object with key_as_string undefined", () => {
      const result = rangeBucketWithDate(undefined);

      expect(result.key_as_string).toBeUndefined();
    });
  });
});

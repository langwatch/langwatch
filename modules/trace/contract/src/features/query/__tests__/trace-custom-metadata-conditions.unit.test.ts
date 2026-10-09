import { describe, expect, it } from "vitest";

import {
  customMetadataKeyCondition,
  customMetadataValueCondition,
} from "../trace-custom-metadata-conditions.ts";

describe("customMetadataKeyCondition", () => {
  describe("given a dot-encoded key and a table alias", () => {
    it("reads the key from all three storage formats under that alias", () => {
      const result = customMetadataKeyCondition({
        values: ["nested·key"],
        paramId: "f0",
        alias: "ta",
      });

      expect(result.params).toEqual({
        f0_k0_canonical: "metadata.nested.key",
        f0_k0_lw: "langwatch.metadata.nested.key",
        f0_k0_bare: "nested.key",
      });
      expect(result.sql).toContain("ta.Attributes");
      expect(result.sql).not.toContain("ts.Attributes");
    });

    it("pairs mapContains with a non-empty check for every format", () => {
      const { sql } = customMetadataKeyCondition({ values: ["k"], paramId: "f0", alias: "ts" });

      for (const format of ["canonical", "lw", "bare"]) {
        expect(sql).toContain(
          `(mapContains(ts.Attributes, {f0_k0_${format}:String}) AND ts.Attributes[{f0_k0_${format}:String}] != '')`,
        );
      }
    });
  });

  describe("given no keys", () => {
    it("matches nothing", () => {
      expect(customMetadataKeyCondition({ values: [], paramId: "f0", alias: "ts" })).toEqual({
        sql: "1=0",
        params: {},
      });
    });
  });
});

describe("customMetadataValueCondition", () => {
  describe("given a key", () => {
    it("matches the values under any of the three storage formats", () => {
      const result = customMetadataValueCondition({
        values: ["ok"],
        paramId: "f1",
        key: "outcome",
        alias: "ts",
      });

      expect(result.params).toEqual({
        f1_canonical: "metadata.outcome",
        f1_lw: "langwatch.metadata.outcome",
        f1_bare: "outcome",
        f1_values: ["ok"],
      });
      expect(result.sql.match(/IN \(\{f1_values:Array\(String\)\}\)/g)).toHaveLength(3);
    });
  });

  describe("given no key", () => {
    it("matches nothing", () => {
      expect(
        customMetadataValueCondition({ values: ["ok"], paramId: "f1", key: undefined, alias: "ts" })
          .sql,
      ).toBe("1=0");
    });
  });
});

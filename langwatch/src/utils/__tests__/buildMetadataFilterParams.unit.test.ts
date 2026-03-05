import { describe, expect, it } from "vitest";
import { buildMetadataFilterParams } from "../buildMetadataFilterParams";

describe("buildMetadataFilterParams", () => {
  describe("when key is trace_id", () => {
    it("returns query param with trace_id search syntax", () => {
      const result = buildMetadataFilterParams("trace_id", "abc123", "abc123");

      expect(result).toEqual({ query: "trace_id:abc123" });
    });
  });

  describe("when key is a reserved metadata key", () => {
    it("returns the mapped urlKey param for user_id", () => {
      const result = buildMetadataFilterParams(
        "user_id",
        "user-123",
        "user-123",
      );

      expect(result).toEqual({ user_id: "user-123" });
    });

    it("returns the mapped urlKey param for thread_id", () => {
      const result = buildMetadataFilterParams(
        "thread_id",
        "thread-1",
        "thread-1",
      );

      expect(result).toEqual({ thread_id: "thread-1" });
    });

    it("returns the mapped urlKey param for customer_id", () => {
      const result = buildMetadataFilterParams(
        "customer_id",
        "cust-1",
        "cust-1",
      );

      expect(result).toEqual({ customer_id: "cust-1" });
    });

    it("returns the mapped urlKey param for labels with all values", () => {
      const result = buildMetadataFilterParams("labels", "foo, bar", [
        "foo",
        "bar",
      ]);

      expect(result).toEqual({ labels: "foo,bar" });
    });

    it("returns prompt_id urlKey for prompt_ids key", () => {
      const result = buildMetadataFilterParams(
        "prompt_ids",
        "prompt-1",
        "prompt-1",
      );

      expect(result).toEqual({ prompt_id: "prompt-1" });
    });

    describe("when originalValue is an array", () => {
      it("passes all array elements for OR filtering", () => {
        const result = buildMetadataFilterParams("labels", "a, b, c", [
          "a",
          "b",
          "c",
        ]);

        expect(result).toEqual({ labels: "a,b,c" });
      });
    });

    describe("when originalValue is not an array", () => {
      it("uses value directly as filter value", () => {
        const result = buildMetadataFilterParams(
          "user_id",
          "user-xyz",
          "user-xyz",
        );

        expect(result).toEqual({ user_id: "user-xyz" });
      });
    });
  });

  describe("when key is a custom metadata key", () => {
    it("returns metadata_key and metadata.{key} params", () => {
      const result = buildMetadataFilterParams(
        "environment",
        "production",
        "production",
      );

      expect(result).toEqual({
        metadata_key: "environment",
        "metadata.environment": "production",
      });
    });

    describe("when key contains dots", () => {
      it("replaces dots with middle dots in key", () => {
        const result = buildMetadataFilterParams(
          "app.version",
          "1.2.3",
          "1.2.3",
        );

        expect(result).toEqual({
          metadata_key: "app·version",
          "metadata.app·version": "1.2.3",
        });
      });
    });
  });
});

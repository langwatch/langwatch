/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  buildSpendFilterClauses,
  intersectIds,
  parseMetadataFilters,
  spendFilterQueryShape,
} from "../spendFilters";

describe("the shared spend filter vocabulary", () => {
  describe("when a filter appears once in the query", () => {
    it("accepts the bare string hono hands back", () => {
      // Hono gives a string for one occurrence and an array for repeats, so a
      // schema that took only arrays would reject the commoner half.
      const parsed = spendFilterQueryShape.model.parse("gpt-5-mini");
      expect(parsed).toEqual(["gpt-5-mini"]);
    });
  });

  describe("when a filter is repeated", () => {
    it("keeps every value it names", () => {
      const parsed = spendFilterQueryShape.model.parse([
        "gpt-5-mini",
        "claude-opus-5",
      ]);
      expect(parsed).toEqual(["gpt-5-mini", "claude-opus-5"]);
    });
  });

  describe("when a metadata pair is written", () => {
    it("splits on the first colon so a value may contain one", () => {
      expect(parseMetadataFilters(["url:https://acme.test/x"])).toEqual([
        { key: "url", values: ["https://acme.test/x"] },
      ]);
    });

    it("widens a repeated key and narrows across different keys", () => {
      // Two values for one key must OR. ANDing them would make
      // tier:gold + tier:silver match nothing, which reads to the caller as
      // "no such spend" rather than as an impossible question.
      expect(
        parseMetadataFilters(["tier:gold", "tier:silver", "region:eu"]),
      ).toEqual([
        { key: "tier", values: ["gold", "silver"] },
        { key: "region", values: ["eu"] },
      ]);
    });

    it("refuses a pair with no key", () => {
      expect(() => spendFilterQueryShape.metadata.parse(":gold")).toThrow();
    });

    it("refuses a pair with no value", () => {
      // ClickHouse answers a missing Map key with the value type's default,
      // so `tier:` would read as '' IN ('') and match every row that has no
      // `tier` at all: the exact opposite of the narrowing asked for.
      expect(() => spendFilterQueryShape.metadata.parse("tier:")).toThrow();
    });

    it("refuses a pair with no colon at all", () => {
      expect(() => spendFilterQueryShape.metadata.parse("tier")).toThrow();
    });
  });

  describe("when filters are rendered to SQL", () => {
    it("binds a placeholder only for the filters present", () => {
      const { clauses, params } = buildSpendFilterClauses({
        filters: { models: ["gpt-5-mini"] },
      });
      expect(clauses).toEqual(["Model IN {models:Array(String)}"]);
      expect(params).toEqual({ models: ["gpt-5-mini"] });
    });

    it("still emits the predicate when a present filter is empty", () => {
      // The whole point: a team with no projects or an external id nobody
      // minted must answer nothing, not collapse into an absent predicate and
      // hand back the organization's entire spend.
      const { clauses, params } = buildSpendFilterClauses({
        filters: { virtualKeyIds: [] },
      });
      expect(clauses).toEqual([
        "VirtualKeyId IN {virtualKeyIds:Array(String)}",
      ]);
      expect(params).toEqual({ virtualKeyIds: [] });
    });

    it("matches a label against any of the values named", () => {
      const { clauses } = buildSpendFilterClauses({
        filters: { labels: ["tier:gold"] },
      });
      expect(clauses).toEqual(["hasAny(Labels, {labels:Array(String)})"]);
    });

    it("gives each metadata pair its own numbered placeholders", () => {
      const { clauses, params } = buildSpendFilterClauses({
        filters: {
          metadata: [
            { key: "tier", values: ["gold"] },
            { key: "region", values: ["eu", "us"] },
          ],
        },
      });
      expect(clauses).toEqual([
        "MetadataMap[{metadataKey0:String}] IN {metadataValues0:Array(String)}",
        "MetadataMap[{metadataKey1:String}] IN {metadataValues1:Array(String)}",
      ]);
      expect(params).toEqual({
        metadataKey0: "tier",
        metadataValues0: ["gold"],
        metadataKey1: "region",
        metadataValues1: ["eu", "us"],
      });
    });

    it("maps the legacy status vocabulary onto lifecycle statuses", () => {
      const { params } = buildSpendFilterClauses({
        filters: { status: "success" },
      });
      expect(params.status).toBe("confirmed");
    });
  });

  describe("when a key is named directly and by external id", () => {
    it("intersects rather than widening", () => {
      expect(intersectIds(["vk_1", "vk_2"], ["vk_2", "vk_3"])).toEqual([
        "vk_2",
      ]);
    });

    it("treats an absent list as no opinion", () => {
      expect(intersectIds(undefined, ["vk_1"])).toEqual(["vk_1"]);
      expect(intersectIds(["vk_1"], undefined)).toEqual(["vk_1"]);
    });

    it("answers nothing when the two name different keys", () => {
      expect(intersectIds(["vk_1"], ["vk_2"])).toEqual([]);
    });
  });
});

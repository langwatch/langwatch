/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  buildSpendFilterClauses,
  intersectIds,
  MAX_FILTER_VALUES,
  normalizeStatusFilter,
  parseMetadataFilters,
  SPEND_STATUS_FILTERS,
  spendFilterQueryShape,
  spendFiltersSchema,
} from "../src";

/** Which fields a parse rejected, so a refusal test can name the rule it
 *  meant rather than settling for "something threw". */
function issuePaths(result: { success: boolean; error?: z.ZodError }): string[] {
  if (result.success) throw new Error("expected the parse to be refused");
  return (result.error?.issues ?? []).map((issue) => issue.path.join("."));
}

describe("given the shared spend filter vocabulary", () => {
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
      const parsed = spendFilterQueryShape.model.parse(["gpt-5-mini", "claude-opus-5"]);
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
      expect(parseMetadataFilters(["tier:gold", "tier:silver", "region:eu"])).toEqual([
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

    /** @scenario "A metadata pair with no colon is refused, not re-cut" */
    it("refuses a colon-less pair at the function, not only at the schema", () => {
      // Slicing on an absent colon is silently wrong rather than empty:
      // indexOf answers -1, so `tier` would become key `tie` with value
      // `tier`, and the caller would read spend for a filter nobody wrote.
      expect(() => parseMetadataFilters(["tier"])).toThrow();
      expect(() => parseMetadataFilters([":gold"])).toThrow();
      expect(() => parseMetadataFilters(["tier:"])).toThrow();
    });

    /** @scenario "One filter may not name unbounded values" */
    it("refuses more values than one filter may name", () => {
      // Each value becomes an element of a bound ClickHouse array and each
      // metadata entry a predicate of its own, so an unbounded repeat is an
      // unbounded query on a billing read.
      const tooMany = Array.from(
        { length: MAX_FILTER_VALUES + 1 },
        (_, index) => `m${index}`,
      );
      expect(() => spendFilterQueryShape.model.parse(tooMany)).toThrow();
      expect(issuePaths(spendFiltersSchema.safeParse({ models: tooMany }))).toEqual([
        "models",
      ]);
    });
  });

  describe("when the structured spelling is parsed", () => {
    it("accepts what the query spelling accepts", () => {
      const parsed = spendFiltersSchema.parse({
        models: ["gpt-5-mini"],
        metadata: [{ key: "customer_tier", values: ["gold", "silver"] }],
      });
      expect(parsed.metadata).toEqual([
        { key: "customer_tier", values: ["gold", "silver"] },
      ]);
    });

    it("refuses a metadata key the query spelling could not express", () => {
      // A key with a colon is unaddressable in `key:value`, so accepting it
      // here would let the screen set a filter no reconciliation script can
      // reproduce, which is the drift this module exists to prevent.
      //
      // The path is asserted, not just the rejection: this input is otherwise
      // valid, so a test that only proves "something threw" would keep passing
      // if the colon rule were dropped and some unrelated rule tripped instead.
      expect(
        issuePaths(
          spendFiltersSchema.safeParse({
            metadata: [{ key: "region:env", values: ["eu"] }],
          }),
        ),
      ).toEqual(["metadata.0.key"]);
    });

    it("refuses an empty metadata value", () => {
      expect(
        issuePaths(
          spendFiltersSchema.safeParse({
            metadata: [{ key: "tier", values: [""] }],
          }),
        ),
      ).toEqual(["metadata.0.values.0"]);
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
      expect(clauses).toEqual(["VirtualKeyId IN {virtualKeyIds:Array(String)}"]);
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

    /** @scenario "Every status the surface publishes can be narrowed on" */
    it("resolves every published status rather than a hand-copied subset", () => {
      // The boundary validates against SPEND_STATUS_FILTERS and the SQL
      // builder resolves through normalizeStatusFilter. Written out
      // separately, a status added to the published list would pass the door
      // and then throw inside, turning a validated request into a 500.
      for (const status of SPEND_STATUS_FILTERS) {
        expect(() => normalizeStatusFilter(status), status).not.toThrow();
        expect(normalizeStatusFilter(status), status).toBeDefined();
      }
      expect(() => normalizeStatusFilter("pending")).toThrow();
      // An object lookup would answer this with a function off the prototype
      // and hand it back as if it were a status.
      expect(() => normalizeStatusFilter("constructor")).toThrow();
    });
  });

  describe("when a key is named directly and by external id", () => {
    it("intersects rather than widening", () => {
      expect(intersectIds(["vk_1", "vk_2"], ["vk_2", "vk_3"])).toEqual(["vk_2"]);
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

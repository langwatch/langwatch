/**
 * A create card is the one card whose copy asserts a fact about the world, so
 * the contract has to decide — once, here — when a payload can carry that
 * claim.
 *
 * @see specs/langy/langy-capability-cards.feature
 *      "A write card never claims success on a result that names nothing"
 */
import { describe, expect, it } from "vitest";
import { SCHEMA_BY_CARD_KIND, namesCreatedResource } from "./schemas.js";
import { parseCliResult } from "./registry.js";
import { parseCliToolResult, toCliToolResult } from "./tool-result.js";

describe("namesCreatedResource", () => {
  describe("given a payload that names nothing", () => {
    it("rejects an empty array", () => {
      expect(namesCreatedResource([])).toBe(false);
    });

    it("rejects an empty object", () => {
      expect(namesCreatedResource({})).toBe(false);
    });

    it("rejects an acknowledgement carrying no identity", () => {
      expect(namesCreatedResource({ ok: true })).toBe(false);
    });

    it("rejects an empty collection", () => {
      expect(namesCreatedResource({ data: [] })).toBe(false);
    });

    it("rejects a blank id", () => {
      expect(namesCreatedResource({ id: "   " })).toBe(false);
    });
  });

  describe("given a payload that names the created resource", () => {
    it("accepts an id", () => {
      expect(namesCreatedResource({ id: "scenario_1" })).toBe(true);
    });

    it("accepts a resource-specific id spelling", () => {
      expect(namesCreatedResource({ scenario_id: "scenario_1" })).toBe(true);
    });

    it("accepts a human name", () => {
      expect(namesCreatedResource({ name: "Customer support agent" })).toBe(
        true,
      );
    });

    it("accepts a non-empty collection", () => {
      expect(namesCreatedResource({ data: [{ id: "a" }] })).toBe(true);
    });

    it("accepts a non-empty array", () => {
      expect(namesCreatedResource([{ id: "a" }])).toBe(true);
    });
  });
});

describe("reading a create result as a created-resource card", () => {
  describe("when the result names no resource", () => {
    it("refuses the card schema", () => {
      expect(
        SCHEMA_BY_CARD_KIND.resourceCreated.safeParse([]).success,
      ).toBe(false);
    });

    it("fails to parse as a create result", () => {
      const parsed = parseCliResult({
        resource: "scenario",
        verb: "create",
        output: [],
      });
      expect(parsed).toMatchObject({ ok: false, kind: "resourceCreated" });
    });

    it("records the outcome as unconfirmed rather than dropping the card", () => {
      expect(
        toCliToolResult({ resource: "scenario", verb: "create", payload: [] }),
      ).toEqual({
        kind: "card",
        card: "resourceCreated",
        payload: [],
        outcome: "unconfirmed",
      });
    });

    it("keeps the unconfirmed verdict through storage and replay", () => {
      const result = toCliToolResult({
        resource: "scenario",
        verb: "create",
        payload: {},
      });
      expect(parseCliToolResult(JSON.stringify(result))).toEqual(result);
    });
  });

  describe("when the result names the created resource", () => {
    it("parses as a create result", () => {
      const parsed = parseCliResult({
        resource: "scenario",
        verb: "create",
        output: { id: "scenario_1", name: "Customer support agent" },
      });
      expect(parsed.ok).toBe(true);
    });

    it("records no unconfirmed verdict", () => {
      const result = toCliToolResult({
        resource: "scenario",
        verb: "create",
        payload: { id: "scenario_1" },
      });
      expect(result).toEqual({
        kind: "card",
        card: "resourceCreated",
        payload: { id: "scenario_1" },
      });
    });
  });

  describe("when the verb is not a create", () => {
    it("leaves an empty update result alone", () => {
      expect(
        toCliToolResult({ resource: "scenario", verb: "update", payload: {} }),
      ).toEqual({ kind: "card", card: "resourceUpdated", payload: {} });
    });

    it("leaves an empty delete result alone", () => {
      expect(
        toCliToolResult({ resource: "scenario", verb: "delete", payload: {} }),
      ).toEqual({ kind: "card", card: "resourceRemoved", payload: {} });
    });
  });
});

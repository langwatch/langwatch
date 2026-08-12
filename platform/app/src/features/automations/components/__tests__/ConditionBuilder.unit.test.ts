/**
 * Pure-logic coverage for the builder's custom-attribute support (F7). The
 * Builder used to filter `trace.attribute.<key>` and friends out of its
 * field list entirely, so a condition on a custom attribute was only
 * expressible in Code mode. These pin the field-matching helpers
 * `ConditionRow` uses to render the key sub-input, and that a condition
 * built from them round-trips through the same query language the Code
 * editor reads and writes — no rendering involved, so this stays a unit
 * test (see `ConditionBuilder.integration.test.tsx` for the rendered path).
 */
import { describe, expect, it } from "vitest";
import {
  isConditionComplete,
  queryToConditions,
  serializeConditions,
} from "../../logic/conditionQuery";
import { isPrefixOnly, matchAttributePrefix } from "../ConditionBuilder";

describe("matchAttributePrefix", () => {
  describe("given a plain field", () => {
    it("matches no prefix", () => {
      expect(matchAttributePrefix("status")).toBeNull();
      expect(matchAttributePrefix("")).toBeNull();
    });
  });

  describe("given a bare custom-attribute prefix with no key yet", () => {
    it("matches the prefix option", () => {
      expect(matchAttributePrefix("trace.attribute.")?.value).toBe(
        "trace.attribute.",
      );
    });
  });

  describe("given a custom-attribute prefix with a key typed in", () => {
    it("still matches the same prefix option", () => {
      expect(matchAttributePrefix("trace.attribute.user_id")?.value).toBe(
        "trace.attribute.",
      );
      expect(matchAttributePrefix("span.attribute.model")?.value).toBe(
        "span.attribute.",
      );
    });
  });
});

describe("isPrefixOnly", () => {
  it("is true for a prefix with no key typed yet", () => {
    expect(isPrefixOnly("trace.attribute.")).toBe(true);
  });

  it("is false once a key is typed", () => {
    expect(isPrefixOnly("trace.attribute.user_id")).toBe(false);
  });

  it("is false for a plain field", () => {
    expect(isPrefixOnly("status")).toBe(false);
  });
});

describe("a builder condition on a custom attribute", () => {
  /** @scenario "A builder condition on a custom attribute round-trips to the code editor" */
  it("round-trips to the code editor and back unchanged", () => {
    const condition = {
      id: "c0",
      field: "trace.attribute.user_id",
      operator: "is" as const,
      value: "premium",
    };
    expect(isConditionComplete(condition)).toBe(true);

    // Builder row -> the same string the Code editor shows.
    const query = serializeConditions([condition]);
    expect(query).toBe("trace.attribute.user_id:premium");

    // Code editor's string -> back into a builder row, unchanged.
    const reparsed = queryToConditions(query);
    expect(reparsed).toEqual([condition]);

    // The reparsed field is still recognised as the same attribute prefix,
    // so the builder renders it with the key sub-input filled in rather
    // than falling back to a plain, unmatched field select.
    expect(matchAttributePrefix(reparsed![0]!.field)?.value).toBe(
      "trace.attribute.",
    );
  });
});

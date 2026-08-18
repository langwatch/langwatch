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
import type { Condition } from "../../logic/conditionQuery";
import {
  isConditionComplete,
  queryToConditions,
  serializeConditions,
} from "../../logic/conditionQuery";
import {
  attributeFieldRoundTrips,
  isPrefixOnly,
  isUsableCondition,
  matchAttributePrefix,
} from "../ConditionBuilder";

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

/**
 * `field` is the one place the query string is built from raw user
 * keystrokes rather than a fixed dropdown token — `serializeCondition`
 * (conditionQuery.ts) only escapes the VALUE, never the field. A key
 * containing whitespace or Liqe query syntax (liqe is the parser behind
 * the filter language) can silently retarget what the
 * clause matches instead of failing loudly (a space splits it into two
 * unrelated clauses; a lone space fails to parse at all). These pin that
 * every such key is rejected, never silently saved.
 */
describe("attributeFieldRoundTrips", () => {
  const attributeCondition = ({
    key,
    overrides = {},
  }: {
    key: string;
    overrides?: Partial<Condition>;
  }): Condition => ({
    id: "c0",
    field: `trace.attribute.${key}`,
    operator: "is",
    value: "premium",
    ...overrides,
  });

  describe("given a row that isn't a custom-attribute field", () => {
    it("is always true — nothing to validate", () => {
      expect(
        attributeFieldRoundTrips({
          id: "c0",
          field: "status",
          operator: "is",
          value: "error",
        }),
      ).toBe(true);
    });
  });

  describe("given an attribute row that isn't complete yet", () => {
    it("is true for a bare prefix with no key typed", () => {
      expect(
        attributeFieldRoundTrips({
          id: "c0",
          field: "trace.attribute.",
          operator: "is",
          value: "",
        }),
      ).toBe(true);
    });

    it("is true for a key typed but no value yet", () => {
      expect(
        attributeFieldRoundTrips(
          attributeCondition({ key: "user_id", overrides: { value: "" } }),
        ),
      ).toBe(true);
    });
  });

  describe("given a key that is safe to save", () => {
    it("round-trips for a plain identifier", () => {
      expect(
        attributeFieldRoundTrips(attributeCondition({ key: "user_id" })),
      ).toBe(true);
    });

    it("round-trips for a hyphenated identifier", () => {
      expect(
        attributeFieldRoundTrips(attributeCondition({ key: "user-id" })),
      ).toBe(true);
    });
  });

  describe("given a key that would change what the filter matches", () => {
    /** @scenario "An attribute key that would change the meaning of the filter is rejected" */
    it("rejects a key with an internal space — it would split into two unrelated clauses", () => {
      expect(
        attributeFieldRoundTrips(attributeCondition({ key: "foo bar" })),
      ).toBe(false);
    });

    it("rejects a key that is only whitespace — it fails to parse at all", () => {
      expect(attributeFieldRoundTrips(attributeCondition({ key: " " }))).toBe(
        false,
      );
    });

    it("rejects a key with leading whitespace", () => {
      expect(
        attributeFieldRoundTrips(attributeCondition({ key: " user_id" })),
      ).toBe(false);
    });

    it("rejects a key with trailing whitespace", () => {
      expect(
        attributeFieldRoundTrips(attributeCondition({ key: "user_id " })),
      ).toBe(false);
    });

    it("rejects a key containing a colon", () => {
      expect(
        attributeFieldRoundTrips(attributeCondition({ key: "user:id" })),
      ).toBe(false);
    });

    it("rejects a key containing a quote", () => {
      expect(
        attributeFieldRoundTrips(attributeCondition({ key: 'user"id' })),
      ).toBe(false);
    });
  });

  describe("given the composed row is never handed to onChange", () => {
    it("a row with an unsafe key never appears in the serialised query", () => {
      const bad = attributeCondition({ key: "foo bar" });
      const good = {
        id: "c1",
        field: "status",
        operator: "is" as const,
        value: "error",
      };
      const usable = [bad, good].filter(isUsableCondition);

      expect(serializeConditions(usable)).toBe("status:error");
    });
  });
});

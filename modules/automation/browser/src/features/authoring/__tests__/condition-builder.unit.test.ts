/**
 * The builder's custom-attribute helpers: the field matching `ConditionRow` uses to render
 * the key sub-input, and that a condition built from them round-trips through the query
 * language the Code editor reads and writes. The rendered path is the integration suite.
 */
import { describe, expect, it } from "vitest";

import {
  type Condition,
  isConditionComplete,
  queryToConditions,
  serializeConditions,
} from "../model/condition-query.ts";
import {
  attributeFieldRoundTrips,
  isPrefixOnly,
  isUsableCondition,
  matchAttributePrefix,
} from "../ui/blocks/condition-builder.tsx";

const prefixOf = (field: string) => matchAttributePrefix(field).map((opt) => opt.value);

describe("matchAttributePrefix", () => {
  describe("given a plain field", () => {
    it("matches no prefix", () => {
      expect(matchAttributePrefix("status")).toEqual([]);
      expect(matchAttributePrefix("")).toEqual([]);
    });
  });

  describe("given a bare custom-attribute prefix with no key yet", () => {
    it("matches the prefix option", () => {
      expect(prefixOf("trace.attribute.")).toEqual(["trace.attribute."]);
    });
  });

  describe("given a custom-attribute prefix with a key typed in", () => {
    it("still matches the same prefix option", () => {
      expect(prefixOf("trace.attribute.user_id")).toEqual(["trace.attribute."]);
      expect(prefixOf("span.attribute.model")).toEqual(["span.attribute."]);
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
    const condition: Condition = {
      id: "c0",
      field: "trace.attribute.user_id",
      operator: "is",
      value: "premium",
    };
    expect(isConditionComplete(condition)).toBe(true);

    const query = serializeConditions([condition]);
    expect(query).toBe("trace.attribute.user_id:premium");

    const reparsed = queryToConditions(query) ?? [];
    expect(reparsed).toEqual([condition]);
    // Still the same attribute prefix, so the row renders with its key filled in.
    expect(reparsed.flatMap((c) => prefixOf(c.field))).toEqual(["trace.attribute."]);
  });
});

/** `field` is the one place the query is built from raw keystrokes, and it serialises
 *  unescaped, so every key that could retarget the clause is rejected, never saved. */
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
        attributeFieldRoundTrips({ id: "c0", field: "status", operator: "is", value: "error" }),
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
        attributeFieldRoundTrips(attributeCondition({ key: "user_id", overrides: { value: "" } })),
      ).toBe(true);
    });
  });

  describe("given a key that is safe to save", () => {
    it("round-trips for a plain identifier", () => {
      expect(attributeFieldRoundTrips(attributeCondition({ key: "user_id" }))).toBe(true);
    });

    it("round-trips for a hyphenated identifier", () => {
      expect(attributeFieldRoundTrips(attributeCondition({ key: "user-id" }))).toBe(true);
    });
  });

  describe("given a key that would change what the filter matches", () => {
    /** @scenario "An attribute key that would change the meaning of the filter is rejected" */
    it("rejects a key with an internal space — it would split into two unrelated clauses", () => {
      expect(attributeFieldRoundTrips(attributeCondition({ key: "foo bar" }))).toBe(false);
    });

    it("rejects a key that is only whitespace — it fails to parse at all", () => {
      expect(attributeFieldRoundTrips(attributeCondition({ key: " " }))).toBe(false);
    });

    it("rejects a key with leading whitespace", () => {
      expect(attributeFieldRoundTrips(attributeCondition({ key: " user_id" }))).toBe(false);
    });

    it("rejects a key with trailing whitespace", () => {
      expect(attributeFieldRoundTrips(attributeCondition({ key: "user_id " }))).toBe(false);
    });

    it("rejects a key containing a colon", () => {
      expect(attributeFieldRoundTrips(attributeCondition({ key: "user:id" }))).toBe(false);
    });

    it("rejects a key containing a quote", () => {
      expect(attributeFieldRoundTrips(attributeCondition({ key: 'user"id' }))).toBe(false);
    });
  });

  describe("given the composed row is never handed to onChange", () => {
    it("a row with an unsafe key never appears in the serialised query", () => {
      const bad = attributeCondition({ key: "foo bar" });
      const good: Condition = { id: "c1", field: "status", operator: "is", value: "error" };

      expect(serializeConditions([bad, good].filter(isUsableCondition))).toBe("status:error");
    });
  });
});

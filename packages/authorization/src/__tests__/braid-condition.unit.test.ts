import { describe, expect, it } from "vitest";

import {
  BRAID_CONDITION_COMPILER_VERSION,
  BRAID_CONDITION_MAX_DEPTH,
  BRAID_CONDITION_MAX_LENGTH,
  BRAID_CONDITION_MAX_TERMS,
  type BraidConditionNode,
  braidConditionTermsOf,
  compiledWhereSchema,
} from "../index";

/**
 * ADR-185 §3: the compiled condition a braid stores and its bounds. The OTTL compiler is
 * authz's; this is only the tree it writes.
 */

const orchestrator: BraidConditionNode = {
  kind: "attributeEquals",
  on: "span",
  key: "orchestrator",
  value: "web",
};

const nested = (depth: number): BraidConditionNode =>
  depth === 0 ? orchestrator : { kind: "and", terms: [nested(depth - 1)] };

describe("braid conditions", () => {
  describe("given a tree in the supported set", () => {
    it("parses every comparison the compiler emits, nested inside conjunctions", () => {
      const tree: BraidConditionNode = {
        kind: "and",
        terms: [
          orchestrator,
          { kind: "attributeEquals", on: "resource", key: "service.name", value: "checkout" },
          { kind: "nameEquals", value: "payments_agent" },
          { kind: "and", terms: [{ kind: "attributePresent", key: "orchestrator" }] },
          { kind: "verified", key: "orchestrator" },
        ],
      };

      const parsed = compiledWhereSchema.parse({ version: BRAID_CONDITION_COMPILER_VERSION, tree });

      expect(braidConditionTermsOf(parsed.tree).map((term) => term.kind)).toEqual([
        "attributeEquals",
        "attributeEquals",
        "nameEquals",
        "attributePresent",
        "verified",
      ]);
    });

    it("accepts the top-level conjunction plus the deepest nesting the text allows", () => {
      expect(
        compiledWhereSchema.validate({ version: 1, tree: nested(BRAID_CONDITION_MAX_DEPTH + 1) }),
      ).toBe(true);
    });
  });

  describe("given a tree past a bound", () => {
    it("refuses more comparisons than a condition may hold", () => {
      const terms = Array.from({ length: BRAID_CONDITION_MAX_TERMS + 1 }, () => orchestrator);
      const split = {
        kind: "and",
        terms: [{ kind: "and", terms: terms.slice(0, 8) }, ...terms.slice(8)],
      };

      expect(compiledWhereSchema.validate({ version: 1, tree: split })).toBe(false);
    });

    it("refuses conjunctions nested deeper than the text may nest", () => {
      expect(
        compiledWhereSchema.validate({ version: 1, tree: nested(BRAID_CONDITION_MAX_DEPTH + 2) }),
      ).toBe(false);
    });

    it("refuses more literal characters than the condition text may hold", () => {
      const long = "k".repeat(BRAID_CONDITION_MAX_LENGTH / 2);
      const tree = {
        kind: "and",
        terms: [
          { kind: "attributeEquals", on: "span", key: long, value: long },
          { kind: "nameEquals", value: "x" },
        ],
      };

      expect(compiledWhereSchema.validate({ version: 1, tree })).toBe(false);
    });

    it("refuses an empty conjunction, an empty value and a field it does not know", () => {
      const refused = [
        { kind: "and", terms: [] },
        { kind: "nameEquals", value: "" },
        { kind: "nameEquals", value: "x", or: true },
      ];
      for (const tree of refused) {
        expect(compiledWhereSchema.validate({ version: 1, tree })).toBe(false);
      }
    });
  });
});

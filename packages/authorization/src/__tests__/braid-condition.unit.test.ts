import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  BRAID_CONDITION_COMPILER_VERSION,
  BRAID_CONDITION_MAX_DEPTH,
  BRAID_CONDITION_MAX_LENGTH,
  BRAID_CONDITION_MAX_TERMS,
  type BraidConditionNode,
  braidConditionDigest,
  braidConditionTermsOf,
  compiledWhereSchema,
} from "../index";

/**
 * ADR-183 §3: the compiled condition a braid stores, its bounds, and the digest every fence
 * cache key carries. The OTTL compiler is authz's; this is only the tree it writes.
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
        compiledWhereSchema.validate({ version: 1, tree: nested(BRAID_CONDITION_MAX_DEPTH + 1) }),
      ).toBe(true);
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

  describe("given the digest a cache key carries", () => {
    it("is SHA-256 of the canonical tree, pinned so a library change cannot move a key", () => {
      const unicode: BraidConditionNode = {
        kind: "and",
        terms: [orchestrator, { kind: "nameEquals", value: "agent ünïcødé 🧵" }],
      };
      const canonicals = [
        {
          compiledWhere: { version: 1, tree: orchestrator },
          text: JSON.stringify([1, ["attributeEquals", "span", "orchestrator", "web"]]),
        },
        {
          compiledWhere: { version: 1, tree: unicode },
          text: JSON.stringify([
            1,
            [
              "and",
              ["attributeEquals", "span", "orchestrator", "web"],
              ["nameEquals", "agent ünïcødé 🧵"],
            ],
          ]),
        },
      ];

      expect(braidConditionDigest(canonicals[0]!.compiledWhere)).toBe(
        "bf4068a3995d55197b0866558a2c0df768d56be040bb8ee4758c93abab9f54b0",
      );
      expect(braidConditionDigest(canonicals[1]!.compiledWhere)).toBe(
        "fe6dac3cc5cb504bd93d93b314896eaa3d0a1dfe8ec248803f9b9056bbb0266c",
      );
      for (const { compiledWhere, text } of canonicals) {
        expect(braidConditionDigest(compiledWhere)).toBe(
          createHash("sha256").update(text, "utf8").digest("hex"),
        );
      }
    });

    it("changes when the tree or the compiler version changes, and only then", () => {
      const base = braidConditionDigest({ version: 1, tree: orchestrator });

      expect(braidConditionDigest({ version: 1, tree: { ...orchestrator } })).toBe(base);
      expect(braidConditionDigest({ version: 2, tree: orchestrator })).not.toBe(base);
      expect(
        braidConditionDigest({ version: 1, tree: { ...orchestrator, value: "cli" } }),
      ).not.toBe(base);
      expect(
        braidConditionDigest({ version: 1, tree: { ...orchestrator, on: "resource" } }),
      ).not.toBe(base);
    });
  });
});

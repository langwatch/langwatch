import {
  BRAID_CONDITION_COMPILER_VERSION,
  BRAID_CONDITION_MAX_DEPTH,
  BRAID_CONDITION_MAX_LENGTH,
  BRAID_CONDITION_MAX_TERMS,
  braidConditionDigest,
  braidConditionTermsOf,
  compiledWhereSchema,
  type BraidConditionNode,
  type BraidConditionTerm,
} from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { BRAID_CONDITION_REFUSAL_CODES } from "../authz.errors.ts";
import { compileBraidCondition } from "../braid-condition-compiler.ts";

function compiled({ text }: { text: string }): BraidConditionNode {
  const result = compileBraidCondition({ text });
  if (!result.ok) throw new Error(`expected ${text} to compile, refused with ${result.code}`);
  if (!result.compiledWhere) throw new Error(`expected ${text} to yield a tree`);
  return result.compiledWhere.tree;
}

function refusal({ text }: { text: string }) {
  const result = compileBraidCondition({ text });
  if (result.ok) throw new Error(`expected ${text} to be refused`);
  return result;
}

/** Every string a tree holds outside `kind` and `on`: what the fence binds as parameters. */
function leafStrings(node: BraidConditionNode): string[] {
  return braidConditionTermsOf(node).flatMap((term) =>
    Object.entries(term)
      .filter(([field]) => field !== "kind" && field !== "on")
      .map(([, value]) => String(value)),
  );
}

describe("compileBraidCondition", () => {
  describe("given a condition in the supported set", () => {
    /** @scenario "A condition in the supported set compiles" */
    it.each([
      [
        'attributes["orchestrator"] == "web"',
        { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
      ],
      [
        'resource.attributes["service.name"] == "checkout"',
        { kind: "attributeEquals", on: "resource", key: "service.name", value: "checkout" },
      ],
      ['name == "payments_agent"', { kind: "nameEquals", value: "payments_agent" }],
      ['attributes["orchestrator"] != nil', { kind: "attributePresent", key: "orchestrator" }],
      [
        'attributes["orchestrator"] == "web" and Verified("orchestrator")',
        {
          kind: "and",
          terms: [
            { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
            { kind: "verified", key: "orchestrator" },
          ],
        },
      ],
    ])("compiles %s into a tree whose only text is its literals", (text, tree) => {
      const node = compiled({ text });
      expect(node).toEqual(tree);
      for (const leaf of leafStrings(node)) expect(text).toContain(leaf);
    });

    it("unescapes quotes and backslashes in literals", () => {
      expect(compiled({ text: String.raw`name == "a \"quoted\" \\ name"` })).toEqual({
        kind: "nameEquals",
        value: String.raw`a "quoted" \ name`,
      });
    });

    it("compiles equivalent conjunctions to one flat tree and one digest", () => {
      const texts = [
        '(name == "a" and name == "b") and Verified("k")',
        'Verified("k") and name == "b" and name == "a"',
        'name == "a" and (name == "a" and (name == "b")) and Verified("k") and name == "b"',
      ];
      const trees = texts.map((text) => compiled({ text }));
      for (const tree of trees) {
        expect(tree).toEqual({
          kind: "and",
          terms: [
            { kind: "nameEquals", value: "a" },
            { kind: "nameEquals", value: "b" },
            { kind: "verified", key: "k" },
          ],
        });
      }
      const digests = trees.map((tree) =>
        braidConditionDigest({ version: BRAID_CONDITION_COMPILER_VERSION, tree }),
      );
      expect(new Set(digests).size).toBe(1);
    });

    it("emits a repeated single comparison bare", () => {
      expect(compiled({ text: '(name == "a") and name == "a"' })).toEqual({
        kind: "nameEquals",
        value: "a",
      });
    });
  });

  describe("given a condition outside the supported set", () => {
    /** @scenario "An unsupported condition is refused with a fix the admin can act on" */
    it.each([
      ['attributes["a"] == "x" or attributes["b"] == "y"', "or", 23],
      ['not attributes["a"] == "x"', "not", 0],
      ['IsMatch(attributes["a"], "^x")', "IsMatch", 0],
      ['attributes["latency"] > 100', "a numeric comparison", 22],
      ['attributes["a"] != "x"', "!= with a value", 19],
      ['attributes["flag"] == true', "a comparison with true", 22],
      ['attributes["a"] == ""', "an empty string", 19],
    ])("refuses %s naming %s where it stands", (text, construct, at) => {
      const result = refusal({ text });
      expect(result).toMatchObject({ code: "braid_condition_unsupported", construct, at });
      expect(result.fix.length).toBeGreaterThan(0);
    });

    it.each([
      'attributes["a"] == false',
      'attributes["a"] == nil',
      'resource.attributes["a"] != nil',
      "name != nil",
      'span.attributes["a"] == "x"',
      'attributes["a"]["b"] == "x"',
      'attributes["a"] = "x"',
      'attributes["a"]',
      'attributes == "x"',
      'attributes["a"] == "x" AND name == "y"',
      'attributes["a"] == "x" && name == "y"',
      'attributes["a"] == "x" || name == "y"',
      '"x" == attributes["a"]',
      'Verified("has space")',
      'Verified("a", "b")',
      'Verified("")',
      'attributes[""] == "x"',
      String.raw`name == "a\nb"`,
      'name == "x" ; drop',
    ])("refuses %s as unsupported", (text) => {
      expect(refusal({ text }).code).toBe("braid_condition_unsupported");
    });

    it.each([
      ['name == "unclosed', 8],
      ['(name == "a"', 0],
      ['name == "a")', 11],
      ['name == "a" and', 12],
      ['name == "a" and ()', 17],
      ['and name == "a"', 0],
      ['attributes["a" == "x"', 10],
      ["name ==", 7],
    ])("refuses malformed %s at offset %i", (text, at) => {
      expect(refusal({ text })).toMatchObject({ code: "braid_condition_syntax", at });
    });
  });

  describe("given no condition", () => {
    /** @scenario "A braid with no condition braids every owner span in the reader's traces" */
    it.each(["", "   ", "\n\t "])("accepts %j with no tree", (text) => {
      expect(compileBraidCondition({ text })).toEqual({ ok: true, compiledWhere: undefined });
    });
  });

  describe("given a condition that compiles", () => {
    /** @scenario "A compiled condition carries the compiler's version" */
    it("stores the compiler version beside the tree", () => {
      const result = compileBraidCondition({ text: 'name == "a"' });
      expect(result.ok && result.compiledWhere?.version).toBe(BRAID_CONDITION_COMPILER_VERSION);
    });
  });

  describe("given a condition past a size bound", () => {
    const term = 'name == "a"';
    const terms = (count: number) => Array.from({ length: count }, () => term).join(" and ");
    const nested = (depth: number) => `${"(".repeat(depth)}${term}${")".repeat(depth)}`;

    /** @scenario "A condition too large to read is refused" */
    it.each([
      ["characters", `name == "${"a".repeat(BRAID_CONDITION_MAX_LENGTH)}"`],
      ["comparisons", terms(BRAID_CONDITION_MAX_TERMS + 1)],
      ["depth", nested(BRAID_CONDITION_MAX_DEPTH + 1)],
    ])("refuses one past the %s bound and names it", (limit, text) => {
      expect(refusal({ text })).toMatchObject({ code: "braid_condition_too_large", limit });
    });

    it("accepts a condition at every bound", () => {
      const atBound = `${nested(BRAID_CONDITION_MAX_DEPTH)} and ${terms(BRAID_CONDITION_MAX_TERMS - 1)}`;
      expect(compileBraidCondition({ text: atBound }).ok).toBe(true);
      expect(compileBraidCondition({ text: " ".repeat(BRAID_CONDITION_MAX_LENGTH) }).ok).toBe(true);
    });
  });
});

/** A seeded generator, so a failing case replays; the package takes no property-test dependency. */
function seeded({ seed }: { seed: number }) {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const text = ({ min }: { min: number }) => {
    const alphabet = [
      '"',
      "\\",
      " ",
      "a",
      "Z",
      "9",
      ".",
      "_",
      "-",
      "(",
      ")",
      "é",
      "and",
      "or",
      "==",
    ];
    const length = min + Math.floor(next() * 8);
    return Array.from({ length }, () => pick(alphabet)).join("");
  };
  return { next, pick, text };
}

const quote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function render({ term }: { term: BraidConditionTerm }): string {
  switch (term.kind) {
    case "attributeEquals":
      return `${term.on === "resource" ? "resource." : ""}attributes[${quote(term.key)}] == ${quote(term.value)}`;
    case "nameEquals":
      return `name == ${quote(term.value)}`;
    case "attributePresent":
      return `attributes[${quote(term.key)}] != nil`;
    case "verified":
      return `Verified(${quote(term.key)})`;
  }
}

describe("compileBraidCondition properties", () => {
  it("yields leaves whose multiset equals the deduplicated literals in the text", () => {
    const random = seeded({ seed: 183 });
    for (let run = 0; run < 500; run++) {
      const count = 1 + Math.floor(random.next() * BRAID_CONDITION_MAX_TERMS);
      const terms: BraidConditionTerm[] = Array.from({ length: count }, () => {
        const kind = random.pick(["span", "resource", "name", "present", "verified"] as const);
        if (kind === "name") return { kind: "nameEquals", value: random.text({ min: 1 }) };
        if (kind === "present") return { kind: "attributePresent", key: random.text({ min: 1 }) };
        if (kind === "verified")
          return { kind: "verified", key: random.pick(["k", "a.b-c_9", "Z"]) };
        return {
          kind: "attributeEquals",
          on: kind,
          key: random.text({ min: 1 }),
          value: random.text({ min: 1 }),
        };
      });
      const text = terms
        .map((term) => (random.next() < 0.3 ? `(${render({ term })})` : render({ term })))
        .join(random.pick([" and ", "  and\n", " and\t"]));
      if (text.length > BRAID_CONDITION_MAX_LENGTH) continue;
      const leaves = braidConditionTermsOf(compiled({ text })).map((leaf) => JSON.stringify(leaf));
      const literals = [...new Set(terms.map((term) => JSON.stringify(term)))];
      expect(leaves.toSorted()).toEqual(literals.toSorted());
    }
  });

  it("answers any text with a schema-valid tree or a named refusal inside the text", () => {
    const random = seeded({ seed: 166 });
    const pieces = [
      'attributes["k"]',
      "name",
      "==",
      "!=",
      '"v"',
      '""',
      "nil",
      "and",
      "or",
      "(",
      ")",
      "Verified",
      "[",
      "]",
      "not",
      "1",
      "true",
      " ",
    ];
    for (let run = 0; run < 2000; run++) {
      const text = Array.from({ length: 1 + Math.floor(random.next() * 12) }, () =>
        random.pick(pieces),
      ).join(" ");
      const result = compileBraidCondition({ text });
      const answer = result.ok
        ? { valid: !result.compiledWhere || compiledWhereSchema.validate(result.compiledWhere) }
        : {
            valid:
              BRAID_CONDITION_REFUSAL_CODES.includes(result.code) &&
              result.at >= 0 &&
              result.at <= text.length,
          };
      expect({ text, ...answer }).toEqual({ text, valid: true });
    }
  });
});

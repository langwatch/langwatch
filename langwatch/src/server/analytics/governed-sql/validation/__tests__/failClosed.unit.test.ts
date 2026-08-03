/**
 * The default-deny fallthrough, exercised rather than asserted about.
 *
 * The rule under test is the one the whole design rests on: a node kind, a
 * field, or an enumerated value the walk does not recognise is a **refusal**,
 * never a pass. It cannot be reached through the real grammar — by
 * construction, `@clickhouse/parser` only emits shapes that exist today — so
 * every case here parses real SQL first, mutates one thing in the resulting
 * tree, and feeds it back through an injected parser.
 *
 * Each case ships with its control: the *unmutated* tree is asserted to pass.
 * Without that, a mutation that merely broke the tree would look like the
 * fallthrough working.
 */
import { describe, expect, it } from "vitest";

import {
  clickHouseSqlParser,
  type GovernedSqlParser,
  type SqlAstNode,
} from "../parser";
import { type GovernedSqlValidation, validateGovernedSql } from "../validate";
import type { GovernedSqlViolationCode } from "../violations";

const POLICY = {
  allowedTables: ["analytics.traces"],
  gatedColumns: [] as readonly string[],
  defaultDatabase: "analytics",
};

const BASE_SQL =
  "SELECT TraceId FROM traces WHERE Cost > 1 UNION ALL SELECT TraceId FROM traces";

/** A parser that hands back a tree someone else built. */
function parserOf(statements: readonly SqlAstNode[]): GovernedSqlParser {
  return { parse: () => ({ ok: true, statements }) };
}

/** The real parse of {@link BASE_SQL}, deep-copied so a mutation is local. */
function baseTree(): Record<string, unknown> {
  const parsed = clickHouseSqlParser.parse(BASE_SQL);
  if (!parsed.ok) throw new Error("fixture SQL must parse");
  // `locations: true` is the parser default and its `location` objects are
  // plain data, so a structural clone is faithful and keeps the mutation from
  // reaching the next case.
  return structuredClone(parsed.statements[0]) as Record<string, unknown>;
}

/** The first `SelectQuery` under a `SelectWithUnionQuery`. */
function firstSelect(tree: Record<string, unknown>): Record<string, unknown> {
  const selects = tree.selects as Record<string, unknown>[];
  return selects[0] as Record<string, unknown>;
}

function validateTree(tree: Record<string, unknown>): GovernedSqlValidation {
  return validateGovernedSql({
    sql: BASE_SQL,
    parser: parserOf([tree as unknown as SqlAstNode]),
    ...POLICY,
  });
}

function codesOf(result: GovernedSqlValidation): GovernedSqlViolationCode[] {
  return result.ok ? [] : result.violations.map((violation) => violation.code);
}

describe("the default-deny walk", () => {
  describe("given the tree exactly as the parser produced it", () => {
    it("accepts it, so every mutation below is the only difference", () => {
      expect(codesOf(validateTree(baseTree()))).toEqual([]);
    });

    it("accepts it through the shipped parser too, not only the injected one", () => {
      expect(
        codesOf(validateGovernedSql({ sql: BASE_SQL, ...POLICY })),
      ).toEqual([]);
    });
  });

  describe("given a node kind the walk has never heard of", () => {
    it("refuses a made-up kind in expression position", () => {
      const tree = baseTree();
      firstSelect(tree).where = {
        type: "SomeSyntaxClickHouseLearnsIn2027",
        payload: "anything at all",
      };

      expect(codesOf(validateTree(tree))).toEqual(["UNSUPPORTED_SYNTAX"]);
    });

    it("refuses a made-up kind in the FROM clause", () => {
      const tree = baseTree();
      const from = firstSelect(tree).from as Record<string, unknown>;
      (from.children as Record<string, unknown>[])[0] = {
        type: "FutureTableSource",
        target: "somewhere",
      };

      expect(codesOf(validateTree(tree))).toEqual(["UNSUPPORTED_SYNTAX"]);
    });

    /**
     * Not a fictional kind: `InsertQuery` is a real node the parser emits, and
     * it is refused here for the only reason that matters — the walk's rule
     * table does not list it. A denylist of "bad" kinds would have to have
     * predicted this position; the allowlist did not have to.
     */
    it("refuses a real node kind that is simply not in the allowlist", () => {
      const tree = baseTree();
      firstSelect(tree).where = {
        type: "InsertQuery",
        table: { type: "TableIdentifier", name: "traces" },
      };

      expect(codesOf(validateTree(tree))).toEqual(["UNSUPPORTED_SYNTAX"]);
    });

    it("refuses a value in a node slot that is not a node at all", () => {
      const tree = baseTree();
      firstSelect(tree).where = "Cost > 1";

      expect(codesOf(validateTree(tree))).toEqual(["UNSUPPORTED_SYNTAX"]);
    });
  });

  describe("given a field the walk has never heard of", () => {
    /**
     * The case a node-kind allowlist alone would miss. `INTO OUTFILE` is
     * exactly this shape in real ClickHouse — an ordinary literal hanging off
     * a field of an ordinary SELECT — so a walk that only checked kinds would
     * step straight over it.
     */
    it("refuses one on a recognised statement node", () => {
      const tree = baseTree();
      tree.exfiltrate_to = {
        type: "Literal",
        value_type: "String",
        value: "/tmp/leak",
      };

      expect(codesOf(validateTree(tree))).toEqual(["UNSUPPORTED_SYNTAX"]);
    });

    it("refuses one on a recognised query node", () => {
      const tree = baseTree();
      firstSelect(tree).some_future_clause = { type: "Literal", value: 1 };

      expect(codesOf(validateTree(tree))).toEqual(["UNSUPPORTED_SYNTAX"]);
    });

    it("refuses one on a recognised expression node", () => {
      const tree = baseTree();
      const projection = firstSelect(tree).select as Record<string, unknown>[];
      (projection[0] as Record<string, unknown>).evaluated_as = {
        type: "Literal",
        value: 1,
      };

      expect(codesOf(validateTree(tree))).toEqual(["UNSUPPORTED_SYNTAX"]);
    });
  });

  describe("given an enumerated field carrying a value the walk has never heard of", () => {
    it("refuses an unknown set-operation mode", () => {
      const tree = baseTree();
      tree.union_mode = "UNION_SOMETHING_NEW";

      expect(codesOf(validateTree(tree))).toEqual(["UNSUPPORTED_SYNTAX"]);
    });

    it("accepts the two modes the policy does name", () => {
      for (const union_mode of ["UNION_ALL", "UNION_DISTINCT"]) {
        const tree = baseTree();
        tree.union_mode = union_mode;

        expect(codesOf(validateTree(tree)), union_mode).toEqual([]);
      }
    });
  });

  describe("given a parser that cannot answer", () => {
    it("refuses when the parser throws rather than letting the throw escape", () => {
      const exploding: GovernedSqlParser = {
        parse: () => {
          throw new Error("grammar module failed to load");
        },
      };

      const result = validateGovernedSql({
        sql: BASE_SQL,
        parser: exploding,
        ...POLICY,
      });

      expect(codesOf(result)).toEqual(["PARSE_FAILED"]);
    });

    it("refuses when the parser reports failure", () => {
      const refusing: GovernedSqlParser = { parse: () => ({ ok: false }) };

      expect(
        codesOf(
          validateGovernedSql({ sql: BASE_SQL, parser: refusing, ...POLICY }),
        ),
      ).toEqual(["PARSE_FAILED"]);
    });
  });

  describe("given a query that violates the policy in many places", () => {
    it("caps how many reasons ride back in one response", () => {
      const gated = Array.from({ length: 60 }, (_, i) => `body${i}`);
      const result = validateGovernedSql({
        sql: `SELECT ${gated.join(", ")} FROM traces`,
        allowedTables: POLICY.allowedTables,
        gatedColumns: gated,
        defaultDatabase: POLICY.defaultDatabase,
      });

      expect(result.ok).toBe(false);
      expect(result.ok ? 0 : result.violations.length).toBe(20);
    });
  });
});

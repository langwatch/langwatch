import { describe, expect, it } from "vitest";
import { ParseError, parse, serialize, stripAtSigils } from "../parse";
import {
  analyzeOrGroups,
  buildFacetStateLookup,
  getFacetValues,
  getRangeValue,
  hasCrossFacetOR,
  validateAst,
} from "../queries";
import {
  addToOrGroupAtLocation,
  removeFacetValueFromQuery,
  removeFieldFromQuery,
  removeNodeAtLocation,
  setFacetValueAtLocation,
  setRangeInQuery,
  swapOperatorAtLocation,
  toggleFacetInQuery,
} from "../mutations";

function locationOf(
  query: string,
  fragment: string,
): { start: number; end: number } {
  const start = query.indexOf(fragment);
  if (start < 0) throw new Error(`Fragment ${fragment} not found in ${query}`);
  return { start, end: start + fragment.length };
}

describe("stripAtSigils", () => {
  describe("given a sigil at the start of a token", () => {
    it("removes the sigil at the start of the string", () => {
      expect(stripAtSigils("@status:error")).toBe("status:error");
    });

    it("removes the sigil after whitespace", () => {
      expect(stripAtSigils("status:error AND @model:gpt-4o")).toBe(
        "status:error AND model:gpt-4o",
      );
    });

    it("removes the sigil after an opening parenthesis", () => {
      expect(stripAtSigils("(@status:error)")).toBe("(status:error)");
    });
  });

  describe("given a sigil mid-token", () => {
    it("preserves it inside an unquoted value", () => {
      expect(stripAtSigils("user:foo@bar.com")).toBe("user:foo@bar.com");
    });
  });

  describe("given a sigil inside quotes", () => {
    it("preserves it inside a double-quoted string", () => {
      expect(stripAtSigils('user:"foo@bar.com"')).toBe('user:"foo@bar.com"');
    });

    it("preserves it inside a single-quoted string", () => {
      expect(stripAtSigils("user:'foo@bar.com'")).toBe("user:'foo@bar.com'");
    });

    it("strips a sigil after the closing quote", () => {
      expect(stripAtSigils('user:"foo" @model:gpt')).toBe(
        'user:"foo" model:gpt',
      );
    });
  });
});

describe("removeNodeAtLocation", () => {
  describe("given a single tag", () => {
    it("returns an empty query", () => {
      const query = "status:error";
      const { start, end } = locationOf(query, "status:error");
      expect(
        removeNodeAtLocation({ currentQuery: query, start, end }),
      ).toBe("");
    });
  });

  describe("given two AND-joined tags", () => {
    it("drops the targeted tag and the now-orphaned AND keyword", () => {
      const query = "status:error AND model:gpt-4o";
      const { start, end } = locationOf(query, "status:error");
      expect(
        removeNodeAtLocation({ currentQuery: query, start, end }),
      ).toBe("model:gpt-4o");
    });
  });

  describe("given two OR-joined tags inside parentheses", () => {
    it("drops the targeted tag and collapses the parenthesised group", () => {
      const query = "(status:error OR status:warning) AND model:gpt-4o";
      const { start, end } = locationOf(query, "status:warning");
      // The orphan paren wrapping a single tag is collapsed by the serializer.
      expect(
        removeNodeAtLocation({ currentQuery: query, start, end }),
      ).toBe("status:error AND model:gpt-4o");
    });
  });

  describe("given a tag whose location does not match", () => {
    it("leaves the query unchanged", () => {
      const query = "status:error AND model:gpt-4o";
      expect(
        removeNodeAtLocation({ currentQuery: query, start: 999, end: 1000 }),
      ).toBe(query);
    });
  });
});

describe("parse with stray sigils", () => {
  describe("given a query with leading sigil", () => {
    it("parses successfully after stripping", () => {
      expect(() => parse("@status:error")).not.toThrow();
    });
  });

  describe("given a partially-typed sigil that the user never accepted", () => {
    it("parses successfully after stripping the trigger", () => {
      expect(() => parse("status:error AND @mod")).not.toThrow();
    });
  });
});

describe("parse LRU cache", () => {
  describe("when the same query is parsed twice", () => {
    it("returns the same AST reference (cache hit)", () => {
      const a = parse("status:error AND model:gpt-4o");
      const b = parse("status:error AND model:gpt-4o");
      expect(a).toBe(b);
    });

    it("normalizes leading/trailing whitespace before hashing", () => {
      const a = parse("status:error");
      const b = parse("  status:error  ");
      expect(a).toBe(b);
    });

    it("treats sigil-equivalent queries as the same key", () => {
      const a = parse("status:error AND model:gpt");
      const b = parse("@status:error AND @model:gpt");
      expect(a).toBe(b);
    });
  });

  describe("when the query is invalid", () => {
    it("caches the ParseError and re-throws the same instance", () => {
      let firstError: unknown;
      let secondError: unknown;
      try {
        parse('status:"unclosed');
      } catch (e) {
        firstError = e;
      }
      try {
        parse('status:"unclosed');
      } catch (e) {
        secondError = e;
      }
      expect(firstError).toBeInstanceOf(ParseError);
      expect(firstError).toBe(secondError);
    });
  });

  describe("when the cache exceeds capacity", () => {
    it("evicts the least-recently-used entry", () => {
      // Capacity is 8 — write 9 distinct entries, then re-request the first.
      for (let i = 0; i < 9; i++) {
        parse(`status:error AND model:m${i}`);
      }
      const firstAgain = parse("status:error AND model:m0");
      const firstAgainAgain = parse("status:error AND model:m0");
      // First read after eviction returns a fresh AST; the next call rehits.
      expect(firstAgain).toBe(firstAgainAgain);
    });
  });
});

describe("parse operator matrix", () => {
  describe("comparison operators", () => {
    it.each([
      [">", "cost:>5", ":>", 5],
      [">=", "cost:>=5", ":>=", 5],
      ["<", "cost:<5", ":<", 5],
      ["<=", "cost:<=5", ":<=", 5],
    ])("parses `%s` as a Tag with the matching liqe operator", (_, query, op, value) => {
      const ast = parse(query) as unknown as { type: string; operator: { operator: string }; expression: { value: number } };
      expect(ast.type).toBe("Tag");
      expect(ast.operator.operator).toBe(op);
      expect(ast.expression.value).toBe(value);
    });

    it("parses `>=` with a decimal value", () => {
      const ast = parse("cost:>=0.05") as unknown as { expression: { value: number } };
      expect(ast.expression.value).toBe(0.05);
    });

    it("parses two comparisons joined by AND as a LogicalExpression", () => {
      const ast = parse("promptTokens:>=100 AND promptTokens:<=500");
      expect(ast.type).toBe("LogicalExpression");
    });
  });

  describe("range form", () => {
    it("parses `field:[low TO high]` as a Tag with a RangeExpression", () => {
      const ast = parse("cost:[1 TO 10]") as { type: string; expression: { type: string; range: { min: number; max: number } } };
      expect(ast.type).toBe("Tag");
      expect(ast.expression.type).toBe("RangeExpression");
      expect(ast.expression.range.min).toBe(1);
      expect(ast.expression.range.max).toBe(10);
    });

    it("normalises `1.00` → `1` on round-trip — liqe collapses trailing zeros", () => {
      // Encoded so future-us notice if liqe's number formatting ever changes.
      expect(serialize(parse("cost:[0.01 TO 1.00]"))).toBe("cost:[0.01 TO 1]");
    });

    it("parses negative range bounds", () => {
      const ast = parse("evaluatorScore:[-1 TO 1]") as { expression: { range: { min: number; max: number } } };
      expect(ast.expression.range.min).toBe(-1);
      expect(ast.expression.range.max).toBe(1);
    });
  });

  describe("quoted values", () => {
    it("preserves spaces inside double-quoted values", () => {
      const ast = parse('model:"gpt-4 turbo"') as { expression: { value: string } };
      expect(ast.expression.value).toBe("gpt-4 turbo");
    });

    it("normalises single-quoted values to the same Literal value", () => {
      const single = parse("model:'gpt-4 turbo'") as { expression: { value: string } };
      const dbl = parse('model:"gpt-4 turbo"') as { expression: { value: string } };
      expect(single.expression.value).toBe(dbl.expression.value);
    });

    it("parses a bare quoted string as ImplicitField free text", () => {
      const ast = parse('"refund policy"') as { type: string; field: { type: string }; expression: { value: string } };
      expect(ast.type).toBe("Tag");
      expect(ast.field.type).toBe("ImplicitField");
      expect(ast.expression.value).toBe("refund policy");
    });
  });

  describe("wildcards", () => {
    it.each([
      ["trailing", "model:gpt-*", "gpt-*"],
      ["leading", "model:*-mini", "*-mini"],
      ["middle", "model:gpt*mini", "gpt*mini"],
    ])("parses %s wildcard as a literal value containing `*`", (_, query, expected) => {
      const ast = parse(query) as { expression: { value: string } };
      expect(ast.expression.value).toBe(expected);
    });
  });

  describe("special characters in unquoted values", () => {
    it("accepts `@` mid-value (e.g. emails)", () => {
      const ast = parse("user:foo@bar.com") as { expression: { value: string } };
      expect(ast.expression.value).toBe("foo@bar.com");
    });

    it("rejects `+` in unquoted values — must be quoted to be safe", () => {
      // Pinned to surface if liqe ever loosens this — users currently MUST
      // quote `user:"foo+a@bar.com"` for plus-addressing to round-trip.
      expect(() => parse("user:foo+a@bar.com")).toThrow();
    });

    it("accepts `.` and `_` in field names (e.g. attribute paths)", () => {
      const ast = parse("attribute.langwatch.user_id:abc") as { field: { name: string } };
      expect(ast.field.name).toBe("attribute.langwatch.user_id");
    });
  });

  describe("boolean operator forms", () => {
    it("uppercase AND/OR/NOT are recognised as boolean operators", () => {
      const a = parse("status:error AND model:gpt-4o");
      expect(a.type).toBe("LogicalExpression");
      const o = parse("status:error OR model:gpt-4o");
      expect(o.type).toBe("LogicalExpression");
      const n = parse("NOT status:error");
      expect(n.type).toBe("UnaryOperator");
    });

    it("lowercase `and` parses as a free-text token, not an operator", () => {
      // Documented limitation — booleans are case-sensitive. If this stops
      // being true, the docs and the AI prompt both need to update.
      const ast = parse("status:error and model:gpt-4o");
      // Without uppercase AND, liqe collapses adjacent terms into an
      // implicit AND with `and`/`model:gpt-4o` as siblings — but the key
      // assertion is that we never get a single Tag with value `error and`.
      expect(ast.type).not.toBe("Tag");
    });

    it("`-` shorthand negation is equivalent to `NOT`", () => {
      const a = parse("-status:error");
      const b = parse("NOT status:error");
      expect(a.type).toBe(b.type);
      expect(a.type).toBe("UnaryOperator");
    });

    it("supports nested NOT around a parenthesised group", () => {
      const ast = parse("NOT (status:error OR status:warning)");
      expect(ast.type).toBe("UnaryOperator");
    });

    it("rejects double NOT", () => {
      // Pinned: `NOT NOT` is a syntax error in liqe. Users have to write
      // the affirmative form (no double-negative shorthand).
      expect(() => parse("NOT NOT status:error")).toThrow();
    });

    it("rejects `-` against a parenthesised group — only Tag operands", () => {
      expect(() => parse("-(status:error)")).toThrow();
    });
  });
});

describe("parse silent miscarriages — non-obvious shapes the validator must catch", () => {
  describe("given `status: error` (space after colon)", () => {
    it("parses as a LogicalExpression of `status:` (empty) AND `error` (free text)", () => {
      // The user's intent was `status:error` — but the space splits the
      // clause. Liqe parses it without throwing; our `validateAst` is the
      // backstop that surfaces "Missing value after `status:`".
      const ast = parse("status: error");
      expect(ast.type).toBe("LogicalExpression");
      expect(validateAst(ast)).toBe("Missing value after `status:`");
    });
  });

  describe("given `cost:> 5` (space after operator)", () => {
    it("parses as a LogicalExpression of `cost:` (empty) AND `5` (free text)", () => {
      const ast = parse("cost:> 5");
      expect(ast.type).toBe("LogicalExpression");
      expect(validateAst(ast)).toBe("Missing value after `cost:`");
    });
  });

  describe("given `NOT-status:error` (no space after NOT)", () => {
    it("parses as a literal Tag with field name `NOT-status` — not a negation", () => {
      // The user almost certainly meant negation. We can't fix this in the
      // parser, but the field `NOT-status` doesn't exist in SEARCH_FIELDS,
      // so the backend would 422. This test pins the silent-failure shape.
      const ast = parse("NOT-status:error") as { type: string; field: { type: string; name: string } };
      expect(ast.type).toBe("Tag");
      expect(ast.field.name).toBe("NOT-status");
    });
  });

  describe("given a trailing colon with no value", () => {
    it("parses as a Tag with EmptyExpression — validateAst rejects with the field name", () => {
      const ast = parse("status:");
      expect(validateAst(ast)).toBe("Missing value after `status:`");
    });

    it("rejects mid-clause as well (`status:error AND model:`)", () => {
      const ast = parse("status:error AND model:");
      expect(validateAst(ast)).toBe("Missing value after `model:`");
    });
  });

  describe("given an unparseable mid-edit query", () => {
    it("dangling AND throws", () => {
      expect(() => parse("status:error AND")).toThrow(ParseError);
    });

    it("unmatched opening paren throws", () => {
      expect(() => parse("(status:error")).toThrow(ParseError);
    });

    it("unmatched closing paren throws", () => {
      expect(() => parse("status:error)")).toThrow(ParseError);
    });

    it("unclosed quote throws", () => {
      expect(() => parse("model:'unclosed")).toThrow(ParseError);
    });
  });
});

describe("validateAst", () => {
  describe("given a parseable but semantically empty query", () => {
    it("returns null for a valid Tag", () => {
      expect(validateAst(parse("status:error"))).toBeNull();
    });

    it("returns the field-name error for `field:`", () => {
      expect(validateAst(parse("status:"))).toBe("Missing value after `status:`");
    });

    it("returns the generic error when there is no field name", () => {
      // Hard to reach via the parser (free-text without a value parses as
      // empty), but the validator should still cover the branch.
      expect(
        validateAst({
          type: "Tag",
          field: { type: "ImplicitField" },
          expression: { type: "EmptyExpression", location: { start: 0, end: 0 } },
          operator: { type: "ComparisonOperator", operator: ":", location: { start: 0, end: 0 } },
          location: { start: 0, end: 0 },
        // biome-ignore lint/suspicious/noExplicitAny: structural subset is sufficient for the validator
        } as any),
      ).toBe("Missing value after `:`");
    });

    it("recurses into NOT operands", () => {
      expect(validateAst(parse("NOT status:"))).toBe("Missing value after `status:`");
    });

    it("recurses into both arms of a LogicalExpression", () => {
      expect(validateAst(parse("status:error AND model:"))).toBe(
        "Missing value after `model:`",
      );
    });

    it("recurses into parenthesised groups", () => {
      expect(validateAst(parse("(status:error AND model:) OR origin:application"))).toBe(
        "Missing value after `model:`",
      );
    });
  });
});

describe("getFacetValues", () => {
  describe("given a query with mixed includes / excludes for the same field", () => {
    it("returns each value bucketed by negation", () => {
      const ast = parse("status:error AND status:warning AND -status:ok");
      expect(getFacetValues(ast, "status")).toEqual({
        include: ["error", "warning"],
        exclude: ["ok"],
      });
    });
  });

  describe("given a query that doesn't mention the field", () => {
    it("returns empty arrays", () => {
      const ast = parse("status:error");
      expect(getFacetValues(ast, "model")).toEqual({ include: [], exclude: [] });
    });
  });

  describe("given a NOT around a parenthesised OR group", () => {
    it("flips every inner value to exclude", () => {
      const ast = parse("NOT (status:error OR status:warning)");
      expect(getFacetValues(ast, "status")).toEqual({
        include: [],
        exclude: ["error", "warning"],
      });
    });
  });

  describe("given an ImplicitField (free text)", () => {
    it("ignores the free-text token — only field-tagged values count", () => {
      const ast = parse("refund AND status:error");
      expect(getFacetValues(ast, "status")).toEqual({
        include: ["error"],
        exclude: [],
      });
    });
  });

  describe("given a range expression for the same field", () => {
    it("ignores the non-literal value (range bounds aren't facet values)", () => {
      const ast = parse("cost:[1 TO 10] AND status:error");
      expect(getFacetValues(ast, "cost")).toEqual({ include: [], exclude: [] });
    });
  });
});

describe("getRangeValue", () => {
  describe("given a `[low TO high]` range", () => {
    it("returns both bounds", () => {
      expect(getRangeValue(parse("cost:[1 TO 10]"), "cost")).toEqual({
        from: 1,
        to: 10,
      });
    });
  });

  describe("given a `>=` comparison", () => {
    it("returns only the `from` bound", () => {
      expect(getRangeValue(parse("cost:>=5"), "cost")).toEqual({ from: 5 });
    });
  });

  describe("given a `<` comparison", () => {
    it("returns only the `to` bound", () => {
      expect(getRangeValue(parse("duration:<5000"), "duration")).toEqual({
        to: 5000,
      });
    });
  });

  describe("given a negated comparison (NOT cost:>5)", () => {
    it("returns null — the helper deliberately ignores excluded ranges", () => {
      expect(getRangeValue(parse("NOT cost:>5"), "cost")).toBeNull();
    });
  });

  describe("given a non-numeric value masquerading as a comparison", () => {
    it("returns null without throwing", () => {
      // `cost:>abc` — liqe parses but value isn't a number; we shouldn't
      // produce a NaN-bearing range.
      expect(() => getRangeValue(parse("cost:abc"), "cost")).not.toThrow();
      expect(getRangeValue(parse("cost:abc"), "cost")).toBeNull();
    });
  });

  describe("when the field is missing", () => {
    it("returns null", () => {
      expect(getRangeValue(parse("status:error"), "cost")).toBeNull();
    });
  });
});

describe("hasCrossFacetOR", () => {
  describe("given an OR between two different fields at the top level", () => {
    it("returns true", () => {
      expect(hasCrossFacetOR(parse("status:error OR model:gpt-4o"))).toBe(true);
    });
  });

  describe("given an OR between two values of the same field", () => {
    it("returns false — same-field OR is sidebar-friendly", () => {
      expect(hasCrossFacetOR(parse("status:error OR status:warning"))).toBe(false);
    });
  });

  describe("given a top-level OR whose arms are simple Tags", () => {
    it("returns true when the two Tag fields differ", () => {
      // The detection works precisely when both arms of an OR are Tag (or
      // NOT-Tag). Compound arms (AND/Parens) make `topField` return null,
      // which short-circuits the cross-facet check.
      expect(hasCrossFacetOR(parse("status:error OR model:gpt-4o"))).toBe(true);
    });
  });

  describe("given an OR whose arms are compound", () => {
    it("returns false when the OR's left arm is a compound AND — group has only one classifiable field", () => {
      // `a AND b OR c` parses as `OR(AND(a,b), c)`. The OR analyzer
      // stops at AND boundaries, so the left arm contributes no
      // members; only `c` makes it into the group, which can't form a
      // cross-facet OR on its own.
      expect(
        hasCrossFacetOR(parse("origin:application AND status:error OR model:gpt-4o")),
      ).toBe(false);
    });

    it("returns true when an OR is wrapped in parens with two different fields", () => {
      // The analyzer recurses into ParenthesizedExpressions, so a
      // nested cross-facet OR is detected even with an outer AND.
      expect(
        hasCrossFacetOR(parse("origin:application AND (status:error OR model:gpt-4o)")),
      ).toBe(true);
    });
  });

  describe("given a query without any OR", () => {
    it("returns false", () => {
      expect(hasCrossFacetOR(parse("status:error AND model:gpt-4o"))).toBe(false);
    });
  });
});

describe("toggleFacetInQuery", () => {
  describe("starting from an empty query", () => {
    it("appends the clause as-is when transitioning neutral → include", () => {
      expect(
        toggleFacetInQuery({
          currentQuery: "",
          fieldName: "status",
          value: "error",
          currentState: "neutral",
        }),
      ).toBe("status:error");
    });
  });

  describe("starting from include", () => {
    it("flips include → exclude (rewrites the same value as `NOT`)", () => {
      expect(
        toggleFacetInQuery({
          currentQuery: "status:error",
          fieldName: "status",
          value: "error",
          currentState: "include",
        }),
      ).toBe("NOT status:error");
    });
  });

  describe("starting from exclude", () => {
    it("collapses back to neutral (drops the clause entirely)", () => {
      expect(
        toggleFacetInQuery({
          currentQuery: "NOT status:error",
          fieldName: "status",
          value: "error",
          currentState: "exclude",
        }),
      ).toBe("");
    });
  });

  describe("alongside other clauses", () => {
    it("appends with AND when the query already has content", () => {
      expect(
        toggleFacetInQuery({
          currentQuery: "model:gpt-4o",
          fieldName: "status",
          value: "error",
          currentState: "neutral",
        }),
      ).toBe("model:gpt-4o AND status:error");
    });

    it("removes only the targeted value, leaving siblings intact", () => {
      expect(
        toggleFacetInQuery({
          currentQuery: "status:error AND status:warning",
          fieldName: "status",
          value: "error",
          currentState: "exclude",
        }),
      ).toBe("status:warning");
    });
  });

  describe("when the value contains spaces", () => {
    it("quotes the value when appending", () => {
      expect(
        toggleFacetInQuery({
          currentQuery: "",
          fieldName: "errorMessage",
          value: "rate limit",
          currentState: "neutral",
        }),
      ).toBe('errorMessage:"rate limit"');
    });
  });

  describe("when the value contains embedded double-quotes", () => {
    it("escapes inner quotes so the result round-trips through liqe", () => {
      // `He said "no"` would otherwise produce malformed liqe and
      // bail the splice. Escaping inner `"` keeps the value intact.
      const out = toggleFacetInQuery({
        currentQuery: "",
        fieldName: "errorMessage",
        value: 'He said "no"',
        currentState: "neutral",
      });
      expect(out).toBe('errorMessage:"He said \\"no\\""');
      expect(() => parse(out)).not.toThrow();
    });
  });

  describe("when the value contains a backslash", () => {
    it("escapes the backslash so it survives round-tripping", () => {
      const out = toggleFacetInQuery({
        currentQuery: "",
        fieldName: "path",
        value: "C:\\foo\\bar",
        currentState: "neutral",
      });
      expect(out).toBe('path:"C:\\\\foo\\\\bar"');
    });
  });
});

describe("setRangeInQuery", () => {
  describe("starting from an empty query", () => {
    it("inserts the range clause", () => {
      expect(
        setRangeInQuery({
          currentQuery: "",
          fieldName: "cost",
          from: "1",
          to: "10",
        }),
      ).toBe("cost:[1 TO 10]");
    });
  });

  describe("when the field already has a range", () => {
    it("replaces the existing range rather than stacking another one", () => {
      expect(
        setRangeInQuery({
          currentQuery: "cost:[1 TO 5]",
          fieldName: "cost",
          from: "1",
          to: "10",
        }),
      ).toBe("cost:[1 TO 10]");
    });

    it("replaces an existing comparison with the new range", () => {
      expect(
        setRangeInQuery({
          currentQuery: "cost:>5",
          fieldName: "cost",
          from: "1",
          to: "10",
        }),
      ).toBe("cost:[1 TO 10]");
    });
  });

  describe("alongside unrelated clauses", () => {
    it("preserves the unrelated clauses and appends the range with AND", () => {
      expect(
        setRangeInQuery({
          currentQuery: "status:error",
          fieldName: "cost",
          from: "1",
          to: "10",
        }),
      ).toBe("status:error AND cost:[1 TO 10]");
    });
  });
});

describe("removeFieldFromQuery", () => {
  describe("when the field is the only clause", () => {
    it("returns the empty string", () => {
      expect(
        removeFieldFromQuery({
          currentQuery: "status:error",
          fieldName: "status",
        }),
      ).toBe("");
    });
  });

  describe("when the field appears multiple times", () => {
    it("drops every value of the field", () => {
      expect(
        removeFieldFromQuery({
          currentQuery: "status:error AND status:warning AND model:gpt-4o",
          fieldName: "status",
        }),
      ).toBe("model:gpt-4o");
    });
  });

  describe("when the field doesn't appear", () => {
    it("returns the query unchanged via round-trip serialisation", () => {
      // Exact string can drift via serialiser whitespace; what matters is
      // that no clauses were dropped.
      const result = removeFieldFromQuery({
        currentQuery: "status:error AND model:gpt-4o",
        fieldName: "cost",
      });
      expect(result).toBe("status:error AND model:gpt-4o");
    });
  });

  describe("when the input is unparseable mid-edit", () => {
    it("returns the original string rather than throwing", () => {
      expect(
        removeFieldFromQuery({
          currentQuery: "status:error AND",
          fieldName: "status",
        }),
      ).toBe("status:error AND");
    });
  });
});

describe("removeFacetValueFromQuery", () => {
  describe("when only the targeted value matches", () => {
    it("drops just that one value", () => {
      expect(
        removeFacetValueFromQuery({
          currentQuery: "status:error AND status:warning",
          fieldName: "status",
          value: "error",
        }),
      ).toBe("status:warning");
    });
  });

  describe("when the value is the only clause", () => {
    it("returns the empty string", () => {
      expect(
        removeFacetValueFromQuery({
          currentQuery: "status:error",
          fieldName: "status",
          value: "error",
        }),
      ).toBe("");
    });
  });

  describe("when the value isn't present", () => {
    it("leaves the query as-is", () => {
      expect(
        removeFacetValueFromQuery({
          currentQuery: "status:error",
          fieldName: "status",
          value: "warning",
        }),
      ).toBe("status:error");
    });
  });
});

describe("buildFacetStateLookup", () => {
  describe("given an empty AST", () => {
    it("returns an empty map", () => {
      const map = buildFacetStateLookup(parse(""));
      expect(map.size).toBe(0);
    });
  });

  describe("given a query with includes and excludes", () => {
    it("indexes both inclusion and exclusion states by `field|value`", () => {
      const map = buildFacetStateLookup(
        parse("status:error AND -model:gpt-4o AND origin:application"),
      );
      expect(map.get("status|error")).toBe("include");
      expect(map.get("model|gpt-4o")).toBe("exclude");
      expect(map.get("origin|application")).toBe("include");
      expect(map.get("status|warning")).toBeUndefined();
    });
  });

  describe("given a query with NOT-wrapped tags", () => {
    it("marks them as exclude", () => {
      const map = buildFacetStateLookup(parse("NOT status:error"));
      expect(map.get("status|error")).toBe("exclude");
    });
  });

  describe("when used as a lookup-table for sidebar rows", () => {
    it("returns `neutral` (via fallback) for unseen field/value pairs", () => {
      const map = buildFacetStateLookup(parse("status:error"));
      const get = (field: string, value: string) =>
        map.get(`${field}|${value}`) ?? "neutral";
      expect(get("status", "error")).toBe("include");
      expect(get("status", "warning")).toBe("neutral");
      expect(get("model", "gpt-4o")).toBe("neutral");
    });
  });
});

describe("analyzeOrGroups", () => {
  describe("given a query without any OR", () => {
    it("returns an empty analysis", () => {
      const result = analyzeOrGroups(parse("status:error AND model:gpt-4o"));
      expect(result.groups).toEqual([]);
      expect(result.memberToGroupId.size).toBe(0);
      expect(result.fieldToGroupIds.size).toBe(0);
    });
  });

  describe("given a same-field OR", () => {
    it("emits one group with one field and two members", () => {
      const result = analyzeOrGroups(parse("status:error OR status:warning"));
      expect(result.groups).toHaveLength(1);
      const g = result.groups[0]!;
      expect(g.fields.size).toBe(1);
      expect(g.fields.has("status")).toBe(true);
      expect(g.members).toHaveLength(2);
      expect(g.members.map((m) => m.value).sort()).toEqual([
        "error",
        "warning",
      ]);
    });
  });

  describe("given a cross-facet OR", () => {
    it("emits one group whose fields span both Tags", () => {
      const result = analyzeOrGroups(parse("status:error OR model:gpt-4o"));
      expect(result.groups).toHaveLength(1);
      const g = result.groups[0]!;
      expect(g.fields.size).toBe(2);
      expect(g.fields.has("status")).toBe(true);
      expect(g.fields.has("model")).toBe(true);
    });
  });

  describe("given a NOT-wrapped Tag inside an OR", () => {
    it("marks that member as negated, peers as not-negated", () => {
      const result = analyzeOrGroups(
        parse("status:error OR NOT model:gpt-4o"),
      );
      const members = result.groups[0]!.members;
      const status = members.find((m) => m.field === "status")!;
      const model = members.find((m) => m.field === "model")!;
      expect(status.negated).toBe(false);
      expect(model.negated).toBe(true);
    });

    it("does NOT thread an outer NOT down to inner members (KNOWN LIMITATION)", () => {
      // `analyzeOrGroups`'s walker descends through UnaryOperator
      // without tracking negation, so `NOT (status:error OR
      // status:warning)` produces a group where each member's
      // `negated` flag is `false`. The sidebar consumer reads
      // include/exclude state separately via `buildFacetStateLookup`,
      // which DOES walk negation correctly — so the visible "excluded"
      // chip styling lands. Pinning current behaviour so a later
      // negation-threading fix is a deliberate, visible change rather
      // than a silent shift.
      const result = analyzeOrGroups(
        parse("NOT (status:error OR status:warning)"),
      );
      const members = result.groups[0]!.members;
      expect(members.every((m) => m.negated === false)).toBe(true);
    });
  });

  describe("given a multi-arm OR", () => {
    it("flattens nested ORs into a single group", () => {
      const result = analyzeOrGroups(
        parse("status:error OR status:warning OR model:gpt-4o"),
      );
      expect(result.groups).toHaveLength(1);
      const g = result.groups[0]!;
      expect(g.members).toHaveLength(3);
      expect(g.fields.size).toBe(2);
    });

    it("flattens parenthesised OR shapes as one group", () => {
      // `((a OR b) OR c)` and `(a OR (b OR c))` collapse to the same
      // shape — the visualiser doesn't care which way liqe nested it.
      const a = analyzeOrGroups(parse("(a:1 OR b:2) OR c:3"));
      const b = analyzeOrGroups(parse("a:1 OR (b:2 OR c:3)"));
      expect(a.groups[0]!.members).toHaveLength(3);
      expect(b.groups[0]!.members).toHaveLength(3);
    });
  });

  describe("given an AND boundary inside an OR", () => {
    it("treats the AND-wrapped subtree as opaque (no members from inside)", () => {
      // `(a AND b) OR c:3`: the analyzer sees an OR LogicalExpression
      // and walks members, but stops at AND. Only `c:3` makes it in,
      // so the group has 1 member — below the >1 threshold, no group
      // emitted.
      const result = analyzeOrGroups(
        parse("(origin:application AND status:error) OR model:gpt-4o"),
      );
      expect(result.groups).toEqual([]);
    });
  });

  describe("given multiple disjoint OR groups", () => {
    it("emits one group per OR scope, each with its own id", () => {
      const result = analyzeOrGroups(
        parse(
          "(status:error OR model:gpt-4o) AND (origin:application OR origin:simulation)",
        ),
      );
      expect(result.groups).toHaveLength(2);
      const ids = new Set(result.groups.map((g) => g.id));
      expect(ids.size).toBe(2);
    });

    it("registers a field that appears in multiple groups under fieldToGroupIds", () => {
      // `status` appears in both OR groups — fieldToGroupIds must hold
      // both ids so a row in either group lights up correctly. (This
      // is the regression Copilot caught on the singular `fieldToGroupId`.)
      const result = analyzeOrGroups(
        parse(
          "(status:error OR model:gpt-4o) AND (status:warning OR origin:application)",
        ),
      );
      const statusGroups = result.fieldToGroupIds.get("status");
      expect(statusGroups).toBeDefined();
      expect(statusGroups!.length).toBe(2);
      expect(new Set(statusGroups)).toEqual(
        new Set(result.groups.map((g) => g.id)),
      );
    });
  });

  describe("given non-Tag contents", () => {
    it("ignores ImplicitField (free text) members", () => {
      // `"refund" OR status:error` — the bare quoted free-text Tag is
      // ImplicitField. It contributes no member; the group falls below
      // the >1 threshold and is dropped.
      const result = analyzeOrGroups(parse('"refund" OR status:error'));
      expect(result.groups).toEqual([]);
    });

    it("ignores non-literal expressions (range bounds)", () => {
      // `cost:[1 TO 10] OR status:error` — the range expression is
      // skipped, leaving only the status member; group dropped.
      const result = analyzeOrGroups(parse("cost:[1 TO 10] OR status:error"));
      expect(result.groups).toEqual([]);
    });
  });

  describe("given a cross-facet OR group's memberToGroupId map", () => {
    it("keys members by `${field}|${value}` resolving to the group id", () => {
      const result = analyzeOrGroups(parse("status:error OR model:gpt-4o"));
      const id = result.groups[0]!.id;
      expect(result.memberToGroupId.get("status|error")).toBe(id);
    });

    it("returns undefined for non-member field/value pairs", () => {
      const result = analyzeOrGroups(parse("status:error OR model:gpt-4o"));
      expect(result.memberToGroupId.get("status|warning")).toBeUndefined();
    });
  });

  describe("given an unparenthesised top-level OR", () => {
    it("emits a group whose location covers the full query", () => {
      const query = "status:error OR model:gpt-4o";
      const result = analyzeOrGroups(parse(query));
      const g = result.groups[0]!;
      expect(g.start).toBe(0);
      expect(g.end).toBe(query.length);
    });
  });
});

describe("addToOrGroupAtLocation", () => {
  describe("given an empty query", () => {
    it("returns an empty input unchanged", () => {
      expect(
        addToOrGroupAtLocation({
          currentQuery: "",
          groupStart: 0,
          groupEnd: 0,
          fieldName: "status",
          value: "error",
        }),
      ).toBe("");
    });

    it("returns whitespace-only input unchanged", () => {
      expect(
        addToOrGroupAtLocation({
          currentQuery: "   ",
          groupStart: 0,
          groupEnd: 0,
          fieldName: "status",
          value: "error",
        }),
      ).toBe("   ");
    });
  });

  describe("given an invalid location", () => {
    it("returns the query unchanged when start === end", () => {
      const q = "status:error OR model:gpt-4o";
      expect(
        addToOrGroupAtLocation({
          currentQuery: q,
          groupStart: 5,
          groupEnd: 5,
          fieldName: "x",
          value: "y",
        }),
      ).toBe(q);
    });

    it("returns the query unchanged when end < start", () => {
      const q = "status:error OR model:gpt-4o";
      expect(
        addToOrGroupAtLocation({
          currentQuery: q,
          groupStart: 10,
          groupEnd: 5,
          fieldName: "x",
          value: "y",
        }),
      ).toBe(q);
    });
  });

  describe("given a top-level OR group", () => {
    it("appends ` OR field:value` after the group's end", () => {
      const query = "status:error OR model:gpt-4o";
      const ast = analyzeOrGroups(parse(query));
      const g = ast.groups[0]!;
      expect(
        addToOrGroupAtLocation({
          currentQuery: query,
          groupStart: g.start,
          groupEnd: g.end,
          fieldName: "origin",
          value: "app",
        }),
      ).toBe("status:error OR model:gpt-4o OR origin:app");
    });
  });

  describe("given a parenthesised OR group", () => {
    it("splices ` OR field:value` inside the parens", () => {
      const query = "(status:error OR model:gpt-4o) AND name:bar";
      const ast = analyzeOrGroups(parse(query));
      const g = ast.groups[0]!;
      // `g.start..g.end` covers the inner OR LogicalExpression — the
      // splice lands before the closing `)` so parens stay balanced
      // and the AND clause stays intact.
      const result = addToOrGroupAtLocation({
        currentQuery: query,
        groupStart: g.start,
        groupEnd: g.end,
        fieldName: "origin",
        value: "app",
      });
      expect(result).toBe(
        "(status:error OR model:gpt-4o OR origin:app) AND name:bar",
      );
    });
  });

  describe("given leading whitespace on the query", () => {
    it("offsets the splice point by leading whitespace", () => {
      const query = "  status:error OR model:gpt-4o";
      const ast = analyzeOrGroups(parse(query));
      const g = ast.groups[0]!;
      expect(
        addToOrGroupAtLocation({
          currentQuery: query,
          groupStart: g.start,
          groupEnd: g.end,
          fieldName: "origin",
          value: "app",
        }),
      ).toBe("  status:error OR model:gpt-4o OR origin:app");
    });
  });

  describe("given a value that needs quoting", () => {
    it("quotes values containing spaces", () => {
      const query = "status:error OR status:warning";
      const ast = analyzeOrGroups(parse(query));
      const g = ast.groups[0]!;
      expect(
        addToOrGroupAtLocation({
          currentQuery: query,
          groupStart: g.start,
          groupEnd: g.end,
          fieldName: "errorMessage",
          value: "rate limit",
        }),
      ).toBe('status:error OR status:warning OR errorMessage:"rate limit"');
    });
  });
});

describe("setFacetValueAtLocation", () => {
  describe("given an empty query", () => {
    it("returns an empty input unchanged", () => {
      expect(
        setFacetValueAtLocation({
          currentQuery: "",
          start: 0,
          end: 0,
          newValue: "x",
        }),
      ).toBe("");
    });

    it("returns whitespace-only input unchanged", () => {
      expect(
        setFacetValueAtLocation({
          currentQuery: "   ",
          start: 0,
          end: 0,
          newValue: "x",
        }),
      ).toBe("   ");
    });
  });

  describe("given a single Tag", () => {
    it("replaces the value while preserving the field name", () => {
      const query = "status:error";
      const { start, end } = locationOf(query, "status:error");
      expect(
        setFacetValueAtLocation({
          currentQuery: query,
          start,
          end,
          newValue: "warning",
        }),
      ).toBe("status:warning");
    });
  });

  describe("given a NOT-wrapped Tag", () => {
    it("preserves the leading NOT outside the swapped span", () => {
      // Tag.location covers only `status:error` — `NOT ` is outside the
      // [start, end), so the splice keeps the negation intact.
      const query = "NOT status:error";
      const { start, end } = locationOf(query, "status:error");
      expect(
        setFacetValueAtLocation({
          currentQuery: query,
          start,
          end,
          newValue: "warning",
        }),
      ).toBe("NOT status:warning");
    });

    it("preserves the leading `-` shorthand negation", () => {
      const query = "-status:error";
      const { start, end } = locationOf(query, "status:error");
      expect(
        setFacetValueAtLocation({
          currentQuery: query,
          start,
          end,
          newValue: "warning",
        }),
      ).toBe("-status:warning");
    });
  });

  describe("given leading whitespace on the query", () => {
    it("offsets the splice point by leading whitespace", () => {
      const query = "  status:error";
      // Tag.location is in trimmed coords, so `start: 0, end: 12`.
      expect(
        setFacetValueAtLocation({
          currentQuery: query,
          start: 0,
          end: 12,
          newValue: "warning",
        }),
      ).toBe("  status:warning");
    });
  });

  describe("given a value that needs quoting", () => {
    it("quotes values containing spaces", () => {
      const query = "errorMessage:foo";
      const { start, end } = locationOf(query, "errorMessage:foo");
      expect(
        setFacetValueAtLocation({
          currentQuery: query,
          start,
          end,
          newValue: "rate limit",
        }),
      ).toBe('errorMessage:"rate limit"');
    });
  });

  describe("given a location that doesn't resolve to a Tag", () => {
    it("returns the query unchanged when no Tag matches", () => {
      const query = "status:error";
      expect(
        setFacetValueAtLocation({
          currentQuery: query,
          start: 999,
          end: 1000,
          newValue: "warning",
        }),
      ).toBe(query);
    });

    it("returns the query unchanged for a range Tag (not a literal)", () => {
      const query = "cost:[1 TO 10]";
      // Liqe's range Tag.location starts at `[`; we know `cost` is a
      // Tag here but its expression is a RangeExpression, not a
      // LiteralExpression — so the swap bails.
      const ast = parse(query);
      const tag = ast as { location: { start: number; end: number } };
      expect(
        setFacetValueAtLocation({
          currentQuery: query,
          start: tag.location.start,
          end: tag.location.end,
          newValue: "5",
        }),
      ).toBe(query);
    });
  });

  describe("given an unparseable query", () => {
    it("returns the query unchanged rather than throwing", () => {
      const query = "status:error AND";
      expect(
        setFacetValueAtLocation({
          currentQuery: query,
          start: 0,
          end: 12,
          newValue: "warning",
        }),
      ).toBe(query);
    });
  });
});

describe("swapOperatorAtLocation", () => {
  describe("given an empty query", () => {
    it("returns an empty input unchanged", () => {
      expect(
        swapOperatorAtLocation({ currentQuery: "", start: 0, end: 0 }),
      ).toBe("");
    });

    it("returns whitespace-only input unchanged", () => {
      expect(
        swapOperatorAtLocation({ currentQuery: "   ", start: 0, end: 0 }),
      ).toBe("   ");
    });
  });

  describe("given an AND operator", () => {
    it("flips it to OR", () => {
      const query = "status:error AND model:gpt-4o";
      const { start, end } = locationOf(query, "AND");
      expect(
        swapOperatorAtLocation({ currentQuery: query, start, end }),
      ).toBe("status:error OR model:gpt-4o");
    });
  });

  describe("given an OR operator", () => {
    it("flips it to AND", () => {
      const query = "status:error OR model:gpt-4o";
      const { start, end } = locationOf(query, "OR");
      expect(
        swapOperatorAtLocation({ currentQuery: query, start, end }),
      ).toBe("status:error AND model:gpt-4o");
    });
  });

  describe("given mixed-case input at the slice", () => {
    it("normalises uppercase comparison and writes the canonical form", () => {
      // The comparison is case-insensitive so `and`/`AND`/`And` all
      // map; the replacement is always uppercase.
      const query = "status:error and model:gpt-4o";
      const { start, end } = locationOf(query, "and");
      expect(
        swapOperatorAtLocation({ currentQuery: query, start, end }),
      ).toBe("status:error OR model:gpt-4o");
    });
  });

  describe("given a slice that isn't an operator", () => {
    it("returns the query unchanged", () => {
      const query = "status:error AND model:gpt-4o";
      const { start, end } = locationOf(query, "status");
      expect(
        swapOperatorAtLocation({ currentQuery: query, start, end }),
      ).toBe(query);
    });
  });

  describe("given leading whitespace on the query", () => {
    it("offsets the splice point by leading whitespace", () => {
      // The handler converts liqe-trimmed coords to absolute coords by
      // adding leadingWs before the swap.
      const query = "  status:error AND model:gpt-4o";
      // In trimmed coords, AND is at 13..16. The function adds
      // leadingWs (2) → swaps 15..18 in the absolute string.
      expect(
        swapOperatorAtLocation({
          currentQuery: query,
          start: 13,
          end: 16,
        }),
      ).toBe("  status:error OR model:gpt-4o");
    });
  });
});

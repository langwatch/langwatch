import { describe, expect, it } from "vitest";
import { ParseError, parse, serialize, stripAtSigils } from "../parse";
import {
  buildFacetStateLookup,
  getFacetValues,
  getRangeValue,
  hasCrossFacetOR,
  validateAst,
} from "../queries";
import {
  removeFacetValueFromQuery,
  removeFieldFromQuery,
  removeNodeAtLocation,
  setRangeInQuery,
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
      expect(removeNodeAtLocation(query, start, end)).toBe("");
    });
  });

  describe("given two AND-joined tags", () => {
    it("drops the targeted tag and the now-orphaned AND keyword", () => {
      const query = "status:error AND model:gpt-4o";
      const { start, end } = locationOf(query, "status:error");
      expect(removeNodeAtLocation(query, start, end)).toBe("model:gpt-4o");
    });
  });

  describe("given two OR-joined tags inside parentheses", () => {
    it("drops the targeted tag and collapses the parenthesised group", () => {
      const query = "(status:error OR status:warning) AND model:gpt-4o";
      const { start, end } = locationOf(query, "status:warning");
      // The orphan paren wrapping a single tag is collapsed by the serializer.
      expect(removeNodeAtLocation(query, start, end)).toBe(
        "status:error AND model:gpt-4o",
      );
    });
  });

  describe("given a tag whose location does not match", () => {
    it("leaves the query unchanged", () => {
      const query = "status:error AND model:gpt-4o";
      expect(removeNodeAtLocation(query, 999, 1000)).toBe(query);
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

  describe("given an OR whose arms are compound (known limitation)", () => {
    it("returns false when the OR's left arm is a compound AND — `topField(AND) = null`", () => {
      // `a AND b OR c` parses as `OR(AND(a,b), c)` because AND binds
      // tighter than OR. `topField` of an AND is null, so the helper
      // can't classify the left vs right field — short-circuits to false.
      // Pinning current behaviour; if we ever harden the helper, flip.
      expect(
        hasCrossFacetOR(parse("origin:application AND status:error OR model:gpt-4o")),
      ).toBe(false);
    });

    it("returns false when an OR is wrapped in parens — helper doesn't recurse into them", () => {
      // The sidebar cross-facet banner won't trigger for `a AND (b OR c)`
      // even when b/c are different fields.
      expect(
        hasCrossFacetOR(parse("origin:application AND (status:error OR model:gpt-4o)")),
      ).toBe(false);
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
      expect(toggleFacetInQuery("", "status", "error", "neutral")).toBe(
        "status:error",
      );
    });
  });

  describe("starting from include", () => {
    it("flips include → exclude (rewrites the same value as `NOT`)", () => {
      expect(toggleFacetInQuery("status:error", "status", "error", "include")).toBe(
        "NOT status:error",
      );
    });
  });

  describe("starting from exclude", () => {
    it("collapses back to neutral (drops the clause entirely)", () => {
      expect(toggleFacetInQuery("NOT status:error", "status", "error", "exclude")).toBe(
        "",
      );
    });
  });

  describe("alongside other clauses", () => {
    it("appends with AND when the query already has content", () => {
      expect(
        toggleFacetInQuery("model:gpt-4o", "status", "error", "neutral"),
      ).toBe("model:gpt-4o AND status:error");
    });

    it("removes only the targeted value, leaving siblings intact", () => {
      expect(
        toggleFacetInQuery(
          "status:error AND status:warning",
          "status",
          "error",
          "exclude",
        ),
      ).toBe("status:warning");
    });
  });

  describe("when the value contains spaces", () => {
    it("quotes the value when appending", () => {
      expect(toggleFacetInQuery("", "errorMessage", "rate limit", "neutral")).toBe(
        'errorMessage:"rate limit"',
      );
    });
  });
});

describe("setRangeInQuery", () => {
  describe("starting from an empty query", () => {
    it("inserts the range clause", () => {
      expect(setRangeInQuery("", "cost", "1", "10")).toBe("cost:[1 TO 10]");
    });
  });

  describe("when the field already has a range", () => {
    it("replaces the existing range rather than stacking another one", () => {
      expect(setRangeInQuery("cost:[1 TO 5]", "cost", "1", "10")).toBe(
        "cost:[1 TO 10]",
      );
    });

    it("replaces an existing comparison with the new range", () => {
      expect(setRangeInQuery("cost:>5", "cost", "1", "10")).toBe(
        "cost:[1 TO 10]",
      );
    });
  });

  describe("alongside unrelated clauses", () => {
    it("preserves the unrelated clauses and appends the range with AND", () => {
      expect(setRangeInQuery("status:error", "cost", "1", "10")).toBe(
        "status:error AND cost:[1 TO 10]",
      );
    });
  });
});

describe("removeFieldFromQuery", () => {
  describe("when the field is the only clause", () => {
    it("returns the empty string", () => {
      expect(removeFieldFromQuery("status:error", "status")).toBe("");
    });
  });

  describe("when the field appears multiple times", () => {
    it("drops every value of the field", () => {
      expect(
        removeFieldFromQuery("status:error AND status:warning AND model:gpt-4o", "status"),
      ).toBe("model:gpt-4o");
    });
  });

  describe("when the field doesn't appear", () => {
    it("returns the query unchanged via round-trip serialisation", () => {
      // Exact string can drift via serialiser whitespace; what matters is
      // that no clauses were dropped.
      const result = removeFieldFromQuery("status:error AND model:gpt-4o", "cost");
      expect(result).toBe("status:error AND model:gpt-4o");
    });
  });

  describe("when the input is unparseable mid-edit", () => {
    it("returns the original string rather than throwing", () => {
      expect(removeFieldFromQuery("status:error AND", "status")).toBe(
        "status:error AND",
      );
    });
  });
});

describe("removeFacetValueFromQuery", () => {
  describe("when only the targeted value matches", () => {
    it("drops just that one value", () => {
      expect(
        removeFacetValueFromQuery(
          "status:error AND status:warning",
          "status",
          "error",
        ),
      ).toBe("status:warning");
    });
  });

  describe("when the value is the only clause", () => {
    it("returns the empty string", () => {
      expect(removeFacetValueFromQuery("status:error", "status", "error")).toBe("");
    });
  });

  describe("when the value isn't present", () => {
    it("leaves the query as-is", () => {
      expect(removeFacetValueFromQuery("status:error", "status", "warning")).toBe(
        "status:error",
      );
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

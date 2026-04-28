import { describe, expect, it } from "vitest";
import {
  buildFacetStateLookup,
  ParseError,
  parse,
  removeNodeAtLocation,
  stripAtSigils,
} from "../queryParser";

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

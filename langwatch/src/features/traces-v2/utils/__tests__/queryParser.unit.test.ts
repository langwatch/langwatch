import { describe, expect, it } from "vitest";
import {
  parse,
  removeNodeAtLocation,
  stripAtSigils,
} from "../queryParser";

function locationOf(query: string, fragment: string): { start: number; end: number } {
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

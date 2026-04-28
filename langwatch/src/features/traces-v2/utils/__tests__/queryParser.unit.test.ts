import { describe, expect, it } from "vitest";
import { parse, stripAtSigils } from "../queryParser";

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

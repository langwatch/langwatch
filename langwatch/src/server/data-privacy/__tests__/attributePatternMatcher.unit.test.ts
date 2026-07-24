import { describe, expect, it } from "vitest";

import {
  compileAttributePattern,
  compileAttributePatterns,
  matchesAnyAttributePattern,
} from "../attributePatternMatcher";

describe("compileAttributePattern", () => {
  describe("given a pattern without wildcards", () => {
    it("matches only the exact key", () => {
      const regex = compileAttributePattern("http.request.body");

      expect(regex.test("http.request.body")).toBe(true);
      expect(regex.test("http.request.body.json")).toBe(false);
      expect(regex.test("xhttp.request.body")).toBe(false);
    });
  });

  describe("given a trailing wildcard", () => {
    it("matches any suffix including nested dotted paths", () => {
      const regex = compileAttributePattern("gen_ai.prompt.*");

      expect(regex.test("gen_ai.prompt.id")).toBe(true);
      expect(regex.test("gen_ai.prompt.variables.name")).toBe(true);
      expect(regex.test("gen_ai.prompt")).toBe(false);
      expect(regex.test("gen_ai.output.messages")).toBe(false);
    });
  });

  describe("given an inner wildcard", () => {
    it("matches any run of characters in the middle", () => {
      const regex = compileAttributePattern("app.*.token");

      expect(regex.test("app.session.token")).toBe(true);
      expect(regex.test("app.billing.card.token")).toBe(true);
      expect(regex.test("app.token")).toBe(false);
    });
  });

  describe("given regex metacharacters in the pattern", () => {
    it("treats them as literals", () => {
      const regex = compileAttributePattern("metrics[0].value");

      expect(regex.test("metrics[0].value")).toBe(true);
      expect(regex.test("metrics0value")).toBe(false);
    });
  });
});

describe("matchesAnyAttributePattern", () => {
  it("checks a key against every compiled matcher", () => {
    const matchers = compileAttributePatterns(["a.b", "c.*"]);

    expect(matchesAnyAttributePattern("a.b", matchers)).toBe(true);
    expect(matchesAnyAttributePattern("c.d.e", matchers)).toBe(true);
    expect(matchesAnyAttributePattern("z", matchers)).toBe(false);
  });
});

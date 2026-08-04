/**
 * The Sessions lens forwards a query's positive free-text terms to the
 * transcript content search (specs/traces-v2/sessions-lens.feature). Only
 * implicit-field terms qualify: structured tags already translate to trace
 * predicates, and negated terms must not become positive content matches.
 */
import { describe, expect, it } from "vitest";
import { extractFreeTextTerms } from "../ast";

describe("given plain free text", () => {
  describe("when extracting the content terms", () => {
    it("returns the term, including hash-prefixed identifiers", () => {
      expect(extractFreeTextTerms("#6418")).toEqual(["#6418"]);
    });

    it("returns quoted phrases whole", () => {
      expect(extractFreeTextTerms('"checkout failed"')).toEqual([
        "checkout failed",
      ]);
    });
  });
});

describe("given a mix of structured tags and free text", () => {
  describe("when extracting the content terms", () => {
    it("keeps only the free-text terms", () => {
      expect(extractFreeTextTerms('service:api "checkout failed"')).toEqual([
        "checkout failed",
      ]);
    });

    it("skips negated terms", () => {
      expect(extractFreeTextTerms("keep NOT dropped")).toEqual(["keep"]);
    });

    it("skips terms negated with the dash prefix", () => {
      expect(extractFreeTextTerms("keep -dropped")).toEqual(["keep"]);
    });
  });
});

describe("given a regex term", () => {
  describe("when extracting the content terms", () => {
    it("ignores it, a regex source is not a substring", () => {
      expect(extractFreeTextTerms("/checkout.*failed/")).toEqual([]);
      expect(extractFreeTextTerms("keep /checkout.*failed/")).toEqual(["keep"]);
    });
  });
});

describe("given a query joined by OR", () => {
  describe("when extracting the content terms", () => {
    it("returns no terms so the content search is skipped", () => {
      expect(extractFreeTextTerms("checkout OR refund")).toEqual([]);
    });

    it("returns no terms when the OR hides inside parentheses", () => {
      expect(
        extractFreeTextTerms("service:api AND (checkout OR refund)"),
      ).toEqual([]);
    });
  });
});

describe("given a query joined only by AND", () => {
  describe("when extracting the content terms", () => {
    it("returns every free-text term", () => {
      expect(extractFreeTextTerms("checkout AND refund")).toEqual([
        "checkout",
        "refund",
      ]);
    });
  });
});

describe("given empty or unparsable input", () => {
  describe("when extracting the content terms", () => {
    it("returns no terms", () => {
      expect(extractFreeTextTerms("")).toEqual([]);
      expect(extractFreeTextTerms("   ")).toEqual([]);
    });
  });
});

describe("given more free-text terms than the content search carries", () => {
  /** @scenario Session content search matches transcript text in log records */
  it("drops the content branch rather than answering a narrower query", () => {
    const nine = Array.from({ length: 9 }, (_, i) => `t${i}`).join(" ");

    expect(extractFreeTextTerms(nine)).toEqual([]);
  });

  /** @scenario Session content search matches transcript text in log records */
  it("keeps a query sitting on the cap", () => {
    const eight = Array.from({ length: 8 }, (_, i) => `t${i}`);

    expect(extractFreeTextTerms(eight.join(" "))).toEqual(eight);
  });
});

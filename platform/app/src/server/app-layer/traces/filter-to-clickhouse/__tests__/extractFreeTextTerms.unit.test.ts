/**
 * The Sessions lens forwards a query's positive free-text terms to the
 * transcript content search (specs/traces-v2/sessions-lens.feature). Only
 * implicit-field terms qualify: structured tags already translate to trace
 * predicates, and negated terms must not become positive content matches.
 */
import { describe, expect, it } from "vitest";
import { extractFreeTextTerms } from "../ast";

describe("extractFreeTextTerms", () => {
  describe("given plain free text", () => {
    it("returns the term, including hash-prefixed identifiers", () => {
      expect(extractFreeTextTerms("#6418")).toEqual(["#6418"]);
    });

    it("returns quoted phrases whole", () => {
      expect(extractFreeTextTerms('"checkout failed"')).toEqual([
        "checkout failed",
      ]);
    });
  });

  describe("given a mix of structured tags and free text", () => {
    it("keeps only the free-text terms", () => {
      expect(extractFreeTextTerms('service:api "checkout failed"')).toEqual([
        "checkout failed",
      ]);
    });

    it("skips negated terms", () => {
      expect(extractFreeTextTerms("keep NOT dropped")).toEqual(["keep"]);
    });
  });

  describe("given empty or unparsable input", () => {
    it("returns no terms", () => {
      expect(extractFreeTextTerms("")).toEqual([]);
      expect(extractFreeTextTerms("   ")).toEqual([]);
    });
  });
});

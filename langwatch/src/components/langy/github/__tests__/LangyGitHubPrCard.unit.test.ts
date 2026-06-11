import { describe, expect, it } from "vitest";

import { extractPrLinks } from "../LangyGitHubPrCard";

describe("extractPrLinks", () => {
  describe("when the reply has no GitHub URL", () => {
    it("returns an empty list", () => {
      expect(extractPrLinks("opened the pr, all good")).toEqual([]);
    });
  });

  describe("when the reply contains one PR URL", () => {
    it("parses owner, repo, number, and the url", () => {
      const out = extractPrLinks(
        "Opened https://github.com/acme/service-x/pull/482 for review.",
      );
      expect(out).toEqual([
        {
          owner: "acme",
          repo: "service-x",
          number: 482,
          url: "https://github.com/acme/service-x/pull/482",
        },
      ]);
    });
  });

  describe("when the reply contains multiple PR URLs", () => {
    it("dedupes by owner/repo/number across the text", () => {
      const out = extractPrLinks(
        "https://github.com/acme/foo/pull/1 and again https://github.com/acme/foo/pull/1 plus https://github.com/acme/bar/pull/9",
      );
      expect(out).toHaveLength(2);
      expect(out[0]?.number).toBe(1);
      expect(out[1]?.number).toBe(9);
    });
  });

  describe("when a URL looks like a PR but is on a different host", () => {
    it("is ignored", () => {
      expect(
        extractPrLinks("https://example.com/acme/foo/pull/1"),
      ).toEqual([]);
    });
  });

  describe("when a URL points at a non-PR path", () => {
    it("is ignored", () => {
      expect(
        extractPrLinks(
          "see https://github.com/acme/foo/issues/1 and https://github.com/acme/foo/blob/main/README.md",
        ),
      ).toEqual([]);
    });
  });
});

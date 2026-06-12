/**
 * @vitest-environment node
 *
 * The extractor backs two surfaces that both have to agree:
 *  - the per-user daily PR counter in the chat handler
 *  - the in-chat PR card renderer
 *
 * If these diverge on what "a PR mention" looks like, we either over-count
 * (lock honest users out of Langy for the day) or skip rendering a card the
 * counter charged for. Pin the behavior here.
 */
import { describe, expect, it } from "vitest";
import { extractGithubPrLinks } from "../githubPrLinks";

describe("extractGithubPrLinks", () => {
  describe("when the text has no GitHub URLs", () => {
    it("returns an empty list", () => {
      expect(extractGithubPrLinks("I checked the dataset and it looks fine.")).toEqual([]);
    });
  });

  describe("when the text mentions one PR URL inline", () => {
    it("extracts owner, repo, number, and the full URL", () => {
      const out = extractGithubPrLinks(
        "Opened https://github.com/acme/service-x/pull/42 for you.",
      );
      expect(out).toEqual([
        {
          owner: "acme",
          repo: "service-x",
          number: 42,
          url: "https://github.com/acme/service-x/pull/42",
        },
      ]);
    });
  });

  describe("when the same PR URL appears twice", () => {
    it("deduplicates by owner/repo/number", () => {
      const text = [
        "PR ready: https://github.com/acme/foo/pull/9",
        "Link again: https://github.com/acme/foo/pull/9",
      ].join("\n");
      expect(extractGithubPrLinks(text)).toHaveLength(1);
    });
  });

  describe("when two distinct PR URLs appear", () => {
    it("returns both, in order of first occurrence", () => {
      const out = extractGithubPrLinks(
        "https://github.com/a/b/pull/1 then https://github.com/c/d/pull/2",
      );
      expect(out.map((p) => p.number)).toEqual([1, 2]);
    });
  });

  describe("when a github.com URL points to issues or compare", () => {
    it("does not match — only /pull/N counts as a PR", () => {
      expect(
        extractGithubPrLinks(
          "issue https://github.com/a/b/issues/42 compare https://github.com/a/b/compare/main...x",
        ),
      ).toEqual([]);
    });
  });

  describe("when called twice on the same input", () => {
    it("returns the same result (regex lastIndex is reset)", () => {
      const text = "PR: https://github.com/a/b/pull/7";
      expect(extractGithubPrLinks(text)).toEqual(extractGithubPrLinks(text));
    });
  });
});

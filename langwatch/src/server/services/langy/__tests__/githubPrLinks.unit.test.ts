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
import { extractGithubPrLinks, extractOpenedPrLinks } from "../githubPrLinks";

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

describe("extractOpenedPrLinks", () => {
  describe("when an `opened` sentinel matches the PR URL", () => {
    it("counts that PR", () => {
      const text = [
        "[langy:progress:opening_pr:acme/foo]",
        "[langy:progress:opened:acme/foo#9]",
        "Opened https://github.com/acme/foo/pull/9 for you.",
      ].join("\n");
      expect(extractOpenedPrLinks(text).map((l) => l.number)).toEqual([9]);
    });
  });

  describe("when a PR is merely MENTIONED (progress events present, none opened it)", () => {
    it("does not count it — 'summarize PR #4751' must not burn the cap", () => {
      const text = [
        "[langy:progress:cloning:acme/foo]",
        "Here's a summary of https://github.com/acme/foo/pull/123 as requested.",
      ].join("\n");
      expect(extractOpenedPrLinks(text)).toEqual([]);
    });
  });

  describe("when the reply has PR URLs but NO progress sentinels at all", () => {
    it("falls back to counting every link (older skill / stripped sentinels)", () => {
      const text = "Done: https://github.com/acme/foo/pull/5";
      expect(extractOpenedPrLinks(text).map((l) => l.number)).toEqual([5]);
    });
  });

  describe("when one PR was opened and another merely referenced", () => {
    it("counts only the opened one", () => {
      const text = [
        "[langy:progress:opened:acme/foo#9]",
        "Opened https://github.com/acme/foo/pull/9 — similar to",
        "https://github.com/other/repo/pull/1.",
      ].join("\n");
      const out = extractOpenedPrLinks(text);
      expect(out.map((l) => `${l.owner}/${l.repo}#${l.number}`)).toEqual([
        "acme/foo#9",
      ]);
    });
  });

  describe("when `opened` fired but its detail is missing (skill drift)", () => {
    it("falls back to all links rather than undercounting a real PR", () => {
      const text = [
        "[langy:progress:opened]",
        "Opened https://github.com/acme/foo/pull/9.",
      ].join("\n");
      expect(extractOpenedPrLinks(text).map((l) => l.number)).toEqual([9]);
    });
  });
});

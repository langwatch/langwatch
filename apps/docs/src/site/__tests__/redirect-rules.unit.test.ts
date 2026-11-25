import { afterAll, describe, expect, it } from "vitest";

import { checkLedger } from "../checks/ledger.ts";
import { checkRedirectRules } from "../checks/redirect-rules.ts";
import { buildFixture, page } from "./build-fixture.ts";

describe("when a build's redirects are checked", () => {
  const fixture = buildFixture({
    files: {
      "index.html": page({ slug: "introduction" }),
      "guide/index.html": page({ slug: "guide" }),
      "guides/setup/index.html": page({ slug: "guides/setup" }),
      "redirects.json": JSON.stringify({
        "/ok": "/guide",
        "/ok-query": "/guide?tab=python",
        "/external": "https://github.com/langwatch/langwatch",
        "/insecure": "http://example.com",
        "/relative": "guide",
        "/anchored": "/guide#install",
        "/missing": "/nowhere",
        "/chain": "/ok",
        "/loop-a": "/loop-b",
        "/loop-b": "/loop-a",
        "/guide": "/guides/setup",
        "/old-guides/:path*": "/guides/:path*",
        "/bad-pattern/:path*": "/guides/:slug*",
      }),
    },
  });
  afterAll(() => fixture.dispose());

  /** @scenario "Redirects point at pages" */
  it("reports destinations that are not pages or https, chains, cycles and fragments", () => {
    const { checked, issues } = checkRedirectRules({ index: fixture.index({ basePath: "/docs" }) });
    expect(checked).toBe(13);
    expect(issues.map(({ source, code }) => [source, code])).toEqual([
      ["/ok", "redirect-chain"],
      ["/ok-query", "redirect-chain"],
      ["/insecure", "destination-not-https"],
      ["/relative", "destination-not-absolute"],
      ["/anchored", "destination-fragment"],
      ["/missing", "destination-not-page"],
      ["/chain", "redirect-chain"],
      ["/loop-a", "redirect-chain"],
      ["/loop-a", "redirect-cycle"],
      ["/loop-b", "redirect-chain"],
      ["/loop-b", "redirect-cycle"],
      ["/guide", "source-is-page"],
      ["/bad-pattern/:path*", "destination-unknown-parameter"],
    ]);
  });

  describe("when a published path lies under a pattern source", () => {
    /** @scenario "Redirects point at pages" */
    it("resolves through the pattern to the page beneath the destination", () => {
      const { issues } = checkLedger({
        index: fixture.index(),
        ledger: ["/old-guides/setup", "/old-guides/absent"],
      });
      expect(issues.filter((issue) => issue.code !== "unlisted-page")).toEqual([
        { source: "published-urls.txt", href: "/old-guides/absent", code: "unpublished" },
      ]);
    });
  });
});

import { describe, expect, it } from "vitest";

import { cachePolicy, markdownTwin, prefersMarkdown } from "../preview-server.ts";

describe("when the preview serves a build", () => {
  /** @scenario "Serve files with the caching a production host gives them" */
  it("keeps hashed assets forever, media for a day and documents fresh", () => {
    expect(cachePolicy({ sitePathname: "/assets/index-BDHvY-Yj.js" })).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(cachePolicy({ sitePathname: "/assets/docs-1a8a2835acafc98e.css" })).toContain(
      "immutable",
    );
    expect(cachePolicy({ sitePathname: "/fonts/Inter-Variable-latin.woff2" })).toBe(
      "public, max-age=86400, stale-while-revalidate=604800",
    );
    for (const sitePathname of ["/integration/quick-start/index.html", "/search-index.json", "/llms.txt"])
      expect(cachePolicy({ sitePathname })).toBe("no-cache");
  });
});

describe("when an agent asks for a page", () => {
  /** @scenario "An agent that asks for Markdown gets the page's Markdown" */
  it("answers with Markdown only when Markdown is preferred at least as much as HTML", () => {
    expect(prefersMarkdown({ accept: "text/markdown" })).toBe(true);
    expect(prefersMarkdown({ accept: "text/markdown, text/html;q=0.9" })).toBe(true);
    expect(prefersMarkdown({ accept: "text/html,application/xhtml+xml,*/*;q=0.8" })).toBe(false);
    expect(prefersMarkdown({ accept: "text/html, text/markdown;q=0.5" })).toBe(false);
    expect(prefersMarkdown({ accept: "" })).toBe(false);
  });

  /** @scenario "An agent that asks for Markdown gets the page's Markdown" */
  it("names the Markdown twin of a page and of the home page", () => {
    expect(markdownTwin({ sitePathname: "/integration/quick-start/" })).toBe(
      "/integration/quick-start.md",
    );
    expect(markdownTwin({ sitePathname: "/" })).toBe("/index.md");
  });
});

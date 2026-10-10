/**
 * @vitest-environment node
 * The changelog feed and an entry page read into the "What's new" card.
 * @see modules/navigation/specs/whats-new.feature
 */
import { describe, expect, it } from "vitest";

import { parseChangelogEntryPage, parseChangelogFeed } from "../user-changelog.rules.ts";

const FEED = `<?xml version="1.0"?><rss><channel><title>LangWatch Changelog</title>
  <item>
    <title>Instant Evals in the Trace Explorer, &amp; Files</title>
    <link>https://langwatch.ai/changelog/instant-evals-in-the-trace-explorer</link>
    <guid isPermaLink="true">https://langwatch.ai/changelog/instant-evals-in-the-trace-explorer</guid>
    <pubDate>Sun, 27 Sep 2026 00:00:00 GMT</pubDate>
  </item>
  <item><title><![CDATA[Older]]></title><link>https://langwatch.ai/changelog/older</link></item>
</channel></rss>`;

const PAGE_URL = "https://langwatch.ai/changelog/instant-evals-in-the-trace-explorer";

const PAGE = `<h1>Title</h1><img src="/changelog/instant-evals/01-eval-chip.png" alt="chip">
  <h2>What You Can Do Now</h2>
  <h3>Instant Evals in the <code>search</code> bar</h3><p>Body</p><ul><li>a detail</li></ul>
  <h3><a href="/docs/langy">Langy</a> drives the Trace Explorer</h3>
  <h3>Files and images in datasets</h3>
  <h3>Connected self-hosted</h3>
  <h3>A fifth one</h3>
  <h2>Fixes</h2><h3>Not a feature</h3>`;

describe("parseChangelogFeed", () => {
  it("reads items newest first with guid, link, title and date", () => {
    expect(parseChangelogFeed(FEED)).toEqual([
      {
        id: PAGE_URL,
        title: "Instant Evals in the Trace Explorer, & Files",
        url: PAGE_URL,
        publishedAt: "Sun, 27 Sep 2026 00:00:00 GMT",
      },
      {
        id: "https://langwatch.ai/changelog/older",
        title: "Older",
        url: "https://langwatch.ai/changelog/older",
        publishedAt: "",
      },
    ]);
  });

  /** @scenario "The feed cannot be parsed" */
  it("reads nothing from a body that is not a feed", () => {
    expect(parseChangelogFeed("<html><body>Bad gateway</body></html>")).toEqual([]);
  });

  it("skips an item whose link is not an http address", () => {
    const feed = "<item><title>x</title><link>javascript:alert(1)</link></item>";
    expect(parseChangelogFeed(feed)).toEqual([]);
  });
});

describe("parseChangelogEntryPage", () => {
  it("reads the first screenshot and up to four lines of What You Can Do Now", () => {
    expect(parseChangelogEntryPage({ html: PAGE, pageUrl: PAGE_URL })).toEqual({
      imageUrl: "https://langwatch.ai/changelog/instant-evals/01-eval-chip.png",
      features: [
        { text: "Instant Evals in the search bar", url: PAGE_URL },
        { text: "Langy drives the Trace Explorer", url: "https://langwatch.ai/docs/langy" },
        { text: "Files and images in datasets", url: PAGE_URL },
        { text: "Connected self-hosted", url: PAGE_URL },
      ],
    });
  });

  it("falls back to the section's list items when it has no headings", () => {
    const html = "<h2>What You Can Do Now</h2><ul><li>One</li><li>Two</li></ul>";
    expect(parseChangelogEntryPage({ html, pageUrl: PAGE_URL }).features).toEqual([
      { text: "One", url: PAGE_URL },
      { text: "Two", url: PAGE_URL },
    ]);
  });

  /** @scenario "An entry page without a screenshot or feature lines still shows the card" */
  it("reads no image and no lines from a page without either", () => {
    expect(parseChangelogEntryPage({ html: "<p>Short note</p>", pageUrl: PAGE_URL })).toEqual({
      imageUrl: null,
      features: [],
    });
  });
});

import { describe, expect, it } from "vitest";

import { pageIcon, publishSearchIndex, searchEntry, searchTrail } from "../compile/search-index.ts";
import { decodeSearchIndex } from "../model/search-engine.ts";

describe("when a rendered page includes shell text and nested navigation", () => {
  /** @scenario "Index API reference content" */
  it("indexes endpoint main content when there is no guide article", () => {
    const entry = searchEntry({
      nav: {
        pages: {
          endpoint: { title: "List prompts", description: "Read prompts", openapi: "GET /prompts" },
        },
        anchors: [],
      },
      slug: "endpoint",
      html: '<nav>Unrelated navigation</nav><main id="content"><h1>List prompts</h1><p>GET /prompts</p><section>cursor query parameter</section><section>promptVersion response field</section></main><footer>Unrelated footer</footer>',
      headings: [],
    });
    expect(entry.body).toBe(
      "List prompts GET /prompts cursor query parameter promptVersion response field",
    );
    expect(entry.method).toBe("GET");
  });

  /** @scenario "Index article content with navigation context" */
  it("indexes the article and heading anchors with the authored context", () => {
    const nav = {
      pages: { guide: { title: "Trace guide", description: "Record a trace" } },
      anchors: [
        {
          title: "Observability",
          children: [
            {
              type: "group",
              title: "SDKs",
              children: [{ type: "page", slug: "guide", title: "Trace guide" }],
            },
          ],
        },
      ],
    } satisfies Parameters<typeof searchEntry>[0]["nav"];
    const entry = searchEntry({
      nav,
      slug: "guide",
      html: '<nav>Not searchable</nav><article class="prose"><style>.hidden { color: red }</style><h2 id="python">Python SDK</h2><p>Capture &amp; inspect <code>spans</code>.</p></article><aside>More shell</aside>',
      headings: [{ id: "python", text: "Python SDK", depth: 2 }],
    });
    expect(entry).toEqual({
      slug: "guide",
      title: "Trace guide",
      description: "Record a trace",
      section: "Observability",
      trail: "Observability › SDKs",
      body: "Python SDK Capture inspect spans .",
      headings: [{ id: "python", text: "Python SDK" }],
    });
    expect(searchTrail({ nav, slug: "unlisted" })).toEqual({ section: "", trail: "" });
  });
});

describe("when the build publishes the rendered entries", () => {
  const article = (words: string) => ({
    title: "Page",
    description: "",
    section: "Guides",
    trail: "Guides › Basics",
    body: words,
  });
  const published = () =>
    JSON.parse(
      publishSearchIndex({
        entries: [
          {
            slug: "first",
            ...article("Spans nest. Spans export, spans! Capture it."),
            headings: [
              { id: "capture-spans", text: "Capture spans" },
              { id: "capture-spans-1", text: "Capture spans" },
            ],
          },
          { slug: "second", method: "GET", ...article("traces"), headings: [] },
          { slug: "third", ...article("Spans and traces"), section: "Other", headings: [] },
        ],
      }),
    );

  /** @scenario "Publish the search index with each article word once" */
  it("keeps one entry per page in order and writes each word once with its later pages", () => {
    /* "spans" and "capture" are in the first page's heading, so they are indexed from the third. */
    expect(published()).toEqual([
      {
        slug: "first",
        title: "Page",
        description: "",
        trail: "Guides › Basics",
        headings: ["Capture spans", ["capture-spans-1", "Capture spans"]],
        terms: "export it nest",
      },
      {
        slug: "second",
        method: "GET",
        title: "Page",
        description: "",
        trail: "Guides › Basics",
        terms: "traces",
        pages: "1",
      },
      {
        slug: "third",
        title: "Page",
        description: "",
        section: "Other",
        trail: "Guides › Basics",
        terms: "and spans",
      },
    ]);
  });

  /** @scenario "Publish the search index with each article word once" */
  it("writes far fewer bytes than the article text it replaces", () => {
    const sentence = "Capture every span, trace and evaluation result from your agent. ";
    const entries = Array.from({ length: 40 }, (_, page) => ({
      slug: `page-${page}`,
      ...article(`${sentence.repeat(30)} page${page}`),
      headings: [],
    }));
    const articleBytes = entries.reduce((sum, entry) => sum + entry.body.length, 0);
    expect(publishSearchIndex({ entries }).length).toBeLessThan(articleBytes / 10);
  });
});

describe("when pages carry icons at different levels", () => {
  const page = (title: string, icon?: string) => ({
    title,
    description: "",
    ...(icon ? { icon } : {}),
  });
  const nav = {
    pages: {
      own: page("Own", "rocket"),
      grouped: page("Grouped"),
      sectioned: page("Sectioned"),
      bare: page("Bare"),
    },
    anchors: [
      {
        title: "Guides",
        icon: "book",
        children: [
          { type: "page", slug: "sectioned", title: "Sectioned" },
          {
            type: "group",
            title: "Outer",
            icon: "/images/logos/golang.svg",
            children: [
              {
                type: "group",
                title: "Inner",
                children: [
                  { type: "page", slug: "own", title: "Own" },
                  { type: "page", slug: "grouped", title: "Grouped" },
                ],
              },
            ],
          },
        ],
      },
      { title: "Other", children: [{ type: "page", slug: "bare", title: "Bare" }] },
    ],
  } satisfies Parameters<typeof searchEntry>[0]["nav"];
  const entry = (slug: string) =>
    searchEntry({ nav, slug, html: "<article></article>", headings: [] });

  /** @scenario "Give each search result its page's icon" */
  it("names the page's own icon, else its innermost group's with one, else its section's", () => {
    expect(pageIcon({ nav, slug: "own" })).toBe("rocket");
    expect(pageIcon({ nav, slug: "grouped" })).toBe("/images/logos/golang.svg");
    expect(pageIcon({ nav, slug: "sectioned" })).toBe("book");
    expect(entry("bare")).not.toHaveProperty("icon");
  });

  /** @scenario "Give each search result its page's icon" */
  it("writes a bundled icon's drawing once, and the browser reads it for every page naming it", () => {
    const published = JSON.parse(
      publishSearchIndex({
        entries: ["own", "sectioned", "grouped", "bare"].map(entry).concat(entry("own")),
      }),
    );
    expect(published.map((value: { icon?: string }) => value.icon)).toEqual([
      "rocket",
      "book",
      "/images/logos/golang.svg",
      undefined,
      "rocket",
    ]);
    expect(published.filter((value: { glyph?: string }) => value.glyph)).toHaveLength(2);
    expect(published[0]?.glyph).toMatch(/^<path d="[^"]+"\/>/);
    const index = decodeSearchIndex({ data: published });
    expect(index.glyphs.get(index.entries[4]?.icon ?? "")).toBe(published[0]?.glyph);
    expect(index.entries[3]?.icon).toBe("");
  });
});

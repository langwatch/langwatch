import { describe, expect, it } from "vitest";

import { discoveryFiles, llmsFull } from "../compile/discovery-files.ts";

describe("documentation discovery", () => {
  /** @scenario "Discover page exports and crawlable documentation" */
  it("lists canonical pages once and tells crawlers where to find them", () => {
    const files = discoveryFiles({
      nav: {
        site: { name: "LangWatch" },
        pages: {
          introduction: { title: "Introduction", description: "" },
          "coding-agents/overview": { title: "Coding agents", description: "Trace agents" },
        },
      },
    });
    expect(files["sitemap.xml"]).toContain("<loc>https://langwatch.ai/docs/introduction</loc>");
    expect(files["sitemap.xml"]).toContain(
      "<loc>https://langwatch.ai/docs/coding-agents/overview</loc>",
    );
    expect(files["sitemap.xml"].match(/<url>/g)).toHaveLength(2);
    expect(files["robots.txt"]).toContain("Sitemap: https://langwatch.ai/docs/sitemap.xml");
    expect(files["agents.txt"]).toContain("not automatically installed agent configuration");
    expect(files["humans.txt"]).toContain("LangWatch B.V.");
    expect(files["llms.txt"]).toContain(
      "- [Coding agents](https://langwatch.ai/docs/coding-agents/overview.md): Trace agents",
    );
  });

  /** @scenario "Discover page exports and crawlable documentation" */
  it("groups llms.txt by section and still lists every page exactly once", () => {
    const llms = discoveryFiles({
      nav: {
        site: { name: "LangWatch" },
        pages: {
          introduction: { title: "Introduction", description: "" },
          "tracing/spans": { title: "Spans", description: "" },
          orphan: { title: "Orphan", description: "" },
        },
        anchors: [
          {
            title: "Guides",
            icon: "",
            children: [
              { type: "page", slug: "introduction", title: "Introduction" },
              {
                type: "group",
                title: "Tracing",
                children: [{ type: "page", slug: "tracing/spans", title: "Spans" }],
              },
            ],
          },
          {
            title: "Again",
            icon: "",
            children: [{ type: "page", slug: "introduction", title: "Introduction" }],
          },
        ],
      },
    })["llms.txt"];
    expect(llms).toContain("## Guides\n\n- [Introduction]");
    expect(llms).toContain("- [Spans](https://langwatch.ai/docs/tracing/spans.md)");
    expect(llms).toContain("## More pages\n\n- [Orphan]");
    expect(llms).not.toContain("## Again");
    expect(llms.match(/^- \[/gm)).toHaveLength(3);
  });
});

describe("when agents read the whole documentation", () => {
  const nav = {
    site: { name: "LangWatch" },
    pages: {
      introduction: { title: "Introduction", description: "" },
      "tracing/spans": { title: "Spans", description: "" },
    },
  };

  /** @scenario "Discover page exports and crawlable documentation" */
  it("dates sitemap pages that have a commit and leaves the rest undated", () => {
    const files = discoveryFiles({
      nav,
      lastModified: new Map([["tracing/spans", "2026-10-01T09:00:00+02:00"]]),
    });
    expect(files["sitemap.xml"]).toContain(
      "<loc>https://langwatch.ai/docs/tracing/spans</loc><lastmod>2026-10-01T09:00:00+02:00</lastmod>",
    );
    expect(files["sitemap.xml"]).toContain(
      "<loc>https://langwatch.ai/docs/introduction</loc></url>",
    );
  });

  /** @scenario "Discover page exports and crawlable documentation" */
  it("puts the agent guidance first, then every export in the order given", () => {
    const full = llmsFull({ nav, exports: ["# Introduction\n", "# Spans\n"] });
    expect(full.indexOf("npx langwatch report")).toBeLessThan(full.indexOf("# Introduction"));
    expect(full).toContain("# Introduction\n\n---\n\n# Spans\n");
  });
});

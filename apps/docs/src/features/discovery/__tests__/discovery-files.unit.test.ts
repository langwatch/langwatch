import { describe, expect, it } from "vitest";

import { robotsIssues } from "../../../site/audit/agent-readiness.ts";
import budgets from "../../../site/audit/budgets.json" with { type: "json" };
import {
  AI_CRAWLERS,
  discoveryFiles,
  llmsDirectory,
  llmsFull,
  llmsSectionFiles,
} from "../compile/discovery-files.ts";

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
    expect(files["sitemap.xml"]?.match(/<url>/g)).toHaveLength(2);
    expect(files["robots.txt"]).toContain("Sitemap: https://langwatch.ai/docs/sitemap.xml");
    expect(files["agents.txt"]).toContain("not automatically installed agent configuration");
    expect(files["humans.txt"]).toContain("Reasoning Engine B.V.");
    expect(files["indexnow.txt"]).toMatch(/^[0-9a-f]{32}\n$/);
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
    expect(llms?.match(/^- \[.*\.md\)/gm)).toHaveLength(3);
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
    const full = llmsFull({
      nav,
      exports: [
        { slug: "introduction", markdown: "# Introduction\n" },
        { slug: "tracing/spans", markdown: "# Spans\n" },
      ],
    });
    expect(full.indexOf("npx langwatch report")).toBeLessThan(full.indexOf("# Introduction"));
    expect(full).toContain("# Introduction\n\n---\n\n# Spans\n");
  });

  /** @scenario "Discover page exports and crawlable documentation" */
  it("drops each page's pointer to llms.txt, which the file names once", () => {
    const page = "# Spans\n\n> Page: https://langwatch.ai/docs/spans\n> Index of all pages: x\n";
    const full = llmsFull({ nav, exports: [{ slug: "spans", markdown: page }] });
    expect(full).toContain("> Page: https://langwatch.ai/docs/spans\n");
    expect(full).not.toContain("> Index of all pages");
  });

  /** @scenario "Robots.txt names each AI crawler" */
  it("allows each AI crawler the budgets list by name, keeping the catch-all and sitemap", () => {
    const robots = discoveryFiles({ nav })["robots.txt"] ?? "";
    expect(AI_CRAWLERS).toEqual(budgets.agentReadiness.crawlers);
    expect(robotsIssues({ robots, crawlers: AI_CRAWLERS })).toEqual([]);
    expect(robots.split("\n\n")[0]).toBe(
      "User-agent: *\nContent-Signal: ai-train=yes, search=yes, ai-input=yes\nAllow: /",
    );
    expect(robots).toContain(
      `User-agent: ${AI_CRAWLERS.at(-1)}\nContent-Signal: ai-train=yes, search=yes, ai-input=yes\nAllow: /`,
    );
    expect(robots).toContain("Sitemap: https://langwatch.ai/docs/sitemap.xml");
  });

  describe("when a section is split into its own file", () => {
    const page = (slug: string) => ({ type: "page" as const, slug, title: slug });
    const sectioned = {
      site: { name: "LangWatch" },
      pages: {
        introduction: { title: "Introduction", description: "" },
        "api-reference/traces/overview": { title: "Traces", description: "" },
        "api-reference/traces/search": { title: "Search traces", description: "" },
        "api-reference/traces/get-trace": { title: "Get a trace", description: "" },
      },
      anchors: [
        { title: "Platform", icon: "", children: [page("introduction")] },
        {
          title: "API Reference",
          icon: "",
          children: [
            {
              type: "group" as const,
              title: "Traces",
              children: [
                page("api-reference/traces/overview"),
                page("api-reference/traces/search"),
                page("api-reference/traces/get-trace"),
              ],
            },
          ],
        },
      ],
    };
    const exports = Object.keys(sectioned.pages).map((slug) => ({
      slug,
      markdown: `# ${slug}\n\n> Page: https://langwatch.ai/docs/${slug}\n`,
    }));

    /** @scenario "Split the documentation into one file per section" */
    it("writes each section's pages to its own file, in reading order", () => {
      const files = llmsSectionFiles({ nav: sectioned, exports });
      expect(Object.keys(files)).toEqual(["llms-full/platform.txt", "llms-full/api-reference.txt"]);
      const api = files["llms-full/api-reference.txt"] ?? "";
      expect(api.indexOf("# api-reference/traces/overview")).toBeLessThan(
        api.indexOf("# api-reference/traces/get-trace"),
      );
      expect(api).not.toContain("# introduction");
      expect(api.indexOf("npx langwatch report")).toBeLessThan(api.indexOf("# api-reference"));
    });

    /** @scenario "Split the documentation into one file per section" */
    it("names every section file in llms.txt, with its page count", () => {
      const llms = llmsDirectory({ nav: sectioned });
      expect(llms).toContain(
        "- [API Reference](https://langwatch.ai/docs/llms-full/api-reference.txt): 3 pages in one file",
      );
      expect(llms.indexOf("Sections in one file each")).toBeLessThan(llms.indexOf("## Platform"));
    });

    /** @scenario "List the API reference once per resource" */
    it("lists an API resource once, by its overview, and none of its operations", () => {
      const llms = llmsDirectory({ nav: sectioned });
      expect(llms).toContain(
        "- [Traces](https://langwatch.ai/docs/api-reference/traces/overview.md): 3 pages",
      );
      expect(llms).not.toContain("search.md");
      expect(llms).not.toContain("get-trace.md");
    });
  });
});

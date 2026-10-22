import { describe, expect, it } from "vitest";

import { canonicalUrl } from "../../../lib/site-path.ts";
import { breadcrumbTrail, pageDescription, pageHead } from "../compile/page-head.ts";

describe("static documentation metadata", () => {
  /** @scenario "Discover page exports and crawlable documentation" */
  it("uses the root canonical for introduction and escapes metadata safely", () => {
    const head = pageHead({
      slug: "introduction",
      title: 'Docs <intro> "test"',
      description: '</script>&"',
    });
    expect(canonicalUrl({ slug: "introduction" })).toBe("https://langwatch.ai/docs/introduction");
    expect(head).toContain('<link rel="canonical" href="https://langwatch.ai/docs/introduction">');
    expect(head).toContain('content="Docs &lt;intro> &quot;test&quot;"');
    expect(head).toContain('type="text/markdown" href="/introduction.md"');
    expect(head).toContain('rel="describedby" type="text/plain" href="/llms.txt"');
    const data = head.match(/<script[^>]+>([\s\S]+)<\/script>/)?.[1];
    expect(data).not.toContain("</script>");
    expect(JSON.parse(data ?? "")).toMatchObject({
      "@type": "WebPage",
      description: '</script>&"',
      url: "https://langwatch.ai/docs/introduction",
    });
  });

  /** @scenario "Discover page exports and crawlable documentation" */
  it("gives a deep API page matching canonical, social and structured URLs", () => {
    const head = pageHead({ slug: "api-reference/traces/get-trace", title: "Get trace" });
    expect(head).toContain('href="https://langwatch.ai/docs/api-reference/traces/get-trace"');
    expect(head).toContain(
      'property="og:url" content="https://langwatch.ai/docs/api-reference/traces/get-trace"',
    );
    expect(head).toContain('name="twitter:card" content="summary_large_image"');
    expect(head).not.toContain('name="description"');
  });

  /** @scenario "Discover page exports and crawlable documentation" */
  it("describes the trail the site shows, with real pages only", () => {
    const sections = [
      {
        title: "Guides",
        icon: "",
        children: [
          { type: "page" as const, slug: "integration/quick-start", title: "Quick start" },
          {
            type: "group" as const,
            title: "Tracing",
            children: [{ type: "page" as const, slug: "tracing/spans", title: "Spans" }],
          },
        ],
      },
    ];
    const trail = breadcrumbTrail({ sections, slug: "tracing/spans", title: "Spans" });
    expect(trail).toEqual([
      { title: "Documentation", slug: "introduction" },
      { title: "Guides", slug: "integration/quick-start" },
      { title: "Spans", slug: "tracing/spans" },
    ]);
    const head = pageHead({ slug: "tracing/spans", title: "Spans", trail });
    const scripts = [...head.matchAll(/<script[^>]+>([\s\S]+?)<\/script>/g)].map((match) =>
      JSON.parse(match[1]),
    );
    expect(scripts[1]).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { position: 1, name: "Documentation", item: "https://langwatch.ai/docs/introduction" },
        { position: 2, name: "Guides", item: "https://langwatch.ai/docs/integration/quick-start" },
        { position: 3, name: "Spans", item: "https://langwatch.ai/docs/tracing/spans" },
      ],
    });
    expect(
      breadcrumbTrail({ sections, slug: "integration/quick-start", title: "Quick start" }),
    ).toHaveLength(2);
    expect(pageHead({ slug: "introduction", title: "Home", trail: [] })).not.toContain(
      "BreadcrumbList",
    );
  });
});

describe("when a page has no authored description", () => {
  /** @scenario "Describe every page to search engines" */
  it("describes an API page by its endpoint and leaves a guide's authored text alone", () => {
    const operation = { method: "POST", path: "/api/v1/agents", description: "" };
    expect(pageDescription({ title: "Create agents", operation })).toBe(
      "Create agents: POST /api/v1/agents in the LangWatch REST API.",
    );
    expect(
      pageDescription({
        title: "Create agents",
        operation: { ...operation, description: "Adds one" },
      }),
    ).toBe("Adds one");
    expect(pageDescription({ title: "Guide", description: "Authored", operation })).toBe(
      "Authored",
    );
    expect(pageDescription({ title: "Guide", operation: null })).toBe("");
  });
});

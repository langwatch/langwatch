import { describe, expect, it } from "vitest";

import { breadcrumbTrail, canonicalUrl, pageHead } from "../compile/page-head.ts";

describe("static documentation metadata", () => {
  /** @scenario "Discover page exports and crawlable documentation" */
  it("uses the root canonical for introduction and escapes metadata safely", () => {
    const head = pageHead({
      slug: "introduction",
      title: 'Docs <intro> "test"',
      description: '</script>&"',
    });
    expect(canonicalUrl({ slug: "introduction" })).toBe("https://docs.langwatch.ai/");
    expect(head).toContain('<link rel="canonical" href="https://docs.langwatch.ai/">');
    expect(head).toContain('content="Docs &lt;intro> &quot;test&quot;"');
    expect(head).toContain('type="text/markdown" href="/introduction.md"');
    expect(head).toContain('rel="describedby" type="text/plain" href="/llms.txt"');
    const data = head.match(/<script[^>]+>([\s\S]+)<\/script>/)?.[1];
    expect(data).not.toContain("</script>");
    expect(JSON.parse(data ?? "")).toMatchObject({
      "@type": "WebPage",
      description: '</script>&"',
      url: "https://docs.langwatch.ai/",
    });
  });

  /** @scenario "Discover page exports and crawlable documentation" */
  it("gives a deep API page matching canonical, social and structured URLs", () => {
    const head = pageHead({ slug: "api-reference/traces/get-trace", title: "Get trace" });
    expect(head).toContain('href="https://docs.langwatch.ai/api-reference/traces/get-trace"');
    expect(head).toContain(
      'property="og:url" content="https://docs.langwatch.ai/api-reference/traces/get-trace"',
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
        { position: 1, name: "Documentation", item: "https://docs.langwatch.ai/" },
        { position: 2, name: "Guides", item: "https://docs.langwatch.ai/integration/quick-start" },
        { position: 3, name: "Spans", item: "https://docs.langwatch.ai/tracing/spans" },
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

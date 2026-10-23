import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { canonicalUrl, sitePath } from "../../../lib/site-path.ts";
import {
  breadcrumbTrail,
  headSettings,
  pageDescription,
  pageHead,
  trimDescription,
} from "../compile/page-head.ts";
import type { HeadSettings } from "../compile/page-head.ts";

function isInstant({ date }: { date: string }) {
  try {
    return Temporal.Instant.from(date) !== null;
  } catch {
    return false;
  }
}

const EMPTY: HeadSettings = {
  description: "",
  organization: null,
  tagManager: "",
  dates: new Map(),
};
const SETTINGS: HeadSettings = {
  description: "The open-source LLMOps platform.",
  organization: {
    name: "LangWatch",
    url: "https://langwatch.ai",
    logo: "https://langwatch.ai/docs/logo/light.svg",
    sameAs: ["https://github.com/langwatch/langwatch"],
  },
  tagManager: "GTM-ABC123",
  dates: new Map([["integration/quick-start", "2026-10-12T08:12:32+00:00"]]),
};

function structuredData({ head }: { head: string }) {
  return [...head.matchAll(/<script[^>]+>([\s\S]+?)<\/script>/g)].map((match): unknown =>
    JSON.parse(match[1] ?? ""),
  );
}

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
    expect(head).toContain('content="Docs &lt;intro&gt; &quot;test&quot; - LangWatch"');
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
    const head = pageHead({
      slug: "api-reference/traces/get-trace",
      title: "Get trace",
      settings: EMPTY,
    });
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
      JSON.parse(match[1] ?? ""),
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

describe("when docs.json describes the site and its organization", () => {
  /** @scenario "Describe every page to search engines and social previews" */
  it("describes an undescribed page with the site description", () => {
    const head = pageHead({ slug: "guide", title: "Guide", settings: SETTINGS });
    for (const attribute of ['name="description"', 'property="og:description"']) {
      expect(head).toContain(`<meta ${attribute} content="The open-source LLMOps platform.">`);
    }
    expect(
      pageHead({ slug: "guide", title: "Guide", description: "Own", settings: SETTINGS }),
    ).toContain('<meta name="description" content="Own">');
  });

  /** @scenario "Describe every page to search engines and social previews" */
  it("names the organization as the publisher and dates a known page", () => {
    const dated = pageHead({
      slug: "integration/quick-start",
      title: "Quick Start",
      settings: SETTINGS,
    });
    expect(structuredData({ head: dated })[0]).toMatchObject({
      "@type": "TechArticle",
      dateModified: "2026-10-12T08:12:32+00:00",
      isPartOf: {
        "@type": "WebSite",
        publisher: {
          "@type": "Organization",
          name: "LangWatch",
          url: "https://langwatch.ai",
          logo: { "@type": "ImageObject", url: "https://langwatch.ai/docs/logo/light.svg" },
          sameAs: ["https://github.com/langwatch/langwatch"],
        },
      },
    });
    const undated = structuredData({
      head: pageHead({ slug: "guide", title: "Guide", settings: EMPTY }),
    });
    expect(undated[0]).not.toHaveProperty("dateModified");
    expect(undated[0]).not.toHaveProperty("isPartOf.publisher");
  });

  /** @scenario "Show when a page was last updated" */
  it("reads the real docs.json organization and commit dates", () => {
    const settings = headSettings();
    expect(settings.organization?.name).toBe("LangWatch");
    expect(settings.description).not.toBe("");
    const unreadable = [...settings.dates.values()].filter((date) => !isInstant({ date }));
    expect(unreadable).toEqual([]);
  });
});

describe("when a guide is described to search engines", () => {
  const organization = {
    name: "LangWatch",
    url: "https://langwatch.ai",
    logo: "",
    sameAs: ["https://github.com/langwatch/langwatch", "https://x.com/langwatchai"],
  };
  const settings = { ...SETTINGS, organization };

  /** @scenario "Describe a guide to search engines as a technical article" */
  it("marks it as a dated technical article by the organization", () => {
    const head = pageHead({ slug: "integration/quick-start", title: "Quick Start", settings });
    expect(structuredData({ head })[0]).toMatchObject({
      "@type": "TechArticle",
      headline: "Quick Start",
      inLanguage: "en",
      image: "https://langwatch.ai/docs/images/coding-agents/optimized/session-detail-1560.webp",
      mainEntityOfPage: "https://langwatch.ai/docs/integration/quick-start",
      author: { "@type": "Organization", name: "LangWatch" },
      publisher: { "@type": "Organization", name: "LangWatch" },
    });
    expect(head).toContain('<meta property="og:type" content="article">');
    expect(head).toContain(
      '<meta property="article:modified_time" content="2026-10-12T08:12:32+00:00">',
    );
    expect(head).toContain('<meta name="twitter:site" content="@langwatchai">');
  });

  /** @scenario "Describe a guide to search engines as a technical article" */
  it("keeps the docs home a web page of the documentation website", () => {
    const head = pageHead({ slug: "introduction", title: "Home", settings });
    expect(structuredData({ head })[0]).toMatchObject({
      "@type": "WebPage",
      isPartOf: { "@type": "WebSite", name: "LangWatch documentation" },
    });
    expect(structuredData({ head })[0]).not.toHaveProperty("headline");
    expect(head).toContain('<meta property="og:type" content="website">');
    expect(pageHead({ slug: "guide", title: "Guide", settings: EMPTY })).not.toContain(
      "twitter:site",
    );
  });
});

describe("when docs.json names a tag manager container", () => {
  /** @scenario "Load the tag manager without slowing the page" */
  it("names it on production pages only and never adds a tag script", () => {
    const production = pageHead({
      slug: "guide",
      title: "Guide",
      settings: SETTINGS,
      production: true,
    });
    expect(production).toContain('<meta name="docs-gtm" content="GTM-ABC123">');
    expect(production).not.toContain("googletagmanager");
    expect(
      pageHead({ slug: "guide", title: "Guide", settings: SETTINGS, production: false }),
    ).not.toContain("docs-gtm");
  });
});

describe("when a page head is built", () => {
  /** @scenario "Preload the two fonts every page draws above the fold" */
  it("preloads the Latin body font and the regular title font and no other font", () => {
    const head = pageHead({
      slug: "integration/quick-start",
      title: "Quick Start",
      settings: EMPTY,
    });
    const preloads = [...head.matchAll(/<link rel="preload"[^>]*>/g)].map((match) => match[0]);
    expect(preloads).toEqual([
      `<link rel="preload" href="${sitePath({ path: "/src/app/fonts/Inter-Variable-latin.woff2" })}" as="font" type="font/woff2" crossorigin>`,
      `<link rel="preload" href="${sitePath({ path: "/src/app/fonts/Sentient-Regular.woff2" })}" as="font" type="font/woff2" crossorigin>`,
    ]);
  });
});

describe("search metadata", () => {
  /** @scenario "Page titles keep the published format" */
  it("suffixes the title and social titles but not the structured name", () => {
    const head = pageHead({
      slug: "integration/quick-start",
      title: "Quick Start",
      settings: EMPTY,
    });
    expect(head).toContain("<title>Quick Start - LangWatch</title>");
    expect(head).toContain('property="og:title" content="Quick Start - LangWatch"');
    expect(head).toContain('name="twitter:title" content="Quick Start - LangWatch"');
    expect(structuredData({ head })[0]).toMatchObject({ name: "Quick Start" });
  });

  describe("when a description is longer than 160 characters", () => {
    const sentence = "Search traces by any attribute and filter the results by date range.";
    const long = `${sentence} ${sentence} ${sentence}`;

    /** @scenario "Long descriptions are cut at a boundary" */
    it("cuts after the last full sentence that fits", () => {
      const cut = trimDescription({ text: long });
      expect(cut).toBe(`${sentence} ${sentence}`);
      expect(cut.length).toBeLessThanOrEqual(160);
    });

    /** @scenario "Long descriptions are cut at a boundary" */
    it("cuts at a whole word when no sentence fits", () => {
      const cut = trimDescription({ text: "word ".repeat(60), max: 160 });
      expect(cut.length).toBeLessThanOrEqual(160);
      expect(cut.endsWith("word")).toBe(true);
      expect(cut).not.toContain("...");
    });

    /** @scenario "Long descriptions are cut at a boundary" */
    it("repeats the same cut in every tag", () => {
      const head = pageHead({ slug: "guide", title: "Guide", description: long, settings: EMPTY });
      const cut = trimDescription({ text: long });
      expect(head.split(`content="${cut}"`)).toHaveLength(4);
      expect(structuredData({ head })[0]).toMatchObject({ description: cut });
    });
  });

  describe("when a description is shorter than 50 characters", () => {
    /** @scenario "Short descriptions stay as authored" */
    it("keeps it unchanged", () => {
      expect(trimDescription({ text: "Search traces." })).toBe("Search traces.");
    });
  });
});

import { describe, expect, it } from "vitest";

import { canonicalUrl, pageHead } from "../docs-metadata.mjs";

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
});

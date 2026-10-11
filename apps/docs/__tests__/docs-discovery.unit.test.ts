import { describe, expect, it } from "vitest";

import { discoveryFiles } from "../docs-discovery.mjs";

describe("documentation discovery", () => {
  /** @scenario "Discover page exports and crawlable documentation" */
  it("lists canonical pages once and tells crawlers where to find them", () => {
    const files = discoveryFiles({
      nav: { pages: { introduction: {}, "coding-agents/overview": {} } },
    });
    expect(files["sitemap.xml"]).toContain("<loc>https://docs.langwatch.ai/</loc>");
    expect(files["sitemap.xml"]).toContain(
      "<loc>https://docs.langwatch.ai/coding-agents/overview</loc>",
    );
    expect(files["sitemap.xml"].match(/<url>/g)).toHaveLength(2);
    expect(files["robots.txt"]).toContain("Sitemap: https://docs.langwatch.ai/sitemap.xml");
    expect(files["agents.txt"]).toContain("not automatically installed agent configuration");
    expect(files["humans.txt"]).toContain("LangWatch B.V.");
  });
});

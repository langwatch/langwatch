import { afterAll, describe, expect, it } from "vitest";

import { checkAgentOutputs, checkSitemap, docsLinks } from "../checks/agent-outputs.ts";
import { buildFixture, page, REDIRECT_PAGE } from "./build-fixture.ts";

const DOCS = "https://langwatch.ai/docs";

describe("when agent outputs name documentation addresses", () => {
  const fixture = buildFixture({
    files: {
      "index.html": page({ slug: "introduction" }),
      "guide/index.html": page({ slug: "guide", ids: ["install"] }),
      "guide.md": `See [install](${DOCS}/guide#install), [moved](${DOCS}/old) and [gone](${DOCS}/gone).`,
      "old/index.html": REDIRECT_PAGE,
      "redirects.json": JSON.stringify({ "/old": "/guide" }),
      "llms.txt": `- [Guide](${DOCS}/guide.md): text\n- [Anchor](${DOCS}/guide.md#absent)`,
      "llms-full.txt": `Read https://docs.langwatch.ai/guide#install. Also ${DOCS}/missing-page, please.`,
      "agents.txt": `Start with ${DOCS}/llms.txt for the directory.`,
    },
  });
  afterAll(() => fixture.dispose());

  /** @scenario "Links in agent outputs resolve in the build" */
  it("reports addresses that reach no page or heading with the file that names them", () => {
    for (const basePath of ["", "/docs"]) {
      const { issues } = checkAgentOutputs({ index: fixture.index({ basePath }) });
      expect(issues).toEqual([
        { source: "/guide.md", href: `${DOCS}/gone`, code: "missing-target" },
        { source: "/llms.txt", href: `${DOCS}/guide.md#absent`, code: "missing-fragment" },
        { source: "/llms-full.txt", href: `${DOCS}/missing-page`, code: "missing-target" },
      ]);
    }
  });

  it("drops trailing punctuation and ignores other hosts", () => {
    expect(
      docsLinks({
        text: `(${DOCS}/a). ${DOCS}/b, https://langwatch.ai/docsx https://example.com/docs/c`,
      }),
    ).toEqual([`${DOCS}/a`, `${DOCS}/b`]);
  });
});

describe("when the sitemap is checked", () => {
  const sitemap = (locs: string[]) =>
    `<urlset>${locs.map((loc) => `<url><loc>${loc}</loc></url>`).join("")}</urlset>`;
  const fixture = buildFixture({
    files: {
      "index.html": page({ slug: "introduction" }),
      "introduction/index.html": page({ slug: "introduction" }),
      "guide/index.html": page({ slug: "guide" }),
      "section/index.html": page({ slug: "section" }),
      "unlisted/index.html": page({ slug: "unlisted" }),
      "aliased/index.html": page({ slug: "elsewhere" }),
      "old/index.html": REDIRECT_PAGE,
      "sitemap.xml": sitemap([
        `${DOCS}/introduction`,
        `${DOCS}/guide/`,
        `${DOCS}/section/index`,
        `${DOCS}/old`,
        `${DOCS}/aliased`,
        `${DOCS}/elsewhere`,
      ]),
    },
  });
  afterAll(() => fixture.dispose());

  /** @scenario "Sitemap entries are canonical page addresses" */
  it("reports non-canonical, slash, index and redirect entries and pages it omits", () => {
    const { issues } = checkSitemap({ index: fixture.index({ basePath: "/docs" }) });
    expect(issues.map(({ href, code }) => [href.slice(DOCS.length), code])).toEqual([
      ["/guide/", "sitemap-trailing-slash"],
      ["/section/index", "sitemap-index-suffix"],
      ["/old", "sitemap-not-page"],
      ["/aliased", "sitemap-not-canonical"],
      ["/elsewhere", "sitemap-not-page"],
      ["/guide", "sitemap-missing-page"],
      ["/section", "sitemap-missing-page"],
      ["/unlisted", "sitemap-missing-page"],
    ]);
  });
});

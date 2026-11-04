import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyKnownIssues, builtBasePath, checkSeo, knownIssuesOf } from "../seo-check.ts";

const DOCS = "https://langwatch.ai/docs";
const seo = { title: { min: 10, max: 70 }, description: { min: 20, max: 160 } };
const description = "A description long enough for search results.";

function page({
  slug,
  head = {},
  body = "<h1>Title</h1>",
}: {
  slug: string;
  head?: Record<string, string | null>;
  body?: string;
}) {
  const tags = {
    title: `<title>${slug} guide | LangWatch Docs</title>`,
    description: `<meta name="description" content="${description}">`,
    canonical: `<link rel="canonical" href="${DOCS}/${slug}">`,
    markdown: `<link rel="alternate" type="text/markdown" href="/docs/${slug}.md">`,
    ogTitle: `<meta property="og:title" content="${slug}">`,
    ogDescription: `<meta property="og:description" content="${description}">`,
    ogImage: `<meta property="og:image" content="${DOCS}/images/card.webp">`,
    viewport: '<meta name="viewport" content="width=device-width, initial-scale=1">',
    twitterCard: '<meta name="twitter:card" content="summary_large_image">',
    twitterTitle: `<meta name="twitter:title" content="${slug}">`,
    twitterDescription: `<meta name="twitter:description" content="${description}">`,
    twitterImage: `<meta name="twitter:image" content="${DOCS}/images/card.webp">`,
    jsonLd: `<script type="application/ld+json">{"@type":"WebPage"}</script>`,
    ...head,
  };
  return `<!doctype html><html lang="en"><head>${Object.values(tags).filter(Boolean).join("")}</head><body>${body}</body></html>`;
}

let outDir: string;

function write({ file, contents }: { file: string; contents: string }) {
  mkdirSync(path.dirname(path.join(outDir, file)), { recursive: true });
  writeFileSync(path.join(outDir, file), contents);
}

function site({
  pages,
  robots,
  llms,
}: {
  pages: Record<string, string>;
  robots?: string;
  llms?: string;
}) {
  write({
    file: "sitemap.xml",
    contents: `<urlset>${Object.keys(pages)
      .map((slug) => `<loc>${DOCS}/${slug}</loc>`)
      .join("")}</urlset>`,
  });
  for (const [slug, html] of Object.entries(pages)) {
    write({ file: `${slug}/index.html`, contents: html });
    write({ file: `${slug}.md`, contents: `# ${slug}\n` });
  }
  write({
    file: "robots.txt",
    contents: robots ?? `User-agent: *\nAllow: /\nSitemap: ${DOCS}/sitemap.xml\n`,
  });
  write({
    file: "llms.txt",
    contents:
      llms ??
      Object.keys(pages)
        .map((slug) => `- [${slug}](${DOCS}/${slug}.md)`)
        .join("\n"),
  });
  write({ file: "404.html", contents: '<head><meta name="robots" content="noindex"></head>' });
}

beforeEach(() => {
  outDir = mkdtempSync(path.join(os.tmpdir(), "docs-seo-check-"));
});
afterEach(() => rmSync(outDir, { recursive: true, force: true }));

describe("checkSeo", () => {
  describe("when every sitemap page is complete", () => {
    it("reports no issues and lists each Markdown export", () => {
      site({ pages: { guide: page({ slug: "guide" }), "api/op": page({ slug: "api/op" }) } });
      const result = checkSeo({ outDir, basePath: "/docs", seo });
      expect(result.issues).toEqual([]);
      expect(result.pages).toBe(2);
      expect(result.exports).toEqual(["/docs/guide.md", "/docs/api/op.md"]);
    });
  });

  describe("when pages have search and agent-readiness gaps", () => {
    /** @scenario "Report every search and agent-readiness gap across all pages" */
    it("names each page and the exact gap", () => {
      site({
        pages: {
          headings: page({ slug: "headings", body: "<h1>One</h1><h1>Two</h1>" }),
          short: page({
            slug: "short",
            head: {
              title: "<title>Short</title>",
              description: '<meta name="description" content="Too short">',
            },
          }),
          relative: page({
            slug: "relative",
            head: { canonical: '<link rel="canonical" href="/docs/relative">' },
          }),
          elsewhere: page({
            slug: "elsewhere",
            head: { canonical: `<link rel="canonical" href="${DOCS}/other">` },
          }),
          social: page({
            slug: "social",
            head: {
              ogDescription: null,
              ogImage: '<meta property="og:image" content="/card.webp">',
            },
          }),
          data: page({
            slug: "data",
            head: { jsonLd: '<script type="application/ld+json">{"@type":</script>' },
          }),
          hidden: page({
            slug: "hidden",
            head: { robots: '<meta name="robots" content="noindex">' },
          }),
          unlisted: page({ slug: "unlisted", head: { markdown: null } }),
        },
        llms: ["headings", "short", "relative", "elsewhere", "social", "data", "hidden"]
          .map((slug) => `- [${slug}](${DOCS}/${slug}.md)`)
          .join("\n"),
      });
      const codes = checkSeo({ outDir, basePath: "/docs", seo }).issues.map(
        (issue) => `${issue.page.replace(DOCS, "")} ${issue.code}`,
      );
      expect(codes).toEqual([
        "/headings h1-count",
        "/short title-length",
        "/short description-length",
        "/relative relative-canonical",
        "/elsewhere canonical-mismatch",
        "/social missing-open-graph",
        "/social open-graph-image",
        "/data invalid-json-ld",
        "/hidden noindex",
        "/unlisted missing-markdown-link",
        "/unlisted missing-from-llms-txt",
      ]);
    });

    /** @scenario "Every published page carries complete search and social metadata" */
    it("reports a page missing its language, viewport or social card", () => {
      const bare = page({
        slug: "bare",
        head: {
          viewport: null,
          twitterCard: null,
          twitterDescription: null,
          twitterImage: '<meta name="twitter:image" content="/card.webp">',
        },
      }).replace(' lang="en"', "");
      site({ pages: { bare } });
      expect(checkSeo({ outDir, basePath: "/docs", seo }).issues).toEqual(
        [
          ["missing-twitter-card", "no twitter:card"],
          ["missing-twitter-card", "no twitter:description"],
          ["missing-document-basics", "no html lang"],
          ["missing-document-basics", "no viewport"],
          ["open-graph-image", "twitter:image /card.webp"],
        ].map(([code, detail]) => ({ page: `${DOCS}/bare`, code, detail })),
      );
    });

    it("reports an empty Markdown export", () => {
      site({ pages: { guide: page({ slug: "guide" }) } });
      write({ file: "guide.md", contents: "  \n" });
      expect(checkSeo({ outDir, basePath: "/docs", seo }).issues).toEqual([
        { page: `${DOCS}/guide`, code: "empty-markdown-export", detail: "/guide.md" },
      ]);
    });
  });

  describe("when robots.txt or the not-found page lets crawlers down", () => {
    /** @scenario "Let crawlers in and point them at the sitemap" */
    it("reports a blocking robots.txt, a missing sitemap line and an indexable not-found page", () => {
      site({ pages: { guide: page({ slug: "guide" }) }, robots: "User-agent: *\nDisallow: /\n" });
      write({ file: "404.html", contents: "<head><title>Not found</title></head>" });
      expect(
        checkSeo({ outDir, basePath: "/docs", seo }).issues.map((issue) => issue.code),
      ).toEqual(["robots-blocks-site", "robots-missing-sitemap", "not-found-indexable"]);
    });

    it("accepts a disallow rule for a single crawler", () => {
      site({
        pages: { guide: page({ slug: "guide" }) },
        robots: `User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: ${DOCS}/sitemap.xml\n`,
      });
      expect(checkSeo({ outDir, basePath: "/docs", seo }).issues).toEqual([]);
    });
  });
});

describe("builtBasePath", () => {
  /** @scenario "Refuse to audit a build made for another mount" */
  it("reads the mount a build was made for from its home page", () => {
    write({ file: "index.html", contents: '<head><link rel="icon" href="/docs/favicon.svg" />' });
    expect(builtBasePath({ outDir })).toBe("/docs");
    write({ file: "index.html", contents: '<head><link rel="icon" href="/favicon.svg" />' });
    expect(builtBasePath({ outDir })).toBe("");
  });
});

describe("applyKnownIssues", () => {
  describe("when the known list holds today's issues", () => {
    it("fails only new issues and reports known ones that were fixed", () => {
      const first = { page: `${DOCS}/a`, code: "description-length", detail: "" };
      const second = { page: `${DOCS}/b`, code: "description-length", detail: "" };
      const issues = [first, second];
      const known = knownIssuesOf({
        issues: [first, { page: `${DOCS}/c`, code: "h1-count", detail: "" }],
      });
      expect(known).toEqual({ "description-length": ["/a"], "h1-count": ["/c"] });
      const result = applyKnownIssues({ issues, known });
      expect(result.failures).toEqual([second]);
      expect(result.fixed).toEqual([{ page: "/c", code: "h1-count", detail: "no longer occurs" }]);
      expect(result.known).toBe(1);
    });
  });
});

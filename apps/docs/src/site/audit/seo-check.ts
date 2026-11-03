import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { DOCS_URL, docsUrl, stripBasePath } from "../../lib/site-path.ts";
import type { Budgets } from "./budgets.ts";

export type SeoIssue = { page: string; code: string; detail: string };
type Range = Budgets["seo"]["title"];
type SeoBudgets = Pick<Budgets["seo"], "title" | "description">;

function decodeEntities(text: string) {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function tagAttributes({ tag }: { tag: string }) {
  return Object.fromEntries(
    [...tag.matchAll(/([a-zA-Z:-]+)=(?:"([^"]*)"|'([^']*)')/g)].map((match) => [
      (match[1] ?? "").toLowerCase(),
      decodeEntities(match[2] ?? match[3] ?? ""),
    ]),
  );
}

/** The `<head>` facts the checks read, from markup this build itself wrote. */
export function readHead({ html }: { html: string }) {
  const head = html.slice(0, html.search(/<\/head>/i) + 1 || html.length);
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((match) =>
    tagAttributes({ tag: match[0] }),
  );
  const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((match) =>
    tagAttributes({ tag: match[0] }),
  );
  const meta = (key: string, value: string) =>
    metas.find((attributes) => attributes[key]?.toLowerCase() === value)?.content;
  const title = /<title>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const body = html.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  return {
    title: title === undefined ? undefined : decodeEntities(title).trim(),
    description: meta("name", "description"),
    robots: meta("name", "robots"),
    ogTitle: meta("property", "og:title"),
    ogDescription: meta("property", "og:description"),
    ogImage: meta("property", "og:image"),
    twitterCard: meta("name", "twitter:card"),
    twitterTitle: meta("name", "twitter:title"),
    twitterDescription: meta("name", "twitter:description"),
    twitterImage: meta("name", "twitter:image"),
    viewport: meta("name", "viewport"),
    lang: /<html\b[^>]*\blang="([^"]+)"/i.exec(html)?.[1],
    canonical: links.find((attributes) => attributes.rel === "canonical")?.href,
    markdown: links.find(
      (attributes) => attributes.rel === "alternate" && attributes.type === "text/markdown",
    )?.href,
    jsonLd: [
      ...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi),
    ].map((match) => match[1] ?? ""),
    headings: (body.match(/<h1[\s>]/gi) ?? []).length,
  };
}

function isAbsoluteHttps(url: string | undefined) {
  if (!url) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function lengthIssue({ name, value, range }: { name: string; value?: string; range: Range }) {
  if (!value) return { code: `missing-${name}`, detail: `no ${name}` };
  if (value.length < range.min || value.length > range.max)
    return {
      code: `${name}-length`,
      detail: `${value.length} characters, budget ${range.min} to ${range.max}: "${value}"`,
    };
  return null;
}

/** The base path a build was made for, read from the favicon link its home page carries. */
export function builtBasePath({ outDir }: { outDir: string }) {
  const html = readFileSync(path.join(outDir, "index.html"), "utf8");
  const icon = /<link\b[^>]*rel="icon"[^>]*href="([^"]*)\/favicon\.svg"/i.exec(html);
  return icon ? icon[1] : null;
}

/** Every sitemap `<loc>`, the build's list of navigable pages. */
export function sitemapPages({ outDir }: { outDir: string }) {
  const sitemap = readFileSync(path.join(outDir, "sitemap.xml"), "utf8");
  return [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) =>
    decodeEntities(match[1] ?? ""),
  );
}

/** The prerendered HTML file for a sitemap address, or null for an address off the site. */
export function pageFile({ outDir, url }: { outDir: string; url: string }) {
  if (url !== DOCS_URL && !url.startsWith(`${DOCS_URL}/`)) return null;
  const sitePathname = url.slice(DOCS_URL.length) || "/";
  return path.join(outDir, `.${sitePathname}`, "index.html");
}

type PageIssue = Omit<SeoIssue, "page">;
type PageHead = ReturnType<typeof readHead>;

function metaIssues({ head, seo }: { head: PageHead; seo: SeoBudgets }): PageIssue[] {
  const issues: PageIssue[] = [];
  if (head.headings !== 1)
    issues.push({ code: "h1-count", detail: `${head.headings} <h1> elements, expected 1` });
  const title = lengthIssue({ name: "title", value: head.title, range: seo.title });
  const description = lengthIssue({
    name: "description",
    value: head.description,
    range: seo.description,
  });
  for (const issue of [title, description]) if (issue) issues.push(issue);
  return issues;
}

function canonicalIssue({ head, url }: { head: PageHead; url: string }): PageIssue | null {
  const { canonical } = head;
  if (!canonical) return { code: "missing-canonical", detail: "no canonical link" };
  if (!isAbsoluteHttps(canonical)) return { code: "relative-canonical", detail: canonical };
  if (canonical !== url)
    return { code: "canonical-mismatch", detail: `${canonical} is not ${url}` };
  return null;
}

function socialIssues({ head }: { head: PageHead }): PageIssue[] {
  const issues: PageIssue[] = [];
  const named = [
    ["missing-open-graph", "og:title", head.ogTitle],
    ["missing-open-graph", "og:description", head.ogDescription],
    ["missing-twitter-card", "twitter:card", head.twitterCard],
    ["missing-twitter-card", "twitter:title", head.twitterTitle],
    ["missing-twitter-card", "twitter:description", head.twitterDescription],
    ["missing-document-basics", "html lang", head.lang],
    ["missing-document-basics", "viewport", head.viewport],
  ] as const;
  for (const [code, name, value] of named) if (!value) issues.push({ code, detail: `no ${name}` });
  for (const [name, value] of [
    ["og:image", head.ogImage],
    ["twitter:image", head.twitterImage],
  ] as const)
    if (!isAbsoluteHttps(value))
      issues.push({ code: "open-graph-image", detail: `${name} ${value ?? "missing"}` });
  return issues;
}

function jsonLdIssues({ head }: { head: PageHead }): PageIssue[] {
  if (head.jsonLd.length === 0) return [{ code: "missing-json-ld", detail: "no JSON-LD" }];
  const issues: PageIssue[] = [];
  for (const data of head.jsonLd) {
    try {
      JSON.parse(data);
    } catch (error) {
      issues.push({ code: "invalid-json-ld", detail: (error as Error).message });
    }
  }
  return issues;
}

function markdownIssues({
  head,
  outDir,
  basePath,
  exports,
}: {
  head: PageHead;
  outDir: string;
  basePath: string;
  exports: string[];
}): PageIssue[] {
  const markdown = head.markdown ? stripBasePath({ pathname: head.markdown, basePath }) : null;
  if (!head.markdown || !markdown)
    return [{ code: "missing-markdown-link", detail: "no text/markdown link" }];
  exports.push(head.markdown);
  const markdownFile = path.join(outDir, `.${markdown}`);
  const empty = !existsSync(markdownFile) || readFileSync(markdownFile, "utf8").trim() === "";
  return empty ? [{ code: "empty-markdown-export", detail: markdown }] : [];
}

function checkPage({
  outDir,
  basePath,
  url,
  llms,
  seo,
  exports,
}: {
  outDir: string;
  basePath: string;
  url: string;
  llms: Set<string>;
  seo: SeoBudgets;
  exports: string[];
}): PageIssue[] {
  const file = pageFile({ outDir, url });
  if (!file) return [{ code: "foreign-sitemap-url", detail: `not under ${DOCS_URL}` }];
  if (!existsSync(file)) return [{ code: "missing-page", detail: path.relative(outDir, file) }];
  const head = readHead({ html: readFileSync(file, "utf8") });
  const canonical = canonicalIssue({ head, url });
  const issues: PageIssue[] = [
    ...metaIssues({ head, seo }),
    ...(canonical ? [canonical] : []),
    ...socialIssues({ head }),
    ...jsonLdIssues({ head }),
  ];
  if (head.robots?.toLowerCase().includes("noindex"))
    issues.push({ code: "noindex", detail: `robots "${head.robots}" on a sitemap page` });
  issues.push(...markdownIssues({ head, outDir, basePath, exports }));
  const markdown = head.markdown ? stripBasePath({ pathname: head.markdown, basePath }) : null;
  const listed = [url, `${url}.md`, markdown && docsUrl({ path: markdown })];
  if (!listed.some((candidate) => candidate && llms.has(candidate)))
    issues.push({ code: "missing-from-llms-txt", detail: `${url} (or its .md) is not linked` });
  return issues;
}

function checkRobots({ outDir }: { outDir: string }): SeoIssue[] {
  const file = path.join(outDir, "robots.txt");
  if (!existsSync(file)) return [{ page: "robots.txt", code: "missing-robots", detail: "absent" }];
  const lines = readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean);
  const issues: SeoIssue[] = [];
  let everyone = false;
  for (const line of lines) {
    const [field, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (/^user-agent$/i.test(field ?? "")) everyone = value === "*";
    else if (everyone && /^disallow$/i.test(field ?? "") && value === "/")
      issues.push({ page: "robots.txt", code: "robots-blocks-site", detail: line });
  }
  const sitemap = docsUrl({ path: "/sitemap.xml" });
  const declaresSitemap = lines.some((line) => isSitemapLine({ line, sitemap }));
  if (!declaresSitemap)
    issues.push({
      page: "robots.txt",
      code: "robots-missing-sitemap",
      detail: `no Sitemap: ${sitemap}`,
    });
  return issues;
}

function isSitemapLine({ line, sitemap }: { line: string; sitemap: string }) {
  return /^sitemap:/i.test(line) && line.slice(8).trim() === sitemap;
}

function checkNotFound({ outDir }: { outDir: string }): SeoIssue[] {
  const file = path.join(outDir, "404.html");
  if (!existsSync(file)) return [{ page: "404.html", code: "missing-not-found", detail: "absent" }];
  const { robots } = readHead({ html: readFileSync(file, "utf8") });
  return robots?.toLowerCase().includes("noindex")
    ? []
    : [{ page: "404.html", code: "not-found-indexable", detail: "no noindex robots meta" }];
}

/** A page as the known-issue list names it: its site path, or the file for site-wide checks. */
function pageKey({ page }: { page: string }) {
  return page.startsWith(DOCS_URL) ? page.slice(DOCS_URL.length) || "/" : page;
}

/** Splits issues into new ones (failures) and known entries that no longer occur (fixed). */
export function applyKnownIssues<T extends SeoIssue>({
  issues,
  known,
}: {
  issues: T[];
  known: Budgets["seo"]["known"];
}) {
  const seen = new Set(issues.map((issue) => `${issue.code} ${pageKey(issue)}`));
  const failures = issues.filter((issue) => !known[issue.code]?.includes(pageKey(issue)));
  const fixed = Object.entries(known).flatMap(([code, pages]) =>
    pages
      .filter((page) => !seen.has(`${code} ${page}`))
      .map((page) => ({ page, code, detail: "no longer occurs" })),
  );
  return { failures, fixed, known: issues.length - failures.length };
}

/** The known-issue list that tolerates exactly these issues, sorted for a stable diff. */
export function knownIssuesOf({ issues }: { issues: SeoIssue[] }) {
  const known: Record<string, string[]> = {};
  for (const issue of issues) (known[issue.code] ??= []).push(pageKey(issue));
  return Object.fromEntries(
    Object.entries(known)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([code, pages]) => [code, [...new Set(pages)].toSorted()]),
  );
}

/**
 * Static search and agent-readiness checks over every sitemap page; no browser, no server.
 * `exports` are the Markdown export paths the pages link, for a served Content-Type check.
 */
export function checkSeo({
  outDir,
  basePath,
  seo,
}: {
  outDir: string;
  basePath: string;
  seo: SeoBudgets;
}) {
  const llmsFile = path.join(outDir, "llms.txt");
  const llms = new Set(
    existsSync(llmsFile)
      ? [...readFileSync(llmsFile, "utf8").matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].flatMap((m) =>
          m[1] === undefined ? [] : [m[1]],
        )
      : [],
  );
  const pages = sitemapPages({ outDir });
  const issues: SeoIssue[] = [...checkRobots({ outDir }), ...checkNotFound({ outDir })];
  if (llms.size === 0)
    issues.push({ page: "llms.txt", code: "missing-llms-txt", detail: "no links" });
  const exports: string[] = [];
  for (const url of pages)
    for (const issue of checkPage({ outDir, basePath, url, llms, seo, exports }))
      issues.push({ page: url, ...issue });
  return { pages: pages.length, issues, exports };
}

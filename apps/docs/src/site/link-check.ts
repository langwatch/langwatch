import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  readBuiltRedirects,
  resolveRedirect,
  type Redirects,
} from "../features/navigation/compile/redirects.ts";
import { stripBasePath } from "../lib/site-path.ts";

export type LinkIssue = { source: string; href: string; code: string };
type Target = { url: URL } | { error: string } | { external: true };

function htmlFiles({ directory }: { directory: string }): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles({ directory: file });
    return entry.name.endsWith(".html") ? [file] : [];
  });
}

function attributes({ html, attribute }: { html: string; attribute: string }) {
  const pattern = new RegExp(`\\b${attribute}=["']([^"']*)["']`, "gi");
  return [...html.matchAll(pattern)].map((match) => match[1].replace(/&amp;/g, "&"));
}

/* Under a base path the production origin is external: canonical URLs name it, not the mount. */
function siteOrigin({ basePath }: { basePath: string }) {
  return basePath ? "http://docs.local" : "https://docs.langwatch.ai";
}

function resolveTarget({
  href,
  source,
  redirects,
  basePath,
}: {
  href: string;
  source: string;
  redirects: Redirects;
  basePath: string;
}): Target {
  const origin = siteOrigin({ basePath });
  let url = new URL(href, `${origin}${basePath}${source}`);
  const visited = new Set<string>();
  while (url.origin === origin) {
    if (visited.has(url.pathname)) return { error: "redirect-cycle" };
    visited.add(url.pathname);
    const sitePathname = stripBasePath({ pathname: url.pathname, basePath });
    if (sitePathname === null) return { error: "outside-base-path" };
    const redirect = resolveRedirect({
      pathname: url.pathname,
      search: url.search,
      redirects,
      basePath,
    });
    if (!redirect) {
      const site = new URL(url);
      site.pathname = sitePathname;
      return { url: site };
    }
    const target = new URL(redirect, url);
    if (!target.hash) target.hash = url.hash;
    url = target;
  }
  return { external: true };
}

function checkTarget({
  outDir,
  url,
  ids,
}: {
  outDir: string;
  url: URL;
  ids: Map<string, Set<string>>;
}) {
  const pathname = decodeURIComponent(url.pathname);
  const target = path.resolve(outDir, `.${pathname}`);
  const withinBuild = target.startsWith(outDir + path.sep) || target === outDir;
  if (!withinBuild) return "outside-build";
  const file = path.extname(target) ? target : path.join(target, "index.html");
  if (!existsSync(file)) return "missing-target";
  if (!statSync(file).isFile()) return "missing-target";
  if (!url.hash || !file.endsWith(".html")) return null;
  const known =
    ids.get(file) ?? new Set(attributes({ html: readFileSync(file, "utf8"), attribute: "id" }));
  ids.set(file, known);
  const fragment = decodeURIComponent(url.hash.slice(1));
  return known.has(fragment) ? null : "missing-fragment";
}

const MEDIA_ATTRIBUTES = ["src", "poster", "data-src"];

/** Media addresses (src, poster, every srcset candidate) that leave a mounted build's prefix. */
function escapedMedia({ html, basePath }: { html: string; basePath: string }) {
  if (!basePath) return [];
  const candidates = attributes({ html, attribute: "srcset" }).flatMap((set) =>
    set.split(",").map((candidate) => candidate.trim().split(/\s+/)[0] ?? ""),
  );
  const addresses = [
    ...MEDIA_ATTRIBUTES.flatMap((attribute) => attributes({ html, attribute })),
    ...candidates,
  ];
  return [...new Set(addresses)].filter(
    (address) =>
      address.startsWith("/") && !address.startsWith("//") && !address.startsWith(`${basePath}/`),
  );
}

/** The local links in one page that do not reach an existing file or fragment. */
function checkPage({
  outDir,
  file,
  redirects,
  ids,
  basePath,
}: {
  outDir: string;
  file: string;
  redirects: Redirects;
  ids: Map<string, Set<string>>;
  basePath: string;
}) {
  const source = `/${path.relative(outDir, file).replace(/index\.html$/, "")}`;
  const html = readFileSync(file, "utf8");
  const hrefs = [...new Set(attributes({ html, attribute: "href" }))];
  const checkable = hrefs.filter(
    (href) => href && !/^(mailto:|tel:|data:|javascript:)/i.test(href),
  );
  const escaped = escapedMedia({ html, basePath });
  const issues: LinkIssue[] = escaped.map((href) => ({ source, href, code: "outside-base-path" }));
  for (const href of checkable) {
    const target = resolveTarget({ href, source, redirects, basePath });
    if ("external" in target) continue;
    const code = "error" in target ? target.error : checkTarget({ outDir, url: target.url, ids });
    if (code) issues.push({ source, href, code });
  }
  return { checked: checkable.length + escaped.length, issues };
}

/** Every local link and fragment in a build, following redirects; external links are skipped. */
export function checkLinks({ outDir, basePath = "" }: { outDir: string; basePath?: string }) {
  const redirects = readBuiltRedirects({ outDir });
  const files = htmlFiles({ directory: outDir });
  const ids = new Map<string, Set<string>>();
  const pages = files.map((file) => checkPage({ outDir, file, redirects, ids, basePath }));
  return {
    pages: files.length,
    checked: pages.reduce((total, page) => total + page.checked, 0),
    issues: pages.flatMap((page) => page.issues),
  };
}

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  readBuiltRedirects,
  resolveRedirect,
  type Redirects,
} from "../features/navigation/compile/redirects.ts";

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

function resolveTarget({
  href,
  source,
  redirects,
}: {
  href: string;
  source: string;
  redirects: Redirects;
}): Target {
  let url = new URL(href, `https://docs.langwatch.ai${source}`);
  const visited = new Set<string>();
  while (url.origin === "https://docs.langwatch.ai") {
    if (visited.has(url.pathname)) return { error: "redirect-cycle" };
    visited.add(url.pathname);
    const redirect = resolveRedirect({ pathname: url.pathname, search: url.search, redirects });
    if (!redirect) return { url };
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

/** The local links in one page that do not reach an existing file or fragment. */
function checkPage({
  outDir,
  file,
  redirects,
  ids,
}: {
  outDir: string;
  file: string;
  redirects: Redirects;
  ids: Map<string, Set<string>>;
}) {
  const source = `/${path.relative(outDir, file).replace(/index\.html$/, "")}`;
  const hrefs = [...new Set(attributes({ html: readFileSync(file, "utf8"), attribute: "href" }))];
  const checkable = hrefs.filter(
    (href) => href && !/^(mailto:|tel:|data:|javascript:)/i.test(href),
  );
  const issues: LinkIssue[] = [];
  for (const href of checkable) {
    const target = resolveTarget({ href, source, redirects });
    if ("external" in target) continue;
    const code = "error" in target ? target.error : checkTarget({ outDir, url: target.url, ids });
    if (code) issues.push({ source, href, code });
  }
  return { checked: checkable.length, issues };
}

/** Every local link and fragment in a build, following redirects; external links are skipped. */
export function checkLinks({ outDir }: { outDir: string }) {
  const redirects = readBuiltRedirects({ outDir });
  const files = htmlFiles({ directory: outDir });
  const ids = new Map<string, Set<string>>();
  const pages = files.map((file) => checkPage({ outDir, file, redirects, ids }));
  return {
    pages: files.length,
    checked: pages.reduce((total, page) => total + page.checked, 0),
    issues: pages.flatMap((page) => page.issues),
  };
}

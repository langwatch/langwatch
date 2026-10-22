import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { resolveRedirect } from "../../features/navigation/compile/redirects.ts";
import { DOCS_URL, stripBasePath, withBasePath } from "../../lib/site-path.ts";
import type { BuildIndex } from "./build-index.ts";

export type LinkIssue = { source: string; href: string; code: string };
type Target = { url: URL } | { error: string } | { external: true };

const LOCAL_ORIGIN = "http://docs.local";
/* docs.langwatch.ai answers every path with a 301 to the same path under DOCS_URL. */
const DOCS_ADDRESSES = [DOCS_URL, "https://docs.langwatch.ai"];
const EXPORT_EXTENSION = /\.(md|claude|agent)$/;

/** The path after a public docs address (`""`, `/x`, `?q`), or null for any other link. */
function docsRest({ href }: { href: string }) {
  for (const address of DOCS_ADDRESSES) {
    if (!href.startsWith(address)) continue;
    const rest = href.slice(address.length);
    if (rest === "" || /^[/?#]/.test(rest)) return rest;
  }
  return null;
}

/** A link to the public docs address, checked as the same path in this build. */
export function localHref({ href, basePath }: { href: string; basePath: string }) {
  const rest = docsRest({ href });
  if (rest === null) return href;
  return withBasePath({ basePath, path: rest.startsWith("/") ? rest : `/${rest}` });
}

/** Whether an address names the public documentation. */
export function isDocsAddress({ href }: { href: string }) {
  return docsRest({ href }) !== null;
}

/** Follows redirects from a link on `source` until it leaves them; external ends the walk. */
export function resolveTarget({
  href,
  source,
  index,
}: {
  href: string;
  source: string;
  index: Pick<BuildIndex, "redirects" | "basePath">;
}): Target {
  const { redirects, basePath } = index;
  let url = new URL(localHref({ href, basePath }), `${LOCAL_ORIGIN}${basePath}${source}`);
  const visited = new Set<string>();
  while (url.origin === LOCAL_ORIGIN) {
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

/**
 * The HTML page a Markdown export stands for: `/a/b.md` -> `a/b/index.html`, `/index.md` ->
 * home.
 */
function exportPage({ outDir, file }: { outDir: string; file: string }) {
  const stem = path.relative(outDir, file).replace(EXPORT_EXTENSION, "");
  return path.join(outDir, stem === "index" ? "" : stem, "index.html");
}

function isFile({ file }: { file: string }) {
  return existsSync(file) && statSync(file).isFile();
}

/** Null when a resolved site URL reaches a built file and, for a fragment, an element id. */
export function checkTarget({
  index,
  url,
}: {
  index: Pick<BuildIndex, "outDir" | "html">;
  url: URL;
}) {
  const { outDir } = index;
  const pathname = decodeURIComponent(url.pathname);
  const target = path.resolve(outDir, `.${pathname}`);
  const insideBuild = target.startsWith(outDir + path.sep);
  if (!insideBuild && target !== outDir) return "outside-build";
  const file = path.extname(target) ? target : path.join(target, "index.html");
  if (!isFile({ file })) return "missing-target";
  if (!url.hash) return null;
  const page = EXPORT_EXTENSION.test(file) ? exportPage({ outDir, file }) : file;
  const facts = index.html.get(page);
  if (!facts) return null;
  return facts.ids.has(decodeURIComponent(url.hash.slice(1))) ? null : "missing-fragment";
}

/** Resolves and checks one link; null when it reaches a page, a file or leaves the site. */
export function linkIssue({
  href,
  source,
  index,
}: {
  href: string;
  source: string;
  index: BuildIndex;
}) {
  const target = resolveTarget({ href, source, index });
  if ("external" in target) return null;
  return "error" in target ? target.error : checkTarget({ index, url: target.url });
}

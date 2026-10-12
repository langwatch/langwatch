import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { sitePath, stripBasePath, withBasePath } from "../../../lib/site-path.ts";
import { DOCS_ORIGIN } from "../../discovery/compile/page-head.ts";
import { readDocsConfig } from "./nav.ts";

const redirectsSchema = z.record(z.string(), z.string());
export type Redirects = z.infer<typeof redirectsSchema>;

/** docs.json redirects keyed by source path without a trailing slash. */
export function readRedirects({ docsRoot }: { docsRoot: string }): Redirects {
  return Object.fromEntries(
    (readDocsConfig({ docsRoot }).redirects ?? []).map(({ source, destination }) => [
      source.replace(/\/$/, ""),
      destination,
    ]),
  );
}

/** The redirects a build published as `redirects.json`, read back by preview and the link check. */
export function readBuiltRedirects({ outDir }: { outDir: string }): Redirects {
  return redirectsSchema.parse(
    JSON.parse(readFileSync(path.join(outDir, "redirects.json"), "utf8")),
  );
}

/** A request's redirect target; incoming query keys survive unless the destination sets them. */
export function resolveRedirect({
  pathname,
  search,
  redirects,
  basePath = "",
}: {
  pathname: string;
  search: string;
  redirects: Redirects;
  basePath?: string;
}) {
  const sitePathname = stripBasePath({ pathname, basePath });
  if (sitePathname === null) return null;
  const destination = redirects[sitePathname.replace(/\/$/, "")];
  if (!destination) return null;
  const target = new URL(destination, "http://docs.local");
  for (const [key, value] of new URLSearchParams(search)) {
    if (!target.searchParams.has(key)) target.searchParams.append(key, value);
  }
  if (/^https?:\/\//.test(destination)) return target.href;
  return withBasePath({ basePath, path: `${target.pathname}${target.search}${target.hash}` });
}

function escapeAttribute(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
}

/** Where a redirect source's static page is published. */
export function redirectTarget({ source }: { source: string }) {
  return `${source.replace(/^\/+/, "")}/index.html`;
}

/** `:param` and `*` sources match many paths; only a real host rule can serve them. */
export function isStaticRedirect({ source }: { source: string }) {
  return !/[:*]/.test(source);
}

/** A redirect any static host can serve: refresh to the destination, canonical, noindex, a link. */
export function redirectPage({ destination }: { destination: string }) {
  const href = escapeAttribute(sitePath({ path: destination }));
  const canonical = escapeAttribute(new URL(destination, DOCS_ORIGIN).href);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Moved | LangWatch Docs</title><meta name="robots" content="noindex"><link rel="canonical" href="${canonical}"><meta http-equiv="refresh" content="0; url=${href}"></head><body><p>This page moved to <a href="${href}">${href}</a>.</p></body></html>`;
}

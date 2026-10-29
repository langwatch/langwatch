import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
  docsUrl,
  publicSlug,
  sitePath,
  stripBasePath,
  withBasePath,
} from "../../../lib/site-path.ts";
import { matchRedirect } from "../model/redirect-match.ts";
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

const EXPORT_EXTENSIONS = ["md", "claude", "agent"];

/**
 * Every redirect the site answers: docs.json first, then each directory to its first page in
 * reading order (as Mintlify does), then the Markdown exports of moved pages to their new export.
 */
export function siteRedirects({ docsRoot, slugs }: { docsRoot: string; slugs: string[] }) {
  const redirects = readRedirects({ docsRoot });
  const published = new Set(slugs.map((slug) => `/${publicSlug({ slug })}`));
  for (const slug of slugs) {
    const parts = publicSlug({ slug }).split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      const directory = `/${parts.slice(0, depth).join("/")}`;
      if (published.has(directory) || Object.hasOwn(redirects, directory)) continue;
      redirects[directory] = `/${publicSlug({ slug })}`;
    }
  }
  for (const [source, destination] of Object.entries(redirects)) {
    if (!isStaticRedirect({ source }) || !destination.startsWith("/")) continue;
    const target = new URL(destination, "http://docs.local").pathname;
    for (const extension of EXPORT_EXTENSIONS)
      redirects[`${source}.${extension}`] ??= `${target}.${extension}`;
  }
  return redirects;
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
  const destination = matchRedirect({ path: sitePathname, redirects });
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
  return !/[:*]|\.(md|claude|agent)$/.test(source);
}

/** A redirect any static host can serve: refresh to the destination, canonical, noindex, a link. */
export function redirectPage({ destination }: { destination: string }) {
  const href = escapeAttribute(sitePath({ path: destination }));
  const canonical = escapeAttribute(
    /^https?:\/\//.test(destination) ? destination : docsUrl({ path: destination }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Moved | LangWatch Docs</title><meta name="robots" content="noindex"><link rel="canonical" href="${canonical}"><meta http-equiv="refresh" content="0; url=${href}"></head><body><p>This page moved to <a href="${href}">${href}</a>.</p></body></html>`;
}

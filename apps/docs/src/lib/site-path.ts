/* Where the site is served: "" at the root (production) or a prefix such as "/docs" when a
   build was given `--base-path`. Data stays unprefixed; the prefix is added where a URL is
   written. */

import { docsBasePath } from "../config.ts";

/** The build's base path: "" at the root, "/docs" under a prefix and in plain Node "". */
export const BASE_PATH = docsBasePath;

function isRootAbsolute({ path }: { path: string }) {
  return path.startsWith("/") && !path.startsWith("//");
}

/** `path` under `basePath` when it is root-absolute; anything else is returned as it is. */
export function withBasePath({ basePath, path }: { basePath: string; path: string }) {
  return basePath && isRootAbsolute({ path }) ? `${basePath}${path}` : path;
}

/** A root-absolute site path under this build's base path. Pass unprefixed paths only. */
export function sitePath({ path }: { path: string }) {
  return withBasePath({ basePath: BASE_PATH, path });
}

/** A page's address: `introduction` -> `/introduction` (under the base path); "" is the home. */
export function pagePath({ slug }: { slug: string }) {
  return sitePath({ path: `/${slug}` });
}

/** The site path of a request path, or null when it lies outside this build's base path. */
export function stripBasePath({
  pathname,
  basePath = BASE_PATH,
}: {
  pathname: string;
  basePath?: string;
}) {
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  return pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : null;
}

/** Whether a same-origin request path belongs to this site rather than an app beside it. */
export function isSitePath({ pathname }: { pathname: string }) {
  return stripBasePath({ pathname }) !== null;
}

/** Where the public documentation lives; docs.langwatch.ai answers with a 301 to it. */
export const DOCS_URL = "https://langwatch.ai/docs";

/** The public address of a root-absolute site path, whatever base path the build used. */
export function docsUrl({ path }: { path: string }) {
  return `${DOCS_URL}${path}`;
}

/** The home page is also published at the root; both name the introduction, as today. */
export function canonicalUrl({ slug }: { slug: string }) {
  return docsUrl({ path: `/${slug}` });
}

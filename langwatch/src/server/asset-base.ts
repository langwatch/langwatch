/**
 * Runtime-configurable base URL for content-hashed build assets.
 *
 * The published Docker image is shared by self-hosters and LangWatch SaaS, and
 * Vite's `base` is a compile-time constant — so the CDN origin cannot be baked
 * into the image without breaking every self-host install. Instead the base is
 * chosen at container start: `vite.config.ts` emits every JS-referenced asset
 * URL as `window.__lwAssetUrl(<path relative to the build root>)`, and the HTML
 * shell served by `static-handler.ts` defines that global from
 * `LANGWATCH_ASSET_BASE` and rewrites the base-absolute entry refs to match.
 *
 * - Unset / "/" (self-host default): assets resolve same-origin, served by the
 *   pod exactly as before; the HTML rewrite is a no-op.
 * - "https://cdn.langwatch.ai/<commit-sha>/" (SaaS): assets resolve to the
 *   commit-prefixed CDN namespace, where every past build's assets still exist —
 *   so a rolling deploy never strands a tab on a 404. See ADR-038.
 */

// Browser globals the built bundle and the injected bootstrap agree on. The
// bundle references `__lwAssetUrl`; the bootstrap defines both. Keep in sync
// with the `renderBuiltUrl` runtime expression in vite.config.ts.
export const ASSET_URL_GLOBAL = "__lwAssetUrl";
export const ASSET_BASE_GLOBAL = "__lwAssetBase";

/**
 * Normalize a raw `LANGWATCH_ASSET_BASE` value to a base that always ends in a
 * slash (so `base + "assets/x.js"` concatenates cleanly), collapsing unset and
 * bare "/" to the same-origin sentinel "/".
 *
 * A non-"/" value MUST be an absolute http(s) URL. We validate (and throw) here
 * so the two consumers can never disagree: a scheme-less value like
 * "cdn.langwatch.ai/x/" would otherwise rewrite asset refs to a broken
 * *relative* URL (silent 404s on every chunk) while `new URL()` in
 * `assetBaseOrigin` throws and drops the CSP entry — the exact silent failure
 * this feature exists to kill. Failing fast at boot surfaces the misconfig in
 * the pod logs instead. `url.href` also percent-encodes anything unsafe, so a
 * stray "<" can't break out of the injected `<script>`.
 */
export function normalizeAssetBase(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed === "/") return "/";

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(
      `LANGWATCH_ASSET_BASE must be an absolute http(s) URL ` +
        `(e.g. https://cdn.example.com/<tag>/); got ${JSON.stringify(raw)}`,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(
      `LANGWATCH_ASSET_BASE must use http or https; got ${JSON.stringify(raw)}`,
    );
  }
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}

/** The effective asset base for this process, read from the environment. */
export function getAssetBase(): string {
  return normalizeAssetBase(process.env.LANGWATCH_ASSET_BASE);
}

/**
 * The external origin to admit into the CSP fetch directives, or null when the
 * base is same-origin (nothing to add).
 */
export function assetBaseOrigin(base: string): string | null {
  if (base === "/") return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

/**
 * The inline classic `<script>` that defines the asset-URL resolver. A classic
 * inline script runs during HTML parse, before deferred module scripts, so the
 * resolver is defined before the entry chunk's dynamic imports evaluate.
 */
export function assetBaseBootstrapScript(base: string): string {
  // `base` is already URL-validated (no raw "<"), but escape "<" for defence in
  // depth so the JSON string literal can never terminate the <script> element.
  const json = JSON.stringify(base).replace(/</g, "\\u003c");
  return (
    `<script>window.${ASSET_BASE_GLOBAL}=${json};` +
    `window.${ASSET_URL_GLOBAL}=function(p){return window.${ASSET_BASE_GLOBAL}+p};</script>`
  );
}

/**
 * Inject the resolver bootstrap into the HTML shell and rewrite the base-absolute
 * entry references (`<script src>`, `modulepreload`, stylesheet `<link href>`)
 * that Vite baked as `/assets/…` to the runtime base. The `/assets/` rewrite is
 * a no-op when the base is same-origin; the resolver bootstrap is always
 * injected (the built bundle references `window.__lwAssetUrl` regardless of base).
 */
export function injectAssetBaseIntoHtml(html: string, base: string): string {
  const withBootstrap = insertBootstrap(html, assetBaseBootstrapScript(base));
  if (base === "/") return withBootstrap;
  // Whitespace-anchored so it rewrites the `src`/`href` of Vite's entry
  // `<script>` / `modulepreload` / stylesheet tags but never a `data-src` etc.
  // Function replacer (not a `$1` string) so a "$" in the base can't be read as
  // a replacement-pattern token.
  return withBootstrap.replace(
    /(\s(?:src|href))="\/assets\//g,
    (_match, attr: string) => `${attr}="${base}assets/`,
  );
}

/**
 * Place the bootstrap as early as possible: after `<head>` when present (before
 * Vite's injected entry scripts), else after `<html>`, else after the doctype,
 * else at the very start.
 */
function insertBootstrap(html: string, snippet: string): string {
  for (const anchor of [/<head[^>]*>/i, /<html[^>]*>/i, /<!doctype[^>]*>/i]) {
    const match = anchor.exec(html);
    if (match) {
      const at = match.index + match[0].length;
      return html.slice(0, at) + snippet + html.slice(at);
    }
  }
  return snippet + html;
}

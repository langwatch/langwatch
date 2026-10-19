// Browser globals the built bundle and the injected bootstrap agree on. The
// bundle references `__lwAssetUrl`; the bootstrap defines both. Keep in sync
// with the `renderBuiltUrl` runtime expression in vite.config.ts.
export const ASSET_URL_GLOBAL = "__lwAssetUrl";
export const ASSET_BASE_GLOBAL = "__lwAssetBase";

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
    throw new Error(`LANGWATCH_ASSET_BASE must use http or https; got ${JSON.stringify(raw)}`);
  }
  // The resolver concatenates the asset path onto this base, so a query or
  // fragment would swallow it — "…/build?rev=1" + "assets/x.js" resolves to
  // "…/build?rev=1/assets/x.js", where the path is part of the query. Same
  // silent 404 the scheme check above exists to prevent.
  if (url.search || url.hash) {
    throw new Error(
      `LANGWATCH_ASSET_BASE must not carry a query or fragment; ` + `got ${JSON.stringify(raw)}`,
    );
  }
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}

export function assetBaseOrigin(base: string): string | null {
  if (base === "/") return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

export function assetBaseBootstrapScript(base: string): string {
  return `<script>${assetBaseBootstrapBody(base)}</script>`;
}

export function assetBaseBootstrapBody(base: string): string {
  // `base` is already URL-validated (no raw "<"), but escape "<" for defence in
  // depth so the JSON string literal can never terminate the <script> element.
  const json = JSON.stringify(base).replace(/</g, "\\u003c");
  return (
    `window.${ASSET_BASE_GLOBAL}=${json};` +
    `window.${ASSET_URL_GLOBAL}=function(p){return window.${ASSET_BASE_GLOBAL}+p};`
  );
}

import fs from "node:fs";
import path from "node:path";

import { assetBaseBootstrapScript, assetBaseOrigin, normalizeAssetBase } from "./asset-base.ts";

export type ApiUiBundle = Readonly<{ directory: string; head: string; assetOrigin: string | null }>;
export type BundleConfig = Readonly<{
  directory: string;
  assetBase?: string;
  publicConfig: Readonly<Record<string, unknown>>;
}>;

export function resolveUiBundle(config: BundleConfig): ApiUiBundle | undefined {
  const directory = path.resolve(config.directory);
  if (!fs.existsSync(path.join(directory, "index.html"))) return void 0;
  const assetBase = normalizeAssetBase(config.assetBase);
  const content = JSON.stringify(config.publicConfig).replace(
    /[&<>"']/g,
    (character) => escapes[character] ?? character,
  );
  return {
    directory,
    head:
      assetBaseBootstrapScript(assetBase) +
      `<meta name="langwatch-public-config" content="${content}">`,
    assetOrigin: assetBaseOrigin(assetBase),
  };
}

const escapes: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

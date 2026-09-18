// The built browser bundle this process serves off the same listener: apps/ui
// is a build, not a deployable, so the pod answering /api/* answers / too.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicAppConfigMetaTag } from "@langwatch/config/public-app-config";
import { resolvePublicAppConfig } from "@langwatch/config/public-app-config/projection";
import { assetBaseBootstrapScript, assetBaseOrigin, normalizeAssetBase } from "./api-asset-base.ts";
import { buildSecurityHeaders } from "./api-security-headers.ts";

/**
 * The built browser application, as the server that hosts it reads one. The
 * shape is stated here rather than imported: it is three plain fields.
 */
export type ApiUiBundle = Readonly<{
  /** Where the built bundle is. Absent from disk, the door answers nothing. */
  directory: string;
  /** Injected at the start of the served shell's head. */
  head?: string;
  /** Sent with every served file — this deployment's security headers. */
  headers?: Readonly<Record<string, string>>;
}>;

/** What this module reads of the environment to answer with a bundle. */
export type UiBundleEnvironment = Readonly<Record<string, unknown>>;

/** One environment value, where it is text at all. */
function text(environment: UiBundleEnvironment, key: string): string | undefined {
  const value = environment[key];

  return typeof value === "string" ? value : undefined;
}

/**
 * Where the built bundle sits relative to this module. `apps/ui` builds to
 * `apps/ui/dist/client`, and the image copies both applications side by side,
 * so the artefact is a fixed relative walk from `apps/api/src/door/`.
 */
export function resolveUiBundleDirectory(environment: UiBundleEnvironment): string {
  const configured = text(environment, "LANGWATCH_UI_DIST_DIR")?.trim();
  if (configured) return path.resolve(configured);

  return fileURLToPath(new URL("../../../ui/dist/client", import.meta.url));
}

/**
 * The bundle this deployment serves, or nothing when it carries no build —
 * locally, Vite owns the browser and this process answers `/api/*` alone.
 */
export function resolveUiBundle(environment: UiBundleEnvironment): ApiUiBundle | undefined {
  // A page the browser cannot tell which origin to call is worse than no page:
  // the projection it carries is built on the deployment's own base address,
  // so a deployment that named none serves transports alone.
  if (text(environment, "BASE_HOST") === undefined) return undefined;

  const directory = resolveUiBundleDirectory(environment);
  if (!fs.existsSync(path.join(directory, "index.html"))) return undefined;

  const assetBase = normalizeAssetBase(text(environment, "LANGWATCH_ASSET_BASE"));

  return {
    directory,
    // The asset resolver first — a classic inline script runs during the parse,
    // before the deferred entry chunk that calls it — then this deployment's
    // own public configuration, which the browser reads before it renders.
    head:
      assetBaseBootstrapScript(assetBase) +
      createPublicAppConfigMetaTag(resolvePublicAppConfig(environment)),
    // The browser reads the policy off the document that loads the bundle, so
    // it belongs on the responses serving that document.
    headers: buildSecurityHeaders({
      dev: text(environment, "NODE_ENV") !== "production",
      environment: securityHeaderEnvironment(environment),
      assetOrigin: assetBaseOrigin(assetBase),
    }),
  };
}

/**
 * The storage endpoints the policy admits, read off the same environment. A
 * narrow projection rather than the whole record: these five names are all the
 * header builder may see.
 */
function securityHeaderEnvironment(
  environment: UiBundleEnvironment,
): Record<string, string | undefined> {
  const names = ["AWS_REGION", "AZURE_BLOB_ENDPOINT", "S3_BUCKET_NAME", "S3_ENDPOINT", "S3_REGION"];

  return Object.fromEntries(names.map((name) => [name, text(environment, name)]));
}

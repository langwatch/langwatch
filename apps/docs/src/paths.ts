import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { z } from "zod";

/* The prerender runs as a bundle in a per-build directory, so build.ts injects the app root. */
declare const __DOCS_APP_ROOT__: string | undefined;

/** Build-time locations; Node only, never imported by a browser or rendered module. */
export const appRoot =
  typeof __DOCS_APP_ROOT__ === "string"
    ? __DOCS_APP_ROOT__
    : fileURLToPath(new URL("..", import.meta.url));
export const docsRoot = path.resolve(appRoot, "../../docs");
export const publicRoot = path.join(appRoot, "public");
export const cacheRoot = path.join(appRoot, "node_modules/.cache");

/* Output directories named on a build, preview or check command line. */
const port = z.coerce.number().int().min(1).max(65535);

/* `--base-path /docs` serves the build under a prefix; production leaves it out (the root). */
const basePath = z
  .string()
  .regex(/^(\/[A-Za-z0-9._~-]+)*\/?$/, "a base path is /segment[/segment], e.g. /docs")
  .refine((value) => !value.split("/").some((segment) => segment === "." || segment === ".."), {
    message: "a base path may not hold . or .. segments; browsers resolve them outside the mount",
  })
  .transform((value) => value.replace(/\/$/, ""));

/* `--app-origin` names the app the playground connects to (ADR-185): `self` when the docs are
   served from the app's own origin (haven, a same-host install), `none` for no connection. */
const appOrigin = z.union(
  [
    z.enum(["self", "none"]),
    z.url({ protocol: /^https?$/ }).transform((value) => new URL(value).origin),
  ],
  { error: "an app origin is self, none or an http(s) URL, e.g. https://app.langwatch.ai" },
);

const renderWorkers = z.coerce.number().int().min(1);

export function readBuildOptions({ args = process.argv.slice(2) }: { args?: string[] } = {}) {
  const { values } = parseArgs({
    args,
    options: {
      "out-dir": { type: "string" },
      "base-path": { type: "string" },
      "app-origin": { type: "string" },
      "render-workers": { type: "string" },
      "no-render-cache": { type: "boolean" },
    },
  });
  return {
    outDir: path.resolve(values["out-dir"] ?? "dist"),
    basePath: basePath.parse(values["base-path"] ?? ""),
    appOrigin: appOrigin.parse(values["app-origin"] ?? "https://app.langwatch.ai"),
    renderWorkers:
      values["render-workers"] === undefined
        ? undefined
        : renderWorkers.parse(values["render-workers"]),
    renderCache: values["no-render-cache"] !== true,
  };
}

export function readPreviewOptions({ args = process.argv.slice(2) }: { args?: string[] } = {}) {
  const { values } = parseArgs({
    args,
    options: {
      "out-dir": { type: "string" },
      port: { type: "string" },
      "base-path": { type: "string" },
    },
  });
  return {
    outDir: path.resolve(values["out-dir"] ?? "dist"),
    port: port.parse(values.port ?? 4173),
    basePath: basePath.parse(values["base-path"] ?? ""),
  };
}

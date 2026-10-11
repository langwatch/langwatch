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

export function readBuildOptions({ args = process.argv.slice(2) }: { args?: string[] } = {}) {
  const { values } = parseArgs({ args, options: { "out-dir": { type: "string" } } });
  return { outDir: path.resolve(values["out-dir"] ?? "dist") };
}

export function readPreviewOptions({ args = process.argv.slice(2) }: { args?: string[] } = {}) {
  const { values } = parseArgs({
    args,
    options: { "out-dir": { type: "string" }, port: { type: "string" } },
  });
  return {
    outDir: path.resolve(values["out-dir"] ?? "dist"),
    port: port.parse(values.port ?? 4173),
  };
}

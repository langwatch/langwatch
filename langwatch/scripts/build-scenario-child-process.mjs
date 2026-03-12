/**
 * Bundles the scenario child process entry point into a single JavaScript file.
 *
 * This eliminates tsx cold-start delay in production by pre-compiling TypeScript
 * to JavaScript at build time. Shared singleton dependencies are kept external
 * to preserve runtime semantics.
 *
 * @see specs/scenarios/pre-compiled-child-process.feature
 */

import { build } from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

await build({
  entryPoints: [
    path.join(
      packageRoot,
      "src",
      "server",
      "scenarios",
      "execution",
      "scenario-child-process.ts",
    ),
  ],
  outfile: path.join(packageRoot, "dist", "scenario-child-process.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: [
    // Shared singletons — must resolve to the same instance at runtime
    "@opentelemetry/api",
    "@langwatch/scenario",
    // Native/binary dependencies that cannot be bundled
    "pino",
    "pino-pretty",
    "sharp",
  ],
  // Resolve path aliases from tsconfig.workers.json
  alias: {
    "~/*": path.join(packageRoot, "src", "*"),
  },
  tsconfig: path.join(packageRoot, "tsconfig.workers.json"),
  sourcemap: true,
  logLevel: "info",
});

console.log("Built dist/scenario-child-process.js");

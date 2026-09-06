/**
 * Builds the plugin's one build artifact: `scripts/session-context.mjs`.
 *
 * The plugin is otherwise hand-authored files, so this exists for a single
 * reason: the hook script is bundled from the SDK, and it must be bundled at
 * the moment the plugin is packaged rather than committed. A committed copy
 * would drift from the source it was built from and nobody would notice until a
 * session went quiet.
 *
 * Run it before publishing, and before running the plugin's integration tests.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(pluginRoot, "..", "..");
const bundleDir = join(repoRoot, "sdks", "typescript", "dist", "plugin");
const bundles = ["session-context.mjs", "session-guidance.mjs"];

// `--filter` rather than a directory hop: the repo is one pnpm workspace
// (ADR-076), so the package name resolves from anywhere inside it, including
// from a CI job that never changes directory.
execFileSync("pnpm", ["--filter", "langwatch", "run", "build:plugin-hook"], {
  cwd: repoRoot,
  stdio: "inherit",
});

// The bundle build reports success through its exit code, but an empty or
// missing output would ship a plugin whose hook silently does nothing on every
// session. Fail here instead.
for (const name of bundles) {
  const bundle = join(bundleDir, name);
  let size = 0;
  try {
    size = statSync(bundle).size;
  } catch {
    throw new Error(
      `The hook bundle was not produced at ${bundle}. ` +
        `Run \`pnpm --filter langwatch run build:plugin-hook\` and read its output.`,
    );
  }
  if (size === 0) {
    throw new Error(`The hook bundle at ${bundle} is empty.`);
  }

  const destination = join(pluginRoot, "scripts", name);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(bundle, destination);

  console.log(`plugin: wrote scripts/${name} (${size} bytes)`);
}

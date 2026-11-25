import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Written last into a prebuilt app; a tree without it is an interrupted install (ADR-180). */
export const APP_COMPLETE_MARKER = ".langwatch-app-complete";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The repository checkout this CLI runs from (`pnpm dev:cli`), or null for an npm install. Walks up
 * rather than counting levels: the bundle and the source sit at different depths. A tree under
 * node_modules is never a checkout, even when it holds the workspace.
 */
export function checkoutRoot(): string | null {
  let dir = here;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "apps", "api", "package.json"))) {
      return dir.split(/[\\/]/).includes("node_modules") ? null : dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Where the prebuilt app for one release lives: `<LANGWATCH_HOME>/app/<version>`. */
export function installedAppDir({
  appsDir,
  version,
}: {
  appsDir: string;
  version: string;
}): string {
  return join(appsDir, version);
}

import { statSync } from "node:fs";
import { dirname, join } from "node:path";

/** The nearest directory at or above `from` that holds a pnpm lockfile. */
export function workspaceRoot(from: string): string | undefined {
  for (let dir = from; dir !== dirname(dir); dir = dirname(dir)) {
    if (statSync(join(dir, "pnpm-lock.yaml"), { throwIfNoEntry: false })) return dir;
  }
  return undefined;
}

/** What an install changes: the lockfile, and the state pnpm rewrites on every install. */
function installState(root: string): string {
  return ["pnpm-lock.yaml", "node_modules/.modules.yaml"]
    .map((file) => {
      const stat = statSync(join(root, file), { throwIfNoEntry: false });
      return `${file}:${stat?.size}:${stat?.mtimeMs}:${stat?.ino}`;
    })
    .join("\n");
}

/**
 * Names the cache files: any change to the install, Node version, platform, architecture
 * or symlink mode yields a different salt, so the cache starts empty.
 */
export function cacheSalt({
  root,
  execArgv = process.execArgv,
}: {
  root: string;
  execArgv?: string[];
}): string {
  return [
    installState(root),
    process.version,
    process.platform,
    process.arch,
    execArgv.includes("--preserve-symlinks"),
  ].join("\n");
}

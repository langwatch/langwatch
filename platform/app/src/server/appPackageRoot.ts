import { existsSync, readFileSync } from "fs";
import path from "path";

// The app package root (`platform/app`), resolved without depending on the
// caller's file depth. Under tsx the caller sits in src/…; in the production
// bundle every module collapses to dist/server, so any `__dirname`-relative
// math (path.dirname(__dirname), resolve(__dirname, "../../..")) points
// somewhere different. Walking up to the directory whose package.json is
// `@langwatch/web` gives the same answer in both.
// Keyed by the resolved start dir so a call with a different start (or after
// process.chdir()) is not served the previous answer.
let cached: { start: string; root: string } | undefined;

const isAppPackageDir = (dir: string): boolean => {
  const pkg = path.join(dir, "package.json");
  if (!existsSync(pkg)) return false;
  try {
    return JSON.parse(readFileSync(pkg, "utf8")).name === "@langwatch/web";
  } catch {
    return false; // unreadable/partial package.json — keep walking
  }
};

export const resolveAppPackageRoot = (
  start: string = process.cwd(),
): string => {
  const resolvedStart = path.resolve(start);
  if (cached?.start === resolvedStart) return cached.root;
  let dir = resolvedStart;
  for (;;) {
    if (isAppPackageDir(dir)) {
      cached = { start: resolvedStart, root: dir };
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to the resolved starting directory (process.cwd() by default): in
  // every real deployment the process starts from the app package dir, so this
  // stays correct even if the marker walk came up empty.
  cached = { start: resolvedStart, root: resolvedStart };
  return resolvedStart;
};

/**
 * Reuse cached nlpgo binary by comparing source digest (not mtime, which
 * drifts in CI).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Files whose bytes the Go build reads. Anything else cannot change output. */
function isBuildInput(name: string): boolean {
  return (
    name.endsWith(".go") ||
    name === "go.mod" ||
    name === "go.sum" ||
    name === "go.work" ||
    name === "go.work.sum"
  );
}

/**
 * Every build-input file under `dir`, as paths relative to `root` — a
 * property of the tree, not of where it's checked out, so a worktree, a
 * runner and a developer's clone reach the same digest for the same sources.
 */
function collectBuildInputs(dir: string, root: string): string[] {
  const found: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
          continue;
        }
        stack.push(full);
      } else if (isBuildInput(entry.name)) {
        found.push(path.relative(root, full));
      }
    }
  }
  return found;
}

/**
 * A digest of every Go build input under `watchDirs`. Both path and content
 * go into the hash, so adding, removing or renaming a file moves it even
 * when the surviving bytes match. Sorted first, since iteration order varies.
 */
export function digestGoSources({
  watchDirs,
  watchFiles = [],
  root,
}: {
  watchDirs: string[];
  /**
   * Individual files outside any watched tree — module/workspace files at
   * the repo root. Just as much a build input: a dependency bump, `replace`
   * retarget or `go.work` edit changes what compiles with no .go file touched.
   */
  watchFiles?: string[];
  root: string;
}): string {
  const files = [
    ...watchDirs
      .filter((dir) => fs.existsSync(dir))
      .flatMap((dir) => collectBuildInputs(dir, root)),
    ...watchFiles.filter((file) => fs.existsSync(file)).map((file) => path.relative(root, file)),
  ].toSorted();

  const digest = createHash("sha256");
  for (const relative of files) {
    digest.update(relative);
    digest.update("\0");
    try {
      digest.update(fs.readFileSync(path.join(root, relative)));
    } catch {
      // A file that vanished between listing and reading is a changed tree.
      // Fold the fact in rather than throwing: the caller's fallback is a
      // rebuild, which is exactly the right answer for a tree in motion.
      digest.update("<unreadable>");
    }
    digest.update("\0");
  }
  return digest.digest("hex");
}

/** The digest recorded beside a binary, or null when there is no usable stamp. */
export function readStamp(stampPath: string): string | null {
  try {
    const recorded = fs.readFileSync(stampPath, "utf8").trim();
    return recorded.length > 0 ? recorded : null;
  } catch {
    return null;
  }
}

/** Record the digest a freshly built binary was compiled from. */
export function writeStamp(stampPath: string, digest: string): void {
  fs.writeFileSync(stampPath, `${digest}\n`);
}

/**
 * Whether the cached binary can be used as-is. Both halves must be present
 * and agree — a stamp with no binary is a half-restored cache, a binary
 * with no stamp predates this mechanism; neither proves a source match.
 */
export function cachedBinaryIsUsable({
  binaryPath,
  stampPath,
  currentDigest,
}: {
  binaryPath: string;
  stampPath: string;
  currentDigest: string;
}): boolean {
  if (!fs.existsSync(binaryPath)) return false;
  return readStamp(stampPath) === currentDigest;
}

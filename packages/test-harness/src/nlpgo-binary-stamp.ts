/**
 * Decides whether a cached nlpgo test binary can be reused.
 *
 * The question is "was this binary built from these sources", and the only
 * answer that survives CI is the sources' content. Modification times do not:
 * git stores no mtimes, so actions/checkout writes every file with the time of
 * the current run, while a binary restored by actions/cache carries the time it
 * was compiled in an earlier one. Comparing the two makes every source look
 * newer than every cached binary, so an mtime check rebuilds on every CI run no
 * matter how well the cache is keyed — which is what it did, at ~90s a shard.
 *
 * So the build writes a stamp beside the binary holding the digest of the
 * sources it compiled, and a later run reuses the binary only when today's
 * digest matches that stamp.
 *
 * Not a test file (underscore prefix + no `.test.ts` suffix) so vitest does not
 * pick it up as a suite.
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
 * Every build-input file under `dir`, as paths relative to `root`.
 *
 * Relative rather than absolute so the digest is a property of the tree and not
 * of where it happens to be checked out: the same sources in a worktree, a
 * runner and a developer's clone must agree, or the stamp never matches and we
 * are back to rebuilding every time.
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
 * A digest of every Go build input under `watchDirs`.
 *
 * Both the path and the content of each file go into the hash, so adding,
 * removing or renaming a file moves the digest even when the surviving bytes
 * are identical. Sorted first because directory iteration order is a filesystem
 * detail and two machines must reach the same digest for the same tree.
 */
export function digestGoSources({
  watchDirs,
  watchFiles = [],
  root,
}: {
  watchDirs: string[];
  /**
   * Individual files outside any watched tree — the module and workspace files
   * at the repo root. They are build inputs every bit as much as the sources: a
   * dependency bump, a `replace` retarget or a `go.work` edit changes what
   * compiles without touching a single .go file under the trees below.
   */
  watchFiles?: string[];
  root: string;
}): string {
  const files = [
    ...watchDirs
      .filter((dir) => fs.existsSync(dir))
      .flatMap((dir) => collectBuildInputs(dir, root)),
    ...watchFiles.filter((file) => fs.existsSync(file)).map((file) => path.relative(root, file)),
  ].sort();

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
 * Whether the cached binary can be used as-is.
 *
 * Both halves have to be present and agree. A stamp without its binary is a
 * half-restored cache, and a binary without a stamp is one built before this
 * mechanism existed; neither is evidence the artifact matches the sources, so
 * both rebuild.
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

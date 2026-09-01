import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Removes the workspaces the dogfood scenarios leave in the system temp
 * folder.
 *
 * Most scenarios build their workspace with `fs.mkdtempSync(os.tmpdir(), …)`
 * and never remove it. Each one carries the `node_modules` or the `.venv` the
 * agent installed, so a run of the whole suite leaves tens of gigabytes
 * behind, and a few runs fill the disk. That failure arrives as a git write
 * error or a test that cannot write its own fixture, which reads like
 * anything except a full disk.
 *
 * `KEEP_SKILL_TEST_WORKDIR=1` keeps them, the same way it keeps the
 * workspaces under `.claude/tmp/skill-tests/`, so reading the artifact a run
 * produced still works.
 *
 * A workspace with anything written in the last ten minutes is left alone:
 * batches of this suite run side by side, and one run must never remove the
 * workspace another run is still writing to.
 *
 * The activity read walks the tree rather than reading the mtime of the top
 * directory. A directory's own mtime only moves when an entry is added or
 * removed directly in it, so a run that spends twenty minutes editing files
 * inside `src/` or a `.venv` looks untouched from the top, and a sweep from a
 * concurrent run would delete the workspace out from under it. The walk stops
 * at the first recent entry it meets, so an active workspace costs almost
 * nothing to recognise; only a stale one is read in full, and that is the one
 * about to be removed anyway.
 */
const IDLE_MINUTES_BEFORE_REMOVAL = 10;

/**
 * Whether anything inside the tree was written after `cutoff`.
 *
 * Symlinks are read as entries, never followed: a workspace holding a link to
 * a shared cache must not make the sweep wander outside it, and must not let
 * that cache's mtime keep a dead workspace alive.
 */
function hasActivitySince(directory: string, cutoff: number): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    // Unreadable is not evidence of idleness, so treat it as busy and keep it.
    return true;
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    try {
      if (fs.lstatSync(entryPath).mtimeMs > cutoff) return true;
    } catch {
      continue;
    }
    if (entry.isDirectory() && hasActivitySince(entryPath, cutoff)) return true;
  }

  return false;
}

export default function setup(): () => void {
  return () => {
    if (process.env.KEEP_SKILL_TEST_WORKDIR === "1") return;

    const tempRoot = os.tmpdir();
    const idleCutoff = Date.now() - IDLE_MINUTES_BEFORE_REMOVAL * 60 * 1000;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(tempRoot, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith("langwatch-skill-")) continue;

      const workDir = path.join(tempRoot, entry.name);
      try {
        if (fs.statSync(workDir).mtimeMs > idleCutoff) continue;
        if (hasActivitySince(workDir, idleCutoff)) continue;
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        // A workspace another run owns, or one already gone. Both are fine.
      }
    }
  };
}

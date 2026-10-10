import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Removes workspaces the dogfood scenarios `mkdtemp`'d and never cleaned up,
 * which otherwise fill the disk as a confusing failure. `KEEP_SKILL_TEST_WORKDIR=1`
 * keeps them; anything written in the last ten minutes is left alone for concurrent runs.
 */
const IDLE_MINUTES_BEFORE_REMOVAL = 10;

/**
 * Whether anything inside the tree was written after `cutoff`. Symlinks are
 * read as entries, never followed — a link to a shared cache must not make
 * the sweep wander outside it, nor let that cache's mtime keep a dead workspace alive.
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
      removeIdleWorkspace({ tempRoot, entry, idleCutoff });
    }
  };
}

function removeIdleWorkspace({
  tempRoot,
  entry,
  idleCutoff,
}: {
  tempRoot: string;
  entry: fs.Dirent;
  idleCutoff: number;
}): void {
  if (!entry.isDirectory()) return;
  if (!entry.name.startsWith("langwatch-skill-")) return;

  const workDir = path.join(tempRoot, entry.name);
  try {
    if (fs.statSync(workDir).mtimeMs > idleCutoff) return;
    if (hasActivitySince(workDir, idleCutoff)) return;
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    // A workspace another run owns, or one already gone. Both are fine.
  }
}

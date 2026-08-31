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
 * A directory touched in the last ten minutes is left alone: batches of this
 * suite run side by side, and one run must never remove the workspace another
 * run is still writing to.
 */
const IDLE_MINUTES_BEFORE_REMOVAL = 10;

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
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        // A workspace another run owns, or one already gone. Both are fine.
      }
    }
  };
}

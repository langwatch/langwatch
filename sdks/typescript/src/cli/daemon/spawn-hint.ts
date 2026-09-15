/**
 * Spawning on the first invocation would leave a credential-holding process
 * alive for nothing on one-off commands, and pile up per-identity in CI. So it
 * spawns on evidence instead: once an identity has MISSED at least twice inside
 * a short window, tracked in a tiny 0600 JSON file beside the socket. Every
 * failure reading or writing that file is swallowed, costing a spawn, never a
 * command.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { ensureSocketDir, type DaemonIdentity } from "./identity";

/** Misses older than this are forgotten — two calls a week apart are two one-offs. */
const WINDOW_MS = 60_000;
/** Misses (including this one) needed inside the window before a daemon is spawned. */
const MISSES_BEFORE_SPAWN = 2;

function hintPath(identity: DaemonIdentity): string {
  return path.join(identity.socketDir, `${identity.fingerprint.slice(0, 16)}.hint`);
}

/**
 * Record a daemon miss for this identity and report whether it has now missed
 * often enough, recently enough, to be worth a daemon.
 */
export function recordMissAndDecideToSpawn(identity: DaemonIdentity): boolean {
  const file = hintPath(identity);
  const now = Date.now();

  // Deliberately OUTSIDE the swallow-everything block below. A socket
  // directory we cannot own (identity.ts UntrustedSocketDirError) is not a
  // bookkeeping hiccup to shrug off and retry — it means the socket can never
  // be made private, so there must be no daemon at all. Fail closed: no hint,
  // no spawn, every command runs in-process exactly as it does today.
  try {
    ensureSocketDir(identity.socketDir);
  } catch {
    return false;
  }

  try {
    let recent: number[] = [];
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(parsed)) {
        recent = parsed.filter(
          (entry): entry is number => typeof entry === "number" && now - entry < WINDOW_MS,
        );
      }
    } catch {
      // No hint file yet, or an unreadable one. Either way: start over.
    }

    recent.push(now);

    if (recent.length >= MISSES_BEFORE_SPAWN) {
      // Clear the evidence so a daemon that fails to come up does not make every
      // subsequent invocation try to spawn another one.
      try {
        fs.unlinkSync(file);
      } catch {
        // Nothing to clear.
      }
      return true;
    }

    fs.writeFileSync(file, JSON.stringify(recent.slice(-MISSES_BEFORE_SPAWN)), {
      mode: 0o600,
    });
    return false;
  } catch {
    // Bookkeeping is not allowed to be a failure mode.
    return false;
  }
}

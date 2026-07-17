/**
 * When is a daemon worth spawning?
 *
 * Spawning one on the very first daemon-less invocation is tempting and wrong.
 * A daemon only pays for itself across MANY calls, and a great deal of CLI usage
 * is a single one-off command — a human running `langwatch trace get …` once, or
 * a CI job that shells out to the CLI twice in a pipeline. Spawning for those
 * leaves a credential-holding process alive for the whole idle window in
 * exchange for nothing, and in CI (where every job may resolve a different
 * identity, and therefore a different daemon) it leaves a pile of them.
 *
 * So we spawn on evidence, not on hope: the daemon appears once an identity has
 * MISSED at least twice inside a short window — which is exactly what an agent
 * hammering the CLI looks like on its second call, and is exactly what a one-off
 * command never looks like.
 *
 * The bookkeeping is a tiny JSON file of recent miss timestamps, 0600, beside
 * the socket. Every failure here is swallowed: a hint we cannot read or write
 * costs a spawn, never a command.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { ensureSocketDir, type DaemonIdentity } from "./identity";

/** Misses older than this are forgotten — two calls a week apart are two one-offs. */
const WINDOW_MS = 60_000;
/** Misses (including this one) needed inside the window before a daemon is spawned. */
const MISSES_BEFORE_SPAWN = 2;

function hintPath(identity: DaemonIdentity): string {
  return path.join(
    identity.socketDir,
    `${identity.fingerprint.slice(0, 16)}.hint`,
  );
}

/**
 * Record a daemon miss for this identity and report whether it has now missed
 * often enough, recently enough, to be worth a daemon.
 */
export function recordMissAndDecideToSpawn(identity: DaemonIdentity): boolean {
  const file = hintPath(identity);
  const now = Date.now();

  try {
    ensureSocketDir(identity.socketDir);

    let recent: number[] = [];
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(parsed)) {
        recent = parsed.filter(
          (entry): entry is number =>
            typeof entry === "number" && now - entry < WINDOW_MS,
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

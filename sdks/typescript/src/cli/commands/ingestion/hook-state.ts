/**
 * What `langwatch ingest hook <tool>` remembers between invocations: one small
 * file per session holding the last context it managed to post.
 *
 * That file is the whole reason a Stop hook on a quiet session costs nothing,
 * and the reason a branch switch mid-session is reported. It lives beside the
 * CLI's own config rather than in the repository, because it describes a
 * session on this machine and nothing a checkout should carry.
 *
 * Reads report "nothing recorded" for every failure, so an unreadable file
 * costs one duplicate record rather than silence. Writes throw, and the caller
 * decides what a lost fingerprint is worth.
 *
 * Spec: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Fingerprints for sessions last seen longer ago than this are pruned. */
const STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

/** `~/.langwatch/state/session-context`, beside the CLI's own config. */
export function defaultStateDir(): string {
  return path.join(os.homedir(), ".langwatch", "state", "session-context");
}

/**
 * Where one session's fingerprint lives. The agent is part of the key because
 * session ids are only unique within one agent, and two agents sharing a
 * fingerprint would leave the second silent. Whatever the agent and session id
 * turn out to contain, the result is one path segment.
 */
export function stateFilePath({
  stateDir,
  agent,
  sessionId,
}: {
  stateDir: string;
  agent: string;
  sessionId: string;
}): string {
  const name = `${agent}-${sessionId}`.replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(stateDir, `${name.slice(0, 128)}.json`);
}

/** The fingerprint last posted for this session, or null when there is none. */
export function readFingerprint(stateFile: string): string | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (parsed === null || typeof parsed !== "object") return null;
    const fingerprint = (parsed as { fingerprint?: unknown }).fingerprint;
    return typeof fingerprint === "string" ? fingerprint : null;
  } catch {
    // Nothing recorded for this session yet, or a file we cannot read: post.
    return null;
  }
}

/** Record what was just posted. Throws when the state cannot be written. */
export function writeFingerprint({
  stateFile,
  fingerprint,
  now,
}: {
  stateFile: string;
  fingerprint: string;
  now: () => number;
}): void {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      fingerprint,
      updated_at: new Date(now()).toISOString(),
    }),
    { mode: 0o600 },
  );
}

/**
 * Drop fingerprints for sessions nobody has touched in a week. Opportunistic:
 * the directory is small, this runs on a hook that is already doing IO, and
 * every failure is beneath mentioning.
 */
export function pruneStaleState({
  stateDir,
  now,
}: {
  stateDir: string;
  now: () => number;
}): void {
  try {
    for (const entry of fs.readdirSync(stateDir)) {
      if (!entry.endsWith(".json")) continue;
      const file = path.join(stateDir, entry);
      try {
        if (now() - fs.statSync(file).mtimeMs > STATE_MAX_AGE_MS) {
          fs.unlinkSync(file);
        }
      } catch {
        // Raced with another hook, or unreadable. Either way, leave it.
      }
    }
  } catch {
    // No state directory yet.
  }
}

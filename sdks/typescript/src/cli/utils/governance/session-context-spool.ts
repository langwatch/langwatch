/**
 * Declarations that could not be delivered, held for a seam that can.
 *
 * `langwatch ingest context` runs inside the agent's shell, and under codex's
 * default sandbox that shell has no network at all. The command's own retry
 * is worthless there, because every retry runs in the same sandbox. What does
 * get out is the session report: codex spawns its notify program from its own
 * process, outside the sandbox, and the claude hooks run outside it too.
 *
 * So a declaration that cannot be sent is written here instead, and the next
 * seam that reports for any session sends it. One entry per agent and session
 * id: the newest declaration replaces the pending one, since an older one is a
 * checkout the agent has already left. An entry older than an hour is dropped
 * unsent, for the same reason.
 *
 * The drain runs AFTER the seam posts its own directory-derived context, so
 * the declared context is the last record written and becomes the session's
 * current branch. It posts without consulting the fingerprint, because the
 * fingerprint describes what the seam just posted, and it writes the declared
 * fingerprint afterwards so the next turn stays quiet.
 *
 * The queue lives beside the fingerprints, except that codex's sandbox denies
 * every write under the home directory, including into a directory that
 * already exists. It does allow the temp directory, so that is the fallback
 * and a drain reads both. The temp queue is trusted only when its directory
 * belongs to this user and no one else can write to it, since an entry there
 * decides which checkout a session is credited with.
 *
 * Spec: specs/ai-governance/cli-wrappers/session-context-declare.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { stateFilePath, writeFingerprint } from "./hook-state";

/** Past this age a queued declaration is dropped rather than sent. */
export const SPOOL_MAX_AGE_MS = 60 * 60 * 1_000;

/** How many queued declarations the directory may hold. */
export const SPOOL_MAX_ENTRIES = 50;

/** A declaration waiting for a seam that can reach the collector. */
export interface SpooledDeclaration {
  agent: string;
  sessionId: string;
  fingerprint: string;
  /** The OTLP body, exactly as the declaration built it. */
  payload: unknown;
  queuedAtMs: number;
  /** The file it came from, so a delivered entry can be removed. */
  file: string;
}

/** `<stateDir>/spool`, beside the fingerprints the same seams keep. */
export function spoolDir(stateDir: string): string {
  return path.join(stateDir, "spool");
}

/** Where a sandboxed agent can still queue, the home directory being denied. */
export function fallbackSpoolDir(): string {
  return path.join(os.tmpdir(), "langwatch-session-context-spool");
}

/**
 * Ours and private: on a shared machine anyone could otherwise drop an entry
 * there and move somebody else's session onto a checkout of their choosing.
 */
function isPrivateToThisUser(dir: string): boolean {
  try {
    const stats = fs.statSync(dir);
    if (!stats.isDirectory()) return false;
    const uid = process.getuid?.();
    if (uid !== undefined && stats.uid !== uid) return false;
    // Anything group- or world-writable is not ours alone.
    return (stats.mode & 0o022) === 0;
  } catch {
    return false;
  }
}

/** One entry per agent and session, so a newer declaration replaces an older. */
export function spoolFileName({
  agent,
  sessionId,
}: {
  agent: string;
  sessionId: string;
}): string {
  const name = `${agent}-${sessionId}`.replace(/[^A-Za-z0-9._-]/g, "_");
  return `${name.slice(0, 128)}.json`;
}

/** That entry in the state directory, which is where an unsandboxed run puts it. */
export function spoolFilePath({
  stateDir,
  agent,
  sessionId,
}: {
  stateDir: string;
  agent: string;
  sessionId: string;
}): string {
  return path.join(spoolDir(stateDir), spoolFileName({ agent, sessionId }));
}

/**
 * Queue a declaration the command could not deliver. The state directory is
 * tried first, the temp directory second, because a sandboxed agent can write
 * only the latter. Throws when neither accepts it.
 */
export function writeSpooledDeclaration({
  stateDir,
  agent,
  sessionId,
  fingerprint,
  payload,
  now,
}: {
  stateDir: string;
  agent: string;
  sessionId: string;
  fingerprint: string;
  payload: unknown;
  now: () => number;
}): void {
  const body = JSON.stringify({
    agent,
    session_id: sessionId,
    fingerprint,
    payload,
    queued_at: new Date(now()).toISOString(),
    queued_at_ms: now(),
  });
  const name = spoolFileName({ agent, sessionId });

  let lastError: unknown;
  for (const dir of [spoolDir(stateDir), fallbackSpoolDir()]) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(dir, name), body, { mode: 0o600 });
      pruneSpool({ stateDir, now });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function parseEntry(file: string): SpooledDeclaration | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed === null || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const agent = record.agent;
    const sessionId = record.session_id;
    const fingerprint = record.fingerprint;
    const queuedAtMs = record.queued_at_ms;
    if (
      typeof agent !== "string" ||
      typeof sessionId !== "string" ||
      typeof fingerprint !== "string" ||
      typeof queuedAtMs !== "number" ||
      record.payload === undefined
    ) {
      return null;
    }
    return {
      agent,
      sessionId,
      fingerprint,
      payload: record.payload,
      queuedAtMs,
      file,
    };
  } catch {
    return null;
  }
}

function removeQuietly(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    /* raced with another seam draining the same entry */
  }
}

/**
 * Every queued declaration still worth sending. Entries past the age limit
 * and entries that do not parse are deleted rather than returned.
 */
export function readSpooledDeclarations({
  stateDir,
  now,
}: {
  stateDir: string;
  now: () => number;
}): SpooledDeclaration[] {
  const entries: SpooledDeclaration[] = [];
  const fallback = fallbackSpoolDir();
  for (const dir of [spoolDir(stateDir), fallback]) {
    if (dir === fallback && !isPrivateToThisUser(dir)) continue;
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const file = path.join(dir, name);
      const entry = parseEntry(file);
      if (!entry) {
        removeQuietly(file);
        continue;
      }
      if (now() - entry.queuedAtMs > SPOOL_MAX_AGE_MS) {
        removeQuietly(file);
        continue;
      }
      entries.push(entry);
    }
  }
  return entries.sort((a, b) => a.queuedAtMs - b.queuedAtMs);
}

/** Keep the directory small: the newest entries are the ones worth keeping. */
export function pruneSpool({
  stateDir,
  now,
}: {
  stateDir: string;
  now: () => number;
}): void {
  try {
    const entries = readSpooledDeclarations({ stateDir, now });
    for (const entry of entries.slice(0, -SPOOL_MAX_ENTRIES)) {
      removeQuietly(entry.file);
    }
  } catch {
    /* the directory is bookkeeping: never worth failing a seam over */
  }
}

/**
 * Send every queued declaration, newest per session, and record what landed.
 *
 * Returns how many were delivered. Never throws and never reports failure to
 * the caller in a way that could change its exit status: a seam's own work
 * has already succeeded by the time this runs.
 */
export async function drainSessionContextSpool({
  stateDir,
  now,
  post,
}: {
  stateDir: string;
  now: () => number;
  /** Send one OTLP body. False means "keep the entry for the next turn". */
  post: (payload: unknown) => Promise<boolean>;
}): Promise<number> {
  let delivered = 0;
  try {
    for (const entry of readSpooledDeclarations({ stateDir, now })) {
      let sent = false;
      try {
        sent = await post(entry.payload);
      } catch {
        sent = false;
      }
      if (!sent) continue;

      removeQuietly(entry.file);
      delivered++;
      try {
        writeFingerprint({
          stateFile: stateFilePath({
            stateDir,
            agent: entry.agent,
            sessionId: entry.sessionId,
          }),
          fingerprint: entry.fingerprint,
          now,
        });
      } catch {
        // The record landed. A fingerprint we cannot write costs one
        // duplicate next turn and nothing more.
      }
    }
  } catch {
    /* a drain must never be why a seam reported failure */
  }
  return delivered;
}

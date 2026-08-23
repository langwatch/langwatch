/**
 * Which codex session is live on this machine right now.
 *
 * Codex exports nothing about itself into the processes a session spawns: no
 * session id variable, no marker at all (openai/codex#8923). What it does
 * leave is the rollout transcript it appends to after every turn, so "the
 * rollout written to most recently" is the closest thing the machine has to
 * "the session asking". The window keeps a transcript from yesterday from
 * answering for a session that is not running any more.
 *
 * With two sessions active inside the window the newest write wins, which is
 * a documented limitation rather than a solvable one: nothing on disk says
 * which of two live sessions spawned this process.
 *
 * Spec: specs/ai-governance/cli-wrappers/session-context-declare.feature
 */

import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

import {
  type CodexRolloutMeta,
  parseCodexRollout,
} from "./codex-rollout";
import {
  defaultCodexSessionsRoot,
  findRecentRollouts,
} from "./codex-rollout-otlp";

/** How recently a rollout must have been written to count as live. */
export const LIVE_ROLLOUT_WINDOW_MS = 15 * 60_000;

/** `rollout-<timestamp>-<uuid>.jsonl`, the uuid being the session id. */
const ROLLOUT_SESSION_ID =
  /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

export interface LiveCodexSession {
  sessionId: string;
  rolloutPath: string;
  /** The rollout's own identity line, when the transcript parses. */
  meta: CodexRolloutMeta | null;
}

/**
 * The codex session most recently active on this machine, or null when no
 * rollout was written inside the window. The session id comes from the
 * rollout's filename, with the transcript's own `session_meta` line as the
 * fallback for a name codex ever changes the shape of.
 */
export async function resolveLiveCodexSession({
  sessionsRoot = defaultCodexSessionsRoot(),
  nowMs,
  windowMs = LIVE_ROLLOUT_WINDOW_MS,
}: {
  sessionsRoot?: string;
  nowMs: number;
  windowMs?: number;
}): Promise<LiveCodexSession | null> {
  const files = await findRecentRollouts(nowMs - windowMs, sessionsRoot);

  let newest: { path: string; mtimeMs: number } | null = null;
  for (const file of files) {
    try {
      const s = await stat(file);
      if (!newest || s.mtimeMs > newest.mtimeMs) {
        newest = { path: file, mtimeMs: s.mtimeMs };
      }
    } catch {
      /* raced with codex pruning its own sessions */
    }
  }
  if (!newest) return null;

  // The meta is worth parsing even with the id in hand: it is what carries
  // the first typed prompt, and the declare command titles the session with
  // it exactly the way the turn harvest does, so the two seams' fingerprints
  // agree and the context posts once between them.
  let meta: CodexRolloutMeta | null = null;
  try {
    meta = parseCodexRollout(await readFile(newest.path, "utf8")).meta;
  } catch {
    /* an unreadable transcript still names its session in the filename */
  }

  const sessionId =
    ROLLOUT_SESSION_ID.exec(basename(newest.path))?.[1] ??
    meta?.sessionId ??
    null;
  if (!sessionId) return null;

  return { sessionId, rolloutPath: newest.path, meta };
}

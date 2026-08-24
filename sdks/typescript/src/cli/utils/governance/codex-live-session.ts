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
 * Nothing on disk says which of two simultaneously active sessions spawned
 * this process, so when two of them are active this resolves to no session at
 * all. Picking the newer of the two would attribute one session's checkout to
 * the other, and a declaration that names the wrong session is worse than no
 * declaration: the caller is told to name the session with the flags instead.
 *
 * Two windows are what separate "two sessions are running" from "codex was
 * restarted". See HOT_ROLLOUT_WINDOW_MS.
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

/**
 * How recently a rollout must have been written for its session to count as
 * ACTIVE rather than merely recent.
 *
 * The session that runs `langwatch ingest context` is in the middle of a turn
 * while it runs it, so codex appended to that session's rollout seconds ago.
 * A session that sits idle, and above all one that ended when codex was
 * restarted, leaves a rollout that is stale-recent: inside the live window,
 * outside this one. That is what separates a restart, where only one session
 * is really running, from two sessions running side by side, and it is why
 * this refuses on two ACTIVE sessions rather than on two recent rollouts.
 */
export const HOT_ROLLOUT_WINDOW_MS = 60_000;

/** `rollout-<timestamp>-<uuid>.jsonl`, the uuid being the session id. */
const ROLLOUT_SESSION_ID =
  /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/** A candidate key that is a session id rather than a path standing in for one. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LiveCodexSession {
  sessionId: string;
  rolloutPath: string;
  /** The rollout's own identity line, when the transcript parses. */
  meta: CodexRolloutMeta | null;
}

/**
 * The outcome of resolving without explicit flags: the one session that was
 * asking, no session at all, or more than one and no way to tell them apart.
 */
export type CodexSessionResolution =
  | { kind: "session"; session: LiveCodexSession }
  | { kind: "ambiguous"; sessionIds: string[] }
  | { kind: "none" };

/**
 * The codex session asking on this machine. One live rollout answers on its
 * own; several answer only when exactly one of them is hot, because a hot
 * rollout is a session mid-turn and the caller is mid-turn by definition. Two
 * hot rollouts, or none, resolve to `ambiguous` and the caller declares
 * nothing. The session id comes from the rollout's filename, with the
 * transcript's own `session_meta` line as the fallback for a name codex ever
 * changes the shape of.
 */
export async function resolveLiveCodexSession({
  sessionsRoot = defaultCodexSessionsRoot(),
  nowMs,
  windowMs = LIVE_ROLLOUT_WINDOW_MS,
  hotWindowMs = HOT_ROLLOUT_WINDOW_MS,
}: {
  sessionsRoot?: string;
  nowMs: number;
  windowMs?: number;
  hotWindowMs?: number;
}): Promise<CodexSessionResolution> {
  const files = await findRecentRollouts(nowMs - windowMs, sessionsRoot);

  // One candidate per SESSION, not per file: a session codex resumed can
  // leave more than one rollout behind, and those are one session asking,
  // not two competing for the declaration. A file whose name carries no id
  // stands for itself until its transcript is read.
  const candidates = new Map<string, { path: string; mtimeMs: number }>();
  for (const file of files) {
    try {
      const s = await stat(file);
      const key =
        ROLLOUT_SESSION_ID.exec(basename(file))?.[1]?.toLowerCase() ?? file;
      const seen = candidates.get(key);
      if (!seen || s.mtimeMs > seen.mtimeMs) {
        candidates.set(key, { path: file, mtimeMs: s.mtimeMs });
      }
    } catch {
      /* raced with codex pruning its own sessions */
    }
  }
  if (candidates.size === 0) return { kind: "none" };

  let chosen: { path: string; mtimeMs: number };
  if (candidates.size === 1) {
    chosen = [...candidates.values()][0]!;
  } else {
    const hot = [...candidates].filter(
      ([, candidate]) => nowMs - candidate.mtimeMs <= hotWindowMs,
    );
    if (hot.length !== 1) {
      const named = hot.length > 1 ? hot : [...candidates];
      return {
        kind: "ambiguous",
        sessionIds: named
          .map(([key]) => key)
          .filter((key) => UUID.test(key))
          .sort(),
      };
    }
    chosen = hot[0]![1];
  }

  // The meta is worth parsing even with the id in hand: it is what carries
  // the first typed prompt, and the declare command titles the session with
  // it exactly the way the turn harvest does, so the two seams' fingerprints
  // agree and the context posts once between them.
  let meta: CodexRolloutMeta | null = null;
  try {
    meta = parseCodexRollout(await readFile(chosen.path, "utf8")).meta;
  } catch {
    /* an unreadable transcript still names its session in the filename */
  }

  const sessionId =
    ROLLOUT_SESSION_ID.exec(basename(chosen.path))?.[1] ??
    meta?.sessionId ??
    null;
  if (!sessionId) return { kind: "none" };

  return {
    kind: "session",
    session: { sessionId, rolloutPath: chosen.path, meta },
  };
}

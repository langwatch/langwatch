/**
 * Which codex session is live right now: codex exports no session id
 * (openai/codex#8923), so "most recently written rollout" is the proxy.
 * Spec: specs/ai-governance/cli-wrappers/session-context-declare.feature
 */

import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

import { type CodexRolloutMeta, parseCodexRollout } from "./codex-rollout";
import { defaultCodexSessionsRoot, findRecentRollouts } from "./codex-rollout-otlp";

/** How recently a rollout must have been written to count as live. */
export const LIVE_ROLLOUT_WINDOW_MS = 15 * 60_000;

/**
 * How recently a rollout must have been written to count as ACTIVE, inside
 * the live window but outside this one -- distinguishing a restart from two
 * sessions running side by side.
 */
export const HOT_ROLLOUT_WINDOW_MS = 60_000;

/** `rollout-<timestamp>-<uuid>.jsonl`, the uuid being the session id. */
export const ROLLOUT_SESSION_ID =
  /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/** A candidate key that is a session id rather than a path standing in for one. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function newestRolloutPerSession(
  files: readonly string[],
): Promise<Map<string, { path: string; mtimeMs: number }>> {
  const candidates = new Map<string, { path: string; mtimeMs: number }>();
  for (const file of files) {
    try {
      const s = await stat(file);
      const key = ROLLOUT_SESSION_ID.exec(basename(file))?.[1]?.toLowerCase() ?? file;
      const seen = candidates.get(key);
      if (!seen || s.mtimeMs > seen.mtimeMs) {
        candidates.set(key, { path: file, mtimeMs: s.mtimeMs });
      }
    } catch {
      /* raced with codex pruning its own sessions */
      void 0;
    }
  }
  return candidates;
}

/**
 * The codex session asking on this machine. One live rollout answers
 * alone; several answer only when exactly one is hot. Two hot rollouts, or
 * none, resolve to `ambiguous`.
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
  const candidates = await newestRolloutPerSession(files);
  if (candidates.size === 0) return { kind: "none" };

  let chosen: { path: string; mtimeMs: number };
  if (candidates.size === 1) {
    chosen = [...candidates.values()][0]!;
  } else {
    const hot = [...candidates].filter(([, candidate]) => nowMs - candidate.mtimeMs <= hotWindowMs);
    if (hot.length !== 1) {
      const named = hot.length > 1 ? hot : [...candidates];
      return {
        kind: "ambiguous",
        sessionIds: named
          .map(([key]) => key)
          .filter((key) => UUID.test(key))
          .toSorted(),
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
    void 0;
  }

  const sessionId = ROLLOUT_SESSION_ID.exec(basename(chosen.path))?.[1] ?? meta?.sessionId ?? null;
  // The filename branch already yields a session id in codex's own shape. The
  // transcript branch is a fallback for a name codex changes the shape of, so
  // it is held to the same shape rather than trusted to carry anything.
  if (!sessionId || !UUID.test(sessionId)) return { kind: "none" };

  return {
    kind: "session",
    session: { sessionId, rolloutPath: chosen.path, meta },
  };
}

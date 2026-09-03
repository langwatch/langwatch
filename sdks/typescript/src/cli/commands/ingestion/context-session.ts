/**
 * Which coding-agent session a declaration is for.
 *
 * Resolution is ordered by how sure each answer is:
 *
 *   1. `--agent` plus `--session-id`, when the caller knows better.
 *   2. The claude session this process runs inside: claude exports
 *      `CLAUDECODE` and `CLAUDE_CODE_SESSION_ID` into every shell it spawns.
 *      Checked before codex so a codex started inside a claude session
 *      declares for the claude session actually doing the work.
 *   3. The codex session this process runs UNDER, read from the process tree.
 *      Exact, see `codex-ancestor-session.ts`.
 *   4. The codex session active on this machine, inferred from the rollout
 *      transcripts, for when the process tree cannot be read.
 *
 * Every refusal says one line to whoever ran the command: "nothing was
 * declared" must never be silent to the agent.
 *
 * Spec: specs/ai-governance/cli-wrappers/session-context-declare.feature
 */

import { readFile } from "node:fs/promises";

import {
  type AncestorProbe,
  resolveCodexSessionFromAncestors,
} from "@/cli/utils/governance/codex-ancestor-session";
import { type CodexRolloutMeta, parseCodexRollout } from "@/cli/utils/governance/codex-rollout";
import { findRolloutForThread } from "@/cli/utils/governance/codex-rollout-otlp";
import { resolveLiveCodexSession } from "@/cli/utils/governance/codex-live-session";

/** The agents a declaration can name, keyed by their normalized spelling. */
const AGENTS = new Set(["claude_code", "codex", "opencode"]);

/** Which session the declaration is for, and what titles its seams carry. */
export interface ResolvedSession {
  agent: string;
  sessionId: string;
  /** The codex rollout identity, when the session resolved to codex. */
  codexMeta: CodexRolloutMeta | null;
}
/** What every resolution tier needs to answer. */
interface ResolutionInputs {
  sessionId?: string;
  agent?: string;
  env: NodeJS.ProcessEnv;
  now: () => number;
  codexSessionsRoot: string;
  ancestorStartPid: number;
  ancestorProbe?: AncestorProbe;
  writeLine: (line: string) => void;
}

/** The session the flags name, or null with the reason said out loud. */
async function resolveExplicitSession({
  sessionId,
  agent,
  codexSessionsRoot,
  writeLine,
}: ResolutionInputs): Promise<ResolvedSession | null> {
  const normalized = agent?.trim().toLowerCase().replace(/-/g, "_") ?? "";
  const trimmedSessionId = sessionId?.trim() ?? "";
  if (!trimmedSessionId || !AGENTS.has(normalized)) {
    writeLine(
      "Pass both --agent (claude-code, codex or opencode) and --session-id to declare for an explicit session.",
    );
    return null;
  }
  return {
    agent: normalized,
    sessionId: trimmedSessionId,
    codexMeta:
      normalized === "codex"
        ? await readCodexMeta({ sessionId: trimmedSessionId, codexSessionsRoot })
        : null,
  };
}

/**
 * The claude session this process runs inside, from the variables claude
 * exports into every shell it spawns.
 */
function resolveClaudeSession(env: NodeJS.ProcessEnv): ResolvedSession | null {
  const claudeSessionId = env.CLAUDE_CODE_SESSION_ID?.trim();
  if (!env.CLAUDECODE || !claudeSessionId) return null;
  return { agent: "claude_code", sessionId: claudeSessionId, codexMeta: null };
}

/**
 * The codex session: the one this process runs under when the process tree
 * answers, the one active on this machine when it does not.
 */
async function resolveCodexSession({
  now,
  codexSessionsRoot,
  ancestorStartPid,
  ancestorProbe,
  writeLine,
}: ResolutionInputs): Promise<ResolvedSession | null> {
  const ancestor = await resolveCodexSessionFromAncestors({
    startPid: ancestorStartPid,
    sessionsRoot: codexSessionsRoot,
    ...(ancestorProbe ? { probe: ancestorProbe } : {}),
  });
  if (ancestor) {
    return {
      agent: "codex",
      sessionId: ancestor.sessionId,
      // The same rollout the session is writing, read for the same title the
      // turn harvest sends, so the two seams' fingerprints agree.
      codexMeta: await readRolloutMeta(ancestor.rolloutPath),
    };
  }

  const live = await resolveLiveCodexSession({
    sessionsRoot: codexSessionsRoot,
    nowMs: now(),
  });
  if (live.kind === "session") {
    return {
      agent: "codex",
      sessionId: live.session.sessionId,
      codexMeta: live.session.meta,
    };
  }
  writeLine(
    live.kind === "ambiguous"
      ? "Multiple active codex sessions; run with --agent codex --session-id <id>."
      : "Could not find a live coding-agent session on this machine. Pass --agent and --session-id to name one.",
  );
  return null;
}

/**
 * Which session is asking, in the order above. Each tier announces its own
 * failure, because "nothing was declared" must never be silent to the agent.
 */
export async function resolveSession(inputs: ResolutionInputs): Promise<ResolvedSession | null> {
  if (inputs.sessionId || inputs.agent) {
    return resolveExplicitSession(inputs);
  }
  // The claude environment wins over every codex reading: a codex (or any
  // other process) started from inside a claude session inherits these, and
  // the session doing the work, the one whose cost this checkout explains,
  // is the claude one.
  return resolveClaudeSession(inputs.env) ?? (await resolveCodexSession(inputs));
}

/** The rollout identity at a known transcript path, best-effort. */
async function readRolloutMeta(rolloutPath: string): Promise<CodexRolloutMeta | null> {
  try {
    return parseCodexRollout(await readFile(rolloutPath, "utf8")).meta;
  } catch {
    return null;
  }
}

/** The rollout identity for an explicitly named codex session, best-effort. */
async function readCodexMeta({
  sessionId,
  codexSessionsRoot,
}: {
  sessionId: string;
  codexSessionsRoot: string;
}): Promise<CodexRolloutMeta | null> {
  try {
    const rollout = await findRolloutForThread(sessionId, codexSessionsRoot);
    if (!rollout) return null;
    return parseCodexRollout(await readFile(rollout, "utf8")).meta;
  } catch {
    return null;
  }
}

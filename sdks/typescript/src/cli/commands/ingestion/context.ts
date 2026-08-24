/**
 * `langwatch ingest context`: the agent declares the repository and branch it
 * is working on, itself, from inside the checkout.
 *
 * The hooks report the directory the agent PROCESS runs in, which is correct
 * until the agent works somewhere else: a claude session that only `cd`s
 * inside its shell tool, or a codex agent that lives for weeks in a scratch
 * directory and reviews one checkout after another. Codex records its
 * directory once at session start and nothing moves it, so a standing agent
 * reports no repository, no branch and no pull request, however much it
 * works. This command is the way out: run from inside a checkout, it posts
 * the same session-context record the hooks post, for the session the agent
 * is running in, and the always-loaded guidance the CLI installs tells every
 * session to run it when it switches.
 *
 * Which session that is, in order:
 *
 *   1. `--agent` plus `--session-id`, when the caller knows better.
 *   2. The claude session this process runs inside: claude exports
 *      `CLAUDECODE` and `CLAUDE_CODE_SESSION_ID` into every shell it spawns.
 *      Checked first so a codex started inside a claude session declares for
 *      the claude session actually doing the work.
 *   3. The codex session this process runs UNDER: codex holds its rollout
 *      transcript open for the whole session and spawns the shell that runs
 *      this, so the first ancestor process holding a rollout open is the
 *      session asking. Deterministic, and unbothered by other sessions.
 *   4. Failing that, the codex session active on this machine, inferred from
 *      the rollout transcripts. This is what answers when the process tree
 *      cannot be read, under a restrictive sandbox above all. Inference
 *      cannot tell two simultaneously active sessions apart, so there it
 *      declares nothing and asks for the flags rather than name the wrong
 *      session.
 *
 * Unlike the hooks this command talks to whoever ran it: its stdout is the
 * agent's tool result, so it says in one line what it declared or why it
 * declared nothing. It still never exits non-zero and never throws, because
 * the caller is a live session and a broken declaration must cost the agent
 * one line, not the turn.
 *
 * Fingerprint state is shared with the hooks and the codex turn harvest, so
 * a declaration a hook already made posts nothing, and the titles ride along
 * exactly as each agent's own seam sends them, or the fingerprints could
 * never match. After a declaration, the next hook may re-post the process's
 * own directory once; the platform folds branches by appending, so that is
 * expected and harmless.
 *
 * Spec: specs/ai-governance/cli-wrappers/session-context-declare.feature
 */

import { loadConfig } from "@/cli/utils/governance/config";
import { LANGWATCH_SDK_VERSION } from "@/internal/constants";

import {
  type CliTelemetryConfig,
  postSessionContext,
  resolveTarget,
} from "./hook";
import {
  type GitRunner,
  readSessionContext,
  runGitCommand,
} from "./git-context";
import {
  defaultStateDir,
  readFingerprint,
  stateFilePath,
  writeFingerprint,
} from "@/cli/utils/governance/hook-state";
import {
  defaultClaudeSessionRegistryDir,
  readClaudeSessionName,
} from "@/cli/utils/governance/claude-session-registry";
import {
  buildSessionContextLogPayload,
  normalizeSessionName,
  parseTraceparent,
  sessionContextFingerprint,
  sessionTitleFromPrompt,
} from "@/cli/utils/governance/session-context";
import {
  type CodexRolloutMeta,
  parseCodexRollout,
} from "@/cli/utils/governance/codex-rollout";
import {
  codexSessionIndexPath,
  readCodexThreadNames,
} from "@/cli/utils/governance/codex-session-index";
import {
  defaultCodexSessionsRoot,
  findRolloutForThread,
} from "@/cli/utils/governance/codex-rollout-otlp";
import { resolveLiveCodexSession } from "@/cli/utils/governance/codex-live-session";
import {
  type AncestorProbe,
  resolveCodexSessionFromAncestors,
} from "@/cli/utils/governance/codex-ancestor-session";
import { readFile } from "node:fs/promises";

/** The agents a declaration can name, keyed by their normalized spelling. */
const AGENTS = new Set(["claude_code", "codex", "opencode"]);

export interface ContextCommandOptions {
  /** Declare for this session instead of resolving the live one. */
  sessionId?: string;
  /** The agent the session belongs to. Required with `sessionId`. */
  agent?: string;
  env?: NodeJS.ProcessEnv;
  /** The checkout being declared. Defaults to where the agent ran this. */
  cwd?: string;
  runGit?: GitRunner;
  fetchImpl?: typeof fetch;
  now?: () => number;
  stateDir?: string;
  claudeRegistryDir?: string;
  codexSessionsRoot?: string;
  /** The process the ancestor walk starts from. Defaults to the parent. */
  ancestorStartPid?: number;
  /** The process-tree readings. Defaults to the real `ps` and `lsof`. */
  ancestorProbe?: AncestorProbe;
  readCliConfig?: () => CliTelemetryConfig;
  /** One line to whoever ran the command. Defaults to stdout. */
  writeLine?: (line: string) => void;
}

/** Which session the declaration is for, and what titles its seams carry. */
interface ResolvedSession {
  agent: string;
  sessionId: string;
  /** The codex rollout identity, when the session resolved to codex. */
  codexMeta: CodexRolloutMeta | null;
}

/**
 * Declare the working context of the running coding-agent session.
 * One line of output, exit zero, whatever happens.
 */
export async function contextCommand({
  sessionId,
  agent,
  env = process.env,
  cwd = process.cwd(),
  runGit = runGitCommand,
  fetchImpl = fetch,
  now = Date.now,
  stateDir = defaultStateDir(),
  claudeRegistryDir,
  codexSessionsRoot = defaultCodexSessionsRoot(),
  ancestorStartPid = process.ppid,
  ancestorProbe,
  readCliConfig = loadConfig,
  writeLine = (line) => process.stdout.write(`${line}\n`),
}: ContextCommandOptions = {}): Promise<void> {
  try {
    await declare({
      sessionId,
      agent,
      env,
      cwd,
      runGit,
      fetchImpl,
      now,
      stateDir,
      claudeRegistryDir,
      codexSessionsRoot,
      ancestorStartPid,
      ancestorProbe,
      readCliConfig,
      writeLine,
    });
  } catch (error) {
    writeLine(`Could not declare the context: ${(error as Error).message}`);
  }
}

async function declare({
  sessionId,
  agent,
  env,
  cwd,
  runGit,
  fetchImpl,
  now,
  stateDir,
  claudeRegistryDir,
  codexSessionsRoot,
  ancestorStartPid,
  ancestorProbe,
  readCliConfig,
  writeLine,
}: Required<
  Omit<
    ContextCommandOptions,
    "sessionId" | "agent" | "claudeRegistryDir" | "ancestorProbe"
  >
> &
  Pick<
    ContextCommandOptions,
    "sessionId" | "agent" | "claudeRegistryDir" | "ancestorProbe"
  >): Promise<void> {
  const session = await resolveSession({
    sessionId,
    agent,
    env,
    now,
    codexSessionsRoot,
    ancestorStartPid,
    ancestorProbe,
    writeLine,
  });
  if (!session) return;

  const context = readSessionContext({ directory: cwd, runGit });
  if (!context) {
    writeLine(
      `No git repository with an origin remote at ${cwd}. Run this from inside the checkout you are working on.`,
    );
    return;
  }

  const target = resolveTarget({
    env,
    agent: session.agent,
    readCliConfig,
  });
  if (!target) {
    writeLine(
      "LangWatch telemetry is not configured on this machine, so there is nowhere to declare to.",
    );
    return;
  }

  // The titles ride exactly as each agent's own seam sends them, so this
  // declaration and that seam fingerprint identically and post once between
  // them. Claude names its sessions in a live registry; codex names its in
  // the rollout's first typed prompt and its session index.
  const title = session.codexMeta?.firstUserMessage
    ? sessionTitleFromPrompt(session.codexMeta.firstUserMessage)
    : null;
  const name =
    session.agent === "claude_code"
      ? normalizeSessionName(
          readClaudeSessionName({
            sessionId: session.sessionId,
            registryDir:
              claudeRegistryDir ?? defaultClaudeSessionRegistryDir(env),
          }),
        )
      : session.agent === "codex"
        ? normalizeSessionName(
            (
              await readCodexThreadNames(codexSessionIndexPath(codexSessionsRoot))
            ).get(session.sessionId),
          )
        : null;

  const fingerprint = sessionContextFingerprint(context, { title, name });
  const stateFile = stateFilePath({
    stateDir,
    agent: session.agent,
    sessionId: session.sessionId,
  });
  const declared = describeContext({ context, session });
  if (readFingerprint(stateFile) === fingerprint) {
    writeLine(`Context already declared: ${declared}`);
    return;
  }

  const payload = buildSessionContextLogPayload({
    sessionId: session.sessionId,
    agent: session.agent,
    context,
    timeUnixNano: `${now()}000000`,
    scopeVersion: LANGWATCH_SDK_VERSION,
    trace: parseTraceparent(env.TRACEPARENT),
    title,
    name,
  });

  const posted = await postSessionContext({ target, env, payload, fetchImpl });
  if (!posted) {
    // The fingerprint stays unwritten on purpose: the next declaration or
    // hook retries instead of assuming the context landed.
    writeLine(
      "LangWatch did not accept the declaration; it will be retried on the next one.",
    );
    return;
  }

  try {
    writeFingerprint({ stateFile, fingerprint, now });
  } catch {
    // A fingerprint we cannot record costs one duplicate record next time.
  }
  writeLine(`Declared ${declared}`);
}

/**
 * Which session is asking. Flags first, then the claude environment, then
 * the newest recently-active codex rollout. Announces its own failure,
 * because "nothing was declared" must never be silent to the agent.
 */
async function resolveSession({
  sessionId,
  agent,
  env,
  now,
  codexSessionsRoot,
  ancestorStartPid,
  ancestorProbe,
  writeLine,
}: {
  sessionId?: string;
  agent?: string;
  env: NodeJS.ProcessEnv;
  now: () => number;
  codexSessionsRoot: string;
  ancestorStartPid: number;
  ancestorProbe?: AncestorProbe;
  writeLine: (line: string) => void;
}): Promise<ResolvedSession | null> {
  if (sessionId || agent) {
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
          ? await readCodexMeta({
              sessionId: trimmedSessionId,
              codexSessionsRoot,
            })
          : null,
    };
  }

  // The claude environment wins over the rollout sweep: a codex (or any
  // other process) started from inside a claude session inherits these, and
  // the session doing the work, the one whose cost this checkout explains,
  // is the claude one.
  const claudeSessionId = env.CLAUDE_CODE_SESSION_ID?.trim();
  if (env.CLAUDECODE && claudeSessionId) {
    return { agent: "claude_code", sessionId: claudeSessionId, codexMeta: null };
  }

  // The process tree answers exactly when it can, so it is asked before the
  // machine-wide inference below.
  const ancestor = await resolveCodexSessionFromAncestors({
    startPid: ancestorStartPid,
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
  if (live.kind === "ambiguous") {
    writeLine(
      "Multiple active codex sessions; run with --agent codex --session-id <id>.",
    );
    return null;
  }

  writeLine(
    "Could not find a live coding-agent session on this machine. Pass --agent and --session-id to name one.",
  );
  return null;
}

/** The rollout identity at a known transcript path, best-effort. */
async function readRolloutMeta(
  rolloutPath: string,
): Promise<CodexRolloutMeta | null> {
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

function describeContext({
  context,
  session,
}: {
  context: NonNullable<ReturnType<typeof readSessionContext>>;
  session: ResolvedSession;
}): string {
  const repo = context.repository
    ? `${context.repository.host}/${context.repository.owner}/${context.repository.name}`
    : "(no repository)";
  const branch = context.branch ? `@${context.branch}` : "";
  return `${repo}${branch} for ${session.agent} session ${session.sessionId}`;
}

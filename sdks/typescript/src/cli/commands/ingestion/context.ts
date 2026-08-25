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
 * Which session that is is decided in `context-session.ts`.
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
import { writeSpooledDeclaration } from "@/cli/utils/governance/session-context-spool";
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
  codexSessionIndexPath,
  readCodexThreadNames,
} from "@/cli/utils/governance/codex-session-index";
import { defaultCodexSessionsRoot } from "@/cli/utils/governance/codex-rollout-otlp";
import type { AncestorProbe } from "@/cli/utils/governance/codex-ancestor-session";

import {
  type ResolvedSession,
  resolveSession,
} from "./context-session";

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
    // Under codex's default sandbox this shell has no network, so retrying
    // from here would fail exactly the same way every time. The declaration
    // is queued instead, for the session report to deliver: that runs from
    // the agent's own process, outside the sandbox. The fingerprint stays
    // unwritten, so nothing yet claims this context landed.
    try {
      writeSpooledDeclaration({
        stateDir,
        agent: session.agent,
        sessionId: session.sessionId,
        fingerprint,
        payload,
        now,
      });
      writeLine(
        `Queued ${declared}; it will be sent when this session next reports.`,
      );
    } catch (error) {
      writeLine(
        `LangWatch did not accept the declaration and it could not be queued: ${(error as Error).message}`,
      );
    }
    return;
  }

  try {
    writeFingerprint({ stateFile, fingerprint, now });
  } catch {
    // A fingerprint we cannot record costs one duplicate record next time.
  }
  writeLine(`Declared ${declared}`);
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

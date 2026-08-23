/**
 * `langwatch ingest hook <tool>`: what a coding agent runs at the start and end
 * of every session.
 *
 * Coding agents know exactly which repository, branch and worktree a session is
 * working in and export none of it over telemetry. Each of the three that can
 * run our code inside a session reaches this same command, and each hands it
 * the same three facts on stdin (`session_id`, `cwd`, `hook_event_name`):
 *
 *   - Claude Code and Codex call it directly as a command hook.
 *   - opencode has no command hooks, so the plugin the CLI installs subscribes
 *     to its session event bus and spawns this command with the same payload.
 *
 * The session id each seam reports is the one that agent puts on its own
 * telemetry, so the record this posts joins the session the agent is already
 * describing. So the command runs git itself and posts one small OTLP log
 * record, which is what lets a session's traces be joined to the code they were
 * working on.
 *
 * Where that record goes is `resolveTarget` below, and it is deliberately not
 * the environment alone: Claude Code hands its child processes an environment
 * with every `OTEL_*` variable removed, and Codex hands its hooks one with no
 * exporter variables either, so a hook that trusted them would never send
 * anything from a real session.
 *
 * Two constraints shape every branch below.
 *
 *   - NOTHING ON STDOUT, EVER. A SessionStart hook's stdout is injected into
 *     the user's session context, so one stray line would land in the
 *     model's prompt. Diagnostics go to stderr, and only when `DEBUG`
 *     contains "langwatch" (the CLI's existing debug convention).
 *   - ALWAYS EXIT ZERO, AND SOON. Unparseable input, no repository, no
 *     telemetry configured, a collector that refuses the post: every one of
 *     them returns quietly. Every wait is bounded, stdin included, so a seam
 *     that never closes a pipe cannot leave the hook alive for the rest of the
 *     session. A hook is never allowed to be why a session broke.
 *
 * A failed post deliberately leaves the fingerprint file alone, so the next
 * hook in the same session retries instead of assuming the context landed.
 *
 * Spec: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import {
  type GovernanceConfig,
  loadConfig,
} from "@/cli/utils/governance/config";
import { LANGWATCH_SDK_VERSION } from "@/internal/constants";
import { resolveLogsEndpoint } from "@/internal/endpoint";

import {
  type GitRunner,
  readSessionContext,
  runGitCommand,
} from "./git-context";
import { parseHookInput, readStdin } from "./hook-input";
import {
  defaultStateDir,
  pruneStaleState,
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
  parseOtlpHeaders,
  parseTraceparent,
  sessionContextFingerprint,
} from "@/cli/utils/governance/session-context";

/**
 * What each accepted tool argument means: the agent the record declares, plus
 * the environment variables that agent publishes about the running session.
 * Anything else is a silent no-op.
 *
 * Both variables are per-agent rather than read unconditionally, because a
 * hook process inherits whatever its ancestors exported. A Codex session
 * started from inside a Claude Code session sees `CLAUDE_CODE_SESSION_ID` and
 * `CLAUDE_PROJECT_DIR` in its environment, and reading either would report the
 * wrong session, on the wrong checkout, under the wrong agent.
 *
 * The payload's `cwd` beats `projectDirVar`. Claude Code's payload `cwd` is
 * the harness's own working directory: a `cd` inside the Bash tool never moves
 * it, and a native worktree switch (EnterWorktree) does. `CLAUDE_PROJECT_DIR`
 * stays pinned to the directory the session was launched in, so preferring it
 * would keep reporting the launch checkout after the session moved into a
 * worktree to work on another branch. It remains the fallback for a payload
 * with no `cwd`. Codex and opencode publish no such variable, and their
 * payload `cwd` is already the session's own directory.
 */
const TOOLS: Record<
  string,
  { agent: string; sessionIdVar?: string; projectDirVar?: string }
> = {
  claude_code: {
    agent: "claude_code",
    sessionIdVar: "CLAUDE_CODE_SESSION_ID",
    projectDirVar: "CLAUDE_PROJECT_DIR",
  },
  codex: { agent: "codex" },
  opencode: { agent: "opencode" },
};

/** How long the collector has to accept the record before we give up on it. */
const POST_TIMEOUT_MS = 3_000;

export interface HookCommandOptions {
  /** The agent the hook is running for: `claude-code`, `codex` or `opencode`. */
  tool: string;
  env?: NodeJS.ProcessEnv;
  /** Reads the hook payload. Defaults to draining this process's stdin. */
  readInput?: () => Promise<string>;
  runGit?: GitRunner;
  fetchImpl?: typeof fetch;
  /** Wall clock in milliseconds. */
  now?: () => number;
  /** Where per-session fingerprints live. Defaults under the config home. */
  stateDir?: string;
  /** Claude's live session registry. Defaults under claude's config home. */
  claudeRegistryDir?: string;
  /** Reads the CLI's device config, the fallback telemetry target. */
  readCliConfig?: () => CliTelemetryConfig;
}

/**
 * The part of the device config the hook needs to reach a collector. Both
 * fields are optional here even though the config type requires the control
 * plane: a CLI that was never signed in has neither, and that is the
 * "no telemetry configured" case rather than an error.
 */
type CliTelemetryConfig = Partial<
  Pick<GovernanceConfig, "control_plane_url" | "default_personal_ingest_keys">
>;

/** Where one record goes and what authenticates it. */
interface TelemetryTarget {
  endpoint: string;
  headers: Record<string, string>;
}

/**
 * Emit the session's git context, once per distinct context per session.
 * Never writes stdout, never throws, never exits non-zero.
 */
export async function hookCommand({
  tool,
  env = process.env,
  readInput = readStdin,
  runGit = runGitCommand,
  fetchImpl = fetch,
  now = Date.now,
  stateDir = defaultStateDir(),
  claudeRegistryDir,
  readCliConfig = loadConfig,
}: HookCommandOptions): Promise<void> {
  try {
    await runHook({
      tool,
      env,
      readInput,
      runGit,
      fetchImpl,
      now,
      stateDir,
      claudeRegistryDir,
      readCliConfig,
    });
  } catch (error) {
    debug({ message: `hook failed: ${(error as Error).message}`, env });
  }
}

async function runHook({
  tool,
  env,
  readInput,
  runGit,
  fetchImpl,
  now,
  stateDir,
  claudeRegistryDir,
  readCliConfig,
}: {
  tool: string;
  env: NodeJS.ProcessEnv;
  readInput: () => Promise<string>;
  runGit: GitRunner;
  fetchImpl: typeof fetch;
  now: () => number;
  stateDir: string;
  claudeRegistryDir?: string;
  readCliConfig: () => CliTelemetryConfig;
}): Promise<void> {
  const spec = TOOLS[tool.trim().toLowerCase().replace(/-/g, "_")];
  if (!spec) {
    debug({ message: `no hook for tool '${tool}'`, env });
    return;
  }
  const agent = spec.agent;

  // Checked before stdin is read and before any git work: an agent with no
  // telemetry configured is the common case, and it must cost nothing but this
  // lookup. Reading first would spend the stdin deadline on a pipe the seam
  // may never close, for a payload nothing was ever going to be sent from.
  const target = resolveTarget({ env, agent, readCliConfig });
  if (!target) {
    debug({
      message: "no telemetry target in the environment or the CLI config",
      env,
    });
    return;
  }

  const input = parseHookInput(await readInput());
  const sessionId = firstNonEmpty(
    input.sessionId,
    spec.sessionIdVar ? env[spec.sessionIdVar] : undefined,
  );
  if (!sessionId) {
    debug({ message: "no session id in the hook input or the environment", env });
    return;
  }
  debug({
    message: `${input.hookEventName ?? "hook"} for session ${sessionId}`,
    env,
  });

  const projectDir = spec.projectDirVar ? env[spec.projectDirVar] : undefined;
  const directory = firstNonEmpty(input.cwd, projectDir) ?? process.cwd();
  // The session's own name, as claude itself holds it. The SessionStart
  // payload carries it at start; the live registry is what makes a
  // mid-session /rename observable from the Stop hook, which runs after
  // every turn. Codex and opencode hold no such registry, so for them the
  // record carries no name and the harvest names their sessions instead.
  const name =
    agent === "claude_code"
      ? normalizeSessionName(
          input.sessionTitle ??
            readClaudeSessionName({
              sessionId,
              registryDir:
                claudeRegistryDir ?? defaultClaudeSessionRegistryDir(env),
            }),
        )
      : null;
  // Outside a repository the record can still carry the session's name, and
  // the name alone is worth a post: it is what labels the session before its
  // first prompt. With neither identity nor a name there is nothing to say.
  const context = readSessionContext({ directory, runGit }) ?? {};
  if (!context.repository && !name) {
    debug({
      message: `no git repository with an origin remote at ${directory}`,
      env,
    });
    return;
  }

  const fingerprint = sessionContextFingerprint(context, { name });
  pruneStaleState({ stateDir, now });

  const stateFile = stateFilePath({ stateDir, agent, sessionId });
  if (readFingerprint(stateFile) === fingerprint) {
    debug({ message: "context unchanged since the last post", env });
    return;
  }

  const payload = buildSessionContextLogPayload({
    sessionId,
    agent,
    context,
    // OTLP timestamps are nanoseconds since the epoch, as a string.
    timeUnixNano: `${now()}000000`,
    scopeVersion: LANGWATCH_SDK_VERSION,
    trace: parseTraceparent(env.TRACEPARENT),
    name,
  });

  const posted = await postSessionContext({
    target,
    env,
    payload,
    fetchImpl,
  });
  if (!posted) return;

  try {
    writeFingerprint({ stateFile, fingerprint, now });
  } catch (error) {
    // A fingerprint we cannot record costs one duplicate record next time.
    debug({
      message: `could not record the fingerprint: ${(error as Error).message}`,
      env,
    });
  }
  debug({ message: `posted ${fingerprint}`, env });
}

/**
 * Where to post the record, and what to authenticate it with.
 *
 * The environment is the first source, per the OTel exporter spec, and the
 * only one when the hook is driven by something other than an agent the CLI
 * signed in. It cannot be the only one: Claude Code strips every `OTEL_*`
 * variable from the processes it spawns, hooks included, so a session
 * exporting perfectly well hands its hooks an environment with no endpoint in
 * it at all.
 *
 * The fallback is the CLI's own device config, written by `langwatch login`
 * and `langwatch ingest install`: the control plane the CLI is signed in to,
 * and the ingest key minted for this agent. Null when neither source can name
 * a collector, which is the "no telemetry configured" no-op.
 */
function resolveTarget({
  env,
  agent,
  readCliConfig,
}: {
  env: NodeJS.ProcessEnv;
  agent: string;
  readCliConfig: () => CliTelemetryConfig;
}): TelemetryTarget | null {
  const fromEnv = resolveLogsEndpoint(env);
  if (fromEnv) {
    return {
      endpoint: fromEnv,
      headers: parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
    };
  }

  const config = readCliConfig();
  const base = config.control_plane_url?.trim().replace(/\/+$/, "");
  const secret = config.default_personal_ingest_keys?.[agent]?.secret?.trim();
  if (!base || !secret) return null;

  return {
    endpoint: `${base}/api/otel/v1/logs`,
    headers: { Authorization: `Bearer ${secret}` },
  };
}

async function postSessionContext({
  target,
  env,
  payload,
  fetchImpl,
}: {
  target: TelemetryTarget;
  env: NodeJS.ProcessEnv;
  payload: unknown;
  fetchImpl: typeof fetch;
}): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(target.endpoint, {
      method: "POST",
      headers: {
        ...target.headers,
        // Last, so a headers variable carrying its own content-type cannot
        // mislabel a body we know the encoding of.
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      debug({ message: `collector answered ${response.status}`, env });
      return false;
    }
    return true;
  } catch (error) {
    debug({ message: `post failed: ${(error as Error).message}`, env });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function debug({
  message,
  env,
}: {
  message: string;
  env: NodeJS.ProcessEnv;
}): void {
  if (!env.DEBUG?.includes("langwatch")) return;
  process.stderr.write(`langwatch:hook ${message}\n`);
}

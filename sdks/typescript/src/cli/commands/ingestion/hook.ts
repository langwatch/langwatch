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
 *   - ALWAYS EXIT ZERO. Unparseable input, no repository, no telemetry
 *     configured, a collector that refuses the post: every one of them
 *     returns quietly. A hook is never allowed to be why a session broke.
 *
 * A failed post deliberately leaves the fingerprint file alone, so the next
 * hook in the same session retries instead of assuming the context landed.
 *
 * Spec: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { resolveLogsEndpoint } from "@/cli/telemetry/events";
import {
  type GovernanceConfig,
  loadConfig,
} from "@/cli/utils/governance/config";
import { LANGWATCH_SDK_VERSION } from "@/internal/constants";

import {
  buildSessionContextLogPayload,
  parseGitRemoteUrl,
  parseOtlpHeaders,
  parseTraceparent,
  type SessionContext,
  sessionContextFingerprint,
} from "./session-context";

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
 * `projectDirVar` matters because a session can `cd` away from where it
 * started: Claude Code exports the root it was launched in, so that beats the
 * payload's `cwd`. Codex and opencode publish no such variable, and their
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

/** How long a single git invocation may take. */
const GIT_TIMEOUT_MS = 2_000;

/** Fingerprints for sessions last seen longer ago than this are pruned. */
const STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

/** Runs one git command in a directory. Trimmed stdout, or null on any failure. */
export type GitRunner = (args: { args: string[]; cwd: string }) => string | null;

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

interface HookInput {
  sessionId?: string;
  cwd?: string;
  hookEventName?: string;
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
      readCliConfig,
    });
  } catch (error) {
    debug(`hook failed: ${(error as Error).message}`, env);
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
  readCliConfig,
}: {
  tool: string;
  env: NodeJS.ProcessEnv;
  readInput: () => Promise<string>;
  runGit: GitRunner;
  fetchImpl: typeof fetch;
  now: () => number;
  stateDir: string;
  readCliConfig: () => CliTelemetryConfig;
}): Promise<void> {
  const spec = TOOLS[tool.trim().toLowerCase().replace(/-/g, "_")];
  if (!spec) {
    debug(`no hook for tool '${tool}'`, env);
    return;
  }
  const agent = spec.agent;

  const input = parseHookInput(await readInput());
  const sessionId = firstNonEmpty(
    input.sessionId,
    spec.sessionIdVar ? env[spec.sessionIdVar] : undefined,
  );
  if (!sessionId) {
    debug("no session id in the hook input or the environment", env);
    return;
  }
  debug(`${input.hookEventName ?? "hook"} for session ${sessionId}`, env);

  // Checked before any git work: an agent with no telemetry configured is
  // the common case, and it must cost nothing but this lookup.
  const target = resolveTarget({ env, agent, readCliConfig });
  if (!target) {
    debug("no telemetry target in the environment or the CLI config", env);
    return;
  }

  const projectDir = spec.projectDirVar ? env[spec.projectDirVar] : undefined;
  const directory = firstNonEmpty(projectDir, input.cwd) ?? process.cwd();
  const context = readSessionContext({ directory, runGit });
  if (!context) {
    debug(`no git repository with an origin remote at ${directory}`, env);
    return;
  }

  const fingerprint = sessionContextFingerprint(context);
  pruneStaleState({ stateDir, now });

  const stateFile = path.join(
    stateDir,
    `${stateFileName(`${agent}-${sessionId}`)}.json`,
  );
  if (readFingerprint(stateFile) === fingerprint) {
    debug("context unchanged since the last post", env);
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
  });

  const posted = await postSessionContext({
    target,
    env,
    payload,
    fetchImpl,
  });
  if (!posted) return;

  writeFingerprint({ stateFile, fingerprint, now, env });
  debug(`posted ${fingerprint}`, env);
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

/** The git identity of `directory`, or null when it is not a repository we can name. */
function readSessionContext({
  directory,
  runGit,
}: {
  directory: string;
  runGit: GitRunner;
}): SessionContext | null {
  const remote = runGit({ args: ["remote", "get-url", "origin"], cwd: directory });
  const repository = remote === null ? null : parseGitRemoteUrl(remote);
  if (!repository) return null;

  // Empty on a detached HEAD, which is a state to omit rather than invent.
  const branch = runGit({ args: ["branch", "--show-current"], cwd: directory });
  const worktree = readWorktreeName({ directory, runGit });

  return {
    repository,
    ...(branch ? { branch } : {}),
    ...(worktree ? { worktree } : {}),
  };
}

/**
 * The name of the linked worktree `directory` sits in, or undefined in the
 * main checkout. A linked worktree is exactly the case where the per-worktree
 * git dir differs from the common one; its name is the directory it is
 * checked out into, which is what people call it.
 */
function readWorktreeName({
  directory,
  runGit,
}: {
  directory: string;
  runGit: GitRunner;
}): string | undefined {
  const gitDir = runGit({ args: ["rev-parse", "--git-dir"], cwd: directory });
  const commonDir = runGit({
    args: ["rev-parse", "--git-common-dir"],
    cwd: directory,
  });
  if (!gitDir || !commonDir) return undefined;
  // Both may come back relative to the directory, so resolve before comparing.
  if (path.resolve(directory, gitDir) === path.resolve(directory, commonDir)) {
    return undefined;
  }

  const topLevel = runGit({ args: ["rev-parse", "--show-toplevel"], cwd: directory });
  return topLevel ? path.basename(topLevel) : undefined;
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
      debug(`collector answered ${response.status}`, env);
      return false;
    }
    return true;
  } catch (error) {
    debug(`post failed: ${(error as Error).message}`, env);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function parseHookInput(raw: string): HookInput {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    return {
      sessionId: stringField(record.session_id),
      cwd: stringField(record.cwd),
      hookEventName: stringField(record.hook_event_name),
    };
  } catch {
    // Empty stdin, or something that is not JSON. Neither is worth a word.
    return {};
  }
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/** Drain stdin. A terminal is not a hook payload, so it reads as empty. */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function runGitCommand({ args, cwd }: { args: string[]; cwd: string }): string | null {
  try {
    const result = spawnSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
    });
    if (result.status !== 0 || typeof result.stdout !== "string") return null;
    const output = result.stdout.trim();
    return output === "" ? null : output;
  } catch {
    return null;
  }
}

/** `~/.langwatch/state/session-context`, beside the CLI's own config. */
function defaultStateDir(): string {
  return path.join(os.homedir(), ".langwatch", "state", "session-context");
}

/**
 * One path segment, whatever the agent and session id turn out to contain.
 * The agent is part of the key because session ids are only unique within one
 * agent, and two agents sharing a fingerprint would leave the second silent.
 */
function stateFileName(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128);
}

function readFingerprint(stateFile: string): string | null {
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

function writeFingerprint({
  stateFile,
  fingerprint,
  now,
  env,
}: {
  stateFile: string;
  fingerprint: string;
  now: () => number;
  env: NodeJS.ProcessEnv;
}): void {
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        fingerprint,
        updated_at: new Date(now()).toISOString(),
      }),
      { mode: 0o600 },
    );
  } catch (error) {
    // A fingerprint we cannot record costs one duplicate record next time.
    debug(`could not record the fingerprint: ${(error as Error).message}`, env);
  }
}

/**
 * Drop fingerprints for sessions nobody has touched in a week. Opportunistic:
 * the directory is small, this runs on a hook that is already doing IO, and
 * every failure is beneath mentioning.
 */
function pruneStaleState({
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

function debug(message: string, env: NodeJS.ProcessEnv): void {
  if (!env.DEBUG?.includes("langwatch")) return;
  process.stderr.write(`langwatch:hook ${message}\n`);
}

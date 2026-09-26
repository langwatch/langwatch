/**
 * `langwatch ingest hook <tool>`: what a coding agent runs at the start and end
 * of every session.
 *
 * Coding agents know exactly which repository, branch and worktree a session is
 * working in and export none of it over telemetry. Each of the three that can
 * run our code inside a session reaches this same command, and each hands it
 * the same three facts on stdin (`session_id`, `cwd`, `hook_event_name`):
 *
 *   - Claude Code and Codex call it directly as a command hook, and the
 *     LangWatch Claude Code plugin calls it through its launcher
 *     (`plugins/langwatch/scripts/launch.mjs`), which runs whatever
 *     `langwatch` is installed.
 *   - opencode has no command hooks, so the plugin the CLI installs subscribes
 *     to its session event bus and spawns this command with the same payload.
 *
 * THE CROSS-VERSION CONTRACT. The plugin and the CLI release separately, so a
 * plugin from any version has to run with a CLI from any version. This
 * command and `ingest guidance` therefore accept and ignore options and
 * arguments they do not know (registered with `allowUnknownOption` and
 * `allowExcessArguments` in program.ts) and always exit zero, whatever they
 * were called with. A future plugin passing an argument this build does not
 * understand still gets the session reported; a usage error there would be
 * prose on stderr and a non-zero exit on every session start.
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
import { TOOL_BY_SOURCE_TYPE } from "@/cli/utils/governance/otel-env-block";
import { LANGWATCH_SDK_VERSION } from "@/internal/constants";
import { resolveLogsEndpoint } from "@/internal/endpoint";

import {
  type GitRunner,
  readSessionContext,
  runGitCommand,
} from "./git-context";
import { parseHookInput, readStdin } from "./hook-input";
import {
  readWiredExporterTarget,
  type WiredExporterTarget,
} from "@/cli/utils/governance/wired-target";
import {
  defaultStateDir,
  pruneStaleState,
  readFingerprint,
  stateFilePath,
  writeFingerprint,
} from "@/cli/utils/governance/hook-state";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  type HealOutcome,
  healRevokedIngestKey,
} from "@/cli/utils/governance/ingest-key-heal";
import { drainSessionContextSpool } from "@/cli/utils/governance/session-context-spool";
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
import { langwatchFetch } from "@/internal/http/langwatchFetch";

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
  /**
   * Repairs a personal ingest key the collector rejected: re-mints, rewrites
   * the wiring, returns the target to retry with. Injectable so a test needs
   * no login; defaults to the real healer.
   */
  healRevokedKey?: (params: {
    agent: string;
    rejectedToken: string | undefined;
    rejectedTokenSource?: "cache" | "wiring";
  }) => Promise<HealOutcome>;
  /**
   * Reads the target the AGENT's own exporter is wired to, out of its
   * settings file (#7958). Injectable so a test needs no home directory;
   * defaults to the real reader.
   */
  readWiredTarget?: (params: {
    agent: string;
  }) => WiredExporterTarget | null;
}

/**
 * The part of the device config the hook needs to reach a collector. Every
 * field is optional here even though the config type requires the control
 * plane: a CLI that was never signed in has none of them, and that is the
 * "no telemetry configured" case rather than an error.
 */
export type CliTelemetryConfig = Partial<
  Pick<
    GovernanceConfig,
    "control_plane_url" | "default_personal_ingest_keys" | "tool_project_keys"
  >
>;

/** Where one record goes, what authenticates it, and which source named it. */
export interface TelemetryTarget {
  endpoint: string;
  headers: Record<string, string>;
  /**
   * Which of the three sources named this target. Read on a 401: only a
   * personal key is this device's to replace.
   */
  source: "environment" | "pin" | "personal";
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
  fetchImpl = langwatchFetch,
  now = Date.now,
  stateDir = defaultStateDir(),
  claudeRegistryDir,
  readCliConfig = loadConfig,
  healRevokedKey = healRevokedIngestKey,
  readWiredTarget = readWiredExporterTarget,
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
      healRevokedKey,
      readWiredTarget,
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
  healRevokedKey,
  readWiredTarget,
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
  healRevokedKey: NonNullable<HookCommandOptions["healRevokedKey"]>;
  readWiredTarget: NonNullable<HookCommandOptions["readWiredTarget"]>;
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

  const own = await postOwnSessionContext({
    spec,
    agent,
    sessionId,
    input,
    env,
    runGit,
    fetchImpl,
    now,
    stateDir,
    claudeRegistryDir,
    target,
  });

  // A 401 means the key this device exports with is dead: revoked on the
  // platform, or retired with the session that minted it. The agent's own
  // exporter fails the same way and says nothing, so this is the one place
  // the device finds out. A personal key is re-minted under the current
  // session, the wiring rewritten, the record retried, and the user told to
  // restart the agent, which still holds the old key. A pinned key stops at
  // the report.
  let liveTarget = target;
  if (own.httpStatus === 401 && claimHealWindow({ stateDir, agent, now })) {
    // A pinned key is not this device's to replace: minting a personal one in
    // its place would move the session's telemetry into another project
    // without saying so. The healer declines a pinned tool for that same
    // reason, so the report is the whole repair, and the only person who can
    // make it is the one who pinned the key.
    if (target.source === "pin") {
      debug({
        message: "the pinned ingest key was rejected; not re-minted",
        env,
      });
      if (agent === "claude_code") notifyClaude(PINNED_REJECTED_NOTICE);
    } else {
      await healOrReport({
        agent,
        env,
        target,
        own,
        stateDir,
        healRevokedKey,
        adoptHealed: (healed) => {
          liveTarget = healed;
        },
      });
    }
  }

  // The record above posted with THIS CLI's key. The agent's own exporter
  // posts with whatever its settings file holds, and the two can drift — a
  // live cache over a revoked wiring 401s every span in silence while this
  // hook keeps succeeding (#7958). Probe the wired target once per session
  // so the one process that could notice actually asks.
  await probeWiredExporter({
    agent,
    sessionId,
    env,
    fetchImpl,
    now,
    stateDir,
    cliTarget: liveTarget,
    readWiredTarget,
    healRevokedKey,
  });

  // Whatever this hook had to say about its own directory is said. Anything
  // the agent declared from a shell that could not reach the collector goes
  // out now, last, so the declared checkout is the session's current one.
  await drainSessionContextSpool({
    stateDir,
    now,
    post: async (payload) =>
      (await postSessionContext({ target: liveTarget, env, payload, fetchImpl }))
        .ok,
  });
}

/**
 * Ask the collector whether the AGENT's own exporter can still be heard.
 *
 * One empty batch per session, posted to the endpoint and bearer read out of
 * the agent's settings file — the collector authenticates it like any other
 * post and stores nothing. A 401 there is the agent's every span being
 * refused, so it runs the same heal as the hook's own 401 (re-mint, rewrite
 * the wiring, tell the user to restart); a repair this device cannot make on
 * its own is reported plainly, naming the refusing endpoint.
 *
 * Skipped when the wiring matches the target this hook just posted with —
 * that post already asked this exact question — and when the wiring file
 * names no target at all. An offline probe releases its once-per-session
 * marker so the next hook asks again.
 */
async function probeWiredExporter({
  agent,
  sessionId,
  env,
  fetchImpl,
  now,
  stateDir,
  cliTarget,
  readWiredTarget,
  healRevokedKey,
}: {
  agent: string;
  sessionId: string;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  now: () => number;
  stateDir: string;
  cliTarget: TelemetryTarget;
  readWiredTarget: NonNullable<HookCommandOptions["readWiredTarget"]>;
  healRevokedKey: NonNullable<HookCommandOptions["healRevokedKey"]>;
}): Promise<void> {
  const wired = readWiredTarget({ agent });
  if (!wired) return;
  if (
    wired.endpoint === cliTarget.endpoint &&
    wired.token === bearerOf(cliTarget.headers)
  ) {
    return;
  }
  if (!claimProbeMarker({ stateDir, agent, sessionId })) return;

  const target: TelemetryTarget = {
    endpoint: wired.endpoint,
    headers: { Authorization: `Bearer ${wired.token}` },
    source: "personal",
  };
  const probe = await postSessionContext({
    target,
    env,
    payload: { resourceLogs: [] },
    fetchImpl,
  });
  if (probe.status === null) {
    // Offline says nothing about the key. Ask again next hook.
    releaseProbeMarker({ stateDir, agent, sessionId });
    return;
  }
  if (probe.status === 401) {
    debug({
      message: `the agent's wired ingest key was refused by ${wired.endpoint}`,
      env,
    });
    if (!claimHealWindow({ stateDir, agent, now })) return;
    const outcome = await healRevokedKey({
      agent,
      rejectedToken: wired.token,
      rejectedTokenSource: "wiring",
    }).catch((error: Error) => {
      debug({ message: `wired heal failed: ${error.message}`, env });
      return { status: "failed" } as const;
    });
    if (outcome.status === "declined") {
      releaseHealWindow({ stateDir, agent });
    }
    if (outcome.status === "healed") {
      debug({ message: "the agent's wiring was re-minted and rewritten", env });
      if (agent === "claude_code") notifyClaude(HEAL_NOTICE);
    } else if (outcome.status === "expired") {
      if (agent === "claude_code") notifyClaude(SIGNED_OUT_NOTICE);
    } else if (agent === "claude_code") {
      notifyClaude(wiredRefusedNotice(wired.endpoint));
    }
  }
}

/** What the user reads when the agent's wiring is refused and stays dead. */
function wiredRefusedNotice(endpoint: string): string {
  return `LangWatch: your agent's telemetry is being refused by ${endpoint}, so its spans are not being recorded. Run \`langwatch instrument claude\` to rewire this machine.`;
}

/** Where the once-per-session wired-probe marker lives. */
function probeMarkerFile({
  stateDir,
  agent,
  sessionId,
}: {
  stateDir: string;
  agent: string;
  sessionId: string;
}): string {
  const name = `probe-${agent}-${sessionId}`.replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(stateDir, `${name.slice(0, 128)}.json`);
}

/**
 * Claim this session's one wired probe, by exclusive create like the heal
 * window. Pruned with the rest of the session state after seven days.
 */
function claimProbeMarker(params: {
  stateDir: string;
  agent: string;
  sessionId: string;
}): boolean {
  const file = probeMarkerFile(params);
  try {
    fs.writeFileSync(file, "", { flag: "wx" });
    return true;
  } catch {
    try {
      fs.mkdirSync(params.stateDir, { recursive: true });
      fs.writeFileSync(file, "", { flag: "wx" });
      return true;
    } catch {
      return false;
    }
  }
}

/** Hand the probe back: an offline answer must not spend the session's one ask. */
function releaseProbeMarker(params: {
  stateDir: string;
  agent: string;
  sessionId: string;
}): void {
  try {
    fs.rmSync(probeMarkerFile(params), { force: true });
  } catch {
    // Nothing to release, or nothing we may remove: the next session prunes.
  }
}

/**
 * Re-mint the personal key the collector rejected, rewrite the tool's wiring,
 * retry the record, and tell the user what became of it.
 */
async function healOrReport({
  agent,
  env,
  target,
  own,
  stateDir,
  healRevokedKey,
  adoptHealed,
}: {
  agent: string;
  env: NodeJS.ProcessEnv;
  target: TelemetryTarget;
  own: OwnContextOutcome;
  stateDir: string;
  healRevokedKey: NonNullable<HookCommandOptions["healRevokedKey"]>;
  adoptHealed: (target: TelemetryTarget) => void;
}): Promise<void> {
  const outcome = await healRevokedKey({
    agent,
    rejectedToken: bearerOf(target.headers),
  }).catch((error: Error) => {
    debug({ message: `heal failed: ${error.message}`, env });
    return { status: "failed" } as const;
  });
  // Only an attempt spends the window. A decline is read off the config
  // without touching the platform, so holding the window would cost nothing
  // to repeat and would silence the next 401 that this device CAN repair.
  if (outcome.status === "declined") {
    releaseHealWindow({ stateDir, agent });
  }
  if (outcome.status === "healed") {
    const healed: TelemetryTarget = { ...outcome.target, source: "personal" };
    adoptHealed(healed);
    debug({ message: "ingest key re-minted and wiring rewritten", env });
    await own.retry?.(healed);
    if (agent === "claude_code") notifyClaude(HEAL_NOTICE);
  } else if (outcome.status === "withheld") {
    // The platform did not revoke this key itself, so a person may have.
    // The device stays dead until a person sets it up again, so the only
    // repair is to say so.
    debug({ message: "ingest key was revoked by a person; not re-minted", env });
    if (agent === "claude_code") notifyClaude(REVOKED_NOTICE);
  } else if (outcome.status === "expired") {
    // The platform refused the device's session, so nothing here can mint.
    // Without this line the session ends with telemetry silently going
    // nowhere and no sign of why.
    debug({ message: "device session is signed out; not re-minted", env });
    if (agent === "claude_code") notifyClaude(SIGNED_OUT_NOTICE);
  }
}

/** What the user reads after a heal; Claude Code shows `systemMessage`. */
const HEAL_NOTICE =
  "LangWatch: the ingest key this machine exports with had been revoked. A new key was minted and wired; restart Claude Code so telemetry resumes.";

/** What the user reads when the key was revoked on purpose and stays dead. */
const REVOKED_NOTICE =
  "LangWatch: the ingest key this machine exports with was revoked and was not replaced. Run `langwatch instrument claude` to set this machine up again.";

/** What the user reads when the key this tool is pinned to stops working. */
const PINNED_REJECTED_NOTICE =
  "LangWatch: the ingest key this machine is pinned to was rejected, so telemetry is not being recorded. A pinned key is never replaced automatically. Run `langwatch instrument claude --key <ingest-key>` or `--project <id>` with a live key.";

/** What the user reads when the device is signed out of LangWatch. */
const SIGNED_OUT_NOTICE =
  "LangWatch: this machine is signed out, so its ingest key could not be checked or replaced and telemetry is not being recorded. Run `langwatch login --device` and then `langwatch instrument claude`.";

/** How long one heal attempt stands before the hook tries again. */
const HEAL_THROTTLE_MS = 10 * 60 * 1000;

function healStateFile({
  stateDir,
  agent,
}: {
  stateDir: string;
  agent: string;
}): string {
  return path.join(stateDir, `heal-${agent}.json`);
}

/**
 * Take this agent's heal window, or report that another attempt holds it.
 *
 * The window is claimed before the mint and with an exclusive create, so two
 * sessions that start together and read the same 401 cannot both ask the
 * platform to replace the same dead key: the second finds the first one's
 * claim and stands down.
 *
 * A claim older than the window belonged to a run that died mid-heal, and
 * replacing it is a delete followed by a create, which two hooks holding the
 * same stale reading could interleave into two winners. So the right to
 * replace it is itself an exclusive create: whoever lands the takeover marker
 * does the delete, and the hooks that lose the marker stand down instead of
 * racing it. The marker is held across two filesystem calls rather than the
 * whole heal, so a run has to die inside those to strand one, and its own
 * staleness is bounded by the same window.
 *
 * A state directory that cannot be written claims nothing and costs one extra
 * attempt, the same trade the fingerprints make.
 */
function claimHealWindow({
  stateDir,
  agent,
  now,
}: {
  stateDir: string;
  agent: string;
  now: () => number;
}): boolean {
  const file = healStateFile({ stateDir, agent });
  const marker = `${file}.takeover`;
  const claim = JSON.stringify({ attemptedAt: now() });
  const write = (at: string): "claimed" | "taken" | "unwritable" => {
    try {
      fs.writeFileSync(at, claim, { flag: "wx" });
      return "claimed";
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EEXIST"
        ? "taken"
        : "unwritable";
    }
  };

  try {
    fs.mkdirSync(stateDir, { recursive: true });
  } catch {
    return true;
  }

  if (write(file) !== "taken") return true;
  if (standingClaimIsFresh({ file, now })) return false;
  if (!claimTakeover({ marker, now, write })) return false;
  try {
    fs.rmSync(file, { force: true });
    return write(file) !== "taken";
  } finally {
    try {
      fs.rmSync(marker, { force: true });
    } catch {
      // The next stale claim reclaims it by its own age; a marker left behind
      // costs this device one heal window, never the heal itself.
    }
  }
}

/** Whether this hook won the right to replace a claim it read as stale. */
function claimTakeover({
  marker,
  now,
  write,
}: {
  marker: string;
  now: () => number;
  write: (at: string) => "claimed" | "taken" | "unwritable";
}): boolean {
  if (write(marker) !== "taken") return true;
  if (standingClaimIsFresh({ file: marker, now })) return false;
  try {
    fs.rmSync(marker, { force: true });
  } catch {
    return false;
  }
  return write(marker) !== "taken";
}

/** Whether the claim on disk is young enough to still stand for its run. */
function standingClaimIsFresh({
  file,
  now,
}: {
  file: string;
  now: () => number;
}): boolean {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const attemptedAt = Number((JSON.parse(raw) as { attemptedAt?: number }).attemptedAt);
    return Number.isFinite(attemptedAt) && now() - attemptedAt < HEAL_THROTTLE_MS;
  } catch {
    return false;
  }
}

/** Hand the window back, for an outcome that never reached the platform. */
function releaseHealWindow({
  stateDir,
  agent,
}: {
  stateDir: string;
  agent: string;
}): void {
  try {
    fs.rmSync(healStateFile({ stateDir, agent }), { force: true });
  } catch {
    // A claim we cannot clear stands for the window, costing one repair.
  }
}

/** The bearer token in a target's headers, without the scheme. */
function bearerOf(headers: Record<string, string>): string | undefined {
  const value = headers.Authorization ?? headers.authorization;
  const token = value?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return undefined;
  return token;
}

/**
 * The one line the hook ever writes to stdout. Claude Code reads a hook's
 * stdout as JSON and shows `systemMessage` to the user; it carries no
 * `additionalContext`, so nothing reaches the model.
 */
function notifyClaude(message: string): void {
  process.stdout.write(`${JSON.stringify({ systemMessage: message })}\n`);
}

/**
 * Post the context of the directory this hook runs in. Every reason not to
 * post is a debug line and a return: a hook is never allowed to be why a
 * session broke.
 */
async function postOwnSessionContext({
  spec,
  agent,
  sessionId,
  input,
  env,
  runGit,
  fetchImpl,
  now,
  stateDir,
  claudeRegistryDir,
  target,
}: {
  spec: (typeof TOOLS)[string];
  agent: string;
  sessionId: string;
  input: ReturnType<typeof parseHookInput>;
  env: NodeJS.ProcessEnv;
  runGit: GitRunner;
  fetchImpl: typeof fetch;
  now: () => number;
  stateDir: string;
  claudeRegistryDir?: string;
  target: TelemetryTarget;
}): Promise<OwnContextOutcome> {
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
    return { httpStatus: null };
  }

  const fingerprint = sessionContextFingerprint(context, { name });
  pruneStaleState({ stateDir, now });

  const stateFile = stateFilePath({ stateDir, agent, sessionId });
  if (readFingerprint(stateFile) === fingerprint) {
    debug({ message: "context unchanged since the last post", env });
    return { httpStatus: null };
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

  const recordFingerprint = (): void => {
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
  };

  const posted = await postSessionContext({
    target,
    env,
    payload,
    fetchImpl,
  });
  if (!posted.ok) {
    return {
      httpStatus: posted.status,
      retry: async (healed) => {
        const again = await postSessionContext({
          target: healed,
          env,
          payload,
          fetchImpl,
        });
        if (again.ok) recordFingerprint();
        return again.ok;
      },
    };
  }

  recordFingerprint();
  return { httpStatus: posted.status };
}

/**
 * How the hook's own post went: the collector's status (null when nothing
 * was sent), and, after a rejection, a way to send the same record again to
 * a healed target and record its fingerprint on success.
 */
interface OwnContextOutcome {
  httpStatus: number | null;
  retry?: (target: TelemetryTarget) => Promise<boolean>;
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
 * The fallback is the CLI's own device config, written by `langwatch login`,
 * `langwatch instrument` and `langwatch ingest install`. It holds two
 * credentials for one agent and they are read in the order `instrument`
 * chooses between them: the tool's pin first (`tool_project_keys`, with the
 * endpoint override it may carry), then the personal ingest key minted for
 * this agent under the control plane the CLI is signed in to. Null when no
 * source can name a collector, which is the "no telemetry configured" no-op.
 *
 * Shared with `langwatch ingest context`, which posts the same record from
 * the same sources when the agent declares its context itself.
 */
export function resolveTarget({
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
      source: "environment",
    };
  }

  const config = readCliConfig();
  const controlPlane = config.control_plane_url;

  // `langwatch instrument <tool> --key/--project` pins the tool to one ingest
  // key, and while that pin stands the personal path is neither consulted nor
  // rewritten, so a pinned tool has no personal key to read here. The pin is
  // kept per tool rather than per agent, hence the slug translation. It wins
  // over the personal key, and the endpoint it carries wins with it, because a
  // pin is an explicit choice of where this tool's data goes;
  // `installTelemetryWiring` picks the same credential for the env block, so
  // the record posted here and the traces the agent exports land together.
  const pinned = config.tool_project_keys?.[TOOL_BY_SOURCE_TYPE[agent] ?? agent];
  const pinnedSecret = pinned?.secret?.trim();
  if (pinnedSecret) {
    const pinnedEndpoint = logsEndpointUnder(pinned?.endpoint ?? controlPlane);
    // A pin with nowhere to send is still a pin: falling through to the
    // personal key would post this tool's context into another project.
    if (!pinnedEndpoint) return null;
    return {
      endpoint: pinnedEndpoint,
      headers: { Authorization: `Bearer ${pinnedSecret}` },
      source: "pin",
    };
  }

  const endpoint = logsEndpointUnder(controlPlane);
  const secret = config.default_personal_ingest_keys?.[agent]?.secret?.trim();
  if (!endpoint || !secret) return null;

  return {
    endpoint,
    headers: { Authorization: `Bearer ${secret}` },
    source: "personal",
  };
}

/** The OTLP logs path under a control plane base, or null when there is none. */
function logsEndpointUnder(base: string | undefined): string | null {
  const normalized = base?.trim().replace(/\/+$/, "");
  return normalized ? `${normalized}/api/otel/v1/logs` : null;
}

export async function postSessionContext({
  target,
  env,
  payload,
  fetchImpl,
}: {
  target: TelemetryTarget;
  env: NodeJS.ProcessEnv;
  payload: unknown;
  fetchImpl: typeof fetch;
}): Promise<{ ok: boolean; status: number | null }> {
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
      return { ok: false, status: response.status };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    debug({ message: `post failed: ${(error as Error).message}`, env });
    return { ok: false, status: null };
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

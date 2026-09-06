/**
 * `langwatch ingest hook <tool>`: posts one small OTLP log record joining a
 * coding session's traces to the code it worked on. NOTHING ON STDOUT EVER;
 * ALWAYS EXIT ZERO.
 */

import { type GovernanceConfig, loadConfig } from "@/cli/utils/governance/config";
import { LANGWATCH_SDK_VERSION } from "@/internal/constants";
import { resolveLogsEndpoint } from "@/internal/endpoint";

import { type GitRunner, readSessionContext, runGitCommand } from "./git-context";
import { parseHookInput, readStdin } from "./hook-input";
import {
  defaultStateDir,
  pruneStaleState,
  readFingerprint,
  stateFilePath,
  writeFingerprint,
} from "@/cli/utils/governance/hook-state";
import * as fs from "node:fs";
import * as path from "node:path";

import { type HealOutcome, healRevokedIngestKey } from "@/cli/utils/governance/ingest-key-heal";
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

/**
 * What each accepted tool argument means: the agent, plus the environment
 * variables it publishes. The payload's `cwd` beats `projectDirVar`, which
 * stays pinned to the launch directory.
 */
const TOOLS: Record<string, { agent: string; sessionIdVar?: string; projectDirVar?: string }> = {
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
  }) => Promise<HealOutcome>;
}

/**
 * The part of the device config the hook needs to reach a collector. Both
 * fields are optional here: a CLI never signed in has neither, which is
 * "no telemetry configured" rather than an error.
 */
export type CliTelemetryConfig = Partial<
  Pick<GovernanceConfig, "control_plane_url" | "default_personal_ingest_keys">
>;

/** Where one record goes and what authenticates it. */
export interface TelemetryTarget {
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
  healRevokedKey = healRevokedIngestKey,
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
  // platform, rotated by an older server, evicted by the cap. The agent's own
  // exporter fails the same way and says nothing, so this is the one place
  // the device finds out. Re-mint, rewrite the wiring, retry, and tell the
  // user to restart the agent: the running process still holds the old key.
  let liveTarget = target;
  if (own.httpStatus === 401 && claimHealWindow({ stateDir, agent, now })) {
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
      liveTarget = outcome.target;
      debug({ message: "ingest key re-minted and wiring rewritten", env });
      await own.retry?.(outcome.target);
      if (agent === "claude_code") notifyClaude(HEAL_NOTICE);
    } else if (outcome.status === "withheld") {
      // The platform did not revoke this key itself, so a person may have.
      // The device stays dead until a person sets it up again, so the only
      // repair is to say so.
      debug({ message: "ingest key was revoked by a person; not re-minted", env });
      if (agent === "claude_code") notifyClaude(REVOKED_NOTICE);
    }
  }

  // Whatever this hook had to say about its own directory is said. Anything
  // the agent declared from a shell that could not reach the collector goes
  // out now, last, so the declared checkout is the session's current one.
  await drainSessionContextSpool({
    stateDir,
    now,
    post: async (payload) =>
      (await postSessionContext({ target: liveTarget, env, payload, fetchImpl })).ok,
  });
}

/** What the user reads after a heal; Claude Code shows `systemMessage`. */
const HEAL_NOTICE =
  "LangWatch: the ingest key this machine exports with had been revoked. A new key was minted and wired; restart Claude Code so telemetry resumes.";

/** What the user reads when the key was revoked on purpose and stays dead. */
const REVOKED_NOTICE =
  "LangWatch: the ingest key this machine exports with was revoked and was not replaced. Run `langwatch instrument claude` to set this machine up again.";

/** How long one heal attempt stands before the hook tries again. */
const HEAL_THROTTLE_MS = 10 * 60 * 1000;

function healStateFile({ stateDir, agent }: { stateDir: string; agent: string }): string {
  return path.join(stateDir, `heal-${agent}.json`);
}

/**
 * Take this agent's heal window, or report another attempt holds it, via an
 * exclusive create so two sessions reading the same 401 can't both re-mint.
 * A stale claim is replaced through its own exclusive takeover marker.
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
      return (error as NodeJS.ErrnoException).code === "EEXIST" ? "taken" : "unwritable";
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
function standingClaimIsFresh({ file, now }: { file: string; now: () => number }): boolean {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const attemptedAt = Number((JSON.parse(raw) as { attemptedAt?: number }).attemptedAt);
    return Number.isFinite(attemptedAt) && now() - attemptedAt < HEAL_THROTTLE_MS;
  } catch {
    return false;
  }
}

/** Hand the window back, for an outcome that never reached the platform. */
function releaseHealWindow({ stateDir, agent }: { stateDir: string; agent: string }): void {
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
              registryDir: claudeRegistryDir ?? defaultClaudeSessionRegistryDir(env),
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
 * Where to post the record. The environment is the first source, but can't
 * be the only one: Claude Code strips `OTEL_*` from hooks it spawns. Falls
 * back to the CLI's own device config; null when neither names a collector.
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

function debug({ message, env }: { message: string; env: NodeJS.ProcessEnv }): void {
  if (!env.DEBUG?.includes("langwatch")) return;
  process.stderr.write(`langwatch:hook ${message}\n`);
}

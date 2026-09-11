/**
 * `langwatch ollama <args...>` — run an Ollama command with every model call
 * it makes reported to LangWatch. Ollama has no telemetry configuration, so
 * the capture is a loopback proxy pointed at by the child's `OLLAMA_HOST`
 * alone: nothing is written to disk and nothing outlives the command.
 */

import { spawn } from "node:child_process";

import { lwTag } from "../utils/governance/brand";
import { type GovernanceConfig, isLoggedIn, loadConfig } from "../utils/governance/config";
import {
  createDiscardingSpanEmitter,
  createOllamaSpanEmitter,
  type OllamaSpanEmitter,
} from "../utils/governance/ollama-emitter";
import {
  DEFAULT_OLLAMA_ORIGIN,
  resolveUpstreamOrigin,
  startOllamaCaptureProxy,
} from "../utils/governance/ollama-proxy";
import { otlpEndpointFor, resolveIngestionCredential } from "../utils/governance/telemetry-refresh";
import { normalizeEndpoint } from "../../internal/endpoint";

/** Ingestion source slug for calls captured from a local Ollama server. */
export const OLLAMA_SOURCE_TYPE = "ollama";

/** The config key the project pin and the cached personal key live under. */
export const OLLAMA_TOOL = "ollama";

const KEY_ENV_VAR = "LANGWATCH_INGEST_KEY";

/** How long the reachability check waits before it gives up and warns. */
const PREFLIGHT_TIMEOUT_MS = 1_500;

export interface OllamaCaptureScope {
  /** Full OTLP traces URL the spans are POSTed to. */
  tracesEndpoint: string;
  token: string;
  /** How the destination is named in the one line printed at startup. */
  label: string;
}

/**
 * Where this session's calls are reported, or null when the device has no
 * scope to report them to. A pin is an explicit earlier decision and wins; a
 * pasted key is the shared-machine path and needs no login; the signed-in
 * personal workspace is the default.
 */
export async function resolveOllamaCaptureScope({
  cfg,
  env = process.env,
}: {
  cfg: GovernanceConfig;
  env?: NodeJS.ProcessEnv;
}): Promise<OllamaCaptureScope | null> {
  const pinned = cfg.tool_project_keys?.[OLLAMA_TOOL];
  const pastedKey = env[KEY_ENV_VAR]?.trim();

  if (!pinned?.secret && pastedKey) {
    return {
      tracesEndpoint: `${otlpEndpointFor(cfg.control_plane_url)}/v1/traces`,
      token: pastedKey,
      label: `the ingest key in ${KEY_ENV_VAR}`,
    };
  }

  if (!pinned?.secret && !isLoggedIn(cfg)) return null;

  const credential = await resolveIngestionCredential({
    cfg,
    tool: OLLAMA_TOOL,
    sourceType: OLLAMA_SOURCE_TYPE,
  });
  return {
    tracesEndpoint: `${normalizeEndpoint(credential.endpoint)}/v1/traces`,
    token: credential.token,
    label:
      credential.scope === "project"
        ? `project ${credential.projectLabel ?? "(pinned)"}`
        : "your personal workspace",
  };
}

/**
 * The one Ollama command this wrapper cannot run: `ollama serve` reads the
 * same `OLLAMA_HOST` the wrapper points at its own proxy, so the server would
 * bind the proxy's address or fail trying. Refusing by name is clearer.
 */
function isServeInvocation(args: string[]): boolean {
  return args.find((arg) => !arg.startsWith("-")) === "serve";
}

function write(stream: NodeJS.WriteStream, message: string): void {
  stream.write(`${lwTag()} ${message}\n`);
}

/** Whether the configured Ollama server answers at all, for the warning. */
async function upstreamAnswers(origin: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS);
  try {
    await fetch(`${origin}/api/version`, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function ollamaCommand(args: string[]): Promise<void> {
  if (isServeInvocation(args)) {
    write(
      process.stderr,
      "`langwatch ollama serve` is not supported: the wrapper points OLLAMA_HOST at its own capture proxy, " +
        "and the server would try to listen there. Run `ollama serve` directly, then wrap the commands that talk to it.",
    );
    process.exit(1);
  }

  const cfg = loadConfig();
  const upstreamOrigin = resolveUpstreamOrigin(process.env.OLLAMA_HOST);

  let scope: OllamaCaptureScope | null = null;
  try {
    scope = await resolveOllamaCaptureScope({ cfg });
  } catch (error) {
    write(
      process.stderr,
      `could not resolve a LangWatch scope (${(error as Error).message}); running ollama uncaptured.`,
    );
  }

  const emitter: OllamaSpanEmitter = scope
    ? createOllamaSpanEmitter({ tracesEndpoint: scope.tracesEndpoint, token: scope.token })
    : createDiscardingSpanEmitter();

  if (scope) {
    write(process.stdout, `capturing ollama calls to ${scope.label}.`);
  } else {
    write(
      process.stderr,
      `not capturing: run \`langwatch login --device\`, or set ${KEY_ENV_VAR} to an ingest key. Running ollama anyway.`,
    );
  }

  if (!(await upstreamAnswers(upstreamOrigin))) {
    write(
      process.stderr,
      `no ollama server answered at ${upstreamOrigin}${
        upstreamOrigin === DEFAULT_OLLAMA_ORIGIN ? "" : " (from OLLAMA_HOST)"
      }. Starting anyway; ollama will report the failure itself.`,
    );
  }

  const proxy = await startOllamaCaptureProxy({ upstreamOrigin, emitter });

  const child = spawn("ollama", args, {
    stdio: "inherit",
    env: { ...process.env, OLLAMA_HOST: proxy.url },
    shell: process.platform === "win32",
  });

  let spawnFailed = false;
  child.on("error", (error: NodeJS.ErrnoException) => {
    spawnFailed = true;
    if (error.code === "ENOENT") {
      write(
        process.stderr,
        "ollama is not installed, or not on your PATH. Get it from https://ollama.com/download.",
      );
      return;
    }
    write(process.stderr, `could not run ollama: ${error.message}`);
  });

  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
  });

  await proxy.close();
  await emitter.close();

  const sent = emitter.sent();
  if (sent > 0) {
    write(process.stdout, `reported ${sent} ollama ${sent === 1 ? "call" : "calls"}.`);
  }

  process.exit(spawnFailed && exitCode === 1 ? 127 : exitCode);
}

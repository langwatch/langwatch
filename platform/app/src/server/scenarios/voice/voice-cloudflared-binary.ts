/**
 * Puts the `cloudflared` binary on PATH before the vendored `@langwatch/scenario`
 * SDK spawns it.
 *
 * WHY this exists. The SDK's own `openTwilioTunnel` (cloudflared provider) opens
 * its quick tunnel with a BARE-command spawn — `spawn("cloudflared", ["tunnel",
 * "--url", ..., "--no-autoupdate"])` — a plain PATH lookup. It does NOT use the
 * npm `cloudflared` package's `Tunnel` class, does NOT read a `CLOUDFLARED_BIN`
 * env, and does NOT call the package's `install()`. So even though
 * `onlyBuiltDependencies: [cloudflared]` in `pnpm-workspace.yaml` correctly
 * downloads the binary into the npm package's own `bin/` at image-build time,
 * nothing puts that directory on PATH for the child the SDK spawns, and the dial
 * fails with `spawn cloudflared ENOENT`. The `voice-triage-survey` dev worktree
 * only "worked" because it has an unrelated system `/usr/local/bin/cloudflared`
 * on PATH — CI and prod have neither that nor a system cloudflared in
 * `Dockerfile.runtime`.
 *
 * This module bridges that gap: it locates the npm package's binary (installing
 * it as a fallback only if the build-time download did not run) and prepends its
 * directory to PATH, so the SDK's later bare spawn resolves it. The common case
 * is cheap — the binary is already on disk from the build-time postinstall, so
 * this only reads a path and prepends it; the `install()` call is a fallback for
 * an image that shipped without the binary.
 *
 * WHERE the `cloudflared` npm package lives. It is a prod dependency of the
 * workspace `langwatch` SDK package (`sdks/typescript/package.json`), NOT of
 * `@langwatch/scenario`. `@langwatch/web` depends on `langwatch: workspace:*`,
 * so that edge survives the prod-filtered install (`--prod --filter
 * "@langwatch/web..."`), and under pnpm's strict `node_modules` layout the
 * binary is only resolvable by scoping the require to where `langwatch`
 * resolved. So the resolution below searches scopes in order — the `langwatch`
 * SDK scope first (the real dependency edge), then `@langwatch/scenario` as a
 * secondary fallback in case packaging changes, then the app's own scope.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * The slice of the npm `cloudflared` package this module drives: the resolved
 * binary path and the lazy installer. Both are re-exported from the package
 * root (`lib/lib.js`), the same surface the SDK's own CLI reaches via
 * `import("cloudflared")`.
 */
export interface CloudflaredModule {
  /** Absolute path the binary lives at: `<pkg root>/bin/cloudflared`. */
  bin: string;
  /** Downloads the architecture-appropriate binary to `to`. */
  install: (to: string, version?: string) => Promise<string>;
}

/**
 * How long the fallback download may take before it is abandoned. A hung
 * download must not park worker boot forever; the binary is normally already
 * present from the build-time postinstall, so this only bounds the rare
 * fallback fetch.
 */
export const CLOUDFLARED_INSTALL_TIMEOUT_MS_DEFAULT = 60_000;

/** The dependencies {@link ensureCloudflaredOnPath} is built from. Injected in
 *  tests so a fake resolver/installer/probe stands in for the real filesystem,
 *  network and PATH. */
export interface EnsureCloudflaredOnPathDeps {
  /** Cheap probe: is `cloudflared` already runnable on PATH? Defaults to a
   *  `spawnSync("cloudflared", ["--version"])`. */
  isOnPath?: () => boolean;
  /** Resolves the npm `cloudflared` package's binary path and installer.
   *  Defaults to a require scoped to where the `langwatch` SDK resolved (the
   *  real dependency edge), falling back to `@langwatch/scenario` then the app
   *  scope. */
  resolveModule?: () => CloudflaredModule;
  /** Whether the binary already exists on disk. Defaults to `fs.existsSync`. */
  binaryExists?: (binPath: string) => boolean;
  /** The env whose `PATH` is prepended. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** How long the fallback download may run before it is abandoned. */
  installTimeoutMs?: number;
}

/**
 * Thrown when `cloudflared` is neither on PATH nor installable: the package
 * could not be resolved, the fallback download failed or timed out, or it
 * reported success yet left no binary. A plain {@link Error} (not a
 * `HandledError`): the remedy is an OPERATOR action (ship the binary in the
 * image, fix egress to the GitHub release), not one a customer can take, so per
 * ADR-045 it degrades to a generic "unknown" plus a trace id at the API
 * boundary — matching `VoicePublicBaseUrlMissingError`. The message carries the
 * full cause chain (the underlying ENOENT/EACCES/HTTP text) so the eventual
 * run error names the real failure rather than "tunnel binary unavailable".
 */
export class VoiceTunnelBinaryError extends Error {
  constructor(summary: string, cause?: unknown) {
    const causeText = cause === undefined ? "" : `: ${describeCause(cause)}`;
    super(`cloudflared tunnel binary unavailable: ${summary}${causeText}`);
    this.name = "VoiceTunnelBinaryError";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/** Flatten an error (and any nested `cause`) into a single readable string. */
function describeCause(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);
  const nested = (cause as { cause?: unknown }).cause;
  const head = cause.message.length > 0 ? cause.message : cause.name;
  return nested === undefined ? head : `${head}: ${describeCause(nested)}`;
}

/** Default on-PATH probe: `cloudflared --version` exits 0 iff it is runnable. */
function defaultIsOnPath(): boolean {
  try {
    const result = spawnSync("cloudflared", ["--version"], {
      stdio: "ignore",
    });
    return result.error === undefined && result.status === 0;
  } catch {
    return false;
  }
}

/**
 * One named candidate scope to search for the npm `cloudflared` package. The
 * `require` is `null` when the scope's own anchor did not resolve (e.g. the
 * `langwatch` specifier itself threw), so it is simply skipped.
 */
export interface CloudflaredScope {
  /** Human-readable scope name, surfaced in the all-scopes-failed error. */
  name: string;
  /** The require to resolve/load `cloudflared` from, or `null` if the scope's
   *  anchor did not resolve. */
  require: NodeRequire | null;
}

/**
 * Loads the npm `cloudflared` package's `bin`/`install` from the first
 * {@link CloudflaredScope} that can resolve `cloudflared/package.json`. Resolving
 * the `package.json` is the robust presence check; the package root
 * (`lib/lib.js`) then re-exports `bin` + `install`. Throws naming every tried
 * scope when none can resolve it.
 */
export function resolveCloudflaredFromScopes(
  scopes: CloudflaredScope[],
): CloudflaredModule {
  for (const scope of scopes) {
    if (scope.require === null) continue;
    try {
      scope.require.resolve("cloudflared/package.json");
    } catch {
      continue;
    }
    const mod = scope.require("cloudflared") as Partial<CloudflaredModule>;
    if (typeof mod.bin !== "string" || typeof mod.install !== "function") {
      throw new Error("the cloudflared package did not export bin/install");
    }
    return { bin: mod.bin, install: mod.install };
  }
  throw new Error(
    `could not resolve the cloudflared package from any of: ${scopes
      .map((scope) => scope.name)
      .join(", ")}`,
  );
}

/**
 * Resolves the npm `cloudflared` package's `bin`/`install`, searching scopes in
 * dependency-truth order: the `langwatch` SDK scope (which actually depends on
 * `cloudflared`), then `@langwatch/scenario` as a secondary fallback, then the
 * app's own scope. Under pnpm's strict `node_modules` layout `cloudflared` is
 * only reachable from the `langwatch` scope, so that scope must be tried first.
 */
function defaultResolveModule(): CloudflaredModule {
  const appRequire = createRequire(import.meta.url);
  const scopeFrom = (specifier: string): NodeRequire | null => {
    try {
      return createRequire(appRequire.resolve(specifier));
    } catch {
      // Anchor specifier not resolvable from here; skip this scope.
      return null;
    }
  };
  return resolveCloudflaredFromScopes([
    { name: "langwatch", require: scopeFrom("langwatch") },
    { name: "@langwatch/scenario", require: scopeFrom("@langwatch/scenario") },
    { name: "app scope", require: appRequire },
  ]);
}

/** Reject once `ms` elapses, so a hung download cannot park worker boot. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Prepend `dir` to `env.PATH`, unless it is already the leading entry. */
function prependToPath(env: NodeJS.ProcessEnv, dir: string): void {
  const current = env.PATH ?? "";
  if (current.split(path.delimiter)[0] === dir) return;
  env.PATH = current ? `${dir}${path.delimiter}${current}` : dir;
}

/**
 * Downloads the binary as a fallback if it is missing on disk. No-op when it is
 * already present (the common case: the build-time postinstall put it there).
 * Throws {@link VoiceTunnelBinaryError} on a failed/timed-out download, or when
 * the download reports success yet leaves no binary.
 */
async function ensureBinaryPresent(
  mod: CloudflaredModule,
  binaryExists: (binPath: string) => boolean,
  installTimeoutMs: number,
): Promise<void> {
  if (binaryExists(mod.bin)) return;
  try {
    await withTimeout(
      mod.install(mod.bin),
      installTimeoutMs,
      `cloudflared install timed out after ${installTimeoutMs}ms`,
    );
  } catch (error) {
    throw new VoiceTunnelBinaryError(
      `failed to install the cloudflared binary to ${mod.bin}`,
      error,
    );
  }
  if (!binaryExists(mod.bin)) {
    throw new VoiceTunnelBinaryError(
      `cloudflared install reported success but ${mod.bin} is still missing`,
    );
  }
}

/**
 * Ensures a `cloudflared` binary is resolvable on PATH for the SDK's later bare
 * spawn. No-op when one is already on PATH. Otherwise resolves the npm package,
 * downloads the binary as a fallback if it is missing, and prepends its
 * directory to PATH. Throws {@link VoiceTunnelBinaryError} (carrying the cause
 * chain) on any failure — the worker boot catches it and threads the reason
 * into the run's error.
 */
export async function ensureCloudflaredOnPath(
  deps: EnsureCloudflaredOnPathDeps = {},
): Promise<void> {
  const isOnPath = deps.isOnPath ?? defaultIsOnPath;
  const env = deps.env ?? process.env;

  // A system cloudflared already on PATH (some dev boxes, some images) needs
  // nothing further — and this short-circuit costs one cheap subprocess.
  if (isOnPath()) return;

  const resolveModule = deps.resolveModule ?? defaultResolveModule;
  const binaryExists = deps.binaryExists ?? fs.existsSync;
  const installTimeoutMs =
    deps.installTimeoutMs ?? CLOUDFLARED_INSTALL_TIMEOUT_MS_DEFAULT;

  let mod: CloudflaredModule;
  try {
    mod = resolveModule();
  } catch (error) {
    throw new VoiceTunnelBinaryError(
      "could not resolve the cloudflared package",
      error,
    );
  }

  await ensureBinaryPresent(mod, binaryExists, installTimeoutMs);
  prependToPath(env, path.dirname(mod.bin));
}

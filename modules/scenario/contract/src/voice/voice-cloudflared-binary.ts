/**
 * Puts the `cloudflared` binary on PATH before the SDK's bare PATH-lookup
 * spawn dials `ENOENT` (it never reads `CLOUDFLARED_BIN` or calls `install()`).
 * Searches scopes in dependency-edge order: `cloudflared` is `langwatch`'s dep, not scenario's.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * The slice of the npm `cloudflared` package this module drives: the resolved
 * binary path and the lazy installer, both re-exported from the package root
 * (`lib/lib.js`) — the same surface the SDK's own CLI reaches via `import("cloudflared")`.
 */
export interface CloudflaredModule {
  /** Absolute path the binary lives at: `<pkg root>/bin/cloudflared`. */
  bin: string;
  /** Downloads the architecture-appropriate binary to `to`. */
  install: (to: string, version?: string) => Promise<string>;
}

/**
 * How long the fallback download may take before it's abandoned. A hung
 * download must not park worker boot forever — the binary is normally
 * already present from the build-time postinstall, so this bounds only the rare fallback fetch.
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
  /** The env whose `PATH` is prepended. */
  env: NodeJS.ProcessEnv;
  /** How long the fallback download may run before it is abandoned. */
  installTimeoutMs?: number;
}

/**
 * Thrown when `cloudflared` is neither on PATH nor installable. A plain
 * {@link Error}, not `HandledError` — per ADR-045 the remedy (ship the binary,
 * fix GitHub egress) is an OPERATOR action, so it degrades to "unknown" at the boundary.
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
 * Loads `cloudflared`'s `bin`/`install` from the first {@link CloudflaredScope}
 * that can resolve `cloudflared/package.json` — the robust presence check,
 * since the package root then re-exports both. Throws naming every scope tried.
 */
export function resolveCloudflaredFromScopes(scopes: CloudflaredScope[]): CloudflaredModule {
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
 * Resolves `cloudflared`'s `bin`/`install`, searching scopes in dependency-
 * truth order: `langwatch` SDK (the actual dependent), `@langwatch/scenario`,
 * then the app scope — pnpm's strict layout only exposes it from `langwatch` first.
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
function withTimeout<T>({
  promise,
  ms,
  message,
}: {
  promise: Promise<T>;
  ms: number;
  message: string;
}): Promise<T> {
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
function prependToPath({ env, dir }: { env: NodeJS.ProcessEnv; dir: string }): void {
  const current = env.PATH ?? "";
  if (current.split(path.delimiter)[0] === dir) return;
  env.PATH = current ? `${dir}${path.delimiter}${current}` : dir;
}

/**
 * Downloads the binary as a fallback if missing on disk; no-op when already
 * present (the common postinstall case). Throws {@link VoiceTunnelBinaryError}
 * on a failed/timed-out download, or a reported success that leaves no binary.
 */
async function ensureBinaryPresent({
  mod,
  binaryExists,
  installTimeoutMs,
}: {
  mod: CloudflaredModule;
  binaryExists: (binPath: string) => boolean;
  installTimeoutMs: number;
}): Promise<void> {
  if (binaryExists(mod.bin)) return;
  try {
    await withTimeout({
      promise: mod.install(mod.bin),
      ms: installTimeoutMs,
      message: `cloudflared install timed out after ${installTimeoutMs}ms`,
    });
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
 * Ensures `cloudflared` is resolvable on PATH for the SDK's later bare spawn:
 * no-op if already on PATH, else resolves the package, downloads a fallback
 * binary if missing, and prepends its directory. Throws {@link VoiceTunnelBinaryError}.
 */
export async function ensureCloudflaredOnPath(deps: EnsureCloudflaredOnPathDeps): Promise<void> {
  const isOnPath = deps.isOnPath ?? defaultIsOnPath;
  const env = deps.env;

  // A system cloudflared already on PATH (some dev boxes, some images) needs
  // nothing further — and this short-circuit costs one cheap subprocess.
  if (isOnPath()) return;

  const resolveModule = deps.resolveModule ?? defaultResolveModule;
  const binaryExists = deps.binaryExists ?? fs.existsSync;
  const installTimeoutMs = deps.installTimeoutMs ?? CLOUDFLARED_INSTALL_TIMEOUT_MS_DEFAULT;

  let mod: CloudflaredModule;
  try {
    mod = resolveModule();
  } catch (error) {
    throw new VoiceTunnelBinaryError("could not resolve the cloudflared package", error);
  }

  await ensureBinaryPresent({ mod, binaryExists, installTimeoutMs });
  prependToPath({ env, dir: path.dirname(mod.bin) });
}

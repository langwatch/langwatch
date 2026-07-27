/**
 * Harden the VS Code integrated-terminal environment against the
 * `copilot_vscode` bearer-token leak (ADR-039 §Extension #2).
 *
 * The scoped `code()` shell function injects OTEL_* + COPILOT_OTEL_* into the
 * VS Code process so the Copilot Chat extension exports telemetry. VS Code is
 * long-lived and its integrated terminals are child processes, so they inherit
 * that env — including the ingest token — for the whole editor session. An
 * un-wrapped OTLP-aware tool run in such a terminal would otherwise POST to
 * LangWatch tagged `copilot_vscode`.
 *
 * `terminal.integrated.env.<os>` is VS Code's per-terminal env override; a
 * `null` value means "unset this variable in integrated terminals". We set the
 * telemetry keys to null so the extension host keeps them (read at process
 * launch) while terminals do NOT inherit them. This is a NARROW settings write
 * (terminal env only) — distinct from the "settings.json carries the capture
 * config" approach the ADR rejected; the token is still delivered via env.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type VscodePlatform = "darwin" | "linux" | "win32";

/**
 * The telemetry env keys the scoped `code()` function injects, which must be
 * cleared from VS Code integrated terminals. Kept in sync with the `code` case
 * of `buildOtelEnvBlock` (a drift test asserts they match).
 */
export const VSCODE_TELEMETRY_ENV_KEYS: readonly string[] = [
  "COPILOT_OTEL_ENABLED",
  "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT",
  "OTEL_TRACES_EXPORTER",
  "OTEL_METRICS_EXPORTER",
  "OTEL_EXPORTER_OTLP_PROTOCOL",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_RESOURCE_ATTRIBUTES",
] as const;

/** Absolute path to VS Code's User settings.json for the platform, or null
 * when the platform isn't a supported VS Code host. */
export function vscodeUserSettingsPath(
  platform: VscodePlatform,
  home: string,
  appData?: string,
): string | null {
  switch (platform) {
    case "darwin":
      return path.join(
        home,
        "Library",
        "Application Support",
        "Code",
        "User",
        "settings.json",
      );
    case "linux":
      return path.join(home, ".config", "Code", "User", "settings.json");
    case "win32":
      return path.join(
        appData ?? path.join(home, "AppData", "Roaming"),
        "Code",
        "User",
        "settings.json",
      );
    default:
      return null;
  }
}

/** VS Code's platform-specific integrated-terminal env settings key. */
export function vscodeTerminalEnvKey(platform: VscodePlatform): string | null {
  switch (platform) {
    case "darwin":
      return "terminal.integrated.env.osx";
    case "linux":
      return "terminal.integrated.env.linux";
    case "win32":
      return "terminal.integrated.env.windows";
    default:
      return null;
  }
}

interface VscodeSettingsArgs {
  platform: VscodePlatform;
  home: string;
  /** The env keys to clear from integrated terminals (the code() env block). */
  keys: string[];
  appData?: string;
}

/**
 * Set each of `keys` to null under `terminal.integrated.env.<os>` so VS Code
 * unsets them in integrated terminals. Creates the file/dir when missing,
 * preserves every other user-authored setting verbatim. Returns the settings
 * path written, or null when the platform is unsupported or `keys` is empty.
 */
export function clearVscodeTerminalOtelEnv(
  args: VscodeSettingsArgs,
): string | null {
  const filePath = vscodeUserSettingsPath(args.platform, args.home, args.appData);
  const envKey = vscodeTerminalEnvKey(args.platform);
  if (!filePath || !envKey || args.keys.length === 0) return null;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const settings = readSettings(filePath);
  const existing = settings[envKey];
  const nextEnv: Record<string, unknown> = isPlainObject(existing)
    ? { ...existing }
    : {};
  for (const k of args.keys) nextEnv[k] = null;
  settings[envKey] = nextEnv;

  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + "\n");
  return filePath;
}

/**
 * Remove `keys` from `terminal.integrated.env.<os>` (logout teardown). Drops
 * the env object and the settings key when they become empty, preserving all
 * other settings. Returns true when the file changed; false when absent,
 * malformed, or none of the keys were present (idempotent). A malformed file
 * is left untouched rather than clobbered.
 */
export function removeVscodeTerminalOtelEnv(args: VscodeSettingsArgs): boolean {
  const filePath = vscodeUserSettingsPath(args.platform, args.home, args.appData);
  const envKey = vscodeTerminalEnvKey(args.platform);
  if (!filePath || !envKey) return false;

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return false; // ENOENT
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return false; // malformed — do not touch
  }
  if (!isPlainObject(parsed)) return false;

  const settings: Record<string, unknown> = { ...parsed };
  const env = settings[envKey];
  if (!isPlainObject(env)) return false;

  const nextEnv: Record<string, unknown> = { ...env };
  let removed = false;
  for (const k of args.keys) {
    if (k in nextEnv) {
      delete nextEnv[k];
      removed = true;
    }
  }
  if (!removed) return false;

  if (Object.keys(nextEnv).length === 0) {
    delete settings[envKey];
  } else {
    settings[envKey] = nextEnv;
  }
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + "\n");
  return true;
}

/** Whether VS Code settings already clear any of `keys` in the terminal env. */
export function vscodeTerminalEnvHasAnyClear(args: VscodeSettingsArgs): boolean {
  const filePath = vscodeUserSettingsPath(args.platform, args.home, args.appData);
  const envKey = vscodeTerminalEnvKey(args.platform);
  if (!filePath || !envKey) return false;
  const settings = readSettings(filePath);
  const env = settings[envKey];
  if (!isPlainObject(env)) return false;
  return args.keys.some((k) => k in env);
}

function readSettings(filePath: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (isPlainObject(parsed)) return { ...parsed };
    return {};
  } catch {
    return {};
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

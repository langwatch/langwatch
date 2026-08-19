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
 *
 * settings.json is JSONC — comments and trailing commas are legal, VS Code
 * preserves them, and the file VS Code ships out of the box contains nothing
 * but a comment. All edits therefore go through `jsonc-parser` (VS Code's own
 * library): `modify` + `applyEdits` produce minimal text edits that keep the
 * user's comments and formatting byte-for-byte. A file that does not parse
 * even as JSONC is NEVER written — refusing the hardening beats destroying a
 * user's settings.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  applyEdits,
  modify,
  type ParseError,
  parse as parseJsonc,
} from "jsonc-parser";

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

const JSONC_FORMAT = {
  formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
};

/** Read the raw settings text; "" when the file is missing. */
function readSettingsText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

/**
 * Parse settings text as JSONC. Returns the settings object, or null when the
 * text does not parse even as JSONC (in which case NOTHING may be written) or
 * parses to a non-object. Empty/whitespace-only text parses as `{}` — a fresh
 * file has no user content to protect.
 */
function parseSettings(text: string): Record<string, unknown> | null {
  if (text.trim() === "") return {};
  const errors: ParseError[] = [];
  const parsed = parseJsonc(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  if (errors.length > 0) return null;
  if (!isPlainObject(parsed)) return null;
  return parsed;
}

/** Write via temp+rename: VS Code writes this file concurrently, and a torn
 * write would hand it a half-serialized settings.json. */
function atomicWrite(filePath: string, content: string): void {
  const tmp = `${filePath}.langwatch-tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

/**
 * Set each of `keys` to null under `terminal.integrated.env.<os>` so VS Code
 * unsets them in integrated terminals. Creates the file/dir when missing.
 * Comment/format-preserving: edits are minimal JSONC text edits, every other
 * user-authored byte survives verbatim. Returns the settings path written, or
 * null when the platform is unsupported, `keys` is empty, or the existing
 * file does not parse as JSONC (refused rather than clobbered — the caller
 * must surface that the hardening is NOT in place).
 */
export function clearVscodeTerminalOtelEnv(
  args: VscodeSettingsArgs,
): string | null {
  const filePath = vscodeUserSettingsPath(
    args.platform,
    args.home,
    args.appData,
  );
  const envKey = vscodeTerminalEnvKey(args.platform);
  if (!filePath || !envKey || args.keys.length === 0) return null;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let text = readSettingsText(filePath);
  if (parseSettings(text) === null) return null; // unparseable — refuse

  for (const k of args.keys) {
    text = applyEdits(text, modify(text, [envKey, k], null, JSONC_FORMAT));
  }
  atomicWrite(filePath, text.endsWith("\n") ? text : `${text}\n`);
  return filePath;
}

/**
 * Remove `keys` from `terminal.integrated.env.<os>` (logout teardown). Drops
 * the env object and the settings key when they become empty, preserving all
 * other settings, comments, and formatting. Returns true when the file
 * changed; false when absent, unparseable, or none of the keys were present
 * (idempotent). An unparseable file is left untouched rather than clobbered.
 */
export function removeVscodeTerminalOtelEnv(args: VscodeSettingsArgs): boolean {
  const filePath = vscodeUserSettingsPath(
    args.platform,
    args.home,
    args.appData,
  );
  const envKey = vscodeTerminalEnvKey(args.platform);
  if (!filePath || !envKey) return false;

  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return false; // ENOENT
  }
  const settings = parseSettings(text);
  if (settings === null) return false; // unparseable — do not touch

  const env = settings[envKey];
  if (!isPlainObject(env)) return false;

  const present = args.keys.filter((k) => k in env);
  if (present.length === 0) return false;

  const survivors = Object.keys(env).filter((k) => !args.keys.includes(k));
  if (survivors.length === 0) {
    // env object becomes empty — drop the whole settings key.
    text = applyEdits(text, modify(text, [envKey], undefined, JSONC_FORMAT));
  } else {
    for (const k of present) {
      text = applyEdits(
        text,
        modify(text, [envKey, k], undefined, JSONC_FORMAT),
      );
    }
  }
  atomicWrite(filePath, text.endsWith("\n") ? text : `${text}\n`);
  return true;
}

/** Whether VS Code settings already clear any of `keys` in the terminal env. */
export function vscodeTerminalEnvHasAnyClear(
  args: VscodeSettingsArgs,
): boolean {
  const filePath = vscodeUserSettingsPath(
    args.platform,
    args.home,
    args.appData,
  );
  const envKey = vscodeTerminalEnvKey(args.platform);
  if (!filePath || !envKey) return false;
  const settings = parseSettings(readSettingsText(filePath));
  if (settings === null) return false;
  const env = settings[envKey];
  if (!isPlainObject(env)) return false;
  return args.keys.some((k) => k in env);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

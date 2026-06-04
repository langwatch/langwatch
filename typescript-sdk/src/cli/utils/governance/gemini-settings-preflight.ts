/**
 * Gemini Path A preflight: detect when gemini-cli is configured to
 * prefer cached OAuth over GOOGLE_API_KEY / GEMINI_API_KEY.
 *
 * gemini-cli 0.46 keeps an auth-method marker at
 *   ~/.gemini/settings.json -> security.auth.selectedType
 * When that field is "gemini-oauth", the CLI ignores any API-key env
 * vars the wrapper sets and routes directly to googleapis.com. The
 * gateway never sees the call, no trace is captured, and the user has
 * no surface signal that Path A silently bypassed.
 *
 * This module is a NON-BLOCKING warning. It does not edit the user's
 * settings.json (that would surprise people who intentionally signed
 * into OAuth). It just writes one stderr line on each `langwatch
 * gemini` invocation so the user can act if they want Path A to
 * actually route.
 *
 * Tied to PR #4544. Same shape as the wrapper-mode policy gate, lives
 * adjacent to it so the import surface stays one directory.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type GeminiSettingsPreflightAction =
  | "oauth-selected"
  | "api-key-selected"
  | "no-settings"
  | "parse-error";

export interface GeminiSettingsPreflightResult {
  action: GeminiSettingsPreflightAction;
  warned: boolean;
}

export interface GeminiSettingsPreflightOptions {
  /** Override the settings.json path. Test-only. */
  filePath?: string;
  /** Override the stderr sink. Test-only. */
  writeLine?: (line: string) => void;
}

/** Default settings.json path under the user's home directory. */
export function defaultGeminiSettingsPath(): string {
  const home = process.env.HOME ?? os.homedir();
  return path.join(home, ".gemini", "settings.json");
}

/**
 * Strip the most common JSONC noise (// line + slash-star block
 * comments) before JSON.parse. gemini-cli's settings.json is plain
 * JSON in practice but the CLI tolerates JSONC, so the wrapper does
 * too. Mirrors the opencode-config-flag.ts helper.
 */
function stripJsoncComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Read the gemini settings file, detect the auth selectedType, and
 * surface a warning when the wrapper's API-key env block will be
 * ignored. Always non-throwing: file-not-found, parse errors, and
 * malformed shapes resolve to a no-warn action so the wrapper can
 * continue.
 */
export function warnIfGeminiOAuthSelected(
  options: GeminiSettingsPreflightOptions = {},
): GeminiSettingsPreflightResult {
  const filePath = options.filePath ?? defaultGeminiSettingsPath();
  const writeLine =
    options.writeLine ?? ((line: string) => process.stderr.write(line + "\n"));

  if (!fs.existsSync(filePath)) {
    return { action: "no-settings", warned: false };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return { action: "parse-error", warned: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsoncComments(raw));
  } catch {
    return { action: "parse-error", warned: false };
  }

  const selectedType = readSelectedType(parsed);

  if (selectedType === "gemini-oauth") {
    writeLine(
      "warning: ~/.gemini/settings.json has security.auth.selectedType=\"gemini-oauth\". " +
        "gemini-cli 0.46 will use cached OAuth and ignore GOOGLE_API_KEY / GEMINI_API_KEY, " +
        "so this `langwatch gemini` call will bypass the gateway. " +
        "To route through langwatch: edit ~/.gemini/settings.json and set " +
        "security.auth.selectedType to \"gemini-api-key\".",
    );
    return { action: "oauth-selected", warned: true };
  }

  return { action: "api-key-selected", warned: false };
}

function readSelectedType(parsed: unknown): string | null {
  if (parsed === null || typeof parsed !== "object") return null;
  const security = (parsed as Record<string, unknown>).security;
  if (security === null || typeof security !== "object") return null;
  const auth = (security as Record<string, unknown>).auth;
  if (auth === null || typeof auth !== "object") return null;
  const selectedType = (auth as Record<string, unknown>).selectedType;
  return typeof selectedType === "string" ? selectedType : null;
}

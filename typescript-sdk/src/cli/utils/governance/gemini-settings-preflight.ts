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
  filePath?: string;
  writeLine?: (line: string) => void;
}

export function defaultGeminiSettingsPath(): string {
  const home = process.env.HOME ?? os.homedir();
  return path.join(home, ".gemini", "settings.json");
}

function stripJsoncComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

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

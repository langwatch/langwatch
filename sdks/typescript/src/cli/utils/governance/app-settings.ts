/**
 * Persist telemetry env vars to tool's own settings file (e.g. ~/.claude/settings.json)
 * instead of profile rc, scoping them to that tool's runs only.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface AppSettingsTarget {
  /** Tool slug the target belongs to (e.g. "claude"). */
  tool: string;
  /** Absolute path to the settings file on disk. */
  path: string;
  /** Human-readable path shown in the prompt (`~/.claude/settings.json`). */
  displayPath: string;
}

interface TargetSpec {
  /** Path segments below the user's home dir. */
  segments: string[];
}

const TARGETS: Record<string, TargetSpec> = {
  claude: { segments: [".claude", "settings.json"] },
};

/**
 * Return the settings target for a tool, or null when the tool has
 * no supported app-scoped env block (caller should fall back to the
 * shell rc path).
 */
export function appSettingsTargetFor(tool: string): AppSettingsTarget | null {
  const spec = TARGETS[tool];
  if (!spec) return null;
  const home = os.homedir();
  return {
    tool,
    path: path.join(home, ...spec.segments),
    displayPath: `~/${spec.segments.join("/")}`,
  };
}

/**
 * Project-level Claude Code settings target: `<cwd>/.claude/settings.local.json`.
 * Claude applies local settings ABOVE user-level ones, so writing here lets a
 * wrapped run win over whatever a previous install left at user level.
 */
export function claudeProjectSettingsTarget(cwd: string): AppSettingsTarget {
  return {
    tool: "claude",
    path: path.join(cwd, ".claude", "settings.local.json"),
    displayPath: ".claude/settings.local.json",
  };
}

/**
 * The target's current `env` map (string values only), empty when missing,
 * malformed, or absent. Lets callers inspect persisted values, e.g. to
 * decide whether a block is langwatch-authored before refreshing it.
 */
export function appEnvValues(target: AppSettingsTarget): Record<string, string> {
  return readEnvMap(target.path);
}

/**
 * Whether the target's `env` map already contains every required key with
 * the required value, so re-running `langwatch <tool>` stays quiet when a
 * previous run already installed the current export set.
 */
export function appEnvHasAllVars(target: AppSettingsTarget, vars: Record<string, string>): boolean {
  const current = readEnvMap(target.path);
  for (const [k, v] of Object.entries(vars)) {
    if (current[k] !== v) return false;
  }
  return true;
}

/**
 * Whether the target's `env` map contains ANY of `keys`. Used by the
 * logout scan to decide whether a claude telemetry block is present to
 * offer for removal.
 */
export function appEnvHasAnyVar(target: AppSettingsTarget, keys: string[]): boolean {
  const current = readEnvMap(target.path);
  return keys.some((k) => k in current);
}

/**
 * Merge vars into target env map, creating directories/file if missing.
 * Throws on malformed JSON; every caller treats it as best-effort.
 */
export function installAppEnv(target: AppSettingsTarget, vars: Record<string, string>): void {
  const settings = readAppSettingsFileForUpdate(target.path);
  const existingEnv = settings.env;
  const nextEnv: Record<string, string> = isPlainObject(existingEnv)
    ? { ...(existingEnv as Record<string, string>) }
    : {};
  for (const [k, v] of Object.entries(vars)) {
    nextEnv[k] = v;
  }
  settings.env = nextEnv;

  writeAppSettingsFile({ filePath: target.path, settings });
}

/**
 * Remove keys from target's env map. Returns true if file changed.
 * Idempotent: safe on absent, malformed, or unchanged files.
 */
export function removeAppEnvVars(target: AppSettingsTarget, keys: string[]): boolean {
  let raw: string;
  try {
    raw = fs.readFileSync(target.path, "utf8");
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
  const env = settings.env;
  if (!isPlainObject(env)) return false;

  const nextEnv: Record<string, unknown> = { ...env };
  let removed = false;
  for (const k of keys) {
    if (k in nextEnv) {
      delete nextEnv[k];
      removed = true;
    }
  }
  if (!removed) return false;

  if (Object.keys(nextEnv).length === 0) {
    delete settings.env;
  } else {
    settings.env = nextEnv;
  }
  writeAppSettingsFile({ filePath: target.path, settings });
  return true;
}

/**
 * Settings file as mutable copy. Missing files return {}; other failures throw
 * (write path replaces wholesale). Shared with session-context-hooks.ts.
 */
export function readAppSettingsFileForUpdate(filePath: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw unmergeable(filePath, (err as Error).message);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw unmergeable(filePath, "it is not valid JSON");
  }
  if (!isPlainObject(parsed)) {
    throw unmergeable(filePath, "it does not hold a JSON object");
  }
  return { ...parsed };
}

/**
 * Writes a settings document back, creating parent directories when
 * missing. One writer for every caller editing these files keeps
 * indentation and newlines consistent regardless of who wrote last.
 */
export function writeAppSettingsFile({
  filePath,
  settings,
}: {
  filePath: string;
  settings: Record<string, unknown>;
}): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`);
}

function unmergeable(filePath: string, why: string): Error {
  return new Error(
    `Can't merge into ${filePath}: ${why}. Fix the file and run this again; ` +
      `writing over it would lose everything else it holds.`,
  );
}

/**
 * The settings file's top-level object for a caller that only wants to look at
 * it. Anything unreadable answers `{}`, which is the honest answer to "what is
 * configured here" for a file nothing can parse.
 */
export function readAppSettingsFile(filePath: string): Record<string, unknown> {
  try {
    return readAppSettingsFileForUpdate(filePath);
  } catch {
    return {};
  }
}

function readEnvMap(filePath: string): Record<string, string> {
  const settings = readAppSettingsFile(filePath);
  const env = settings.env;
  if (!isPlainObject(env)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Persist Path B (ingestion) telemetry env vars into a tool's own
 * settings file, rather than the profile-root shell rc.
 *
 * Motivation: `langwatch claude` used to offer to write its
 * OTEL_EXPORTER_OTLP_* block to `~/.zshrc`. That works, but it
 * leaks the vars into every other shell child (git, ripgrep,
 * unrelated services) and pollutes the profile root. Claude Code
 * has a native, per-app `env` block in `~/.claude/settings.json`
 * that it loads on every invocation — writing there scopes the
 * telemetry to `claude` runs only.
 *
 * For scope: `claude` is the only tool with a supported target
 * today. Other wrappers (codex, cursor, gemini, opencode) still
 * fall back to the shell rc path. Adding a new tool means adding
 * an entry to `TARGETS` below and (if the format isn't JSON with
 * a top-level `env` map) extending the read/write helpers.
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
 * Project-level Claude Code settings target for a working directory:
 * `<cwd>/.claude/settings.local.json`. Claude applies local project
 * settings ABOVE user-level `~/.claude/settings.json`, so an env block
 * written here is the documented way for a wrapped run to win over
 * whatever a previous install left at user level. Shares the same
 * read/merge/remove helpers as the user-level target.
 */
export function claudeProjectSettingsTarget(cwd: string): AppSettingsTarget {
  return {
    tool: "claude",
    path: path.join(cwd, ".claude", "settings.local.json"),
    displayPath: ".claude/settings.local.json",
  };
}

/**
 * The target's current `env` map (string values only). Empty when the
 * file is missing, malformed, or has no `env` object. Lets callers
 * inspect the persisted values, e.g. to decide whether an existing
 * block is langwatch-authored before refreshing it in place.
 */
export function appEnvValues(
  target: AppSettingsTarget,
): Record<string, string> {
  return readEnvMap(target.path);
}

/**
 * Whether the target's `env` map already contains every required
 * key with the required value. Used to stay quiet when a previous
 * run already installed the current export set (so re-running
 * `langwatch <tool>` doesn't nag).
 */
export function appEnvHasAllVars(
  target: AppSettingsTarget,
  vars: Record<string, string>,
): boolean {
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
export function appEnvHasAnyVar(
  target: AppSettingsTarget,
  keys: string[],
): boolean {
  const current = readEnvMap(target.path);
  return keys.some((k) => k in current);
}

/**
 * Merge `vars` into the target's top-level `env` map, creating
 * parent directories and the file itself when missing. Preserves
 * every other user-authored top-level key verbatim. Values in
 * `vars` win over pre-existing entries under the same key.
 *
 * Throws when the existing file cannot be read as a JSON object, rather than
 * replacing it. Every caller treats that as best-effort and says so.
 */
export function installAppEnv(
  target: AppSettingsTarget,
  vars: Record<string, string>,
): void {
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
 * Remove `keys` from the target's top-level `env` map. Every other env
 * entry and every other top-level settings key is preserved verbatim.
 * When `env` becomes empty as a result, the `env` key is dropped entirely
 * (no `"env": {}` residue). Returns true when the file changed, false when
 * the file was absent, malformed, or carried none of the keys — so it is
 * safe to call unconditionally (idempotent). A malformed file is left
 * untouched rather than rewritten, so we never clobber user config we
 * can't parse.
 */
export function removeAppEnvVars(
  target: AppSettingsTarget,
  keys: string[],
): boolean {
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
 * The settings file's top-level object, as a mutable copy, for a caller about
 * to write it back.
 *
 * A missing file reads as `{}`: there is nothing there to lose. Every other
 * failure throws, because the write path replaces the file WHOLESALE. The file
 * belongs to the user, not to us, and it is where they keep everything else
 * their agent does; trading all of it for a stray comma is not a recovery. The
 * removal helpers already refuse the same way, by reporting no change.
 *
 * Shared with session-context-hooks.ts, which merges a different region of the same
 * file and must read and write it exactly the way the env block does.
 */
export function readAppSettingsFileForUpdate(
  filePath: string,
): Record<string, unknown> {
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
 * Write a settings document back, creating parent directories when missing.
 *
 * One writer for every caller that edits one of these files, whichever region
 * of it they own. Indentation, the trailing newline and directory creation are
 * what the user's own diff shows after we touch their config, so they cannot
 * depend on which of us wrote it last.
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

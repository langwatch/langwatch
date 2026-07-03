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
 * Merge `vars` into the target's top-level `env` map, creating
 * parent directories and the file itself when missing. Preserves
 * every other user-authored top-level key verbatim. Values in
 * `vars` win over pre-existing entries under the same key.
 */
export function installAppEnv(
  target: AppSettingsTarget,
  vars: Record<string, string>,
): void {
  fs.mkdirSync(path.dirname(target.path), { recursive: true });

  const settings = readSettings(target.path);
  const existingEnv = settings.env;
  const nextEnv: Record<string, string> =
    isPlainObject(existingEnv)
      ? { ...(existingEnv as Record<string, string>) }
      : {};
  for (const [k, v] of Object.entries(vars)) {
    nextEnv[k] = v;
  }
  settings.env = nextEnv;

  fs.writeFileSync(target.path, JSON.stringify(settings, null, 2) + "\n");
}

function readSettings(filePath: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (isPlainObject(parsed)) return { ...parsed };
    return {};
  } catch {
    // ENOENT, malformed JSON — start from an empty object so we
    // don't lose the user's file to a stray comma. A parse error
    // does silently drop other keys, which is why the read path
    // returns {} — the write path replaces the file wholesale.
    return {};
  }
}

function readEnvMap(filePath: string): Record<string, string> {
  const settings = readSettings(filePath);
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

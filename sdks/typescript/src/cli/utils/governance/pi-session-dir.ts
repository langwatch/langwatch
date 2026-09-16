/**
 * Where pi keeps the session files LangWatch reads while pi runs.
 *
 * A user can relocate that directory three ways, and pi resolves them in a
 * fixed order: a `--session-dir` on the command line, then the
 * `PI_CODING_AGENT_SESSION_DIR` environment variable, then `sessionDir` in
 * `~/.pi/agent/settings.json`, then its own default. We mirror that order
 * rather than reading only the default, because a reader hard-coded to
 * `~/.pi/agent/sessions` finds nothing at all for a user who moved it — and
 * finds it silently, with no file to fail on.
 *
 * The two branches differ in shape, and that difference is the whole reason
 * this file has a cwd argument. A directory the user named is used exactly as
 * given: pi writes its sessions straight into it. The default is not a
 * directory pi writes into at all — it is the parent of one directory per
 * working directory, named by encoding the cwd. So `~/.pi/agent/sessions`
 * holds no session file at any time; every file is one level below it. A
 * reader that resolves to the parent and does not descend finds nothing on a
 * default launch, which is every user who has set nothing — verified by
 * running the walker against a real pi installation: zero files at the parent,
 * seven one level down.
 *
 * Both shapes are pi's, read from its shipped source rather than inferred:
 * `session-manager.js` builds the encoded name in `getDefaultSessionDirPath`
 * and takes an explicit directory unchanged
 * (`const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(cwd)`).
 * Resolving to pi's own per-project directory rather than widening the walk to
 * every project also keeps capture to the sessions of the project we are in.
 *
 * Resolution reads; it never creates. The returned directory may not exist,
 * which is the normal state of a session pi has not written yet (pi defers the
 * first write until the first assistant reply), and the caller treats an
 * absent directory the same way it treats an absent file.
 *
 * Every failure resolves rather than throwing: a settings file that is missing,
 * unreadable, not an object, or holds the wrong type for `sessionDir` falls
 * through to the next source. A capture path is not worth an exit code.
 *
 * Spec: specs/coding-agent/pi-session-capture.feature
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** The variable pi itself reads, second in its own precedence order. */
export const PI_SESSION_DIR_ENV = "PI_CODING_AGENT_SESSION_DIR";

/** The flag pi itself accepts, first in its own precedence order. */
const SESSION_DIR_FLAG = "--session-dir";

/** pi's settings file, the third place a relocated directory can be named. */
export function piSettingsPath(home: string = homedir()): string {
  return join(home, ".pi", "agent", "settings.json");
}

/**
 * The PARENT of pi's default per-project directories, which holds no session
 * file itself. Callers that want somewhere to read from want
 * {@link defaultPiProjectSessionsDir}.
 */
export function defaultPiSessionsRoot(home: string = homedir()): string {
  return join(home, ".pi", "agent", "sessions");
}

/**
 * pi's name for one working directory's session folder.
 *
 * Copied from pi's `getDefaultSessionDirPath`: drop a single leading separator,
 * turn every remaining separator and colon into a dash, and wrap the result in
 * a leading and trailing double dash. The colon is in the set for Windows
 * drive letters; on any platform the encoding is pi's, so we reproduce it
 * whole rather than the part that happens to matter here.
 */
export function encodePiCwdDirName(cwd: string): string {
  const stripped = cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-");
  return `--${stripped}--`;
}

/**
 * Where pi writes this working directory's sessions when nothing has moved
 * them. This is the directory a reader reads; its parent never holds files.
 */
export function defaultPiProjectSessionsDir({
  cwd,
  home = homedir(),
}: {
  cwd: string;
  home?: string;
}): string {
  return join(defaultPiSessionsRoot(home), encodePiCwdDirName(resolve(cwd)));
}

/**
 * A directory named on the command line, or null.
 *
 * Both spellings pi accepts are read: `--session-dir <dir>` and
 * `--session-dir=<dir>`. A flag with nothing after it, or one followed by
 * another flag, names no directory and falls through rather than capturing
 * `--verbose` as a path. The last spelling wins, the way an argument parser
 * that lets a later flag override an earlier one behaves.
 */
export function sessionDirFromArgs(args: readonly string[]): string | null {
  let found: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === SESSION_DIR_FLAG) {
      const next = args[i + 1];
      // A value that looks like a flag is the next option, not a path.
      if (next === undefined || next === "" || next.startsWith("-")) continue;
      found = next;
      i++;
      continue;
    }
    if (arg.startsWith(`${SESSION_DIR_FLAG}=`)) {
      const value = arg.slice(SESSION_DIR_FLAG.length + 1);
      if (value !== "") found = value;
    }
  }
  return found;
}

/**
 * `sessionDir` from pi's settings file, or null when the file says nothing
 * usable. Never throws: the whole point of consulting settings is that a user
 * may have moved the directory, not that the file has to be well formed.
 */
export async function readSettingsSessionDir(
  settingsPath: string,
): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(settingsPath, "utf8"));
  } catch {
    // No settings file, no read permission, or not JSON. Nothing is named.
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const sessionDir = (parsed as { sessionDir?: unknown }).sessionDir;
  if (typeof sessionDir !== "string") return null;
  const trimmed = sessionDir.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The directory to read this pi session from, highest-precedence source first.
 * Always resolves to a path; the default is the last source, so there is no
 * "not found" case for the caller to handle.
 *
 * A named directory is returned as named, because that is what pi does with
 * it. Only the default gains the per-project segment, for the same reason.
 */
export async function resolvePiSessionDir({
  toolArgs = [],
  env = process.env,
  home = homedir(),
  cwd = process.cwd(),
}: {
  /** The arguments passed through to pi, as given. */
  toolArgs?: readonly string[];
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** The directory pi is launched in, which names its default session folder. */
  cwd?: string;
} = {}): Promise<string> {
  const fromArgs = sessionDirFromArgs(toolArgs);
  if (fromArgs) return fromArgs;

  const fromEnv = env[PI_SESSION_DIR_ENV]?.trim();
  if (fromEnv) return fromEnv;

  const fromSettings = await readSettingsSessionDir(piSettingsPath(home));
  if (fromSettings) return fromSettings;

  return defaultPiProjectSessionsDir({ cwd, home });
}

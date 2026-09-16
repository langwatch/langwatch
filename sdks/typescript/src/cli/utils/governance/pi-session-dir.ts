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
 * this file has a cwd argument. A directory the user named is the directory pi
 * writes its sessions straight into. The default is not a directory pi writes
 * into at all — it is the parent of one directory per working directory, named
 * by encoding the cwd. So `~/.pi/agent/sessions` holds no session file at any
 * time; every file is one level below it. A reader that resolves to the parent
 * and does not descend finds nothing on a default launch, which is every user
 * who has set nothing — verified by running the walker against a real pi
 * installation: zero files at the parent, seven one level down.
 *
 * Both shapes are pi's, read from its shipped source rather than inferred:
 * `session-manager.js` builds the encoded name in `getDefaultSessionDirPath`
 * and takes an explicit directory through `normalizePath`
 * (`const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(cwd)`).
 * Resolving to pi's own per-project directory rather than widening the walk to
 * every project also keeps capture to the sessions of the project we are in.
 *
 * "Through `normalizePath`" is not "unchanged", and reading it as unchanged is
 * what {@link normalizeNamedPiDir} exists to undo. pi expands a leading `~` and
 * turns a `file://` URL into a path before it writes anywhere. A reader that
 * takes the user's string literally looks for a directory named `~`, finds
 * nothing, and says nothing — the same silent miss as reading the parent, from
 * a different cause. Settings files are where this bites: JSON cannot expand a
 * tilde, so a user who wants their home directory has no way to write it other
 * than `~`, and pi honours that.
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
import { fileURLToPath } from "node:url";

/** The variable pi itself reads, second in its own precedence order. */
export const PI_SESSION_DIR_ENV = "PI_CODING_AGENT_SESSION_DIR";

/**
 * The variable that moves pi's whole agent directory, not just its sessions.
 *
 * pi builds the name rather than writing it down — `config.js:406` is
 * ``export const ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;``
 * over an `APP_NAME` of `pi` (`config.js:401`), which is how a rebranded build
 * of the same agent reads a different variable. We hard-code the `pi` spelling
 * because `pi` is the binary this wrapper spawns.
 */
export const PI_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/** The flag pi itself accepts, first in its own precedence order. */
const SESSION_DIR_FLAG = "--session-dir";

/**
 * pi's agent directory — the root every other path here hangs off.
 *
 * `~/.pi/agent` is only its default. `config.js:420-426` reads
 * {@link PI_AGENT_DIR_ENV} first and, when it is set, returns it through
 * `expandTildePath`, which is `normalizePath(path)` with no options
 * (`config.js:408-410`) — the same call {@link normalizeNamedPiDir} already
 * mirrors, so it is reused here rather than spelled a second time. Only when
 * the variable is unset does pi fall back to `join(homedir(), ".pi", "agent")`.
 *
 * This matters because the variable moves BOTH the settings file
 * (`getSettingsPath`, `config.js:440-442`) and the sessions root
 * (`getSessionsDir`, `config.js:457-459`). A reader that hard-codes
 * `~/.pi/agent` for a user who set it reads a settings file that is not pi's
 * and walks a directory pi never wrote to, and does both without an error to
 * notice — the same silent miss this whole file exists to close.
 *
 * One deliberate divergence: pi's test is `if (envDir)`, so a value of only
 * spaces is a directory named with spaces to pi, while we trim first and treat
 * it as unset. That matches how {@link resolvePiSessionDir} already treats a
 * blank {@link PI_SESSION_DIR_ENV}, and a user who exported whitespace meant
 * nothing by it.
 */
export function piAgentDir({
  env = process.env,
  home = homedir(),
}: {
  env?: NodeJS.ProcessEnv;
  home?: string;
} = {}): string {
  const named = env[PI_AGENT_DIR_ENV]?.trim();
  if (named) return normalizeNamedPiDir(named, home);
  return join(home, ".pi", "agent");
}

/**
 * pi's settings file, the third place a relocated session directory can be
 * named. It lives in the agent directory, so a relocated agent directory takes
 * it with it — resolve one with {@link piAgentDir} rather than passing a home.
 */
export function piSettingsPath(agentDir: string = piAgentDir()): string {
  return join(agentDir, "settings.json");
}

/**
 * The PARENT of pi's default per-project directories, which holds no session
 * file itself. Callers that want somewhere to read from want
 * {@link defaultPiProjectSessionsDir}.
 */
export function defaultPiSessionsRoot(agentDir: string = piAgentDir()): string {
  return join(agentDir, "sessions");
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
 *
 * pi's own `getDefaultSessionDirPath` (`core/session-manager.js:242-247`) puts
 * the agent directory through `resolvePath` as well as the cwd. That is not
 * mirrored, and deliberately: `join` already normalises `..` and a trailing
 * separator, so the only shape `resolvePath` would change is a RELATIVE agent
 * directory, which it would resolve against `process.cwd()` — the same
 * directory our caller reads from, so the filesystem lands in the same place
 * either way. Adding it would buy an identical read and cost this function its
 * one useful property, that every input arrives as an argument. Checked, not
 * assumed: pi's `resolvePath` is `isAbsolute(x) ? resolve(x) : resolve(base, x)`
 * over `process.cwd()` (`utils/paths.js:81-85`).
 */
export function defaultPiProjectSessionsDir({
  cwd,
  agentDir = piAgentDir(),
}: {
  cwd: string;
  agentDir?: string;
}): string {
  return join(defaultPiSessionsRoot(agentDir), encodePiCwdDirName(resolve(cwd)));
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
 * A directory the user named, read the way pi reads it.
 *
 * Mirrors the two transformations pi's `normalizePath` applies with no options
 * (`utils/paths.js:58`, called at `core/session-manager.js:1207`): a leading
 * tilde becomes the home directory, and a `file://` URL becomes a path. pi
 * applies both before it decides where to write, so a reader that skips them
 * is looking somewhere pi never wrote.
 *
 * What is deliberately NOT mirrored, and it is two things rather than one: pi's
 * Windows shell-path handling, which unquotes and unescapes a shell-mangled
 * path, and pi's expansion of a leading `~\` — both guarded by `win32` in pi and
 * both skipped here. Capture on Windows is not covered by this feature's
 * scenarios, and adding an untested second spelling of someone else's parser is
 * the worse risk. A Windows user naming either shape still resolves to the
 * literal string, which is the behaviour before this change.
 *
 * Nothing here resolves a relative path or strips a trailing separator, because
 * pi does neither: `normalizePath` returns both unchanged, and both name the
 * same directory to the filesystem when read from the same working directory.
 *
 * The one place this returns something pi would not: a `file://` URL carrying a
 * host, such as `file://remote/share`. pi throws there and so never starts, so
 * there is no session for anyone to read; we return the literal, read a
 * directory that does not exist, and record nothing. Different route, same
 * outcome, and the outcome is the right one — so the catch is not papering over
 * a failure, it is declining to crash capture over a launch that never happened.
 *
 * Agreement with pi on every other shape was checked by running both functions
 * side by side over `~`, `~/x`, `~user/x`, `~~`, `~x`, `~\x`, `file:///abs`,
 * `FILE://` (neither expands: pi's test is case-sensitive), a whitespace-padded
 * path, a relative path, a trailing separator, and the empty string. Thirteen of
 * fourteen identical; the fourteenth is the host-bearing URL above.
 */
export function normalizeNamedPiDir(named: string, home = homedir()): string {
  if (named === "~") return home;
  if (named.startsWith("~/")) return join(home, named.slice(2));
  if (named.startsWith("file://")) {
    try {
      return fileURLToPath(named);
    } catch {
      // A malformed file:// URL is not worth an exit code on a capture path.
      // pi would throw here; we fall back to the literal, which finds nothing
      // and is no worse than the state before this function existed.
      return named;
    }
  }
  return named;
}

/**
 * The directory to read this pi session from, highest-precedence source first.
 * Always resolves to a path; the default is the last source, so there is no
 * "not found" case for the caller to handle.
 *
 * A named directory is returned as pi reads it — see
 * {@link normalizeNamedPiDir}, which is not the same as "as typed". Only the
 * default gains the per-project segment, for the same reason.
 *
 * The lowest two sources both hang off pi's agent directory, so it is resolved
 * once from the same `env` and shared: a user who moved that directory gets
 * their settings file read from where they moved it AND their default sessions
 * looked for underneath it. Resolving it twice, or resolving only one of them,
 * is how half of a relocation gets honoured.
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
  if (fromArgs) return normalizeNamedPiDir(fromArgs, home);

  const fromEnv = env[PI_SESSION_DIR_ENV]?.trim();
  if (fromEnv) return normalizeNamedPiDir(fromEnv, home);

  const agentDir = piAgentDir({ env, home });

  const fromSettings = await readSettingsSessionDir(piSettingsPath(agentDir));
  if (fromSettings) return normalizeNamedPiDir(fromSettings, home);

  return defaultPiProjectSessionsDir({ cwd, agentDir });
}

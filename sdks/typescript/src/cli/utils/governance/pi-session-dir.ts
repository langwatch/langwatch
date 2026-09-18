/**
 * Where pi keeps the session files LangWatch reads while pi runs.
 *
 * A user can relocate that directory four ways, and pi resolves them in a
 * fixed order: a `--session-dir` on the command line, then the
 * `PI_CODING_AGENT_SESSION_DIR` environment variable, then `sessionDir` in the
 * project's own `.pi/settings.json`, then `sessionDir` in
 * `~/.pi/agent/settings.json`, then its own default. The two settings files are
 * one step to pi, which merges them project-over-global; they are two steps here
 * because reading them in order and stopping at the first answer gives the same
 * result for the one key this file reads. We mirror that order
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
 * which is the normal state before pi has written a session there, and the
 * caller treats an absent directory the same way it treats an absent file.
 *
 * Every failure resolves rather than throwing: a settings file that is missing,
 * unreadable, not an object, or holds the wrong type for `sessionDir` falls
 * through to the next source. A capture path is not worth an exit code.
 *
 * Spec: specs/coding-agent/pi-session-capture.feature
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
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

/** The flag that names one session to open, by path or by id. */
const SESSION_FLAG = "--session";

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
 * The value pi's parser would end up with for a flag that takes one, or null.
 *
 * Shared by every flag this file reads, so pi's parsing rules are written down
 * once. Only the spelling pi accepts is read, and that is narrower than it looks.
 * pi's parser has one branch per flag, each of the shape
 * `arg === "--session-dir" && i + 1 < args.length` (`cli/args.js:88-90`); there
 * is no pass that splits `--flag=value` first. So `--session-dir=/x` is not a
 * relocated directory to pi at all — it lands in pi's `unknownFlags` map
 * (`cli/args.js:216-231`). Verified by calling pi's own `parseArgs` on 0.85.1:
 * `["--session-dir","/space/form"]` yields `/space/form`, while
 * `["--session-dir=/joined/form"]` yields `undefined` and
 * `unknownFlags: ["session-dir"]`.
 *
 * pi does not carry on with its default after that. The unknown-flag map is
 * handed to `createAgentSessionServices` (`main.js:587`), every unregistered
 * name becomes a diagnostic of type `error`
 * (`core/agent-session-services.js:40-45`), and `main.js:722-730` exits 1 on any
 * runtime error before a session exists. Measured on 0.85.1, in both plain and
 * terminal-attached runs: `pi --session-dir=/tmp/pi-probe-A` prints
 * `Error: Unknown option: --session-dir`, exits 1, and `/tmp/pi-probe-A` is
 * never created. The space form on the same build reached the model.
 *
 * So the joined-up spelling produces no session anywhere, and the only honest
 * thing a reader can do is decline to treat it as a relocation. This function
 * used to accept it, which was a silent miss of the kind this whole file exists
 * to close: we pointed capture at a directory the user had typed, pi never ran,
 * and we waited on a file that could not arrive.
 *
 * The same correction runs the other way for a value that looks like a flag.
 * pi takes `args[++i]` unconditionally, so `--session-dir --verbose` really does
 * name a directory called `--verbose` to pi; refusing it here meant watching the
 * default while pi wrote somewhere else. Mirroring pi means taking whatever the
 * next token is, including one that starts with a dash and including the empty
 * string — which pi then treats as unset (`main.js:532` tests `parsed.sessionDir`
 * for truthiness), exactly as a null does here.
 *
 * `--` ends pi's flag parsing entirely (`cli/args.js:22-32`): everything after
 * it is a message or a file argument, so a `--session-dir` behind it names
 * nothing.
 *
 * The last occurrence wins, the way pi's loop leaves the final assignment
 * standing.
 *
 * One known divergence, stated rather than mirrored: pi walks every flag in one
 * pass, so a flag left without its value swallows the next token whatever it is.
 * `pi --model --session /x.jsonl` gives pi a model called `--session` and leaves
 * `/x.jsonl` as a message, while this scan sees `--session` and reads `/x.jsonl`
 * after it. Mirroring that would mean carrying the arity of every flag pi has,
 * which is a copy of someone else's parser that goes stale silently. The cost of
 * the divergence is bounded: on a malformed command line we may offer the reader
 * one extra path, which is a file pi is not writing and yields no events.
 */
function lastFlagValue(
  args: readonly string[],
  flag: string,
): string | null {
  let found: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") break;
    if (arg !== flag) continue;
    const next = args[i + 1];
    // pi's own guard: a flag that ends the arguments names nothing.
    if (next === undefined) continue;
    found = next;
    i++;
  }
  return found;
}

/** A directory named on the command line, read pi's way. */
export function sessionDirFromArgs(args: readonly string[]): string | null {
  return lastFlagValue(args, SESSION_DIR_FLAG);
}

/**
 * The exact session FILE pi was told to open, or null.
 *
 * `--session` takes either a path or a session id, and the two land in very
 * different places. pi decides between them by shape, not by looking at the
 * filesystem (`main.js:192-195`): a value containing a separator or ending in
 * `.jsonl` is a path, resolved against the working directory, and pi then opens
 * that exact file and keeps writing to it where it lies
 * (`core/session-manager.js:1216-1237` resolves the path and hands it straight
 * to the session it returns). Anything else is an id, and every id route ends
 * inside the session directory: a local match is already there, and a match in
 * another project is forked into this one rather than opened in place
 * (`main.js:296-320`).
 *
 * So the id routes need nothing from this function and the path route needs
 * everything: a file named this way can sit anywhere on the disk, and capture
 * that watches only a directory never sees it. That was a silent miss —
 * `langwatch pi --session /elsewhere/session.jsonl` recorded nothing, with no
 * warning that the file it was given was outside what it was watching.
 *
 * The returned path is absolute, resolved the way pi resolves it
 * (`utils/paths.js:81-85`: absolute stays, relative resolves against the
 * launch directory). No tilde expansion, because pi does none here — an
 * unquoted `~` is the shell's to expand and a quoted one is a directory called
 * `~` to pi as much as to us.
 */
export function explicitSessionFileFromArgs({
  toolArgs,
  cwd = process.cwd(),
}: {
  toolArgs: readonly string[];
  cwd?: string;
}): string | null {
  const named = lastFlagValue(toolArgs, SESSION_FLAG);
  if (named === null || named.trim() === "") return null;
  // pi's own shape test, in pi's own order.
  const looksLikePath =
    named.includes("/") || named.includes("\\") || named.endsWith(".jsonl");
  if (!looksLikePath) return null;
  return isAbsolute(named) ? resolve(named) : resolve(cwd, named);
}

/**
 * pi's PROJECT settings file, which outranks the global one.
 *
 * pi keeps two settings files and merges them, project over global
 * (`core/settings-manager.js:151`, `deepMergeSettings(globalSettings,
 * projectSettings)`). The project one is `.pi/settings.json` in the directory pi
 * was launched from (`core/settings-manager.js:55`). Reading only the global
 * file meant a project that had moved its own session directory was captured
 * from the wrong place, found nothing, and reported nothing.
 *
 * Two details decide how far this goes, and both were settled by executing pi's
 * own settings manager rather than by reading it.
 *
 * pi does gate project settings on trust — untrusted projects merge `{}`
 * (`core/settings-manager.js:276`) — but the manager pi asks for the session
 * directory is built with no options at all (`main.js:515`), and trust there
 * defaults to true (`core/settings-manager.js:169`). The trust prompt runs
 * later, at `main.js:576`, against a different manager. So the project's
 * `sessionDir` is honoured whether or not the project is trusted, and mirroring
 * pi means reading it unconditionally. Confirmed by calling
 * `SettingsManager.create(cwd, agentDir)` against a project file naming
 * `/project/sessions` and a global file naming `/global/sessions`:
 * `getSessionDir()` returned `/project/sessions`.
 *
 * The directory name is pi's `CONFIG_DIR_NAME`, which pi derives from its
 * package (`config.js:403`) and defaults to `.pi`. Hard-coded here for the same
 * reason {@link PI_AGENT_DIR_ENV} is: `pi` is the binary this wrapper spawns.
 */
export function piProjectSettingsPath(cwd: string): string {
  return join(resolve(cwd), ".pi", "settings.json");
}

/**
 * `sessionDir` from one of pi's settings files, or null when the file says
 * nothing usable. Never throws: the whole point of consulting settings is that a
 * user may have moved the directory, not that the file has to be well formed.
 *
 * The byte order mark is stripped before parsing because pi strips it
 * (`core/settings-manager.js:199`, `JSON.parse(stripBom(content))`). Editors on
 * Windows write one by default, and `JSON.parse` rejects it. Without the strip
 * the read throws, the catch below turns that into "nothing is named", and
 * resolution falls through to a directory pi is not writing to — capture then
 * watches an empty place and reports no error, which is the failure this module
 * exists to prevent. Measured against pi 0.85.1: a project settings file written
 * with a leading BOM and naming `/tmp/pi-c2/from-project-bom` was honoured by pi
 * and thrown out by a bare parse.
 */
export async function readSettingsSessionDir(
  settingsPath: string,
): Promise<string | null> {
  let parsed: unknown;
  try {
    const contents = await readFile(settingsPath, "utf8");
    parsed = JSON.parse(
      contents.charCodeAt(0) === 0xfeff ? contents.slice(1) : contents,
    );
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

  // Project settings first: pi merges them over the global ones, so the
  // project's answer is the effective one whenever it has an answer at all.
  const fromProject = await readSettingsSessionDir(piProjectSettingsPath(cwd));
  if (fromProject) return normalizeNamedPiDir(fromProject, home);

  const fromSettings = await readSettingsSessionDir(piSettingsPath(agentDir));
  if (fromSettings) return normalizeNamedPiDir(fromSettings, home);

  return defaultPiProjectSessionsDir({ cwd, agentDir });
}

/**
 * Whether pi will offer the user a session to pick from every project.
 *
 * `--resume` (and its `-r`) opens pi's session picker, and the picker is fed
 * from two lists: this project's sessions, and `SessionManager.listAll`, which
 * is every project's (`main.js:322-328`). Whichever the user picks is then
 * handed to `SessionManager.open`, which writes to that file where it lies. So
 * a resume is the one ordinary launch that can spend its whole life in another
 * project's folder.
 *
 * `--continue` is not this: it takes the most recent session of THIS project
 * (`main.js:334`). Neither is `--session <id>` — a local match is already in the
 * directory, and a match in another project is forked into this one rather than
 * opened in place.
 */
export function offersCrossProjectSessionPicker(
  args: readonly string[],
): boolean {
  for (const arg of args) {
    // pi stops reading flags here, so a `--resume` behind it is a message.
    if (arg === "--") return false;
    if (arg === "--resume" || arg === "-r") return true;
  }
  return false;
}

/**
 * The sessions ROOT to search one level deep as well, or null.
 *
 * Capture normally watches one directory: the folder pi writes this project's
 * sessions into. A resume breaks that assumption, because the session the user
 * picks may belong to another project and pi keeps writing it where it already
 * lives. Watching only this project's folder means the run records nothing and
 * says nothing — and `--resume` is a far more common way to reach another
 * project's session than naming its file.
 *
 * Only the default layout has anywhere else to look. When the user has moved the
 * session directory, pi's picker lists that one directory and nothing else
 * (`core/session-manager.js:1322-1326` takes the flat branch for a custom
 * directory), so the directory already being watched is the whole picker and
 * widening would reach into folders pi is not offering.
 *
 * The cost is stated rather than hidden: one level below the root is every
 * project's sessions, so a plain `pi` the user starts by hand in a DIFFERENT
 * project while this run is going is now inside the window too. That is the
 * second-terminal limit this module already documents, widened from one project
 * to all of them, and it is bounded by the same two filters — the modification
 * window and the per-row clock. It is accepted only for the launch that asks for
 * a cross-project picker.
 *
 * `sessionsDir` is the directory {@link resolvePiSessionDir} already gave the
 * caller. Passing it is not only cheaper — every caller needs that directory
 * anyway, and resolving it twice reads both settings files a second time — it
 * also removes a way for the two answers to disagree: capture would watch one
 * directory while this decided whether to widen from another. The same shape as
 * `codex-rollout-otlp.ts`'s own resolved-directory option. Omitting it resolves,
 * so a caller that has not already done so is not forced to.
 */
export async function crossProjectSessionsRoot({
  toolArgs = [],
  env = process.env,
  home = homedir(),
  cwd = process.cwd(),
  sessionsDir,
}: {
  toolArgs?: readonly string[];
  env?: NodeJS.ProcessEnv;
  home?: string;
  cwd?: string;
  sessionsDir?: string;
} = {}): Promise<string | null> {
  if (!offersCrossProjectSessionPicker(toolArgs)) return null;

  const agentDir = piAgentDir({ env, home });
  const resolved =
    sessionsDir ?? (await resolvePiSessionDir({ toolArgs, env, home, cwd }));
  if (resolved !== defaultPiProjectSessionsDir({ cwd, agentDir })) return null;

  return defaultPiSessionsRoot(agentDir);
}

/**
 * What Langy may run in the shared folder, decided here and nowhere else.
 *
 * The CLI is the trust boundary: it holds the folder root, the read-only set,
 * the grants the user gave this session and the skip state. The chat card is
 * only the way to get the user's answer. Nothing the model says about a
 * command is read; the command is parsed.
 *
 * The read-only set is an allowlist, not a blocklist. Every precedent that
 * used a blocklist, or trusted the model's own opinion of a command, was
 * bypassed.
 *
 * @see specs/langy/langy-local-permissions.feature
 * @see dev/docs/adr/129-langy-local-control.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  LocalCallErrorCode,
  LocalToolCall,
} from "../../../agent/local-control-protocol";

/** What the CLI does with one call. */
export type PolicyDecision =
  | { kind: "run" }
  | { kind: "ask"; summary: string; pattern: string; reason: string }
  | { kind: "refuse"; code: LocalCallErrorCode; message: string };

export interface PolicyInput {
  call: LocalToolCall;
  /** The resolved real path of the shared folder. */
  root: string;
  /** The patterns the user allowed for this session. */
  grants: ReadonlySet<string>;
  skipPermissions: boolean;
  /**
   * How a path becomes its real path. The default resolves the deepest part
   * that exists, so a file that is about to be written still resolves through
   * the symlinks of its parents. Tests pass their own table.
   */
  realpath?: (target: string) => string;
  /** The user's home directory, for a path written with a leading tilde. */
  homedir?: string;
}

/**
 * Commands that only read. Fixed, and short on purpose: a command that is not
 * here asks, which costs one card, while a command that is here by mistake
 * costs the user their machine.
 */
export const READ_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "stat",
  "file",
  "tree",
  "pwd",
  "which",
  "echo",
  "printf",
  "env",
  "printenv",
  "date",
  "uname",
  "id",
  "whoami",
  "du",
  "df",
  "realpath",
  "dirname",
  "basename",
  "sort",
  "uniq",
  "cut",
  "tr",
  "diff",
  "cmp",
]);

/** The git subcommands that only read the repository. */
export const READ_ONLY_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "status",
  "log",
  "diff",
  "show",
  "branch",
  "ls-files",
  "blame",
  "remote",
  "rev-parse",
  "describe",
  "tag",
]);

/**
 * `git branch`, `git tag` and `git remote` read with no arguments and write
 * with these. A flag or a verb from this set takes the part out of the
 * read-only class.
 */
const GIT_WRITE_ARGUMENTS: ReadonlySet<string> = new Set([
  "-d",
  "-D",
  "-f",
  "-m",
  "-M",
  "--delete",
  "--force",
  "--move",
  "--set-upstream",
  "add",
  "rm",
  "remove",
  "rename",
  "prune",
  "set-url",
  "set-head",
  "set-branches",
]);

/** Toolchains that may answer their version and nothing else. */
export const VERSION_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  "node",
  "python",
  "python3",
  "pnpm",
  "npm",
  "yarn",
  "bun",
  "uv",
  "pip",
  "go",
  "cargo",
  "git",
]);

const VERSION_ARGUMENTS: ReadonlySet<string> = new Set([
  "-v",
  "-V",
  "--version",
  "version",
]);

/** Running as another user is refused in every mode. */
const PRIVILEGE_COMMANDS: ReadonlySet<string> = new Set(["sudo", "su", "doas"]);

/** Flags that make an otherwise reading command write. */
const WRITE_FLAGS: ReadonlySet<string> = new Set([
  "-exec",
  "-execdir",
  "-delete",
  "-ok",
  "-okdir",
  "-fls",
  "-fprint",
]);

/** Flags that point a command at another directory. */
const DIRECTORY_FLAGS: ReadonlySet<string> = new Set([
  "-C",
  "--git-dir",
  "--work-tree",
  "--directory",
]);

/** Files that may hold secrets, so a read of one asks. */
const SECRET_FILE_PATTERNS: readonly RegExp[] = [
  /^\.env$/,
  /^\.env\..+$/,
  /\.pem$/,
  /\.key$/,
  /^id_rsa/,
  /^id_ed25519/,
  /^\.netrc$/,
  /^\.npmrc$/,
  /^\.pypirc$/,
  /^credentials/,
];

/** True when the file name is one a secret usually lives in. */
export function isSecretFileName(name: string): boolean {
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

// ---------------------------------------------------------------------------
// Reading a shell command
// ---------------------------------------------------------------------------

/** One part of a compound command: its tokens and what the shell would do. */
export interface CommandPart {
  /** The part as written, for the reason line. */
  text: string;
  /** Tokens with their quotes removed. */
  tokens: string[];
  /** The part sends output to a file or reads one in. */
  hasRedirect: boolean;
}

export interface ParsedCommand {
  parts: CommandPart[];
  /** `$(...)`, a backtick or a process substitution: the parse cannot be trusted. */
  hasSubstitution: boolean;
}

const OPERATORS = ["&&", "||", ";", "|", "&", "\n"];

/**
 * Splits a command into its parts and their tokens.
 *
 * Quotes are honored, so `echo "a && b"` is one part and `cat foo` inside a
 * single-quoted string is not a command. A substitution is reported rather
 * than parsed: what it expands to is not knowable here, so the whole command
 * asks.
 */
export function parseCommand(command: string): ParsedCommand {
  const parts: CommandPart[] = [];
  let hasSubstitution = false;

  let partStart = 0;
  let tokens: string[] = [];
  let token = "";
  let tokenOpen = false;
  let hasRedirect = false;
  let index = 0;

  const endToken = () => {
    if (!tokenOpen) return;
    tokens.push(token);
    token = "";
    tokenOpen = false;
  };

  const endPart = (end: number) => {
    endToken();
    const text = command.slice(partStart, end).trim();
    if (tokens.length > 0 || text !== "") {
      parts.push({ text, tokens, hasRedirect });
    }
    tokens = [];
    hasRedirect = false;
  };

  while (index < command.length) {
    const char = command[index]!;

    if (char === "'") {
      const close = command.indexOf("'", index + 1);
      const end = close === -1 ? command.length : close;
      token += command.slice(index + 1, end);
      tokenOpen = true;
      index = end + 1;
      continue;
    }

    if (char === '"') {
      let cursor = index + 1;
      while (cursor < command.length && command[cursor] !== '"') {
        if (command[cursor] === "\\" && cursor + 1 < command.length) {
          token += command[cursor + 1];
          cursor += 2;
          continue;
        }
        if (command[cursor] === "$" && command[cursor + 1] === "(") {
          hasSubstitution = true;
        }
        if (command[cursor] === "`") hasSubstitution = true;
        token += command[cursor];
        cursor += 1;
      }
      tokenOpen = true;
      index = cursor + 1;
      continue;
    }

    if (char === "\\" && index + 1 < command.length) {
      token += command[index + 1];
      tokenOpen = true;
      index += 2;
      continue;
    }

    if (char === "`" || (char === "$" && command[index + 1] === "(")) {
      hasSubstitution = true;
      token += char;
      tokenOpen = true;
      index += 1;
      continue;
    }

    if ((char === "<" || char === ">") && command[index + 1] === "(") {
      hasSubstitution = true;
      hasRedirect = true;
      index += 2;
      continue;
    }

    if (char === ">" || char === "<") {
      endToken();
      hasRedirect = true;
      index += 1;
      continue;
    }

    // `2>file` and `&>file`: the digit or ampersand belongs to the redirect.
    if (/[0-9&]/.test(char) && command[index + 1] === ">" && !tokenOpen) {
      hasRedirect = true;
      index += 2;
      continue;
    }

    const operator = OPERATORS.find((entry) => command.startsWith(entry, index));
    if (operator) {
      endPart(index);
      index += operator.length;
      partStart = index;
      continue;
    }

    if (/\s/.test(char)) {
      endToken();
      index += 1;
      if (!tokenOpen && tokens.length === 0) partStart = index;
      continue;
    }

    token += char;
    tokenOpen = true;
    index += 1;
  }

  endPart(command.length);
  return { parts, hasSubstitution };
}

/**
 * Interpreter names that run the same program under two spellings.
 *
 * A grant is keyed on the command name, so `python3 -m compileall` asked
 * again after the user had already allowed `python -m compileall`, and the
 * two cards read the same. The alias folds into one name, and the pattern the
 * card offers covers the interpreter: what an interpreter runs is its
 * argument, so a per-argument grant would ask again for the next script
 * anyway.
 *
 * Grants only. Nothing else in the policy reads this: the read-only set and
 * the refusals still see the name the command actually wrote.
 */
export const INTERPRETER_ALIASES: ReadonlyMap<string, string> = new Map([
  ["python", "python"],
  ["python3", "python"],
  ["node", "node"],
  ["nodejs", "node"],
  ["pip", "pip"],
  ["pip3", "pip"],
]);

/** The name a grant is keyed on. An interpreter alias folds into one name. */
export function grantName(name: string): string {
  return INTERPRETER_ALIASES.get(name) ?? name;
}

/** The pattern "allow for this session" would grant for one command part. */
export function grantPatternFor(tokens: string[]): string {
  const name = tokens[0] ?? "";
  if (INTERPRETER_ALIASES.has(name)) return `${grantName(name)} *`;
  const first = tokens.slice(1).find((token) => !token.startsWith("-"));
  return first === undefined ? `${name} *` : `${name} ${first}`;
}

/** True when the session grants cover this command part. */
export function grantsAllow({
  tokens,
  grants,
}: {
  tokens: string[];
  grants: ReadonlySet<string>;
}): boolean {
  const name = tokens[0];
  if (name === undefined || name === "") return false;
  return (
    grants.has(grantPatternFor(tokens)) || grants.has(`${grantName(name)} *`)
  );
}

/** True when the token names a program by its path rather than by its name. */
const namesAPath = (token: string): boolean =>
  token.includes("/") || token.includes("\\");

const isEnvironmentAssignment = (token: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);

/**
 * Why this part is not read-only, or null when it is. The message is the
 * `reason` the permission card shows, so it names the part.
 */
function readOnlyRefusal(part: CommandPart): string | null {
  const [name, ...args] = part.tokens;
  const quoted = `"${part.text}"`;
  if (name === undefined || name === "") return `${quoted} is empty`;
  if (isEnvironmentAssignment(name)) {
    return `${quoted} sets environment variables before the command`;
  }
  if (part.hasRedirect) return `${quoted} redirects to or from a file`;
  const writeFlag = args.find((argument) => WRITE_FLAGS.has(argument));
  if (writeFlag) return `${quoted} uses ${writeFlag}, which runs or removes files`;
  if (namesAPath(name)) {
    return `${quoted} names its program by path, so it is not read-only`;
  }
  if (args.some((argument) => DIRECTORY_FLAGS.has(argument))) {
    return `${quoted} points at another directory`;
  }

  if (name === "git") {
    const subcommand = args.find((argument) => !argument.startsWith("-"));
    if (subcommand === undefined) {
      return VERSION_ARGUMENTS.has(args[0] ?? "")
        ? null
        : `${quoted} is not a read-only git command`;
    }
    if (!READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
      return `${quoted} is not a read-only git command`;
    }
    const write = args.find((argument) => GIT_WRITE_ARGUMENTS.has(argument));
    if (write) return `${quoted} uses ${write}, which changes the repository`;
    return null;
  }

  if (VERSION_ONLY_COMMANDS.has(name)) {
    const asked = args.length === 1 && VERSION_ARGUMENTS.has(args[0]!);
    return asked ? null : `${quoted} runs ${name}, which is not read-only`;
  }

  if (!READ_ONLY_COMMANDS.has(name)) {
    return `${quoted} is not in the read-only set`;
  }

  // `env` and `printenv` print the environment with no operand and run
  // whatever they are given with one.
  if ((name === "env" || name === "printenv") && args.some((a) => !a.startsWith("-"))) {
    return `${quoted} runs a command through ${name}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// The folder boundary
// ---------------------------------------------------------------------------

/**
 * The real path of a target that may not exist yet: the deepest part that
 * does exist is resolved through its symlinks and the rest is appended. A
 * file about to be written is therefore checked against the boundary its
 * parents really have.
 */
const defaultRealpath = (target: string): string => {
  let current = path.resolve(target);
  const suffix: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...suffix.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      suffix.push(path.basename(current));
      current = parent;
    }
  }
};

export interface PathCheck {
  /** The path after tilde expansion, resolution against the root and realpath. */
  resolved: string;
  inside: boolean;
}

/** Where a path argument really points, and whether that is inside the folder. */
export function resolvePathInsideRoot({
  target,
  root,
  realpath = defaultRealpath,
  homedir,
}: {
  target: string;
  root: string;
  realpath?: (value: string) => string;
  homedir?: string;
}): PathCheck {
  const home = homedir ?? process.env.HOME ?? "";
  const expanded =
    target === "~" || target.startsWith("~/")
      ? path.join(home, target.slice(1))
      : target;
  const absolute = path.resolve(root, expanded);
  const resolved = realpath(absolute);
  const rootReal = realpath(root);
  const inside =
    resolved === rootReal || resolved.startsWith(`${rootReal}${path.sep}`);
  return { resolved, inside };
}

const outsideMessage = ({
  target,
  resolved,
  root,
}: {
  target: string;
  resolved: string;
  root: string;
}): string =>
  `Only paths inside ${root} are allowed. "${target}" resolves to ${resolved}, which is outside it.`;

/**
 * True when a shell argument is worth checking against the folder boundary.
 *
 * Best effort, and deliberately wide: every plain argument is a candidate,
 * because a bare name can be a symlink that leaves the folder. A word that is
 * not a path resolves inside the folder anyway, so a wide net costs nothing
 * and a narrow one misses `cat outside-link`.
 */
export function looksLikeAPath(token: string): boolean {
  if (token === "" || token.startsWith("-")) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) return false;
  return !isEnvironmentAssignment(token);
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

const TOOL_VERBS: Record<LocalToolCall["tool"], string> = {
  local_read: "read",
  local_write: "write",
  local_edit: "edit",
  local_bash: "bash",
  local_grep: "grep",
  local_find: "find",
  local_ls: "ls",
};

/** The paths one call touches, in the order they were written. */
function pathsOf(call: LocalToolCall): string[] {
  switch (call.tool) {
    case "local_read":
    case "local_write":
    case "local_edit":
      return [call.params.path];
    case "local_grep":
    case "local_find":
    case "local_ls":
      return call.params.path === undefined ? [] : [call.params.path];
    case "local_bash":
      return [];
  }
}

const refusePath = (message: string): PolicyDecision => ({
  kind: "refuse",
  code: "path_refused",
  message,
});

/** The decision for a file tool: the boundary, then the secret-file rule. */
function decideFileTool({
  call,
  root,
  realpath,
  homedir,
}: {
  call: LocalToolCall;
  root: string;
  realpath?: (value: string) => string;
  homedir?: string;
}): PolicyDecision {
  for (const target of pathsOf(call)) {
    const check = resolvePathInsideRoot({ target, root, realpath, homedir });
    if (!check.inside) {
      return refusePath(
        outsideMessage({ target, resolved: check.resolved, root }),
      );
    }
    const name = path.basename(check.resolved);
    if (isSecretFileName(name)) {
      const verb = TOOL_VERBS[call.tool];
      return {
        kind: "ask",
        summary: `${verb} ${target}`,
        pattern: `${call.tool} ${target}`,
        reason: `${name} may hold secrets`,
      };
    }
  }
  return { kind: "run" };
}

/** The decision for a command: the refusals first, then the read-only set. */
function decideBash({
  command,
  root,
  grants,
  realpath,
  homedir,
}: {
  command: string;
  root: string;
  grants: ReadonlySet<string>;
  realpath?: (value: string) => string;
  homedir?: string;
}): PolicyDecision {
  const parsed = parseCommand(command);

  // Refusals hold in every mode, so they are decided before anything else.
  for (const part of parsed.parts) {
    for (const token of part.tokens) {
      if (PRIVILEGE_COMMANDS.has(token)) {
        return {
          kind: "refuse",
          code: "command_refused",
          message: `The folder is shared without administrator rights, so ${token} cannot run.`,
        };
      }
    }
    const escape = boundaryEscape({ part, root, realpath, homedir });
    if (escape) return refusePath(escape);
  }

  if (parsed.parts.length === 0) {
    return {
      kind: "ask",
      summary: command,
      pattern: "* *",
      reason: `"${command}" could not be read as a command`,
    };
  }

  if (parsed.hasSubstitution) {
    const first = parsed.parts[0]!;
    return {
      kind: "ask",
      summary: command,
      pattern: grantPatternFor(first.tokens),
      reason: `"${command}" runs a command substitution, so what it does is not knowable here`,
    };
  }

  for (const part of parsed.parts) {
    const refusal = readOnlyRefusal(part);
    if (refusal === null) continue;
    if (grantsAllow({ tokens: part.tokens, grants })) continue;
    return {
      kind: "ask",
      summary: command,
      pattern: grantPatternFor(part.tokens),
      reason: refusal,
    };
  }

  return { kind: "run" };
}

/**
 * The path this part would leave the folder through, or null. Every argument
 * that looks like a path is checked, and the argument of `cd` and of a
 * directory flag is checked whatever it looks like.
 *
 * The first token is the program, not a path the command reads: `/usr/bin/ls`
 * asks because it is not a bare name, which is a clearer answer than refusing
 * it for living outside the folder.
 */
function boundaryEscape({
  part,
  root,
  realpath,
  homedir,
}: {
  part: CommandPart;
  root: string;
  realpath?: (value: string) => string;
  homedir?: string;
}): string | null {
  const named = new Set<string>();
  for (let index = 0; index < part.tokens.length; index += 1) {
    const token = part.tokens[index]!;
    const next = part.tokens[index + 1];
    if ((token === "cd" || DIRECTORY_FLAGS.has(token)) && next !== undefined) {
      named.add(next);
      continue;
    }
    const equals = /^--[A-Za-z0-9-]+=(.+)$/.exec(token);
    if (equals) {
      named.add(equals[1]!);
      continue;
    }
    if (index > 0 && looksLikeAPath(token)) named.add(token);
  }
  for (const target of named) {
    const check = resolvePathInsideRoot({ target, root, realpath, homedir });
    if (!check.inside) {
      return outsideMessage({ target, resolved: check.resolved, root });
    }
  }
  return null;
}

/**
 * What the CLI does with one call: run it, ask the user in the panel, or
 * refuse it with a pushback the model can act on.
 *
 * Skipping permission checks turns every ask into a run. It never turns a
 * refusal into a run: the folder boundary and the privilege rule hold in
 * every mode.
 */
export function decide({
  call,
  root,
  grants,
  skipPermissions,
  realpath,
  homedir,
}: PolicyInput): PolicyDecision {
  const decision =
    call.tool === "local_bash"
      ? decideBash({
          command: call.params.command,
          root,
          grants,
          realpath,
          homedir,
        })
      : decideFileTool({ call, root, realpath, homedir });

  if (skipPermissions && decision.kind === "ask") return { kind: "run" };
  return decision;
}

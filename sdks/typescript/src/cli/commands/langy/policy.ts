/**
 * What Langy may run in the shared folder, decided here and nowhere else.
 * The CLI is the trust boundary; the command is parsed, never trusted from
 * what the model says about it. See dev/docs/adr/129-langy-local-control.md.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  CommandSegment,
  LocalCallErrorCode,
  LocalToolCall,
} from "../../../agent/local-control-protocol";

/** What the CLI does with one call. */
export type PolicyDecision =
  | { kind: "run" }
  | {
      kind: "ask";
      summary: string;
      /** The pattern the first segment that is not read-only would grant. */
      pattern: string;
      /** Every pattern an "allow this pattern" answer covers. */
      patterns: string[];
      reason: string;
      /** Set for a command: every segment of the chain, in the order it runs. */
      segments?: CommandSegment[];
    }
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
 * Git subcommands whose operands decide what they do — e.g. `git branch`
 * lists but `git branch new-name` creates. Each reads in its bare form when
 * `bare` is true, and with the verbs named here; every other operand asks.
 */
const GIT_OPERAND_RULES: ReadonlyMap<
  string,
  { bare: boolean; verbs: ReadonlySet<string>; lists?: boolean }
> = new Map([
  ["branch", { bare: true, verbs: new Set<string>(), lists: true }],
  ["tag", { bare: true, verbs: new Set<string>(), lists: true }],
  ["remote", { bare: true, verbs: new Set(["get-url"]) }],
  ["worktree", { bare: false, verbs: new Set(["list"]) }],
]);

/**
 * The options that make `git branch` and `git tag` list.
 * With one of these the operands are patterns and references rather than
 * the name of something to write, e.g. `git branch --list "langy/*"`.
 */
const GIT_LIST_OPTIONS: ReadonlySet<string> = new Set([
  "--list",
  "-l",
  "--show-current",
  "--contains",
  "--no-contains",
  "--merged",
  "--no-merged",
  "--points-at",
  "--sort",
  "--format",
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

/**
 * The `gh` invocations that only read, written out in full. Everything
 * else `gh` does reaches GitHub and asks.
 */
export const READ_ONLY_GH_ARGUMENTS: readonly (readonly string[])[] = [
  ["auth", "status"],
  ["--version"],
  ["version"],
];

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

const VERSION_ARGUMENTS: ReadonlySet<string> = new Set(["-v", "-V", "--version", "version"]);

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

/**
 * Read-only commands whose options or operands write something, e.g.
 * `sort -o out in` writes a file and `date -s` sets the clock.
 */
const READ_ONLY_COMMAND_RULES: ReadonlyMap<
  string,
  { writeOptions?: ReadonlySet<string>; maxOperands?: number }
> = new Map([
  ["sort", { writeOptions: new Set(["-o", "--output"]) }],
  ["tree", { writeOptions: new Set(["-o"]) }],
  ["date", { writeOptions: new Set(["-s", "--set", "-f", "--file"]) }],
  ["uniq", { maxOperands: 1 }],
]);

/** The `env` options that only change what the command it runs inherits. */
const ENV_UNDERSTOOD_OPTIONS: ReadonlySet<string> = new Set([
  "-i",
  "--ignore-environment",
  "-0",
  "--null",
  "-u",
  "--unset",
]);

/** Flags that point a command at another directory. */
const DIRECTORY_FLAGS: ReadonlySet<string> = new Set([
  "-C",
  "--git-dir",
  "--work-tree",
  "--directory",
]);

/**
 * Environment files that are committed on purpose and carry placeholders
 * rather than values. Reading one is the normal first step of instrumenting a
 * project, so it must not spend a card.
 */
const EXAMPLE_ENV_FILE = /^\.env\.(example|sample|template|dist)$/i;

/** Files that may hold secrets, so a read of one asks. */
const SECRET_FILE_PATTERNS: readonly RegExp[] = [
  /^\.env$/,
  /^\.env\..+$/,
  /^\.envrc$/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /\.jks$/,
  /\.keystore$/,
  /\.token$/,
  /^id_rsa/,
  /^id_ed25519/,
  /^\.netrc$/,
  /^\.npmrc$/,
  /^\.pypirc$/,
  /^\.pgpass$/,
  /^\.my\.cnf$/,
  /^\.htpasswd$/,
  /^\.git-credentials$/,
  /^credentials/,
  /^tokens?$/i,
  /secret/i,
];

/**
 * Directories whose files are credentials whatever they are called, and the
 * files that carry one inside a folder that is otherwise ordinary (e.g.
 * `.git/config` holds the remote urls, including any token in one).
 */
const SECRET_DIRECTORIES: readonly string[] = [".ssh", ".aws"];

const SECRET_RELATIVE_PATHS: readonly string[] = [".git/config", ".docker/config.json"];

/** True when the file name is one a secret usually lives in. */
export function isSecretFileName(name: string): boolean {
  if (EXAMPLE_ENV_FILE.test(name)) return false;
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * True when a path names a file that may hold secrets: by its own name, by
 * the directory it sits in, or because it is one of the files a project
 * keeps credentials in under an ordinary name.
 */
export function isSecretPath(target: string): boolean {
  const parts = target.split(/[/\\]/).filter((part) => part !== "" && part !== ".");
  const name = parts[parts.length - 1] ?? "";
  if (isSecretFileName(name)) return true;
  const written = parts.join("/");
  if (
    SECRET_RELATIVE_PATHS.some((secret) => written === secret || written.endsWith(`/${secret}`))
  ) {
    return true;
  }
  return parts.slice(0, -1).some((segment) => SECRET_DIRECTORIES.includes(segment));
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
  /**
   * True at the index of a token the shell read as a whole quoted string
   * literal. A token that mixes quoted and bare characters is not one.
   */
  quoted: boolean[];
  /** True at the index of a token a redirect sends output to or reads from. */
  redirectTarget: boolean[];
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
 * Splits a command into its parts and their tokens. Quotes are honored, so
 * `echo "a && b"` is one part. A substitution is reported rather than
 * parsed, since what it expands to is not knowable here.
 */
export function parseCommand(command: string): ParsedCommand {
  const parts: CommandPart[] = [];
  let hasSubstitution = false;

  let partStart = 0;
  let tokens: string[] = [];
  let quoted: boolean[] = [];
  let redirectTarget: boolean[] = [];
  let token = "";
  let tokenOpen = false;
  let tokenQuoted = false;
  let tokenBare = false;
  let redirectPending = false;
  let hasRedirect = false;
  let index = 0;

  const endToken = () => {
    if (!tokenOpen) return;
    tokens.push(token);
    quoted.push(tokenQuoted && !tokenBare);
    redirectTarget.push(redirectPending);
    token = "";
    tokenOpen = false;
    tokenQuoted = false;
    tokenBare = false;
    redirectPending = false;
  };

  const endPart = (end: number) => {
    endToken();
    const text = command.slice(partStart, end).trim();
    if (tokens.length > 0 || text !== "") {
      parts.push({ text, tokens, quoted, redirectTarget, hasRedirect });
    }
    tokens = [];
    quoted = [];
    redirectTarget = [];
    redirectPending = false;
    hasRedirect = false;
  };

  while (index < command.length) {
    const char = command[index]!;

    if (char === "'") {
      const close = command.indexOf("'", index + 1);
      const end = close === -1 ? command.length : close;
      token += command.slice(index + 1, end);
      tokenOpen = true;
      tokenQuoted = true;
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
      tokenQuoted = true;
      index = cursor + 1;
      continue;
    }

    if (char === "\\" && index + 1 < command.length) {
      token += command[index + 1];
      tokenOpen = true;
      tokenBare = true;
      index += 2;
      continue;
    }

    if (char === "`" || (char === "$" && command[index + 1] === "(")) {
      hasSubstitution = true;
      token += char;
      tokenOpen = true;
      tokenBare = true;
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
      redirectPending = true;
      index += 1;
      continue;
    }

    // `2>file` and `&>file`: the digit or ampersand belongs to the redirect.
    if (/[0-9&]/.test(char) && command[index + 1] === ">" && !tokenOpen) {
      hasRedirect = true;
      redirectPending = true;
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
    tokenBare = true;
    index += 1;
  }

  endPart(command.length);
  return { parts, hasSubstitution };
}

/**
 * Interpreter names that run the same program under two spellings, so a
 * grant on one spelling covers the other. Grants only: the read-only set
 * and refusals still see the name the command actually wrote.
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

/**
 * The pattern "allow for this session" would grant: the program and its
 * first argument, so `git commit` grants commits, not every git command.
 */
export function grantPatternFor({
  tokens,
  quoted = [],
}: {
  tokens: string[];
  quoted?: boolean[];
}): string {
  const name = grantName(tokens[0] ?? "");
  const argument = tokens[1];
  if (argument === undefined || argument === "" || quoted[1] === true) {
    return `${name} *`;
  }
  return `${name} ${argument}`;
}

/** True when the session grants cover this command part. */
export function grantsAllow({
  tokens,
  quoted,
  grants,
}: {
  tokens: string[];
  quoted?: boolean[];
  grants: ReadonlySet<string>;
}): boolean {
  const name = tokens[0];
  if (name === undefined || name === "") return false;
  const pattern = grantPatternFor({
    tokens,
    ...(quoted === undefined ? {} : { quoted }),
  });
  return grants.has(pattern) || grants.has(`${grantName(name)} *`);
}

/** True when the token names a program by its path rather than by its name. */
const namesAPath = (token: string): boolean => token.includes("/") || token.includes("\\");

const isEnvironmentAssignment = (token: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);

/**
 * True when this part runs on its own, with no card. What the part does
 * with the machine is a separate question, answered by `effectOf`.
 */
function isReadOnlyPart(part: CommandPart): boolean {
  const [name, ...args] = part.tokens;
  if (name === undefined || name === "") return false;
  if (isEnvironmentAssignment(name)) return false;
  if (part.hasRedirect) return false;
  if (args.some((argument) => WRITE_FLAGS.has(argument))) return false;
  if (namesAPath(name)) return false;
  if (args.some((argument) => DIRECTORY_FLAGS.has(argument))) return false;

  if (name === "git") return isReadOnlyGit(args);

  if (name === "gh") {
    return READ_ONLY_GH_ARGUMENTS.some((allowed) => allowed.join(" ") === args.join(" "));
  }

  if (VERSION_ONLY_COMMANDS.has(name)) {
    return args.length === 1 && VERSION_ARGUMENTS.has(args[0]!);
  }

  if (!READ_ONLY_COMMANDS.has(name)) return false;

  // The environment holds the keys of every tool on this machine, so printing
  // it is a read of secrets whichever command prints it.
  if (name === "printenv") return false;
  if (name === "env") return isReadOnlyEnv(part);

  const rule = READ_ONLY_COMMAND_RULES.get(name);
  if (rule !== undefined) {
    if (
      rule.writeOptions !== undefined &&
      args.some((argument) => carriesOption(argument, rule.writeOptions!))
    ) {
      return false;
    }
    const operands = args.filter((argument) => !argument.startsWith("-"));
    if (rule.maxOperands !== undefined && operands.length > rule.maxOperands) {
      return false;
    }
  }

  return true;
}

/**
 * True when an argument carries one of these options, however it is
 * written: a short option can attach to its value or combine with others,
 * so `sort -o out`, `sort -oout` and `sort --output=out` all write a file.
 */
export function carriesOption(argument: string, options: ReadonlySet<string>): boolean {
  if (!argument.startsWith("-") || argument === "-" || argument === "--") {
    return false;
  }
  if (argument.startsWith("--")) return options.has(argument.split("=")[0]!);
  const letters = argument.slice(1);
  for (const option of options) {
    if (option.startsWith("--") || option.length !== 2) continue;
    if (letters.includes(option.slice(1))) return true;
  }
  return false;
}

/**
 * True when a git command only reads the repository: a read-only subcommand
 * with a write operand still writes.
 */
export function isReadOnlyGit(args: string[]): boolean {
  if (args.some((argument) => GIT_WRITE_ARGUMENTS.has(argument))) return false;
  const words = args.filter((argument) => !argument.startsWith("-"));
  const [subcommand, ...operands] = words;
  if (subcommand === undefined) return VERSION_ARGUMENTS.has(args[0] ?? "");
  const rule = GIT_OPERAND_RULES.get(subcommand);
  if (rule !== undefined) {
    if (
      rule.lists === true &&
      args.some((argument) => GIT_LIST_OPTIONS.has(argument.split("=")[0]!))
    ) {
      return true;
    }
    if (operands.length === 0) return rule.bare;
    return operands.length <= 2 && rule.verbs.has(operands[0]!);
  }
  return READ_ONLY_GIT_SUBCOMMANDS.has(subcommand);
}

/**
 * True when an `env` invocation only prepares the environment of a command
 * that is itself read-only. The forms written in `envCommandStart` are the
 * only ones that run without a question.
 */
export function isReadOnlyEnv(part: CommandPart): boolean {
  const start = envCommandStart(part.tokens);
  if (start === null || start >= part.tokens.length) return false;
  return isReadOnlyPart({
    ...part,
    tokens: part.tokens.slice(start),
    quoted: part.quoted.slice(start),
    redirectTarget: part.redirectTarget.slice(start),
  });
}

/**
 * Where the command an `env` runs starts, the token length when there is
 * none, and null when the arguments are not understood.
 */
export function envCommandStart(tokens: string[]): number | null {
  let index = 1;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (!token.startsWith("-")) {
      if (isEnvironmentAssignment(token)) {
        index += 1;
        continue;
      }
      return index;
    }
    const flag = token.split("=")[0]!;
    if (!ENV_UNDERSTOOD_OPTIONS.has(flag)) return null;
    // `-u NAME` and `--unset NAME` name a variable in the next token.
    if ((flag === "-u" || flag === "--unset") && !token.includes("=")) {
      index += 1;
    }
    index += 1;
  }
  return tokens.length;
}

// ---------------------------------------------------------------------------
// What a command changes
// ---------------------------------------------------------------------------

/**
 * What one part of a command does to the machine. The card's reason is built
 * from these classes rather than restating the command, so it says what the
 * answer allows.
 */
export type CommandEffect =
  | "writes_files"
  | "changes_repository"
  | "reaches_network"
  | "installs_packages"
  | "runs_checks"
  | "reads_environment"
  | "runs_program";

/** The clause each class contributes to the reason sentence. */
const EFFECT_CLAUSES: Record<CommandEffect, string> = {
  writes_files: "writes files in the folder",
  changes_repository: "changes the git repository",
  reaches_network: "reaches the network",
  installs_packages: "installs packages",
  runs_checks: "runs the project's own checks",
  reads_environment: "prints the environment, which may hold secrets",
  runs_program: "runs a program that is not read-only",
};

/** The order the clauses read in, whatever order the segments run in. */
const EFFECT_ORDER: readonly CommandEffect[] = [
  "writes_files",
  "changes_repository",
  "installs_packages",
  "reaches_network",
  "reads_environment",
  "runs_checks",
  "runs_program",
];

/** Git subcommands that talk to a remote. */
const GIT_NETWORK_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "push",
  "pull",
  "fetch",
  "clone",
  "submodule",
]);

/** Commands whose whole purpose is a request to another machine. */
const NETWORK_COMMANDS: ReadonlySet<string> = new Set([
  "curl",
  "wget",
  "ssh",
  "scp",
  "rsync",
  "gh",
  "docker",
  "npx",
]);

/** The verbs that make a package manager fetch and install. */
const INSTALL_VERBS: ReadonlySet<string> = new Set([
  "install",
  "add",
  "sync",
  "ci",
  "update",
  "upgrade",
  "get",
]);

/** Package managers, which install with a verb and run scripts without one. */
const PACKAGE_MANAGERS: ReadonlySet<string> = new Set([
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "pip",
  "pip3",
  "uv",
  "poetry",
  "cargo",
  "go",
  "brew",
]);

/** Tokens that name a check the project runs on itself. */
const CHECK_TOKENS: ReadonlySet<string> = new Set([
  "test",
  "tests",
  "typecheck",
  "lint",
  "check",
  "pytest",
  "vitest",
  "jest",
  "mypy",
  "ruff",
  "eslint",
  "tsc",
  "compileall",
]);

/** Commands that create, move or remove files. */
const FILE_WRITE_COMMANDS: ReadonlySet<string> = new Set([
  "rm",
  "mv",
  "cp",
  "mkdir",
  "rmdir",
  "touch",
  "chmod",
  "chown",
  "ln",
  "tee",
  "sed",
  "truncate",
]);

/** What one part of a command changes. */
export function effectOf(part: CommandPart): CommandEffect {
  const [name, ...args] = part.tokens;
  if (name === undefined || name === "") return "runs_program";
  if (part.hasRedirect) return "writes_files";
  if (args.some((argument) => WRITE_FLAGS.has(argument))) return "writes_files";

  const verb = args.find((argument) => !argument.startsWith("-"));

  if (name === "printenv") return "reads_environment";
  if (name === "env" && envCommandStart(part.tokens) === part.tokens.length) {
    return "reads_environment";
  }

  if (name === "git") {
    if (verb !== undefined && GIT_NETWORK_SUBCOMMANDS.has(verb)) {
      return "reaches_network";
    }
    return "changes_repository";
  }
  if (PACKAGE_MANAGERS.has(name) && verb !== undefined && INSTALL_VERBS.has(verb)) {
    return "installs_packages";
  }
  if (args.some((argument) => CHECK_TOKENS.has(argument))) return "runs_checks";
  if (CHECK_TOKENS.has(name)) return "runs_checks";
  if (NETWORK_COMMANDS.has(name)) return "reaches_network";
  if (FILE_WRITE_COMMANDS.has(name)) return "writes_files";
  return "runs_program";
}

/**
 * The reason the card shows: one sentence about what the answer allows. It
 * never quotes the command, since the card already renders it.
 */
export function reasonFor(parts: CommandPart[]): string {
  const effects = new Set(parts.map(effectOf));
  const clauses = EFFECT_ORDER.filter((effect) => effects.has(effect)).map(
    (effect) => EFFECT_CLAUSES[effect],
  );
  if (clauses.length === 0) return "This runs a command that is not read-only.";
  const last = clauses[clauses.length - 1]!;
  const sentence = clauses.length === 1 ? last : `${clauses.slice(0, -1).join(", ")} and ${last}`;
  return `This ${sentence}.`;
}

// ---------------------------------------------------------------------------
// The folder boundary
// ---------------------------------------------------------------------------

/**
 * The real path of a target that may not exist yet: the deepest part that
 * does exist is resolved through its symlinks and the rest is appended.
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
    target === "~" || target.startsWith("~/") ? path.join(home, target.slice(1)) : target;
  const absolute = path.resolve(root, expanded);
  const resolved = realpath(absolute);
  const rootReal = realpath(root);
  const inside = resolved === rootReal || resolved.startsWith(`${rootReal}${path.sep}`);
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
  `Only paths inside ${root} are allowed. The argument "${target}" was read as a path, and it points at ${resolved}, which is outside the folder.`;

/** Commands whose arguments are text to print rather than files to open. */
const TEXT_PRINTING_COMMANDS: ReadonlySet<string> = new Set(["printf", "echo"]);

/**
 * Escape sequences and printf conversions. A path carries neither, so a quoted
 * string that carries one is text whatever command reads it.
 */
const TEXT_MARKERS = /\\[ntrvfe0]|%[-+ #0-9.]*[sdiufgxXc%]/;

/**
 * True when a quoted argument is text the command prints or matches rather
 * than a path it opens, e.g. `printf '\nDEFAULT=/etc/paths\n'`. A quoted
 * argument to any other command is still a path.
 */
export function isTextArgument({
  name,
  token,
  quoted,
}: {
  name: string;
  token: string;
  quoted: boolean;
}): boolean {
  if (!quoted) return false;
  if (TEXT_PRINTING_COMMANDS.has(name)) return true;
  return TEXT_MARKERS.test(token);
}

/**
 * True when a shell argument is worth checking against the folder boundary.
 * Best effort, and deliberately wide: a bare name can be a symlink that
 * leaves the folder, e.g. `cat outside-link`.
 */
export function looksLikeAPath(token: string): boolean {
  if (token === "" || token.startsWith("-")) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) return false;
  return !isEnvironmentAssignment(token);
}

/**
 * Commands whose bare words are their own vocabulary rather than file names,
 * e.g. `git symbolic-ref --short HEAD`. These read a file only when the
 * argument is written the way a path is written.
 */
const VOCABULARY_COMMANDS: ReadonlySet<string> = new Set(["git", "gh"]);

/** A token written the way a file name is written. */
const WRITTEN_AS_A_PATH = /[/\\]|^[.~]/;

/**
 * True when a token of this command is worth checking against the boundary.
 * The net stays wide for every other command: a bare name can be a symlink
 * that leaves the folder.
 */
export function isPathCandidate({
  name,
  token,
  afterEndOfOptions = false,
}: {
  name: string;
  token: string;
  afterEndOfOptions?: boolean;
}): boolean {
  if (!looksLikeAPath(token)) return false;
  if (afterEndOfOptions) return true;
  if (!VOCABULARY_COMMANDS.has(name)) return true;
  return WRITTEN_AS_A_PATH.test(token);
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
      return refusePath(outsideMessage({ target, resolved: check.resolved, root }));
    }
    const name = path.basename(check.resolved);
    // Both spellings are read: the path as it was written, and the path it
    // really points at, so a link into `.ssh` is judged as `.ssh`.
    if (isSecretPath(target) || isSecretPath(check.resolved)) {
      const verb = TOOL_VERBS[call.tool];
      return {
        kind: "ask",
        summary: `${verb} ${target}`,
        pattern: `${call.tool} ${target}`,
        patterns: [`${call.tool} ${target}`],
        reason: `${name} may hold secrets, so it is not read for you without an answer.`,
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
      patterns: ["* *"],
      reason: "This could not be read as a command, so what it does is unknown.",
      segments: [{ command, pattern: "* *", readOnly: false }],
    };
  }

  // A part that names a file which may hold secrets is never read-only, so
  // the shell asks for the same answer a read of that file asks for.
  const readsOnly = (part: CommandPart): boolean =>
    !parsed.hasSubstitution && isReadOnlyPart(part) && secretFileRead(part) === null;

  const segments: CommandSegment[] = parsed.parts.map((part) => ({
    command: part.text,
    pattern: grantPatternFor({ tokens: part.tokens, quoted: part.quoted }),
    readOnly: readsOnly(part),
  }));

  if (parsed.hasSubstitution) {
    return {
      kind: "ask",
      summary: command,
      pattern: segments[0]!.pattern,
      patterns: segments.map((segment) => segment.pattern),
      reason: "This runs a command substitution, so what it does is not knowable before it runs.",
      segments,
    };
  }

  const writing = parsed.parts.filter((part) => !readsOnly(part));
  const unanswered = writing.filter(
    (part) => !grantsAllow({ tokens: part.tokens, quoted: part.quoted, grants }),
  );
  if (unanswered.length === 0) return { kind: "run" };

  // The answer covers every segment the card lists, not only the first one:
  // a chain that stages, commits and pushes granted `git add` and ran the
  // rest under it.
  const patterns = [
    ...new Set(
      writing.map((part) => grantPatternFor({ tokens: part.tokens, quoted: part.quoted })),
    ),
  ];
  const secret = unanswered.map((part) => secretFileRead(part)).find((name) => name !== null);
  return {
    kind: "ask",
    summary: command,
    pattern: grantPatternFor({
      tokens: unanswered[0]!.tokens,
      quoted: unanswered[0]!.quoted,
    }),
    patterns,
    reason:
      secret === undefined || secret === null
        ? reasonFor(writing)
        : `${secret} may hold secrets, so it is not read for you without an answer.`,
    segments,
  };
}

/**
 * Every token of this part that names a file or a directory. The first
 * token (the program) is never named. See `isPathCandidate`.
 */
export function pathTokensOf(part: CommandPart): string[] {
  const name = part.tokens[0] ?? "";
  const named = new Set<string>();
  let afterEndOfOptions = false;
  for (let index = 0; index < part.tokens.length; index += 1) {
    const token = part.tokens[index]!;
    const next = part.tokens[index + 1];
    if (part.redirectTarget[index] === true) {
      named.add(token);
      continue;
    }
    if ((token === "cd" || DIRECTORY_FLAGS.has(token)) && next !== undefined) {
      named.add(next);
      continue;
    }
    const equals = /^(--[A-Za-z0-9-]+)=(.+)$/.exec(token);
    if (equals) {
      const flag = equals[1]!;
      const value = equals[2]!;
      if (DIRECTORY_FLAGS.has(flag) || isPathCandidate({ name, token: value, afterEndOfOptions })) {
        named.add(value);
      }
      continue;
    }
    if (token === "--") {
      afterEndOfOptions = true;
      continue;
    }
    if (index === 0) continue;
    if (isTextArgument({ name, token, quoted: part.quoted[index] === true })) {
      continue;
    }
    if (isPathCandidate({ name, token, afterEndOfOptions })) named.add(token);
  }
  return [...named];
}

/** File names a wildcard is measured against, for the secret-file rule. */
const SECRET_FILE_SAMPLES: readonly string[] = [
  ".env",
  ".env.local",
  ".envrc",
  "id_rsa",
  "id_ed25519",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".pgpass",
  ".git-credentials",
  "credentials",
  "secrets.yml",
  "token",
  "server.key",
  "key.pem",
  "keys.p12",
];

/**
 * True when what the shell expands this name to could be a secret file,
 * e.g. `.env*` and `*.pem` could each stand for one, `*.py` could not.
 */
function globCouldMatchSecret(name: string): boolean {
  if (!/[*?[]/.test(name)) return false;
  const pattern = name
    .replace(/[.+^${}()|\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  let expansion: RegExp;
  try {
    expansion = new RegExp(`^${pattern}$`);
  } catch {
    return true;
  }
  return SECRET_FILE_SAMPLES.some((sample) => expansion.test(sample));
}

/**
 * The name of a file that may hold secrets this command part would read, or
 * null when it names none. A wildcard asks too, since what it stands for is
 * known to the shell and not here.
 */
export function secretFileRead(part: CommandPart): string | null {
  // A bare word of a command with its own vocabulary is a reference or a
  // pattern rather than a file name, so `git branch --list "langy/*"` is read
  // as the prefix of a branch and not as a wildcard over the folder.
  const name = part.tokens[0] ?? "";
  const ownVocabulary = VOCABULARY_COMMANDS.has(name);
  // What `echo` and `printf` are given is text they print, so the only file
  // they touch is the one a redirect sends the text to.
  const candidates = TEXT_PRINTING_COMMANDS.has(name)
    ? part.tokens.filter((_, index) => part.redirectTarget[index] === true)
    : pathTokensOf(part);
  for (const token of candidates) {
    if (isSecretPath(token)) return path.basename(token);
    if (!ownVocabulary && globCouldMatchSecret(path.basename(token))) {
      return path.basename(token);
    }
  }
  return null;
}

/** The path this part would leave the folder through, or null. */
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
  for (const target of pathTokensOf(part)) {
    const check = resolvePathInsideRoot({ target, root, realpath, homedir });
    if (!check.inside) {
      return outsideMessage({ target, resolved: check.resolved, root });
    }
  }
  return null;
}

/**
 * What the CLI does with one call: run it, ask the user, or refuse with a
 * pushback the model can act on. Skipping permission checks turns every ask
 * into a run, but never a refusal: the boundary and privilege rule hold always.
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

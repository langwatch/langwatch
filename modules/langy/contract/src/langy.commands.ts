/**
 * Recognising a `langwatch` CLI invocation (`<resource> <verb> [args]`)
 * inside a shell command STRING, tokenizing enough to find it in COMMAND
 * POSITION.
 */

/** A LangWatch CLI invocation: the pair that names the capability, plus its args. */
export interface LangwatchCommand {
  resource: string;
  verb: string;
  /**
   * Flags/positionals, lossless-enough for the digest's `query`: repeats
   * collect into an array, a bare flag reads `true`, positionals land under
   * `_`. Values stay strings — consumers coerce.
   */
  args: Record<string, unknown>;
}

/**
 * Tokens that may sit immediately before `langwatch` and still leave it in
 * command position — a runner or an env assignment. Anything else means the
 * word is an argument to another program.
 */
const COMMAND_WRAPPERS = new Set([
  "npx",
  "bunx",
  "pnpx",
  "pnpm",
  "yarn",
  "bun",
  "dlx",
  "exec",
  "env",
  "sudo",
  "time",
  "command",
  "nohup",
]);

/** Shell tokens that end one command and start the next. */
const COMMAND_SEPARATORS = new Set(["&&", "||", ";", "|", "&", "(", ")", "\n"]);

/** CLI resources and verbs are lowercase kebab words (`list-runs`, `api-keys`). */
const IDENTIFIER = /^[a-z][a-z0-9-]*$/;

/** `FOO=bar` — an env prefix, which keeps the next word in command position. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Split a shell command into words, dropping quotes, keeping operators as
 * standalone tokens. Not a shell parser — just enough to find a program in
 * command position.
 */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  const flush = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = "";
    }
  };

  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;

    if (quote) {
      if (char === "\\" && quote === '"' && i + 1 < command.length) {
        current += command[++i]!;
      } else if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "\\" && i + 1 < command.length) {
      // A line continuation folds away; any other escape keeps the next char.
      const next = command[++i]!;
      if (next !== "\n") current += next;
      continue;
    }
    if (char === "\n" || char === ";" || char === "(" || char === ")") {
      flush();
      tokens.push(char === "\n" ? "\n" : char);
      continue;
    }
    if (char === "&" || char === "|") {
      flush();
      const doubled = command[i + 1] === char;
      tokens.push(doubled ? char + char : char);
      if (doubled) i++;
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    current += char;
  }
  flush();
  return tokens;
}

/**
 * `langwatch`, `./bin/langwatch`, or any path ending in it — and `lw`, the
 * package's second bin the CLI's own help calls "the advertised name".
 */
function isLangwatchProgram(token: string): boolean {
  return (
    token === "langwatch" || token === "lw" || token.endsWith("/langwatch") || token.endsWith("/lw")
  );
}

/** True when the token at `index` is RUN, not merely mentioned: starts the command, follows a separator, or follows only env assignments/runners. */
function isInCommandPosition(tokens: string[], index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const previous = tokens[i]!;
    if (COMMAND_SEPARATORS.has(previous)) return true;
    if (ENV_ASSIGNMENT.test(previous)) continue;
    if (COMMAND_WRAPPERS.has(previous)) continue;
    return false;
  }
  return true;
}

/** A flag token (`--query`, `-q`), as opposed to a value or a positional. */
function isFlagToken(token: string): boolean {
  return token.startsWith("-") && token.length > 1 && !/^-\d/.test(token);
}

/**
 * Root-position global flags that consume the token after them, only for
 * skipping past to find the resource. Other globals are treated as boolean:
 * mistaking one for a value-taker would swallow the resource.
 */
const VALUE_TAKING_GLOBAL_FLAGS = new Set(["--output", "-o", "--jq"]);

/**
 * Flags/positionals from after the verb to the next separator.
 * Lossless-enough: values stay strings, repeats become arrays, unknown flags
 * are kept, never dropped.
 */
function parseArgs(tokens: string[], from: number): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const positionals: string[] = [];

  const put = (name: string, value: unknown) => {
    const existing = args[name];
    if (existing === undefined) args[name] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else args[name] = [existing, value];
  };

  for (let i = from; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (COMMAND_SEPARATORS.has(token)) break;

    if (!isFlagToken(token)) {
      positionals.push(token);
      continue;
    }

    const equals = token.indexOf("=");
    const name = (equals === -1 ? token : token.slice(0, equals)).replace(/^-+/, "");
    if (!name) continue; // a bare `--`

    if (equals !== -1) {
      put(name, token.slice(equals + 1));
      continue;
    }
    const next = tokens[i + 1];
    if (next !== undefined && !COMMAND_SEPARATORS.has(next) && !isFlagToken(next)) {
      put(name, next);
      i++;
    } else {
      put(name, true);
    }
  }

  if (positionals.length > 0) args._ = positionals;
  return args;
}

/**
 * Read the FIRST `langwatch <resource> <verb>` invocation out of a shell
 * command. Null when not a LangWatch CLI call, or one naming no resource+verb
 * pair (`langwatch status`, `--version`).
 */
export class LangwatchCommandService {
  static create(): LangwatchCommandService {
    return new LangwatchCommandService();
  }

  static parseLangwatchCommand(command: string): LangwatchCommand | null {
    if (typeof command !== "string" || !command.trim()) return null;

    const tokens = tokenize(command);
    for (let i = 0; i < tokens.length; i++) {
      if (!isLangwatchProgram(tokens[i]!)) continue;
      if (!isInCommandPosition(tokens, i)) continue;

      // Skip root-position global flags before the resource (`lw --output json
      // monitor list`). Which flags take a value is read from a list, not
      // guessed, or a BOOLEAN global would swallow the resource.
      let at = i + 1;
      while (at < tokens.length && isFlagToken(tokens[at]!)) {
        const flag = tokens[at]!;
        const name = flag.includes("=") ? flag.slice(0, flag.indexOf("=")) : flag;
        const takesValue = !flag.includes("=") && VALUE_TAKING_GLOBAL_FLAGS.has(name);
        const next = tokens[at + 1];
        at +=
          takesValue && next !== undefined && !isFlagToken(next) && !COMMAND_SEPARATORS.has(next)
            ? 2
            : 1;
      }

      const resource = tokens[at];
      const verb = tokens[at + 1];
      if (!resource || !verb) return null;
      if (!IDENTIFIER.test(resource) || !IDENTIFIER.test(verb)) return null;
      return { resource, verb, args: parseArgs(tokens, at + 2) };
    }
    return null;
  }

  /**
   * Every `langwatch <resource> <verb>` invocation in a compound command, in
   * order. Same command-position rules as {@link parseLangwatchCommand}.
   */
  static parseAllLangwatchCommands(command: string): LangwatchCommand[] {
    if (typeof command !== "string" || !command.trim()) return [];

    const tokens = tokenize(command);
    const found: LangwatchCommand[] = [];
    for (let i = 0; i < tokens.length; i++) {
      if (!isLangwatchProgram(tokens[i]!)) continue;
      if (!isInCommandPosition(tokens, i)) continue;

      const resource = tokens[i + 1];
      const verb = tokens[i + 2];
      if (!resource || !verb) continue;
      if (!IDENTIFIER.test(resource) || !IDENTIFIER.test(verb)) continue;
      found.push({ resource, verb, args: parseArgs(tokens, i + 3) });
    }
    return found;
  }

  /**
   * Shell syntax letting a command's stdout carry text the CLI never printed
   * (chaining, redirection, substitution). Not a parser — a false positive
   * only costs an untrusted platform link.
   */
  private static readonly outputForgingSyntax = /[;|&<>`$\\\n()]/;

  /**
   * True when `command` is ONE plain `langwatch` invocation, nothing else.
   * The provenance gate for trusting stdout as the CLI's own: callers that
   * CACHE facts from stdout must require this; callers rendering it back need not.
   */
  static isSoleLangwatchInvocation(command: string): boolean {
    if (typeof command !== "string" || !command.trim()) return false;
    if (LangwatchCommandService.outputForgingSyntax.test(command)) return false;

    const tokens = tokenize(command);
    const programIndex = tokens.findIndex((token) => isLangwatchProgram(token));
    if (programIndex === -1) return false;
    return isInCommandPosition(tokens, programIndex);
  }
}

export const parseLangwatchCommand = LangwatchCommandService.parseLangwatchCommand;
export const parseAllLangwatchCommands = LangwatchCommandService.parseAllLangwatchCommands;
export const isSoleLangwatchInvocation = LangwatchCommandService.isSoleLangwatchInvocation;

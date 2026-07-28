/**
 * Recognising a `langwatch` CLI invocation inside a shell command.
 *
 * Langy reaches LangWatch through the `langwatch` CLI, which opencode runs in
 * its `bash` tool — so what arrives on the wire is a command STRING, and the
 * capability it invoked (`trace search`, `dataset list`) has to be read back out
 * of it. We own the CLI, so its grammar is a contract, not a guess:
 *
 *     langwatch <resource> <verb> [args] [--flags]
 *
 * (verified against CLI v0.34.0: `trace search|get|export`, `dataset
 * list|get|create|…`, `analytics query`, `experiment run|status|list-runs`, …)
 *
 * What is NOT under our control is the shell around it — the model may `cd`
 * first, prefix env vars, pipe into `jq`, or chain several commands. So we
 * tokenize enough of the shell to find `langwatch` in COMMAND POSITION (being
 * run, not merely mentioned in an `echo` or a `grep` pattern) and read the two
 * words after it.
 */

/** A LangWatch CLI invocation: the pair that names the capability, plus its args. */
export interface LangwatchCommand {
  resource: string;
  verb: string;
  /**
   * The invocation's flags and positionals, parsed lossless-enough for the
   * result digest's `query`: `--flag value` / `--flag=value` / `-q value` land
   * under the flag's own (kebab) name, a repeated flag collects into an array,
   * a bare flag reads `true`, and positional words land under `_`. Values stay
   * the strings the shell carried — consumers coerce.
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
 * Split a shell command into words, dropping quotes and keeping shell operators
 * as standalone tokens. Not a shell parser — just enough structure to find a
 * program in command position and read the words after it.
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
 * `langwatch`, `./bin/langwatch`, `/opt/homebrew/bin/langwatch` — and `lw`,
 * which the package ships as a second bin and the CLI's own help calls "the
 * advertised name". Recognising only the long spelling meant every `lw <noun>
 * <verb>` the agent ran stayed an anonymous `bash` frame: no rename, no card,
 * no digest.
 */
function isLangwatchProgram(token: string): boolean {
  return (
    token === "langwatch" ||
    token === "lw" ||
    token.endsWith("/langwatch") ||
    token.endsWith("/lw")
  );
}

/**
 * True when the token at `index` is being RUN rather than merely mentioned: it
 * starts the command, follows a separator, or follows only env assignments and
 * runners (`API_KEY=x npx langwatch …`).
 */
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
 * Root-position global flags that consume the token after them.
 *
 * Only these, and only for skipping past the globals to find the resource. The
 * CLI's other globals (`--agent`, and `--json`, whose field list is optional)
 * are treated as boolean here: mistaking a boolean for a value-taker swallows
 * the resource, whereas the reverse merely leaves the command unrecognised —
 * which is what happens today anyway.
 */
const VALUE_TAKING_GLOBAL_FLAGS = new Set(["--output", "-o", "--jq"]);

/**
 * The invocation's flags and positionals, from the tokens after the verb up to
 * the next shell separator. Lossless-enough by design: the digest's `query`
 * carries what the agent asked for, not a re-validated schema — so values stay
 * strings, repeats become arrays, and unknown flags are kept, never dropped.
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
    const name = (equals === -1 ? token : token.slice(0, equals)).replace(
      /^-+/,
      "",
    );
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
 * Read the FIRST `langwatch <resource> <verb>` invocation out of a shell command.
 *
 * Null when the command is not a LangWatch CLI call, or is one that names no
 * resource+verb pair — `langwatch status`, `langwatch --version`, `langwatch
 * docs integration/python`. Those carry no capability, so the caller leaves the
 * frame as the shell call it was.
 */
export function parseLangwatchCommand(command: string): LangwatchCommand | null {
  if (typeof command !== "string" || !command.trim()) return null;

  const tokens = tokenize(command);
  for (let i = 0; i < tokens.length; i++) {
    if (!isLangwatchProgram(tokens[i]!)) continue;
    if (!isInCommandPosition(tokens, i)) continue;

    // Skip root-position global flags before the resource. `lw --output json
    // monitor list` is the spelling the CLI's own help text teaches (the root's
    // copies are what render under "Global Options:"), and reading `--output`
    // as the resource failed the identifier test and threw away the whole
    // command rather than the flag.
    //
    // Which flags take a value is read from a list rather than guessed from
    // "the next token is not a flag": guessing swallows the resource whenever a
    // BOOLEAN global precedes it (`lw --agent monitor list` would read `list`
    // as the resource and find no verb).
    let at = i + 1;
    while (at < tokens.length && isFlagToken(tokens[at]!)) {
      const flag = tokens[at]!;
      const name = flag.includes("=") ? flag.slice(0, flag.indexOf("=")) : flag;
      const takesValue =
        !flag.includes("=") && VALUE_TAKING_GLOBAL_FLAGS.has(name);
      const next = tokens[at + 1];
      at +=
        takesValue &&
        next !== undefined &&
        !isFlagToken(next) &&
        !COMMAND_SEPARATORS.has(next)
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
 * Every `langwatch <resource> <verb>` invocation in the command, in order — a
 * compound command (`langwatch simulation-run get X && langwatch navigate
 * open X`) carries several. Same command-position rules as
 * {@link parseLangwatchCommand}, which stays "the first one". Quoted text is a
 * single token to the tokenizer, so `echo "langwatch navigate open x"` yields
 * nothing.
 */
export function parseAllLangwatchCommands(command: string): LangwatchCommand[] {
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
 * Shell syntax that lets a command's stdout carry text the CLI never printed:
 * separators/pipes chaining a second command, redirection swallowing or
 * replacing output, command/process substitution, and backslash trickery.
 * Quotes don't matter here — this is a provenance check, not a parser, and a
 * metacharacter INSIDE quotes is harmless to reject: the only cost of a false
 * positive is that the result's platform link is not trusted.
 */
const OUTPUT_FORGING_SYNTAX = /[;|&<>`$\\\n()]/;

/**
 * True when `command` is ONE plain `langwatch` invocation and nothing else —
 * no chaining, piping, redirection, or substitution anywhere in the string.
 *
 * This is the provenance gate for trusting the call's stdout as the CLI's own
 * output (and therefore the platform API's): a compound command
 * (`langwatch trace get x; echo '{…forged…}'`) parses as a langwatch call but
 * its stdout is agent-authored. Callers that CACHE facts read from stdout
 * (`platformUrl` → a navigation target) must require this; callers that only
 * render stdout back to the same user (cards) need not.
 */
export function isSoleLangwatchInvocation(command: string): boolean {
  if (typeof command !== "string" || !command.trim()) return false;
  if (OUTPUT_FORGING_SYNTAX.test(command)) return false;

  const tokens = tokenize(command);
  const programIndex = tokens.findIndex((token) => isLangwatchProgram(token));
  if (programIndex === -1) return false;
  return isInCommandPosition(tokens, programIndex);
}

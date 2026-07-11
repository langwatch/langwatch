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

/** A LangWatch CLI invocation, reduced to the pair that names the capability. */
export interface LangwatchCommand {
  resource: string;
  verb: string;
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

/** `langwatch`, `./bin/langwatch`, `/opt/homebrew/bin/langwatch`. */
function isLangwatchProgram(token: string): boolean {
  return token === "langwatch" || token.endsWith("/langwatch");
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

    const resource = tokens[i + 1];
    const verb = tokens[i + 2];
    if (!resource || !verb) return null;
    if (!IDENTIFIER.test(resource) || !IDENTIFIER.test(verb)) return null;
    return { resource, verb };
  }
  return null;
}

/**
 * Recognises a shell command that opens a GitHub pull request: `gh pr create`,
 * a `gh api` POST to `repos/<owner>/<repo>/pulls`, or a `curl` POST to the
 * same REST endpoint. The eval overlap gate reads these before they run.
 */

interface Segment {
  /** Where the segment starts in the command. */
  start: number;
  words: string[];
}

const SEPARATORS = new Set([";", "&", "|", "\n", "(", ")"]);

function closingQuote({ command, from, quote }: { command: string; from: number; quote: string }) {
  let at = from + 1;
  while (at < command.length && command[at] !== quote) {
    at += quote === '"' && command[at] === "\\" ? 2 : 1;
  }
  return at;
}

/** The command split at its operators into words, quotes removed and respected. */
export function shellSegments(command: string): Segment[] {
  const segments: Segment[] = [];
  let current: Segment = { start: 0, words: [] };
  let word: string | null = null;
  const endWord = () => {
    if (word !== null) current.words.push(word);
    word = null;
  };
  for (let at = 0; at < command.length; at += 1) {
    const char = command[at] ?? "";
    if (char === "'" || char === '"') {
      const end = closingQuote({ command, from: at, quote: char });
      word = (word ?? "") + command.slice(at + 1, end).replace(/\\(["\\$`])/g, "$1");
      at = end;
    } else if (SEPARATORS.has(char)) {
      endWord();
      if (current.words.length > 0) segments.push(current);
      current = { start: at + 1, words: [] };
    } else if (/\s/.test(char)) {
      endWord();
    } else {
      word = (word ?? "") + char;
    }
  }
  endWord();
  if (current.words.length > 0) segments.push(current);
  return segments;
}

/** The words with leading `NAME=value` assignments and `env`/`command` wrappers dropped. */
function programWords(words: readonly string[]): string[] {
  let index = 0;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) && word !== "env" && word !== "command") break;
    index += 1;
  }
  return words.slice(index);
}

/** `repos/<owner>/<repo>/pulls`, the endpoint that creates a pull request. */
const PULLS_PATH = /^\/?repos\/[^/\s]+\/[^/\s]+\/pulls\/?(?:\?.*)?$/;
const PULLS_URL =
  /^https?:\/\/(?:api\.github\.com|[^/\s]+\/api\/v3)\/repos\/[^/\s]+\/[^/\s]+\/pulls\/?(?:\?.*)?$/;

const GH_API_VALUE_FLAGS = new Set([
  "-X",
  "--method",
  "-f",
  "-F",
  "--field",
  "--raw-field",
  "-H",
  "--header",
  "--input",
  "-q",
  "--jq",
  "-t",
  "--template",
  "--hostname",
  "--cache",
  "-p",
  "--preview",
]);
const GH_API_BODY_FLAGS = new Set(["-f", "-F", "--field", "--raw-field", "--input"]);
const CURL_DATA_FLAGS = new Set([
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-ascii",
  "--data-urlencode",
  "--json",
  "-F",
  "--form",
]);

/** The method a `-X POST`, `-XPOST`, `--method=POST` or `--request POST` names, upper case. */
function explicitMethod({ words, flags }: { words: readonly string[]; flags: readonly string[] }) {
  for (const [index, word] of words.entries()) {
    for (const flag of flags) {
      if (word === flag) return (words[index + 1] ?? "").toUpperCase();
      if (word.startsWith(`${flag}=`)) return word.slice(flag.length + 1).toUpperCase();
      if (flag.length === 2 && word.startsWith(flag) && word.length > 2) {
        return word.slice(2).toUpperCase();
      }
    }
  }
  return undefined;
}

/** The first argument after `api` that is not a flag or a flag's value. */
function ghApiEndpoint(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (GH_API_VALUE_FLAGS.has(arg)) {
      index += 1;
    } else if (!arg.startsWith("-")) {
      return arg;
    }
  }
  return undefined;
}

function isGhApiPullCreation(words: readonly string[]): boolean {
  if (words[0] !== "gh" || words[1] !== "api") return false;
  const args = words.slice(2);
  const endpoint = ghApiEndpoint(args);
  if (endpoint === undefined || !PULLS_PATH.test(endpoint)) return false;
  const method = explicitMethod({ words: args, flags: ["-X", "--method"] });
  if (method !== undefined) return method === "POST";
  return args.some((arg) => GH_API_BODY_FLAGS.has(arg) || arg.startsWith("--raw-field="));
}

function isCurlPullCreation(words: readonly string[]): boolean {
  if (words[0] !== "curl") return false;
  const args = words.slice(1);
  if (!args.some((arg) => PULLS_URL.test(arg))) return false;
  const method = explicitMethod({ words: args, flags: ["-X", "--request"] });
  if (method !== undefined) return method === "POST";
  return args.some((arg) => CURL_DATA_FLAGS.has(arg) || /^--data[a-z-]*=/.test(arg));
}

function isGhPrCreate(words: readonly string[]): boolean {
  return words[0] === "gh" && words[1] === "pr" && words[2] === "create";
}

/** Where in the command the call that opens a pull request starts, or -1 when none does. */
export function pullRequestCreationIndex(command: string): number {
  for (const segment of shellSegments(command)) {
    const words = programWords(segment.words);
    const opens = isGhPrCreate(words) || isGhApiPullCreation(words);
    if (opens || isCurlPullCreation(words)) return segment.start;
  }
  return -1;
}

/** The base branch the command names: `--base`/`-B`, a `base=` field or a JSON `"base"`. */
export function pullRequestBase(command: string): string | undefined {
  const patterns = [
    /(?:--base[=\s]+|-B\s+)("[^"]*"|'[^']*'|[^\s;&|]+)/,
    /(?:^|\s)(?:-[fF]|--field|--raw-field)[=\s]+["']?base=([^\s"';&|]+)/,
    /\\?"base\\?"\s*:\s*\\?"([^"\\]+)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(command);
    if (match?.[1]) return match[1].replace(/^["']|["']$/g, "");
  }
  return undefined;
}

/** The files the PR body is read from: `--body-file`, `body=@file`, `--input`, `-d @file`. */
export function pullRequestBodyFiles(command: string): string[] {
  const files: string[] = [];
  for (const segment of shellSegments(command)) {
    const words = programWords(segment.words);
    for (const [index, word] of words.entries()) {
      const next = words[index + 1] ?? "";
      if (word === "--body-file" || word === "--input" || (word === "-F" && isGhPrCreate(words))) {
        files.push(next);
      } else if (word.startsWith("--body-file=")) {
        files.push(word.slice("--body-file=".length));
      } else if (next.startsWith("body=@") && (word === "-F" || word === "--field")) {
        files.push(next.slice("body=@".length));
      } else if (CURL_DATA_FLAGS.has(word) && next.startsWith("@")) {
        files.push(next.slice(1));
      }
    }
  }
  return files.filter((file) => file !== "" && file !== "-");
}

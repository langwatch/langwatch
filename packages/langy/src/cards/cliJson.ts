/**
 * Lifting the CLI's JSON document out of its stdout.
 *
 * Every LangWatch CLI read takes `--format json`, but the document does not
 * arrive alone: the CLI writes a spinner and a "use `langwatch trace get <id>`"
 * hint around it, and the shell tool merges stderr into the same string.
 * A card wants the document, not the console.
 *
 * So we take the first balanced `{…}` / `[…]` that parses, rather than assuming
 * the whole output is JSON. Shared here (rather than in the app) because both
 * ends of the contract need it: the server envelope reduces stdout with it, and
 * the digest extractor reads live/legacy outputs that still carry the noise.
 */

/** Give up scanning a huge stdout after this many `{`/`[` candidates. */
const MAX_CANDIDATES = 32;

/** The scalars a document can spell out, as opposed to a number. */
const JSON_LITERALS = ["true", "false", "null"];

/** The four characters JSON counts as whitespace. */
function isWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function tryParse(candidate: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(candidate) as unknown };
  } catch {
    return null;
  }
}

/**
 * Index of the bracket that closes the one at `start`, or -1. String-aware, so
 * a `}` inside a JSON string value does not close the document early.
 */
function findBalancedEnd({
  text,
  start,
}: {
  text: string;
  start: number;
}): number {
  let depth = 0;
  let inString = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i]!;

    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") {
      depth--;
      if (depth === 0) return i;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

/**
 * Whether the bracket at `start` opens its own line, with nothing but whitespace
 * before it. A spinner ends its frame with `\r` rather than `\n`, so both count
 * as the start of a line.
 */
function startsAtDocumentBoundary({
  text,
  start,
}: {
  text: string;
  start: number;
}): boolean {
  const newline = text.lastIndexOf("\n", start - 1);
  const carriageReturn = text.lastIndexOf("\r", start - 1);
  const lineStart = Math.max(newline, carriageReturn) + 1;
  return text.slice(lineStart, start).trim().length === 0;
}

/**
 * Whether what follows the bracket at `start` can begin a JSON document: a key
 * inside `{`, any value inside `[`, or the matching close for an empty one.
 *
 * A log line can open a line with a bracket too (`[retrying request`), and a
 * bracket the rest of the output never closes is otherwise read as a truncated
 * document, which stops the scan. Reading its first token tells the two apart.
 */
function opensJsonContent({
  text,
  start,
}: {
  text: string;
  start: number;
}): boolean {
  const opensObject = text[start] === "{";
  const close = opensObject ? "}" : "]";

  for (let i = start + 1; i < text.length; i++) {
    const char = text[i]!;
    if (isWhitespace(char)) continue;
    if (char === close) return true;
    // An object opens with a key, and with nothing else.
    if (opensObject) return char === '"';
    return opensJsonValue({ text, at: i });
  }
  return false;
}

/**
 * Whether a JSON value begins at `at`.
 *
 * A scalar counts only when what follows it is what a document would put
 * there. The first character is not enough, and neither is the whole word: a
 * log line reads `[null pointer while reading the cache` or `[2026-08-22
 * fetching traces`, and both open with the spelling of a JSON value. In a
 * document a scalar is followed by a comma or the closing bracket.
 */
function opensJsonValue({ text, at }: { text: string; at: number }): boolean {
  const char = text[at]!;
  if (char === '"' || char === "{" || char === "[") return true;

  const scalar = scalarEnd({ text, at });
  if (scalar === -1) return false;

  let i = scalar;
  while (isWhitespace(text[i])) i++;
  // Nothing after the scalar means the output ended on it, which is a result
  // cut short rather than a sentence.
  return i === text.length || text[i] === "," || text[i] === "]";
}

/** Index just past the scalar that starts at `at`, or -1 when none does. */
function scalarEnd({ text, at }: { text: string; at: number }): number {
  for (const literal of JSON_LITERALS) {
    if (text.startsWith(literal, at)) return at + literal.length;
  }
  return numberEnd({ text, at });
}

/**
 * Index just past the number that starts at `at`, or -1 when none does.
 *
 * One forward pass that never reconsiders a character. A regular expression
 * reads better but backtracks over a long run of digits, and this runs on
 * whatever a tool wrote to its stdout.
 */
function numberEnd({ text, at }: { text: string; at: number }): number {
  let i = at;
  if (text[i] === "-") i++;

  // JSON writes no leading zero: a number is `0` on its own, or a non-zero
  // digit and the digits after it. `01` is not one, so `[01,` is a line of
  // prose and the document under it still gets read.
  if (text[i] === "0") {
    i++;
  } else {
    const integerFrom = i;
    while (isDigit(text[i])) i++;
    if (i === integerFrom) return -1;
  }
  if (isDigit(text[i])) return -1;

  if (text[i] === ".") {
    i++;
    const fractionFrom = i;
    while (isDigit(text[i])) i++;
    if (i === fractionFrom) return -1;
  }

  if (text[i] === "e" || text[i] === "E") {
    i++;
    if (text[i] === "+" || text[i] === "-") i++;
    const exponentFrom = i;
    while (isDigit(text[i])) i++;
    if (i === exponentFrom) return -1;
  }

  return i;
}

/**
 * The JSON document a CLI command printed, or null when its output holds none —
 * a human table, an error message, an empty string. Null reads as "leave the raw
 * output alone".
 */
export function parseCliJson(output: string): unknown | null {
  if (typeof output !== "string") return null;
  const trimmed = output.trim();
  if (!trimmed) return null;

  const whole = tryParse(trimmed);
  if (whole) return whole.value;

  let candidates = 0;
  for (let i = 0; i < output.length; i++) {
    const char = output[i]!;
    if (char !== "{" && char !== "[") continue;
    // A DOCUMENT OPENS ITS OWN LINE. A BRACKET INSIDE PROSE IS PROSE.
    //
    // Without this the scan reached into sentences. `langwatch trace search
    // --start now-1d` names a flag the command does not have, so the CLI
    // printed `error: unknown option '--start'` followed by its usage, and that
    // usage documents `--jq` with the example `.traces[].traceId`. The `[]` in
    // it parses as an empty array, so a REJECTED command became the JSON
    // document `[]`. The agent read that as "no traces in the last day" and
    // reported it as a count. Every `--help` did the same. When nothing here is
    // a document, the command's own output is what stays (see the null
    // contract above).
    if (!startsAtDocumentBoundary({ text: output, start: i })) continue;
    if (++candidates > MAX_CANDIDATES) break;

    const end = findBalancedEnd({ text: output, start: i });
    if (end === -1) {
      // A JSON-looking document that opens a line but never closes is a
      // truncated OUTER result. Do not walk into it and promote a complete
      // nested object (for example one trace's {"output":{"value":"…"}}) into
      // the result for the whole command. That was how an oversized trace
      // search rendered an unrelated sentence as its card.
      //
      // A log line that opens with a bracket and never closes it is not that
      // result, so it must not stop the scan before the document under it.
      if (opensJsonContent({ text: output, start: i })) return null;
      continue;
    }
    const parsed = tryParse(output.slice(i, end + 1));
    if (parsed) return parsed.value;
  }
  return null;
}

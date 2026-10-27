/**
 * Extracts the first balanced JSON object from CLI stdout (which includes spinner/hints).
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

/**
 * Index of the bracket that closes the one at `start`, or -1. String-aware, so
 * a `}` inside a JSON string value does not close the document early.
 */
function findBalancedEnd({ text, start }: { text: string; start: number }): number {
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
    const change = bracketDepthChange(char);
    depth += change;
    if (change < 0 && depth === 0) return i;
    if (depth < 0) return -1;
  }
  return -1;
}

function bracketDepthChange(char: string): number {
  if (char === "{" || char === "[") return 1;
  if (char === "}" || char === "]") return -1;
  return 0;
}

/**
 * Bracket at line start (\\r or \\n, unindented) indicates document start, not nested.
 */
function startsAtDocumentBoundary({ text, start }: { text: string; start: number }): boolean {
  if (start === 0) return true;
  const previous = text[start - 1];
  return previous === "\n" || previous === "\r";
}

/**
 * Whether what follows the bracket at `start` can begin a JSON document. A
 * log line can open with a bracket too (`[retrying request`), which would
 * otherwise read as a truncated document and stop the scan.
 */
function opensJsonContent({ text, start }: { text: string; start: number }): boolean {
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
 * JSON value at position: scalar must be followed by comma or closing bracket (not log text).
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
 * One forward pass, never backtracking: a regular expression reads better
 * but backtracks over a long run of digits, and this runs on tool stdout.
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

  return exponentEnd({ text, at: i });
}

/** Index just past the optional exponent at `at`, or -1 when one opens but has no digits. */
function exponentEnd({ text, at }: { text: string; at: number }): number {
  if (text[at] !== "e" && text[at] !== "E") return at;
  let i = at + 1;
  if (text[i] === "+" || text[i] === "-") i++;
  const exponentFrom = i;
  while (isDigit(text[i])) i++;
  if (i === exponentFrom) return -1;
  return i;
}

/**
 * The JSON document a CLI command printed, or null when its output holds none —
 * a human table, an error message, an empty string. Null reads as "leave the raw
 * output alone".
 */
export function parseCliJson(output: string): unknown {
  if (typeof output !== "string") return null;
  const trimmed = output.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Not one whole document: scan the output for one printed inside it.
  }

  return findEmbeddedDocument(output);
}

type CandidateRead =
  | { kind: "document"; value: unknown }
  | { kind: "truncated" }
  | { kind: "not-json" };

function findEmbeddedDocument(output: string): unknown {
  let candidates = 0;
  for (let i = 0; i < output.length; i++) {
    if (!isDocumentStart({ text: output, start: i })) continue;
    if (++candidates > MAX_CANDIDATES) break;
    const read = readCandidate({ text: output, start: i });
    if (read.kind === "document") return read.value;
    if (read.kind === "truncated") return null;
  }
  return null;
}

/** Document starts at a line boundary, not in prose (keeps help text from parsing as JSON). */
function isDocumentStart({ text, start }: { text: string; start: number }): boolean {
  const char = text[start];
  return (char === "{" || char === "[") && startsAtDocumentBoundary({ text, start });
}

function readCandidate({ text, start }: { text: string; start: number }): CandidateRead {
  const end = findBalancedEnd({ text, start });
  if (end === -1) {
    // A JSON-looking document that opens but never closes is a truncated OUTER result - never
    // promote a complete nested object as the whole result. A log line opening a bracket
    // without closing it is not that case, so it must not stop the scan.
    return opensJsonContent({ text, start }) ? { kind: "truncated" } : { kind: "not-json" };
  }
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return { kind: "document", value };
  } catch {
    return { kind: "not-json" };
  }
}

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
function findBalancedEnd(text: string, start: number): number {
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
function startsAtDocumentBoundary(text: string, start: number): boolean {
  const lineStart =
    Math.max(text.lastIndexOf("\n", start - 1), text.lastIndexOf("\r", start - 1)) + 1;
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
function opensJsonContent(text: string, start: number): boolean {
  const opensObject = text[start] === "{";
  const close = opensObject ? "}" : "]";

  for (let i = start + 1; i < text.length; i++) {
    const char = text[i]!;
    if (char === " " || char === "\t" || char === "\n" || char === "\r") continue;
    if (char === close) return true;
    if (opensObject) return char === '"';
    return (
      char === '"' ||
      char === "{" ||
      char === "[" ||
      char === "-" ||
      (char >= "0" && char <= "9") ||
      char === "t" ||
      char === "f" ||
      char === "n"
    );
  }
  return false;
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
    if (!startsAtDocumentBoundary(output, i)) continue;
    if (++candidates > MAX_CANDIDATES) break;

    const end = findBalancedEnd(output, i);
    if (end === -1) {
      // A JSON-looking document that opens a line but never closes is a
      // truncated OUTER result. Do not walk into it and promote a complete
      // nested object (for example one trace's {"output":{"value":"…"}}) into
      // the result for the whole command. That was how an oversized trace
      // search rendered an unrelated sentence as its card.
      //
      // A log line that opens with a bracket and never closes it is not that
      // result, so it must not stop the scan before the document under it.
      if (opensJsonContent(output, i)) return null;
      continue;
    }
    const parsed = tryParse(output.slice(i, end + 1));
    if (parsed) return parsed.value;
  }
  return null;
}

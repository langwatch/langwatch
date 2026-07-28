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

function startsAtDocumentBoundary(text: string, start: number): boolean {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  return text.slice(lineStart, start).trim().length === 0;
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
    if (++candidates > MAX_CANDIDATES) break;

    const end = findBalancedEnd(output, i);
    if (end === -1) {
      // A JSON-looking document that starts at the beginning of a line but
      // never closes is a truncated OUTER result. Do not continue walking into
      // it and accidentally promote a complete nested object (for example one
      // trace's {"output":{"value":"…"}}) into the result for the whole
      // command. That was how an oversized trace search rendered an unrelated
      // sentence as its card.
      if (startsAtDocumentBoundary(output, i)) return null;
      continue;
    }
    const parsed = tryParse(output.slice(i, end + 1));
    if (parsed) return parsed.value;
  }
  return null;
}

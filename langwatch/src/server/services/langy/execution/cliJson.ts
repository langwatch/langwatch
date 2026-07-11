/**
 * Lifting the CLI's JSON document out of its stdout.
 *
 * Every LangWatch CLI read takes `--format json`, but the document does not
 * arrive alone: the CLI writes a spinner and a "use `langwatch trace get <id>`"
 * hint around it, and opencode's bash tool merges stderr into the same string.
 * A card wants the document, not the console.
 *
 * So we take the first balanced `{…}` / `[…]` that parses, rather than assuming
 * the whole output is JSON.
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
    if (end === -1) continue;
    const parsed = tryParse(output.slice(i, end + 1));
    if (parsed) return parsed.value;
  }
  return null;
}

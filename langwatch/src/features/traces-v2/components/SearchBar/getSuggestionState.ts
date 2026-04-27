/**
 * Pure function deciding whether the autocomplete dropdown should be open
 * for a given editor text + cursor position. See PRD-003a for the full
 * contract.
 *
 * Rule: the dropdown is open iff the cursor sits inside an active token of
 * shape `@partial`, `@field:`, or `@field:partial` — i.e. there is no
 * whitespace between the `@` and the cursor, and the `@` is at a valid
 * token start (preceded by start-of-input, whitespace, or `(`).
 */

export type SuggestionState =
  | { open: false }
  | { open: true; mode: "field"; query: string }
  | { open: true; mode: "value"; field: string; query: string };

const TOKEN_END_CHARS = new Set([" ", "\t", "\n", ")"]);

function isValidTokenStartPreceder(ch: string | undefined): boolean {
  if (ch === undefined) return true;
  return TOKEN_END_CHARS.has(ch) || ch === "(";
}

export function getSuggestionState(
  text: string,
  cursorPos: number,
): SuggestionState {
  const closed = { open: false } as const;

  // Scan backwards from the cursor for an `@` that begins a token.
  let atPos = -1;
  for (let i = cursorPos - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "@") {
      const prev = i === 0 ? undefined : text[i - 1];
      if (isValidTokenStartPreceder(prev)) {
        atPos = i;
      }
      // Whether or not the `@` was a valid start, stop scanning — the most
      // recent `@` is the only candidate.
      break;
    }
    if (ch !== undefined && TOKEN_END_CHARS.has(ch)) {
      // Hit a token-terminator before finding any `@` — cursor is not in a token.
      return closed;
    }
  }

  if (atPos < 0) return closed;

  const between = text.slice(atPos + 1, cursorPos);
  const colonIdx = between.indexOf(":");

  if (colonIdx < 0) {
    return { open: true, mode: "field", query: between };
  }

  const field = between.slice(0, colonIdx);
  const query = between.slice(colonIdx + 1);

  // Quoted values aren't autocompleted in v1.
  if (query.includes('"')) return closed;

  return { open: true, mode: "value", field, query };
}

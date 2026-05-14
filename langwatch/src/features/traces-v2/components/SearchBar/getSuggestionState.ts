export type SuggestionState =
  | { open: false }
  | { open: true; mode: "field"; query: string; tokenStart: number }
  | {
      open: true;
      mode: "value";
      field: string;
      query: string;
      tokenStart: number;
    };

const TOKEN_TERMINATORS = new Set([" ", "\t", "\n", "(", ")"]);

function findActiveTokenStart(text: string, cursorPos: number): number {
  for (let i = cursorPos - 1; i >= 0; i--) {
    if (TOKEN_TERMINATORS.has(text[i] as string)) return i + 1;
  }
  return 0;
}

export function getSuggestionState(
  text: string,
  cursorPos: number,
): SuggestionState {
  // Empty/whitespace-only input — open in field mode on focus so users can
  // discover available fields without having to type a leading character.
  if (text.trim().length === 0) {
    return { open: true, mode: "field", query: "", tokenStart: 0 };
  }

  const wordStart = findActiveTokenStart(text, cursorPos);

  // Only consume chars that are actually behind the cursor. When cursor sits
  // before any input (cursorPos === wordStart), there are no token chars yet.
  const tokenStart =
    wordStart < cursorPos && text[wordStart] === "-"
      ? wordStart + 1
      : wordStart;

  let inner = tokenStart;
  let hadSigil = false;
  if (inner < cursorPos && text[inner] === "@") {
    hadSigil = true;
    inner += 1;
  }

  const remaining = text.slice(inner, cursorPos);
  const colonIdx = remaining.indexOf(":");

  if (colonIdx >= 0) {
    const field = remaining.slice(0, colonIdx);
    const query = remaining.slice(colonIdx + 1);
    if (!field) return { open: false };
    if (query.includes('"')) return { open: false };
    return { open: true, mode: "value", field, query, tokenStart };
  }

  // Open field-mode whenever the active token looks like an identifier in
  // progress. The dropdown is invisible when no field name matches, so this
  // adds discoverability without spamming the UI for free-text queries.
  if (!hadSigil && !/^[a-zA-Z][\w.]*$/.test(remaining)) {
    return { open: false };
  }
  return { open: true, mode: "field", query: remaining, tokenStart };
}

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

/**
 * What separates the tokens of a line, and a token's field from its value.
 *
 * The traces search bar reads `field:value` tokens split on whitespace and
 * parentheses. A parameter line reads `name=value` pairs split on commas.
 * The state machine is the same; only the characters differ.
 */
export type SuggestionGrammar = {
  /** The character between a field and its value. */
  valueSeparator: string;
  /** The characters that end one token and start the next. */
  tokenTerminators: ReadonlySet<string>;
  /** What a field name in progress looks like. */
  fieldPattern: RegExp;
  /**
   * Whether an empty token opens field mode, so the list shows right after a
   * terminator. The search bar keeps it closed there: a space between two
   * clauses is not a request for a field.
   */
  opensOnEmptyToken: boolean;
};

/**
 * The grammar of the traces search bar.
 *
 * U+00A0 ends a token as an ordinary space does. A space typed at the end of
 * the bar arrives as U+00A0, from the editor's own boundary character and
 * from the browser's normalisation of a trailing space, and the rest of the
 * bar reads it as a space. Without it here the next clause is read as more of
 * the previous value, and the field list never opens again after the first
 * chip.
 */
export const SEARCH_GRAMMAR: SuggestionGrammar = {
  valueSeparator: ":",
  tokenTerminators: new Set([" ", " ", "\t", "\n", "(", ")"]),
  fieldPattern: /^[a-zA-Z][\w.]*$/,
  opensOnEmptyToken: false,
};

/** The grammar of a `name=value, name=value` parameter line. */
export const PARAMETER_LINE_GRAMMAR: SuggestionGrammar = {
  valueSeparator: "=",
  tokenTerminators: new Set([","]),
  fieldPattern: /^[A-Za-z_]\w*$/,
  opensOnEmptyToken: true,
};

function findActiveTokenStart({
  text,
  cursorPos,
  grammar,
}: {
  text: string;
  cursorPos: number;
  grammar: SuggestionGrammar;
}): number {
  let start = 0;
  for (let i = cursorPos - 1; i >= 0; i--) {
    if (grammar.tokenTerminators.has(text[i] as string)) {
      start = i + 1;
      break;
    }
  }
  // A token may open with spaces when whitespace is not a terminator, as in
  // "a=1, b=2": the space after the comma belongs to no token.
  while (start < cursorPos && /\s/.test(text[start] as string)) start += 1;
  return start;
}

/**
 * Whether the caret sits inside a quoted value whose closing quote has not
 * been typed yet.
 *
 * Everything there is one value, however the words read: an `eval` question
 * runs to several words, and `eval:"is the user annoyed"` would otherwise
 * open the field list on `user` halfway through, where Enter accepts a field
 * instead of searching.
 */
export function isInsideQuotedValue(text: string, cursorPos: number): boolean {
  let open = false;
  for (let i = 0; i < cursorPos && i < text.length; i++) {
    const char = text[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (char === '"') open = !open;
  }
  return open;
}

export function getSuggestionState(
  text: string,
  cursorPos: number,
  grammar: SuggestionGrammar = SEARCH_GRAMMAR,
): SuggestionState {
  // Empty/whitespace-only input — open in field mode on focus so users can
  // discover available fields without having to type a leading character.
  if (text.trim().length === 0) {
    return { open: true, mode: "field", query: "", tokenStart: 0 };
  }

  if (isInsideQuotedValue(text, cursorPos)) return { open: false };

  const wordStart = findActiveTokenStart({ text, cursorPos, grammar });

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
  const separatorIdx = remaining.indexOf(grammar.valueSeparator);

  if (separatorIdx >= 0) {
    const field = remaining.slice(0, separatorIdx);
    const query = remaining.slice(separatorIdx + 1);
    if (!field) return { open: false };
    if (query.includes('"')) return { open: false };
    return { open: true, mode: "value", field, query, tokenStart };
  }

  // Open field-mode whenever the active token looks like an identifier in
  // progress. The dropdown is invisible when no field name matches, so this
  // adds discoverability without spamming the UI for free-text queries.
  if (remaining === "" && grammar.opensOnEmptyToken) {
    return { open: true, mode: "field", query: "", tokenStart };
  }
  if (!hadSigil && !grammar.fieldPattern.test(remaining)) {
    return { open: false };
  }
  return { open: true, mode: "field", query: remaining, tokenStart };
}

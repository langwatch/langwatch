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

/** The grammar of the traces search bar. */
export const SEARCH_GRAMMAR: SuggestionGrammar = {
  valueSeparator: ":",
  tokenTerminators: new Set([" ", "\t", "\n", "(", ")"]),
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
    const character = text[i];
    if (character !== void 0 && grammar.tokenTerminators.has(character)) {
      start = i + 1;
      break;
    }
  }
  // A token may open with spaces when whitespace is not a terminator, as in
  // "a=1, b=2": the space after the comma belongs to no token.
  while (start < cursorPos && /\s/.test(text[start] ?? "")) start += 1;
  return start;
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

  const wordStart = findActiveTokenStart({ text, cursorPos, grammar });

  // Only consume chars that are actually behind the cursor. When cursor sits
  // before any input (cursorPos === wordStart), there are no token chars yet.
  const tokenStart = wordStart < cursorPos && text[wordStart] === "-" ? wordStart + 1 : wordStart;

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
    if (!field) {
      return { open: false };
    }
    if (query.includes('"')) {
      return { open: false };
    }
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

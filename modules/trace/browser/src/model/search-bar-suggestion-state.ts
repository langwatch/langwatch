import {
  getSuggestionState,
  SEARCH_GRAMMAR,
  type SuggestionGrammar,
  type SuggestionState,
} from "@langwatch/trace-browser-kit";

/**
 * The traces bar's grammar: the kit's, plus U+00A0. The editor writes one
 * between clauses and the browser turns a typed trailing space into one, so
 * without it the field list stops opening once the bar holds a chip.
 */
export const TRACE_SEARCH_GRAMMAR: SuggestionGrammar = {
  ...SEARCH_GRAMMAR,
  tokenTerminators: new Set([...SEARCH_GRAMMAR.tokenTerminators, " "]),
};

/**
 * Whether the caret sits inside a quoted value still missing its closing
 * quote. Everything there is one value: `eval:"is the user annoyed"` would
 * otherwise open the field list on `user`, where Enter accepts a field.
 */
export function isInsideQuotedValue(text: string, cursorPos: number): boolean {
  let open = false;
  for (let i = 0; i < cursorPos && i < text.length; i++) {
    const character = text[i];
    if (character === "\\") {
      i += 1;
      continue;
    }
    if (character === '"') open = !open;
  }
  return open;
}

/** What the dropdown shows for the traces search bar's text and caret. */
export function searchBarSuggestionState(text: string, cursorPos: number): SuggestionState {
  if (isInsideQuotedValue(text, cursorPos)) return { open: false };
  return getSuggestionState(text, cursorPos, TRACE_SEARCH_GRAMMAR);
}

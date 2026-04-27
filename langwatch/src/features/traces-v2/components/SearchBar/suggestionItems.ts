/**
 * Builds the list of items to render in the autocomplete dropdown for a
 * given SuggestionState. Pure function — kept separate from the React
 * component so it can be unit-tested if it grows more ranking logic.
 */

import { FIELD_NAMES, FIELD_VALUES } from "../../utils/queryParser";
import type { SuggestionState } from "./getSuggestionState";

const MAX_ITEMS = 10;

export function getSuggestionItems(state: SuggestionState): string[] {
  if (!state.open) return [];

  if (state.mode === "field") {
    const q = state.query.toLowerCase();
    const prefix: string[] = [];
    const contains: string[] = [];
    for (const name of FIELD_NAMES) {
      const lower = name.toLowerCase();
      if (lower.startsWith(q)) prefix.push(name);
      else if (lower.includes(q)) contains.push(name);
    }
    return [...prefix, ...contains].slice(0, MAX_ITEMS);
  }

  const values = FIELD_VALUES[state.field] ?? [];
  const q = state.query.toLowerCase();
  const prefix: string[] = [];
  const contains: string[] = [];
  for (const v of values) {
    const lower = v.toLowerCase();
    if (lower.startsWith(q)) prefix.push(v);
    else if (lower.includes(q)) contains.push(v);
  }
  return [...prefix, ...contains].slice(0, MAX_ITEMS);
}

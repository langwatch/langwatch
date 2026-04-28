import {
  FIELD_NAMES,
  FIELD_VALUES,
} from "~/server/app-layer/traces/query-language/queryParser";
import type { SuggestionState } from "./getSuggestionState";

const MAX_ITEMS = 10;

function rankByMatch(candidates: readonly string[], query: string): string[] {
  const q = query.toLowerCase();
  const prefix: string[] = [];
  const contains: string[] = [];
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    if (lower.startsWith(q)) prefix.push(candidate);
    else if (lower.includes(q)) contains.push(candidate);
  }
  return [...prefix, ...contains].slice(0, MAX_ITEMS);
}

export function getSuggestionItems(state: SuggestionState): string[] {
  if (!state.open) return [];
  if (state.mode === "field") return rankByMatch(FIELD_NAMES, state.query);
  return rankByMatch(FIELD_VALUES[state.field] ?? [], state.query);
}

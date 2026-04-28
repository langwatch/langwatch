import type { SuggestionState } from "./getSuggestionState";
import { getSuggestionItems } from "./suggestionItems";

export interface SuggestionUIState {
  state: SuggestionState;
  items: string[];
  /** Per-item occurrence counts when items come from a DB-backed facet. */
  itemCounts?: Record<string, number>;
  selectedIndex: number;
}

export const CLOSED_SUGGESTION: SuggestionUIState = {
  state: { open: false },
  items: [],
  selectedIndex: 0,
};

export function buildSuggestionUI({
  state,
  previousSelected,
}: {
  state: SuggestionState;
  previousSelected: number;
}): SuggestionUIState {
  if (!state.open) return CLOSED_SUGGESTION;
  const items = getSuggestionItems(state);
  if (items.length === 0) return { state, items, selectedIndex: 0 };
  const selectedIndex = Math.min(previousSelected, items.length - 1);
  return { state, items, selectedIndex };
}

export function navigateSuggestion({
  ui,
  direction,
}: {
  ui: SuggestionUIState;
  direction: "up" | "down";
}): SuggestionUIState {
  if (ui.items.length === 0) return ui;
  const delta = direction === "down" ? 1 : -1;
  const next = (ui.selectedIndex + delta + ui.items.length) % ui.items.length;
  return { ...ui, selectedIndex: next };
}

export function highlightedLabel(ui: SuggestionUIState): string | null {
  if (!ui.state.open || ui.items.length === 0) return null;
  return ui.items[ui.selectedIndex] ?? null;
}

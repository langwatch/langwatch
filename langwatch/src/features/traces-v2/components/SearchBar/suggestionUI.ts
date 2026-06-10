import type { SearchFieldGroup } from "~/server/app-layer/traces/query-language/metadata";
import type { SuggestionState } from "./getSuggestionState";
import {
  getFieldSuggestions,
  getValueSuggestions,
} from "./suggestionItems";

/**
 * Single row in the dropdown. `value` is what lands in the editor;
 * `label` is what renders. `group` drives section headers in field mode
 * (null in value mode). `isPrefix` flags namespaced prefix entries
 * (`trace.attribute.<key>`) so the accept handler knows to drop the user
 * back into field-mode for key-completion instead of auto-appending `:`.
 */
export interface SuggestionRow {
  value: string;
  label: string;
  group: SearchFieldGroup | null;
  isPrefix?: boolean;
}

export interface SuggestionUIState {
  state: SuggestionState;
  items: SuggestionRow[];
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
  const items: SuggestionRow[] =
    state.mode === "field"
      ? getFieldSuggestions(state.query).map((s) => ({
          value: s.value,
          label: s.label,
          group: s.group,
          isPrefix: s.isPrefix,
        }))
      : getValueSuggestions(state.field, state.query).map((v) => ({
          value: v,
          label: v,
          group: null,
        }));
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

export function highlightedRow(ui: SuggestionUIState): SuggestionRow | null {
  if (!ui.state.open || ui.items.length === 0) return null;
  return ui.items[ui.selectedIndex] ?? null;
}

/** Back-compat: callers that just need the editor-facing value string. */
export function highlightedLabel(ui: SuggestionUIState): string | null {
  return highlightedRow(ui)?.value ?? null;
}

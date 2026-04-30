import {
  DYNAMIC_PREFIXES,
  FIELD_NAMES,
  FIELD_VALUES,
  SEARCH_FIELDS,
  type SearchFieldGroup,
} from "~/server/app-layer/traces/query-language/metadata";
import type { SuggestionState } from "./getSuggestionState";

// Field mode is uncapped — the dropdown's 240px scroll handles overflow.
// Value mode keeps a top-N because facet enumerations can run to hundreds.
const MAX_VALUE_ITEMS = 10;

/**
 * Group label + sort priority. Groups render in this order in the
 * dropdown, mirroring the FilterSidebar's section ordering so the user's
 * mental map carries between the two surfaces.
 */
export interface GroupSpec {
  id: SearchFieldGroup;
  label: string;
}

export const SUGGESTION_GROUPS: ReadonlyArray<GroupSpec> = [
  { id: "trace", label: "Trace" },
  { id: "span", label: "Span" },
  { id: "event", label: "Event" },
  { id: "eval", label: "Eval" },
  { id: "metrics", label: "Metrics" },
  { id: "scenario", label: "Scenario" },
  { id: "time", label: "Time" },
];

export interface SuggestionItem {
  /** What lands in the editor when the user accepts. */
  value: string;
  /** What renders in the dropdown row. Same as `value` for plain fields;
   * differs for dynamic prefixes which show as `trace.attribute.<key>`. */
  label: string;
  /** Section id — drives which header the row renders under. */
  group: SearchFieldGroup | null;
  /** When true, accepting this item shouldn't auto-append `:` because the
   * user still needs to type a key. Set on dynamic prefix entries. */
  isPrefix?: boolean;
}

function rankByMatch<T extends { label: string }>(
  candidates: readonly T[],
  query: string,
  limit: number | null,
): T[] {
  const q = query.toLowerCase();
  if (!q) return limit === null ? [...candidates] : candidates.slice(0, limit);
  const prefix: T[] = [];
  const contains: T[] = [];
  for (const candidate of candidates) {
    const lower = candidate.label.toLowerCase();
    if (lower.startsWith(q)) prefix.push(candidate);
    else if (lower.includes(q)) contains.push(candidate);
  }
  const ranked = [...prefix, ...contains];
  return limit === null ? ranked : ranked.slice(0, limit);
}

/**
 * Build the field-mode suggestion list as a flat array — sectioning is a
 * concern of the renderer (`SuggestionDropdown`). Returning a flat list
 * keeps keyboard navigation simple (one index, no per-section maths) and
 * lets the ranking pass operate over every candidate at once so a tight
 * prefix match in `Eval` still wins over a contains match in `Trace`.
 */
export function getFieldSuggestions(query: string): SuggestionItem[] {
  const fieldItems: SuggestionItem[] = FIELD_NAMES.map((name) => {
    const meta = SEARCH_FIELDS[name];
    return {
      value: name,
      label: name,
      group: meta?.group ?? null,
    };
  });
  const prefixItems: SuggestionItem[] = DYNAMIC_PREFIXES.map((p) => ({
    // Accept value is the raw prefix; the user types the key after.
    value: p.prefix,
    label: `${p.prefix}<key>`,
    group: p.group,
    isPrefix: true,
  }));
  return rankByMatch([...fieldItems, ...prefixItems], query, null);
}

export function getValueSuggestions(field: string, query: string): string[] {
  return rankByMatch(
    (FIELD_VALUES[field] ?? []).map((v) => ({ label: v })),
    query,
    MAX_VALUE_ITEMS,
  ).map((v) => v.label);
}

/**
 * Back-compat shim — older callers pull a flat string[] of items. New
 * callers should use `getFieldSuggestions` directly so they can render
 * the per-row group label and prefix-vs-field distinction.
 */
export function getSuggestionItems(state: SuggestionState): string[] {
  if (!state.open) return [];
  if (state.mode === "field") {
    return getFieldSuggestions(state.query).map((s) => s.value);
  }
  return getValueSuggestions(state.field, state.query);
}

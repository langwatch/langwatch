import {
  DYNAMIC_PREFIXES,
  FIELD_NAMES,
  FIELD_VALUES,
  SEARCH_FIELDS,
  type SearchFieldGroup,
} from "../trace-query-metadata.ts";

// Field mode is uncapped — the dropdown's 240px scroll handles overflow.
// Value mode keeps a top-N because facet enumerations can run to hundreds.
const MAX_VALUE_ITEMS = 10;

interface SuggestionItem {
  /** What lands in the editor when the user accepts. */
  value: string;
  /**
   * Primary text rendered in the dropdown row. For plain fields this is the
   * human label (`Origin`, `Tokens / second`) so the list reads like the
   * facet sidebar; for dynamic prefixes it's `trace.attribute.<key>`.
   */
  label: string;
  /** Raw query field (e.g. `origin`, `cost`) — shown as a mono hint beside
   * the label so users learn the syntax, and matched against while typing. */
  field: string;
  /** Section id — drives which header the row renders under. */
  group: SearchFieldGroup | null;
  /** When true, accepting this item shouldn't auto-append `:` because the
   * user still needs to type a key. Set on dynamic prefix entries. */
  isPrefix?: boolean;
}

/**
 * Rank candidates by how well `query` matches ANY of their search keys (human label +
 * raw field). Prefix matches sort ahead of contains matches; ties keep input order.
 */
export function rankByMatch<T extends { keys: string[] }>(
  candidates: readonly T[],
  query: string,
  limit: number | null,
): T[] {
  const q = query.toLowerCase();
  if (!q) return limit === null ? [...candidates] : candidates.slice(0, limit);
  const prefix: T[] = [];
  const contains: T[] = [];
  for (const candidate of candidates) {
    const keys = candidate.keys.map((k) => k.toLowerCase());
    const hasPrefixMatch = keys.some((k) => k.startsWith(q));
    const hasSubstringMatch = keys.some((k) => k.includes(q));
    if (hasPrefixMatch) prefix.push(candidate);
    else if (hasSubstringMatch) contains.push(candidate);
  }
  const ranked = [...prefix, ...contains];
  return limit === null ? ranked : ranked.slice(0, limit);
}

/**
 * F13/#6716: `tokensEstimated` is a qualifier on `tokens`, not a second field to
 * offer. The fold is presentational: the raw filter still parses; "estimated" finds `tokens`.
 */
const FOLDED_QUALIFIER_FIELDS: ReadonlySet<string> = new Set(["tokensEstimated"]);
const QUALIFIER_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  tokens: ["estimated"],
};

/** The field-mode suggestion list as a flat array; the renderer does the sectioning. */
export function getFieldSuggestions(query: string): SuggestionItem[] {
  const fieldItems = FIELD_NAMES.filter((name) => !FOLDED_QUALIFIER_FIELDS.has(name)).map(
    (name) => {
      const meta = SEARCH_FIELDS[name];
      const label = meta?.label ?? name;
      return {
        item: {
          value: name,
          label,
          field: name,
          group: meta?.group ?? null,
        } satisfies SuggestionItem,
        // Match the typed query against both the human label and the raw
        // field id, so `status`, `Status`, and `stat` all hit. A folded field's
        // synonyms (e.g. `tokens` answering to "estimated") extend this too.
        keys: [label, name, ...(QUALIFIER_SYNONYMS[name] ?? [])],
      };
    },
  );
  const prefixItems = DYNAMIC_PREFIXES.map((p) => ({
    item: {
      // Accept value is the raw prefix; the user types the key after.
      value: p.prefix,
      label: `${p.prefix}<key>`,
      field: p.prefix,
      group: p.group,
      isPrefix: true,
    } satisfies SuggestionItem,
    keys: [p.prefix],
  }));
  return rankByMatch([...fieldItems, ...prefixItems], query, null).map((r) => r.item);
}

export function getValueSuggestions(field: string, query: string): string[] {
  return rankByMatch(
    (FIELD_VALUES[field] ?? []).map((v) => ({ value: v, keys: [v] })),
    query,
    MAX_VALUE_ITEMS,
  ).map((v) => v.value);
}

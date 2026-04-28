import { useEffect } from "react";
import { useTraceFacetValues } from "../../hooks/useTraceFacetValues";
import { SEARCH_FIELDS } from "../../utils/queryParser";
import type { SuggestionState } from "./getSuggestionState";
import type { DynamicSuggestionItems } from "./useFilterEditor";

interface UseDynamicValueSuggestionsParams {
  state: SuggestionState;
  override: (next: DynamicSuggestionItems | null) => void;
}

/**
 * For value-mode suggestions on facet-backed fields (e.g. `model:`, `service:`,
 * `topic:`), fetch matching values from ClickHouse and feed them into the
 * dropdown. Lets users autocomplete things the static `FIELD_VALUES` dict
 * can't enumerate — like every model name actually seen in the project.
 *
 * Trailing `*`s are stripped from the prefix so `model:gpt-*` still suggests
 * everything starting with `gpt-` while leaving the literal wildcard intact
 * for the eventual filter query.
 */
export function useDynamicValueSuggestions({
  state,
  override,
}: UseDynamicValueSuggestionsParams): void {
  const isValueMode = state.open && state.mode === "value";
  const field = isValueMode ? state.field : "";
  const meta = field ? SEARCH_FIELDS[field] : undefined;
  const facetField = meta?.facetField;
  const rawQuery = isValueMode ? state.query : "";
  const cleanedPrefix = rawQuery.replace(/\*+$/, "");

  const { data } = useTraceFacetValues({
    facetKey: facetField ?? "",
    prefix: cleanedPrefix || undefined,
    limit: 10,
    enabled: isValueMode && !!facetField,
  });

  useEffect(() => {
    if (!isValueMode || !facetField) {
      override(null);
      return;
    }
    if (!data) return;
    if (data.values.length === 0) {
      // No DB hits in the current time range — don't blank out the static
      // suggestions (e.g. the closed enum for `status:`), otherwise the
      // dropdown disappears and the user can't accept anything.
      override(null);
      return;
    }
    const items = data.values.map((v) => v.value);
    const counts: Record<string, number> = {};
    for (const v of data.values) counts[v.value] = v.count;
    override({ items, counts });
  }, [isValueMode, facetField, data, override]);
}

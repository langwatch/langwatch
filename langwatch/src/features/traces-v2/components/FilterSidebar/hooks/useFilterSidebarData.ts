import { useCallback, useMemo } from "react";
import { useTraceFacets } from "../../../hooks/useTraceFacets";
import { useFacetLensStore, applyLensOrder } from "../../../stores/facetLensStore";
import { useFilterStore } from "../../../stores/filterStore";
import { getFacetValueState } from "../../../utils/queryParser";
import { hashColor } from "../../../utils/formatters";
import {
  ATTRIBUTES_SECTION_KEY,
  FACET_COLORS,
  FACET_DEFAULTS,
  FACET_GROUPS,
  VIBRANT_FIELDS,
  getFacetGroupId,
  type FacetGroupDef,
} from "../constants";
import type {
  AttributeKey,
  CategoricalSection,
  FacetItem,
  FacetValueState,
  RangeSectionData,
  Section,
} from "../types";
import { facetLabel, sortBySectionOrder } from "../utils";

export function useFilterSidebarData() {
  const ast = useFilterStore((s) => s.ast);
  const toggleFacet = useFilterStore((s) => s.toggleFacet);
  const setRange = useFilterStore((s) => s.setRange);
  const removeRange = useFilterStore((s) => s.removeRange);

  const { data: descriptors, isLoading: facetsLoading } = useTraceFacets();

  const lensSectionOrder = useFacetLensStore((s) => s.lens.sectionOrder);
  const lensGroupOrder = useFacetLensStore((s) => s.lens.groupOrder);
  const setSectionOrder = useFacetLensStore((s) => s.setSectionOrder);
  const setGroupOrder = useFacetLensStore((s) => s.setGroupOrder);
  const setAllSectionsOpen = useFacetLensStore((s) => s.setAllSectionsOpen);

  const makeGetValueState = useCallback(
    (field: string) =>
      (value: string): FacetValueState =>
        getFacetValueState(ast, field, value),
    [ast],
  );

  const { categoricals, ranges, attributeKeys } = useMemo(
    () => partitionDescriptors(descriptors),
    [descriptors],
  );

  const facetItems = useMemo(() => {
    const map = new Map<string, FacetItem[]>();
    for (const cat of categoricals) {
      map.set(cat.key, buildFacetItems(cat));
    }
    return map;
  }, [categoricals]);

  const getValueStates = useMemo(() => {
    const map = new Map<string, (value: string) => FacetValueState>();
    for (const cat of categoricals) {
      map.set(cat.key, makeGetValueState(cat.key));
    }
    return map;
  }, [categoricals, makeGetValueState]);

  const sectionByKey = useMemo(() => {
    const map = new Map<string, Section>();
    for (const c of categoricals) map.set(c.key, c);
    for (const r of ranges) map.set(r.key, r);
    if (attributeKeys.length > 0) {
      map.set(ATTRIBUTES_SECTION_KEY, {
        key: ATTRIBUTES_SECTION_KEY,
        label: "Attributes",
        kind: "attributes",
      });
    }
    return map;
  }, [categoricals, ranges, attributeKeys]);

  const orderedKeys = useMemo(() => {
    const naturalOrder = sortBySectionOrder([
      ...categoricals.map((c) => ({ key: c.key, label: c.label })),
      ...ranges.map((r) => ({ key: r.key, label: r.label })),
      ...(attributeKeys.length > 0
        ? [{ key: ATTRIBUTES_SECTION_KEY, label: "Attributes" }]
        : []),
    ]).map((s) => s.key);
    return applyLensOrder(naturalOrder, lensSectionOrder);
  }, [categoricals, ranges, attributeKeys, lensSectionOrder]);

  const orderedGroups = useMemo(
    () => partitionIntoGroups(orderedKeys, lensGroupOrder),
    [orderedKeys, lensGroupOrder],
  );

  return {
    ast,
    categoricals,
    ranges,
    attributeKeys,
    facetItems,
    getValueStates,
    facetsLoading,
    descriptors,
    orderedKeys,
    orderedGroups,
    sectionByKey,
    toggleFacet,
    setRange,
    removeRange,
    setSectionOrder,
    setGroupOrder,
    setAllSectionsOpen,
  };
}

export interface FacetGroupSlice {
  id: FacetGroupDef["id"];
  label: string;
  keys: string[];
}

/**
 * Partition the user-ordered list of section keys into the canonical groups,
 * applying the lens-stored group order on top of the registry default.
 * Within a group, keys keep the order they appeared in the input (preserving
 * any DnD reordering). Unknown keys go to a synthetic trailing "other" group
 * so we never silently drop a section if the registry adds one we forgot to map.
 */
function partitionIntoGroups(
  keys: string[],
  lensGroupOrder: readonly string[],
): FacetGroupSlice[] {
  const byGroup = new Map<FacetGroupDef["id"], string[]>();
  const ungrouped: string[] = [];
  for (const key of keys) {
    const groupId = getFacetGroupId(key);
    if (!groupId) {
      ungrouped.push(key);
      continue;
    }
    const list = byGroup.get(groupId) ?? [];
    list.push(key);
    byGroup.set(groupId, list);
  }

  const presentIds = new Set(byGroup.keys());
  const lensIds = lensGroupOrder.filter((id): id is FacetGroupDef["id"] =>
    presentIds.has(id as FacetGroupDef["id"]),
  );
  const seen = new Set(lensIds);
  const naturalIds = FACET_GROUPS.map((g) => g.id).filter(
    (id) => presentIds.has(id) && !seen.has(id),
  );
  const finalOrder = [...lensIds, ...naturalIds];

  const labelById = new Map(FACET_GROUPS.map((g) => [g.id, g.label] as const));
  const slices: FacetGroupSlice[] = finalOrder.map((id) => ({
    id,
    label: labelById.get(id) ?? id,
    keys: byGroup.get(id) ?? [],
  }));

  if (ungrouped.length > 0) {
    slices.push({ id: "trace", label: "Other", keys: ungrouped });
  }
  return slices;
}

function partitionDescriptors(descriptors: ReturnType<typeof useTraceFacets>["data"]) {
  const cats: CategoricalSection[] = [];
  const rngs: RangeSectionData[] = [];
  let attrKeys: AttributeKey[] = [];

  for (const d of descriptors) {
    if (d.kind === "categorical" && d.topValues.length > 0) {
      cats.push({
        kind: "cat",
        key: d.key,
        label: d.label,
        group: d.group,
        topValues: d.topValues,
      });
    } else if (d.kind === "range" && d.max > 0) {
      rngs.push({
        kind: "range",
        key: d.key,
        label: d.label,
        group: d.group,
        min: d.min,
        max: d.max,
      });
    } else if (d.kind === "dynamic_keys" && d.key === "metadataKeys") {
      attrKeys = d.topKeys;
    }
  }

  return {
    categoricals: sortBySectionOrder(cats),
    ranges: sortBySectionOrder(rngs),
    attributeKeys: attrKeys,
  };
}

function buildFacetItems(cat: CategoricalSection): FacetItem[] {
  const curatedColors = FACET_COLORS[cat.key];
  const dimmed = !VIBRANT_FIELDS.has(cat.key);
  const counts = new Map(cat.topValues.map((v) => [v.value, v.count]));
  const labels = new Map(cat.topValues.map((v) => [v.value, v.label]));
  const orderedValues = orderValues({
    defaults: FACET_DEFAULTS[cat.key],
    fallback: cat.topValues.map((v) => v.value),
    keys: [...counts.keys()],
  });
  const dotColorFor = curatedColors
    ? (value: string) => curatedColors[value]
    : hashColor;

  return orderedValues.map((value) => ({
    value,
    label: labels.get(value) ?? facetLabel(value, cat.key),
    count: counts.get(value) ?? 0,
    dotColor: dotColorFor(value),
    dimmed,
  }));
}

function orderValues({
  defaults,
  fallback,
  keys,
}: {
  defaults: string[] | undefined;
  fallback: string[];
  keys: string[];
}): string[] {
  if (!defaults) return fallback;
  const defaultSet = new Set(defaults);
  return [...defaults, ...keys.filter((v) => !defaultSet.has(v))];
}

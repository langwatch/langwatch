import { useCallback, useMemo } from "react";
import { buildFacetStateLookup } from "~/server/app-layer/traces/query-language/queries";
import { useTraceFacets } from "../../../hooks/useTraceFacets";
import {
  applyLensOrder,
  useFacetLensStore,
} from "../../../stores/facetLensStore";
import { useFilterStore } from "../../../stores/filterStore";
import { hashColor } from "../../../utils/formatters";
import {
  ATTRIBUTES_SECTION_KEY,
  EVENT_ATTRIBUTES_SECTION_KEY,
  FACET_COLORS,
  FACET_DEFAULTS,
  FACET_GROUPS,
  type FacetGroupDef,
  getFacetGroupId,
  SPAN_ATTRIBUTES_SECTION_KEY,
  VIBRANT_FIELDS,
} from "../constants";
import type {
  AttributeKey,
  AttributesSectionData,
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

  // Walk the AST once per identity change to build a flat lookup map.
  // Every sidebar row used to call `getFacetValueState(ast, field, value)`,
  // which walked the AST per call → N×M walks per render. With Phase 2's
  // stable AST identity, this memo only reruns on real query changes.
  const facetStateLookup = useMemo(() => buildFacetStateLookup(ast), [ast]);

  const makeGetValueState = useCallback(
    (field: string) =>
      (value: string): FacetValueState =>
        facetStateLookup.get(`${field}|${value}`) ?? "neutral",
    [facetStateLookup],
  );

  const {
    categoricals,
    ranges,
    traceAttributeKeys,
    spanAttributeKeys,
    eventAttributeKeys,
  } = useMemo(() => partitionDescriptors(descriptors), [descriptors]);

  const attributeSections = useMemo<AttributesSectionData[]>(() => {
    const sections: AttributesSectionData[] = [];
    if (traceAttributeKeys.length > 0) {
      sections.push({
        key: ATTRIBUTES_SECTION_KEY,
        label: "Trace attributes",
        kind: "attributes",
        filterPrefix: "attribute",
        keys: traceAttributeKeys,
      });
    }
    if (eventAttributeKeys.length > 0) {
      sections.push({
        key: EVENT_ATTRIBUTES_SECTION_KEY,
        label: "Event attributes",
        kind: "attributes",
        filterPrefix: "event.attribute",
        keys: eventAttributeKeys,
      });
    }
    if (spanAttributeKeys.length > 0) {
      sections.push({
        key: SPAN_ATTRIBUTES_SECTION_KEY,
        label: "Span attributes",
        kind: "attributes",
        filterPrefix: "span.attribute",
        keys: spanAttributeKeys,
      });
    }
    return sections;
  }, [traceAttributeKeys, spanAttributeKeys, eventAttributeKeys]);

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
    for (const a of attributeSections) map.set(a.key, a);
    return map;
  }, [categoricals, ranges, attributeSections]);

  const orderedKeys = useMemo(() => {
    const naturalOrder = sortBySectionOrder([
      ...categoricals.map((c) => ({ key: c.key, label: c.label })),
      ...ranges.map((r) => ({ key: r.key, label: r.label })),
      ...attributeSections.map((a) => ({ key: a.key, label: a.label })),
    ]).map((s) => s.key);
    return applyLensOrder(naturalOrder, lensSectionOrder);
  }, [categoricals, ranges, attributeSections, lensSectionOrder]);

  const orderedGroups = useMemo(
    () => partitionIntoGroups(orderedKeys, lensGroupOrder),
    [orderedKeys, lensGroupOrder],
  );

  return {
    ast,
    categoricals,
    ranges,
    traceAttributeKeys,
    spanAttributeKeys,
    eventAttributeKeys,
    attributeSections,
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
 *
 * Exported for unit testing — the real call site is `useFilterSidebarData`.
 */
export function partitionIntoGroups(
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

function partitionDescriptors(
  descriptors: ReturnType<typeof useTraceFacets>["data"],
) {
  const cats: CategoricalSection[] = [];
  const rngs: RangeSectionData[] = [];
  let traceAttrs: AttributeKey[] = [];
  let spanAttrs: AttributeKey[] = [];
  let eventAttrs: AttributeKey[] = [];

  for (const d of descriptors) {
    if (
      d.kind === "categorical" &&
      (d.topValues.length > 0 || FACET_DEFAULTS[d.key])
    ) {
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
    } else if (d.kind === "dynamic_keys") {
      // Three parallel attribute discovery streams. Each one corresponds
      // to a distinct `Map` (or `Array(Map)`) column in ClickHouse:
      //   `metadataKeys`        → `trace_summaries.Attributes`
      //   `spanAttributeKeys`   → `stored_spans.SpanAttributes`
      //   `eventAttributeKeys`  → `stored_spans.Events.Attributes`
      // Split here so the sidebar can render distinct sections under
      // their respective groups (event keys live with the trace block
      // because span events are hoisted onto the trace at ingest).
      if (d.key === "metadataKeys") traceAttrs = d.topKeys;
      else if (d.key === "spanAttributeKeys") spanAttrs = d.topKeys;
      else if (d.key === "eventAttributeKeys") eventAttrs = d.topKeys;
    }
  }

  return {
    categoricals: sortBySectionOrder(cats),
    ranges: sortBySectionOrder(rngs),
    traceAttributeKeys: traceAttrs,
    spanAttributeKeys: spanAttrs,
    eventAttributeKeys: eventAttrs,
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

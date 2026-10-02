import { analyzeOrGroups, buildFacetStateLookup, getFacetValues } from "@langwatch/trace-contract";
import { useCallback, useEffect, useMemo } from "react";

import { useDensityStore } from "../../../../../behavior/density.store.ts";
import { useFilterStore } from "../../../../../behavior/explorer.store.ts";
import {
  type AttributeKey,
  type AttributesSectionData,
  type CategoricalSection,
  type FacetItem,
  type FacetValueState,
  type RangeSectionData,
  type Section,
} from "../../../../../behavior/explorer/filter-sidebar/types.ts";
import { usePreviewTracesActive } from "../../../../../behavior/explorer/onboarding/use-preview-traces-active.ts";
import {
  ATTRIBUTES_SECTION_KEY,
  COMFORTABLE_DEFAULT_SECTIONS,
  DISCRETE_MODE_MAX_VALUES,
  EVENT_ATTRIBUTES_SECTION_KEY,
  FACET_COLORS,
  FACET_DEFAULTS,
  FACET_VALUE_ORDER,
  METADATA_DOCS_URL,
  METADATA_SECTION_KEY,
  RANGE_DEFAULTS,
  SPAN_ATTRIBUTES_SECTION_KEY,
  VIBRANT_FIELDS,
} from "../../../../../behavior/facet-constants.ts";
import { applyLensOrder, useFacetLensStore } from "../../../../../behavior/facet-lens.store.ts";
import {
  selectVisibilityFor,
  useFacetVisibilityStore,
} from "../../../../../behavior/facet-visibility.store.ts";
import type { NumericMode } from "../../../../../behavior/numeric-mode.store.ts";
import {
  selectNumericModesFor,
  useNumericModeStore,
} from "../../../../../behavior/numeric-mode.store.ts";
import { useOrganizationTeamProject } from "../../../../../behavior/use-organization-team-project.ts";
import { hashColor } from "../../../../../model/display-formatters.ts";
import {
  type FacetCountState,
  mergeFacetDescriptors,
} from "../../../../../model/explorer/filter-sidebar/merge-facet-descriptors.ts";
import { routeToggleViaOrGroups } from "../../../../../model/explorer/filter-sidebar/route-toggle-via-or-groups.ts";
import { useFilteredTraceFacets } from "../../hooks/use-filtered-trace-facets.ts";
import { useTraceFacets } from "../../hooks/use-trace-facets.ts";
import { computeDiscreteEligible, resolveNumericModeByKey } from "../discrete-mode.ts";
import { facetLabel, sortBySectionOrder } from "../utils.ts";

type ValueStateLookup = ReturnType<typeof buildFacetStateLookup>;

/** The filter store's query and the facet mutations the sidebar drives. */
function useFacetFilterActions() {
  const ast = useFilterStore((s) => s.ast);
  const storeToggleFacet = useFilterStore((s) => s.toggleFacet);
  const storeExcludeFacet = useFilterStore((s) => s.excludeFacet);
  const storeSetRange = useFilterStore((s) => s.setRange);
  const storeRemoveRange = useFilterStore((s) => s.removeRange);
  const toggleEvaluatorSubFilter = useFilterStore((s) => s.toggleEvaluatorSubFilter);
  const setEvaluatorScoreRange = useFilterStore((s) => s.setEvaluatorScoreRange);
  const removeEvaluatorScoreRange = useFilterStore((s) => s.removeEvaluatorScoreRange);

  // A same-field click splices into an existing OR group when there is one;
  // the routing rule lives in routeToggleViaOrGroups. Cross-field OR is the
  // filter bar's, not this sidebar's.
  const orAnalysis = useMemo(() => analyzeOrGroups(ast), [ast]);
  const toggleFacet = useCallback(
    ({ field, value }: { field: string; value: string }) =>
      storeToggleFacet(field, value, routeToggleViaOrGroups({ analysis: orAnalysis, field })),
    [storeToggleFacet, orAnalysis],
  );
  // The row's trailing exclude jumps straight to `NOT field:value` (or back to
  // neutral), so excluding is one deliberate click.
  const excludeFacet = useCallback(
    ({ field, value }: { field: string; value: string }) => storeExcludeFacet(field, value),
    [storeExcludeFacet],
  );
  const setRange = useCallback(
    ({ field, from, to }: { field: string; from: string; to: string }) =>
      storeSetRange(field, from, to),
    [storeSetRange],
  );
  const removeRange = useCallback(
    ({ field }: { field: string }) => storeRemoveRange(field),
    [storeRemoveRange],
  );

  return {
    ast,
    toggleFacet,
    excludeFacet,
    setRange,
    removeRange,
    toggleEvaluatorSubFilter,
    setEvaluatorScoreRange,
    removeEvaluatorScoreRange,
  };
}

/**
 * The reader's per-project facet preferences: which sections they showed or
 * hid, and how each numeric facet presents. Both persist per project.
 */
function useProjectFacetPrefs() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? null;
  const showFacet = useFacetVisibilityStore((s) => s.showFacet);
  const hideFacet = useFacetVisibilityStore((s) => s.hideFacet);
  const resetAllVisibility = useFacetVisibilityStore((s) => s.resetAll);
  const visibilityHydrate = useFacetVisibilityStore((s) => s.hydrateFromStorage);
  const visibilityPrefs = useFacetVisibilityStore((s) => selectVisibilityFor(s, projectId));
  const numericModes = useNumericModeStore((s) => selectNumericModesFor({ state: s, projectId }));
  const setNumericModeRaw = useNumericModeStore((s) => s.setMode);
  const numericModeHydrate = useNumericModeStore((s) => s.hydrateFromStorage);

  useEffect(() => {
    if (projectId) visibilityHydrate(projectId);
  }, [projectId, visibilityHydrate]);
  useEffect(() => {
    if (projectId) numericModeHydrate(projectId);
  }, [projectId, numericModeHydrate]);

  const explicitlyShown = useMemo(
    () => new Set(visibilityPrefs.explicitlyShown),
    [visibilityPrefs.explicitlyShown],
  );
  const explicitlyHidden = useMemo(
    () => new Set(visibilityPrefs.explicitlyHidden),
    [visibilityPrefs.explicitlyHidden],
  );

  const setNumericMode = useCallback(
    ({ field, mode }: { field: string; mode: NumericMode }) => {
      if (projectId) setNumericModeRaw({ projectId, field, mode });
    },
    [projectId, setNumericModeRaw],
  );
  const showFacetForProject = useCallback(
    (key: string) => {
      if (projectId) showFacet(projectId, key);
    },
    [projectId, showFacet],
  );
  const hideFacetForProject = useCallback(
    (key: string) => {
      if (projectId) hideFacet(projectId, key);
    },
    [projectId, hideFacet],
  );
  const resetAllFacets = useCallback(() => {
    if (projectId) resetAllVisibility(projectId);
  }, [projectId, resetAllVisibility]);

  return {
    explicitlyShown,
    explicitlyHidden,
    numericModes,
    setNumericMode,
    showFacet: showFacetForProject,
    hideFacet: hideFacetForProject,
    resetAllFacets,
  };
}

/** Every field the query filters on, read off the `${field}|${value}` lookup keys. */
function activeFieldsOf(lookup: ValueStateLookup): Set<string> {
  return new Set(
    [...lookup.keys()].map((k) => {
      const idx = k.indexOf("|");
      return idx >= 0 ? k.slice(0, idx) : k;
    }),
  );
}

/**
 * Whether a section shows at this density. A field the query filters on always
 * shows, or its filter could not be removed from here; then the reader's own
 * hide and show; compact shows everything, comfortable the curated few.
 */
function isSectionShown({
  key,
  activeFields,
  explicitlyHidden,
  explicitlyShown,
  density,
}: {
  key: string;
  activeFields: ReadonlySet<string>;
  explicitlyHidden: ReadonlySet<string>;
  explicitlyShown: ReadonlySet<string>;
  density: string;
}): boolean {
  if (activeFields.has(key)) return true;
  if (explicitlyHidden.has(key)) return false;
  if (explicitlyShown.has(key)) return true;
  return density === "compact" || COMFORTABLE_DEFAULT_SECTIONS.has(key);
}

/**
 * The attribute sections: metadata always leads (its keys are full, so
 * `attribute` + `metadata.environment` filters the right column), then each
 * other stream that discovered any keys.
 */
function attributeSectionsFor({
  metadataAttributeKeys,
  traceAttributeKeys,
  eventAttributeKeys,
  spanAttributeKeys,
}: {
  metadataAttributeKeys: AttributeKey[];
  traceAttributeKeys: AttributeKey[];
  eventAttributeKeys: AttributeKey[];
  spanAttributeKeys: AttributeKey[];
}): AttributesSectionData[] {
  const streams: AttributesSectionData[] = [
    {
      key: ATTRIBUTES_SECTION_KEY,
      label: "Trace attributes",
      kind: "attributes",
      filterPrefix: "attribute",
      keys: traceAttributeKeys,
    },
    {
      key: EVENT_ATTRIBUTES_SECTION_KEY,
      label: "Event attributes",
      kind: "attributes",
      filterPrefix: "event.attribute",
      keys: eventAttributeKeys,
    },
    {
      key: SPAN_ATTRIBUTES_SECTION_KEY,
      label: "Span attributes",
      kind: "attributes",
      filterPrefix: "span.attribute",
      keys: spanAttributeKeys,
    },
  ];
  return [
    {
      key: METADATA_SECTION_KEY,
      label: "Metadata",
      kind: "attributes",
      filterPrefix: "attribute",
      keys: metadataAttributeKeys,
      displayStripPrefix: "metadata.",
      emptyDocsHref: METADATA_DOCS_URL,
    },
    ...streams.filter((section) => section.keys.length > 0),
  ];
}

/**
 * Values the query filters on that discovery did not return, as zero-count rows
 * pinned above the rest, so an active filter never vanishes from the sidebar.
 */
function withQueryValues({
  items,
  ast,
  key,
  extra,
}: {
  items: FacetItem[];
  ast: Parameters<typeof getFacetValues>[0];
  key: string;
  extra: (value: string) => Partial<FacetItem>;
}): FacetItem[] {
  const known = new Set(items.map((i) => i.value));
  const { include, exclude } = getFacetValues(ast, key);
  const pinned = [...new Set([...include, ...exclude])]
    .filter((value) => !known.has(value))
    .map((value) => ({ value, label: value, count: 0, synthetic: true, ...extra(value) }));
  return [...pinned, ...items];
}

/** The rows each categorical and discrete numeric facet renders. */
function facetItemsFor({
  categoricals,
  discreteEligible,
  isSynthetic,
  ast,
  countState,
}: {
  categoricals: CategoricalSection[];
  discreteEligible: ReturnType<typeof computeDiscreteEligible>;
  isSynthetic: boolean;
  ast: Parameters<typeof getFacetValues>[0];
  countState: FacetCountState;
}): Map<string, FacetItem[]> {
  const map = new Map<string, FacetItem[]>();
  for (const cat of categoricals) {
    const items = buildFacetItems({ cat, isSynthetic: cat.synthetic ?? isSynthetic, countState });
    map.set(
      cat.key,
      withQueryValues({ items, ast, key: cat.key, extra: () => ({ dimmed: true }) }),
    );
  }
  for (const [key, range] of discreteEligible) {
    const items = buildDiscreteFacetItems({
      range,
      synthetic: range.synthetic ?? isSynthetic,
      countState,
    });
    const extra = (value: string) => ({
      dotColor: hashColor(value),
      dimmed: !VIBRANT_FIELDS.has(key),
    });
    map.set(key, withQueryValues({ items, ast, key, extra }));
  }
  return map;
}

/**
 * The discovered sections, or the well-known defaults while discovery is in
 * flight or returned nothing usable for this view.
 */
function sectionsOf({
  descriptors,
  activeFields,
}: {
  descriptors: Descriptors | undefined;
  activeFields: ReadonlySet<string>;
}) {
  const real = partitionDescriptors(descriptors ?? [], activeFields);
  if (!isPartitionEmpty(real)) return { ...real, isSynthetic: false };
  return {
    ...partitionDescriptors(synthesizeDefaultDescriptors(), activeFields),
    isSynthetic: true,
  };
}

/** Sections in the lens's order, before density and the reader's preferences apply. */
function orderedSectionKeys({
  sections,
  lensSectionOrder,
}: {
  sections: { key: string; label: string }[];
  lensSectionOrder: Parameters<typeof applyLensOrder>[1];
}): string[] {
  const naturalOrder = sortBySectionOrder(sections.map(({ key, label }) => ({ key, label }))).map(
    (s) => s.key,
  );
  return applyLensOrder(naturalOrder, lensSectionOrder);
}

export function useFilterSidebarData() {
  const actions = useFacetFilterActions();
  const { ast } = actions;

  // The vocabulary comes from the tenant's discovery, the counts from the read
  // under the active query (ADR-139). The sample preview's fixtures are both.
  const { data: discovered, isLoading: facetsLoading } = useTraceFacets();
  const filtered = useFilteredTraceFacets();
  const isSamplePreview = usePreviewTracesActive();
  const { descriptors, countState } = useMemo(
    () =>
      isSamplePreview
        ? { descriptors: discovered, countState: "settled" as const }
        : mergeFacetDescriptors({
            discovered,
            filtered: filtered.data,
            filteredIsPlaceholder: filtered.isPlaceholderData,
          }),
    [isSamplePreview, discovered, filtered.data, filtered.isPlaceholderData],
  );

  const lensSectionOrder = useFacetLensStore((s) => s.lens.sectionOrder);
  const setSectionOrder = useFacetLensStore((s) => s.setSectionOrder);
  const setAllSectionsOpen = useFacetLensStore((s) => s.setAllSectionsOpen);
  const density = useDensityStore((s) => s.density);
  const prefs = useProjectFacetPrefs();

  // One walk of the query per identity change, so each row's state is a lookup.
  const facetStateLookup = useMemo(() => buildFacetStateLookup(ast), [ast]);
  const activeFields = useMemo(() => activeFieldsOf(facetStateLookup), [facetStateLookup]);
  const { explicitlyHidden, explicitlyShown } = prefs;
  const isSectionVisibleForDensity = useCallback(
    (key: string) =>
      isSectionShown({ key, activeFields, explicitlyHidden, explicitlyShown, density }),
    [density, activeFields, explicitlyHidden, explicitlyShown],
  );

  const sections = useMemo(
    () => sectionsOf({ descriptors, activeFields }),
    [descriptors, activeFields],
  );
  const { categoricals, ranges, isSynthetic } = sections;

  // Numeric facets with a bounded distinct set can render as a tick-list;
  // numericModeByKey says which of them do.
  const discreteEligible = useMemo(
    () => computeDiscreteEligible({ ranges, maxDistinctValues: DISCRETE_MODE_MAX_VALUES }),
    [ranges],
  );
  const numericModes = prefs.numericModes;
  const numericModeByKey = useMemo(
    () => resolveNumericModeByKey({ discreteEligible, numericModes }),
    [discreteEligible, numericModes],
  );

  const attributeSections = useMemo(() => attributeSectionsFor(sections), [sections]);
  const facetItems = useMemo(
    () => facetItemsFor({ categoricals, discreteEligible, isSynthetic, ast, countState }),
    [categoricals, discreteEligible, isSynthetic, ast, countState],
  );

  const getValueStates = useMemo(() => {
    const getFor =
      (field: string) =>
      (value: string): FacetValueState =>
        facetStateLookup.get(`${field}|${value}`) ?? "neutral";
    const keys = [...categoricals.map((c) => c.key), ...discreteEligible.keys()];
    return new Map(keys.map((key) => [key, getFor(key)]));
  }, [categoricals, discreteEligible, facetStateLookup]);

  const sectionByKey = useMemo(
    () =>
      new Map<string, Section>(
        [...categoricals, ...ranges, ...attributeSections].map((section) => [section.key, section]),
      ),
    [categoricals, ranges, attributeSections],
  );

  // Everything the backend has data for, so "+ Add facet" can offer what the
  // current visibility hides; the sidebar renders the visible subset.
  const orderedKeysAll = useMemo(
    () =>
      orderedSectionKeys({
        sections: [...categoricals, ...ranges, ...attributeSections],
        lensSectionOrder,
      }),
    [categoricals, ranges, attributeSections, lensSectionOrder],
  );
  const orderedKeys = useMemo(
    () => orderedKeysAll.filter(isSectionVisibleForDensity),
    [orderedKeysAll, isSectionVisibleForDensity],
  );

  return {
    ...actions,
    categoricals,
    ranges,
    traceAttributeKeys: sections.traceAttributeKeys,
    metadataAttributeKeys: sections.metadataAttributeKeys,
    spanAttributeKeys: sections.spanAttributeKeys,
    eventAttributeKeys: sections.eventAttributeKeys,
    attributeSections,
    facetItems,
    getValueStates,
    facetsLoading,
    descriptors,
    /** What the counts beside the values mean while a query is in flight. */
    countState,
    orderedKeys,
    sectionByKey,
    /** Presentation per discrete-eligible numeric facet; a missing key is slider only. */
    numericModeByKey,
    /** Switch a numeric facet's presentation (persisted per project). */
    setNumericMode: prefs.setNumericMode,
    setSectionOrder,
    setAllSectionsOpen,
    showFacet: prefs.showFacet,
    hideFacet: prefs.hideFacet,
    /** Clears the reader's show/hide overrides, back to the density default. */
    resetAllFacets: prefs.resetAllFacets,
    /** Every key the backend has data for, whatever the current visibility. */
    orderedKeysAll,
    /** Whether a section shows: density, the reader's preferences, active filters. */
    isSectionVisibleForDensity,
  };
}

// Keep a categorical section mounted when (a) it has buckets to show, (b) the AST
// has an active filter on this field, or (c) it was synthesised as a placeholder.
function keptCategoricalSections({
  d,
  activeFieldSet,
}: {
  d: Extract<Descriptors[number], { kind: "categorical" }>;
  activeFieldSet: ReadonlySet<string>;
}): CategoricalSection[] {
  const isSynthetic = (d as { synthetic?: boolean }).synthetic;
  const isKept = d.topValues.length > 0 || activeFieldSet.has(d.key) || isSynthetic;
  if (!isKept) return [];
  return [
    {
      kind: "cat",
      key: d.key,
      label: d.label,
      group: d.group,
      topValues: d.topValues,
      synthetic: isSynthetic,
    },
  ];
}

// Keep range sections when (a) the span is non-zero, (b) the AST
// has an active filter, or (c) it was synthesised as a placeholder.
function keptRangeSections({
  d,
  activeFieldSet,
}: {
  d: Extract<Descriptors[number], { kind: "range" }>;
  activeFieldSet: ReadonlySet<string>;
}): RangeSectionData[] {
  const isSynthetic = (d as { synthetic?: boolean }).synthetic;
  const isKept = d.max > 0 || activeFieldSet.has(d.key) || isSynthetic;
  if (!isKept) return [];
  return [
    {
      kind: "range",
      key: d.key,
      label: d.label,
      group: d.group,
      min: d.min,
      max: d.max,
      discrete: d.discrete,
      synthetic: isSynthetic,
    },
  ];
}

function partitionDescriptors(
  descriptors: ReturnType<typeof useTraceFacets>["data"],
  activeFieldSet: ReadonlySet<string>,
) {
  const cats: CategoricalSection[] = [];
  const rngs: RangeSectionData[] = [];
  let traceAttrs: AttributeKey[] = [];
  let metadataAttrs: AttributeKey[] = [];
  let spanAttrs: AttributeKey[] = [];
  let eventAttrs: AttributeKey[] = [];

  for (const d of descriptors) {
    if (d.kind === "categorical") {
      cats.push(...keptCategoricalSections({ d, activeFieldSet }));
      continue;
    }

    if (d.kind === "range") {
      rngs.push(...keptRangeSections({ d, activeFieldSet }));
      continue;
    }

    // Parallel attribute discovery streams.
    if (d.key === "metadataKeys") traceAttrs = d.topKeys;
    else if (d.key === "metadata") metadataAttrs = d.topKeys;
    else if (d.key === "spanAttributeKeys") spanAttrs = d.topKeys;
    else if (d.key === "eventAttributeKeys") eventAttrs = d.topKeys;
  }

  return {
    categoricals: sortBySectionOrder(cats),
    ranges: sortBySectionOrder(rngs),
    traceAttributeKeys: traceAttrs,
    metadataAttributeKeys: metadataAttrs,
    spanAttributeKeys: spanAttrs,
    eventAttributeKeys: eventAttrs,
  };
}

/**
 * True when a partition surfaced no renderable section at all — no categoricals, no
 * ranges, no attribute keys.
 */
function isPartitionEmpty(partition: ReturnType<typeof partitionDescriptors>): boolean {
  return (
    partition.categoricals.length === 0 &&
    partition.ranges.length === 0 &&
    partition.traceAttributeKeys.length === 0 &&
    partition.metadataAttributeKeys.length === 0 &&
    partition.spanAttributeKeys.length === 0 &&
    partition.eventAttributeKeys.length === 0
  );
}

/**
 * Build a synthetic descriptor list from FACET_DEFAULTS and RANGE_DEFAULTS, used to render the
 * sidebar before discover responds, so users see the well-known facets instead of a blank sidebar.
 */
type Descriptors = NonNullable<ReturnType<typeof useTraceFacets>["data"]>;
function synthesizeDefaultDescriptors(): Descriptors {
  const out: (Descriptors[number] & { synthetic?: boolean })[] = [];

  for (const [key, values] of Object.entries(FACET_DEFAULTS)) {
    // `descriptor.group` here uses the backend's `SectionGroup` taxonomy
    // (evaluation/metadata/prompt/span/trace).
    out.push({
      kind: "categorical",
      key,
      label: key,
      group: "trace",
      topValues: values.map((value) => ({ value, count: 0 })),
      totalDistinct: 0,
      synthetic: true,
    });
  }

  for (const key of RANGE_DEFAULTS) {
    out.push({
      kind: "range",
      key,
      label: key,
      group: "trace",
      min: 0,
      max: 0,
      synthetic: true,
    });
  }

  return out as Descriptors;
}

/**
 * FacetItem[] for a numeric facet's discrete values — each distinct integer
 * becomes a tickable row (value === label === the number), so the existing
 * categorical FacetSection renders the "Discrete" presentation unchanged.
 */
function buildDiscreteFacetItems({
  range,
  synthetic,
  countState,
}: {
  range: RangeSectionData;
  synthetic: boolean;
  countState: FacetCountState;
}): FacetItem[] {
  const dimmed = !VIBRANT_FIELDS.has(range.key);
  return (range.discrete?.values ?? []).map((dv) => ({
    value: String(dv.value),
    label: String(dv.value),
    count: countState === "pending" ? 0 : dv.count,
    dotColor: hashColor(String(dv.value)),
    dimmed,
    synthetic,
    countState,
  }));
}

/**
 * Exported for direct unit coverage: where a facet's curated colour and
 * order rules actually reach the rows. `FACET_COLORS` being correct proves
 * nothing if `dotColorFor` stops consulting it.
 */
export function buildFacetItems({
  cat,
  isSynthetic,
  countState = "settled",
}: {
  cat: CategoricalSection;
  isSynthetic: boolean;
  countState?: FacetCountState;
}): FacetItem[] {
  const curatedColors = FACET_COLORS[cat.key];
  const dimmed = !VIBRANT_FIELDS.has(cat.key);
  const counts = new Map(cat.topValues.map((v) => [v.value, v.count]));
  const labels = new Map(cat.topValues.map((v) => [v.value, v.label]));
  // Evaluator-only — every other facet skips this map entirely. We
  // forward the descriptor's per-value aggregates onto FacetItem so
  // the sidebar drilldown for `evaluator:<id>` can show pass/fail /
  // score-range without a second round-trip.
  const aggregates = new Map(
    cat.topValues.filter((v) => v.aggregates !== undefined).map((v) => [v.value, v.aggregates!]),
  );
  // Event-only — same forwarding pattern as `aggregates`: per-event metric
  // value tallies ride the discover payload so the event drilldown never
  // fires its own query.
  const eventMetrics = new Map(
    cat.topValues
      .filter((v) => v.eventMetrics !== undefined)
      .map((v) => [v.value, v.eventMetrics!]),
  );
  const orderedValues = orderValues({
    defaults: FACET_DEFAULTS[cat.key],
    order: FACET_VALUE_ORDER[cat.key],
    fallback: cat.topValues.map((v) => v.value),
    keys: [...counts.keys()],
  });
  const dotColorFor = curatedColors ? (value: string) => curatedColors[value] : hashColor;

  return orderedValues.map((value) => ({
    value,
    label: labels.get(value) ?? facetLabel(value, cat.key),
    // A warm-start row carries no count the reader can act on; see
    // `mergeFacetDescriptors`.
    count: countState === "pending" ? 0 : (counts.get(value) ?? 0),
    dotColor: dotColorFor(value),
    dimmed,
    synthetic: isSynthetic,
    countState,
    aggregates: aggregates.get(value),
    eventMetrics: eventMetrics.get(value),
  }));
}

/**
 * Exported for direct unit coverage: the ordering rule (rank what is present,
 * seed nothing) is invisible from the rendered sidebar, which sorts by count
 * often enough to look right by accident.
 */
export function orderValues({
  defaults,
  order,
  fallback,
  keys,
}: {
  defaults: string[] | undefined;
  order: readonly string[] | undefined;
  fallback: string[];
  keys: string[];
}): string[] {
  const base = defaults
    ? [...defaults, ...keys.filter((v) => !new Set(defaults).has(v))]
    : fallback;
  if (!order) return base;
  // Rank-sort rather than prepend: `defaults` may introduce values, `order`
  // must not — a facet can be given a reading order without also being given
  // rows for values it has never seen. Sort is stable, so anything outside
  // the ranked list keeps the count-sorted position it arrived with.
  const rank = new Map(order.map((value, i) => [value, i]));
  return [...base].toSorted(
    (a, b) => (rank.get(a) ?? Number.POSITIVE_INFINITY) - (rank.get(b) ?? Number.POSITIVE_INFINITY),
  );
}

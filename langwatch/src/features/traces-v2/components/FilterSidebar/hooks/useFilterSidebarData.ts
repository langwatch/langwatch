import { useCallback, useEffect, useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  analyzeOrGroups,
  buildFacetStateLookup,
  getFacetValues,
} from "~/server/app-layer/traces/query-language/queries";
import { useTraceFacets } from "../../../hooks/useTraceFacets";
import { useDensityStore } from "../../../stores/densityStore";
import {
  applyLensOrder,
  useFacetLensStore,
} from "../../../stores/facetLensStore";
import {
  selectVisibilityFor,
  useFacetVisibilityStore,
} from "../../../stores/facetVisibilityStore";
import { useFilterStore } from "../../../stores/filterStore";
import {
  type NumericMode,
  selectNumericModesFor,
  useNumericModeStore,
} from "../../../stores/numericModeStore";
import { hashColor } from "../../../utils/formatters";
import {
  ATTRIBUTES_SECTION_KEY,
  COMFORTABLE_DEFAULT_SECTIONS,
  DISCRETE_MODE_MAX_VALUES,
  EVENT_ATTRIBUTES_SECTION_KEY,
  FACET_COLORS,
  FACET_DEFAULTS,
  FACET_GROUPS,
  type FacetGroupDef,
  getFacetGroupId,
  METADATA_DOCS_URL,
  METADATA_SECTION_KEY,
  RANGE_DEFAULTS,
  SPAN_ATTRIBUTES_SECTION_KEY,
  VIBRANT_FIELDS,
} from "../constants";
import { routeToggleViaOrGroups } from "../routeToggleViaOrGroups";
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
  const storeToggleFacet = useFilterStore((s) => s.toggleFacet);
  const storeExcludeFacet = useFilterStore((s) => s.excludeFacet);
  const storeSetRange = useFilterStore((s) => s.setRange);
  const storeRemoveRange = useFilterStore((s) => s.removeRange);
  const toggleEvaluatorSubFilter = useFilterStore(
    (s) => s.toggleEvaluatorSubFilter,
  );
  const setEvaluatorScoreRange = useFilterStore(
    (s) => s.setEvaluatorScoreRange,
  );
  const removeEvaluatorScoreRange = useFilterStore(
    (s) => s.removeEvaluatorScoreRange,
  );

  // OR-group analysis, used only to route a same-field click into an
  // existing OR group (the third-and-beyond value of an already-grouped
  // facet). Cross-field OR is built in the filter bar, not here.
  const orAnalysisRaw = useMemo(() => analyzeOrGroups(ast), [ast]);

  // Hand the analysis + field to `routeToggleViaOrGroups`, which decides
  // whether the new value AND-appends or splices into an existing
  // same-field OR group, then forward the result to the store. The
  // routing rule lives in the helper so it's unit-testable without
  // rendering the sidebar — this hook is just the glue.
  const toggleFacet = useCallback(
    ({ field, value }: { field: string; value: string }) => {
      const routing = routeToggleViaOrGroups({
        analysis: orAnalysisRaw,
        field,
      });
      storeToggleFacet(field, value, routing);
    },
    [storeToggleFacet, orAnalysisRaw],
  );

  // Drives the row's trailing exclude (`−`) affordance: jump straight to
  // `NOT field:value` (or back to neutral if already excluded), bypassing
  // the include→exclude cycle so excluding is one deliberate click.
  const excludeFacet = useCallback(
    ({ field, value }: { field: string; value: string }) => {
      storeExcludeFacet(field, value);
    },
    [storeExcludeFacet],
  );

  const setRange = useCallback(
    ({ field, from, to }: { field: string; from: string; to: string }) => {
      storeSetRange(field, from, to);
    },
    [storeSetRange],
  );

  const removeRange = useCallback(
    ({ field }: { field: string }) => {
      storeRemoveRange(field);
    },
    [storeRemoveRange],
  );

  const { data: descriptors, isLoading: facetsLoading } = useTraceFacets();

  const lensSectionOrder = useFacetLensStore((s) => s.lens.sectionOrder);
  const lensGroupOrder = useFacetLensStore((s) => s.lens.groupOrder);
  const setSectionOrder = useFacetLensStore((s) => s.setSectionOrder);
  const setGroupOrder = useFacetLensStore((s) => s.setGroupOrder);
  const setAllSectionsOpen = useFacetLensStore((s) => s.setAllSectionsOpen);

  // Density + per-user visibility prefs feed the "which sections should
  // even show up" filter further down. Both are owned outside the
  // sidebar (density is global, visibility is per-project) so we just
  // subscribe + read them here. The actual resolver
  // (`isSectionVisibleForDensity`) is declared below `facetStateLookup`
  // because it depends on AST-active fields.
  const density = useDensityStore((s) => s.density);
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? null;
  const showFacet = useFacetVisibilityStore((s) => s.showFacet);
  const hideFacet = useFacetVisibilityStore((s) => s.hideFacet);
  const resetAllVisibility = useFacetVisibilityStore((s) => s.resetAll);
  const visibilityHydrate = useFacetVisibilityStore(
    (s) => s.hydrateFromStorage,
  );
  const visibilityPrefs = useFacetVisibilityStore((s) =>
    selectVisibilityFor(s, projectId),
  );
  useEffect(() => {
    if (projectId) visibilityHydrate(projectId);
  }, [projectId, visibilityHydrate]);

  // Per-facet numeric presentation (range slider vs discrete tick-list).
  // Owned outside the sidebar (per-project, like visibility) — read the
  // overrides here and resolve the effective mode against the registry
  // default further down (`numericModeByKey`).
  const numericModes = useNumericModeStore((s) =>
    selectNumericModesFor({ state: s, projectId }),
  );
  const setNumericModeRaw = useNumericModeStore((s) => s.setMode);
  const numericModeHydrate = useNumericModeStore((s) => s.hydrateFromStorage);
  useEffect(() => {
    if (projectId) numericModeHydrate(projectId);
  }, [projectId, numericModeHydrate]);
  const setNumericMode = useCallback(
    ({ field, mode }: { field: string; mode: NumericMode }) => {
      if (projectId) setNumericModeRaw({ projectId, field, mode });
    },
    [projectId, setNumericModeRaw],
  );
  // Stable Sets cheaper to query than `.includes()` inside the hot
  // resolver below — the prefs lists are typically <20 items but
  // `isSectionVisibleForDensity` runs once per section per render.
  const explicitlyShownSet = useMemo(
    () => new Set(visibilityPrefs.explicitlyShown),
    [visibilityPrefs.explicitlyShown],
  );
  const explicitlyHiddenSet = useMemo(
    () => new Set(visibilityPrefs.explicitlyHidden),
    [visibilityPrefs.explicitlyHidden],
  );

  // Walk the AST once per identity change to build a flat lookup map.
  // Every sidebar row used to call `getFacetValueState(ast, field, value)`,
  // which walked the AST per call → N×M walks per render. With Phase 2's
  // stable AST identity, this memo only reruns on real query changes.
  const facetStateLookup = useMemo(() => buildFacetStateLookup(ast), [ast]);

  // AST-active fields always show, regardless of density or user
  // overrides — hiding a facet whose value is currently filtered on
  // would leave the user with no way to remove the filter from the
  // sidebar (search bar still works, but that's worse UX). Derived
  // from `facetStateLookup` which is keyed by `${field}|${value}`.
  const activeFieldSet = useMemo(() => {
    const fields = new Set<string>();
    for (const k of facetStateLookup.keys()) {
      const idx = k.indexOf("|");
      fields.add(idx >= 0 ? k.slice(0, idx) : k);
    }
    return fields;
  }, [facetStateLookup]);

  const isSectionVisibleForDensity = useCallback(
    (key: string): boolean => {
      // Explicit hide wins over everything except active filter — see
      // comment on `activeFieldSet` above.
      if (activeFieldSet.has(key)) return true;
      if (explicitlyHiddenSet.has(key)) return false;
      if (explicitlyShownSet.has(key)) return true;
      // Compact = engineer mode, show everything the backend returned.
      if (density === "compact") return true;
      // Comfortable = "easy mode" — show only the curated cross-cutting
      // facets unless the user added more via the "+ Add facet" menu.
      return COMFORTABLE_DEFAULT_SECTIONS.has(key);
    },
    [density, activeFieldSet, explicitlyHiddenSet, explicitlyShownSet],
  );

  const makeGetValueState = useCallback(
    (field: string) =>
      (value: string): FacetValueState =>
        facetStateLookup.get(`${field}|${value}`) ?? "neutral",
    [facetStateLookup],
  );

  // Synthesise when (a) discover is still in flight, (b) discover
  // completed but returned no descriptors (project has no traces yet), or
  // (c) discover returned descriptors that all partition away — every
  // categorical had zero buckets, every range a zero span, and no
  // attribute keys surfaced — so nothing usable survives for the current
  // view (e.g. a project with traces but an empty distinct set in this
  // time window). Cases (b) and (c) used to collapse the sidebar to zero
  // sections, leaving a blank rail. The synthetic rows are fully
  // interactive (clicks still apply against the AST) but flagged so
  // FacetRow / RangeSection render a "no data yet" placeholder instead of
  // lying with a zero count / flat range bar.
  const {
    categoricals,
    ranges,
    traceAttributeKeys,
    metadataAttributeKeys,
    spanAttributeKeys,
    eventAttributeKeys,
    isSynthetic,
  } = useMemo(() => {
    const real = partitionDescriptors(descriptors ?? [], activeFieldSet);
    if (!isPartitionEmpty(real)) {
      return { ...real, isSynthetic: false };
    }
    const fallback = partitionDescriptors(
      synthesizeDefaultDescriptors(),
      activeFieldSet,
    );
    return { ...fallback, isSynthetic: true };
  }, [descriptors, activeFieldSet]);

  // Discrete-eligible numeric facets: range descriptors carrying a bounded
  // distinct-value set. Their FacetItem[] is built into `facetItems` below so
  // they can render through FacetSection; `numericModeByKey` resolves whether
  // each shows the tick-list (discrete) or the slider (range).
  const discreteEligible = useMemo(() => {
    const map = new Map<string, RangeSectionData>();
    for (const r of ranges) {
      const d = r.discrete;
      if (
        d &&
        d.values.length > 0 &&
        d.distinctCount <= DISCRETE_MODE_MAX_VALUES
      ) {
        map.set(r.key, r);
      }
    }
    return map;
  }, [ranges]);

  const numericModeByKey = useMemo(() => {
    const map = new Map<string, NumericMode>();
    for (const key of discreteEligible.keys()) {
      // Eligible facets default to discrete; a user override wins.
      map.set(key, numericModes[key] ?? "discrete");
    }
    return map;
  }, [discreteEligible, numericModes]);

  const attributeSections = useMemo<AttributesSectionData[]>(() => {
    const sections: AttributesSectionData[] = [];
    // Metadata leads the attribute block. Discovered keys are FULL
    // (`metadata.environment`); `filterPrefix: "attribute"` + the full key
    // yields `attribute.metadata.environment:value` →
    // `Attributes['metadata.environment']`. `displayStripPrefix` strips the
    // redundant `metadata.` from the label only, leaving the filter intact.
    // Metadata always leads the attribute block, even with zero discovered
    // keys — it's the primary way users filter their own traces, so it stays
    // visible and renders a docs-linked empty state (rather than vanishing and
    // leaving users unable to find where metadata filtering lives).
    sections.push({
      key: METADATA_SECTION_KEY,
      label: "Metadata",
      kind: "attributes",
      filterPrefix: "attribute",
      keys: metadataAttributeKeys,
      displayStripPrefix: "metadata.",
      emptyDocsHref: METADATA_DOCS_URL,
    });
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
  }, [
    metadataAttributeKeys,
    traceAttributeKeys,
    spanAttributeKeys,
    eventAttributeKeys,
  ]);

  const facetItems = useMemo(() => {
    const map = new Map<string, FacetItem[]>();
    for (const cat of categoricals) {
      const baseItems = buildFacetItems(cat, cat.synthetic ?? isSynthetic);
      // Surface values that the user typed in the search bar but that
      // discover didn't return (rare value, custom label, paste from
      // another query). Without this, an active filter like
      // `status:custom` shows up as `1` in the section's badge but the
      // matching row is invisible — users can't see what's selected
      // and can't click to remove. Synthesised AST-only rows render
      // with no count so they don't lie about hit counts.
      //
      // Pin AST extras to the TOP of the list so they always stay
      // above the show-more cut — otherwise an actively-filtered value
      // can hide below the fold the moment a section has more than ten
      // discovered values.
      const known = new Set(baseItems.map((i) => i.value));
      const { include, exclude } = getFacetValues(ast, cat.key);
      const extras: FacetItem[] = [];
      for (const value of [...include, ...exclude]) {
        if (known.has(value)) continue;
        known.add(value);
        extras.push({
          value,
          label: value,
          count: 0,
          dimmed: true,
          synthetic: true,
        });
      }
      map.set(cat.key, [...extras, ...baseItems]);
    }
    // Discrete numeric facets render through FacetSection too — build their
    // tick-list items from the descriptor's distinct values.
    for (const [key, range] of discreteEligible) {
      const baseItems = buildDiscreteFacetItems(
        range,
        range.synthetic ?? isSynthetic,
      );
      // Same AST-extra handling as categoricals above: a selected discrete
      // value that discover dropped from the distinct set would otherwise
      // vanish from the sidebar while its filter stays active, leaving the
      // user no way to clear it. Pin those rows to the top with a zero count.
      const known = new Set(baseItems.map((i) => i.value));
      const { include, exclude } = getFacetValues(ast, key);
      const extras: FacetItem[] = [];
      for (const value of [...include, ...exclude]) {
        if (known.has(value)) continue;
        known.add(value);
        extras.push({
          value,
          label: value,
          count: 0,
          dotColor: hashColor(value),
          dimmed: !VIBRANT_FIELDS.has(key),
          synthetic: true,
        });
      }
      map.set(key, [...extras, ...baseItems]);
    }
    return map;
  }, [categoricals, discreteEligible, isSynthetic, ast]);

  const getValueStates = useMemo(() => {
    const map = new Map<string, (value: string) => FacetValueState>();
    for (const cat of categoricals) {
      map.set(cat.key, makeGetValueState(cat.key));
    }
    for (const key of discreteEligible.keys()) {
      map.set(key, makeGetValueState(key));
    }
    return map;
  }, [categoricals, discreteEligible, makeGetValueState]);

  const sectionByKey = useMemo(() => {
    const map = new Map<string, Section>();
    for (const c of categoricals) map.set(c.key, c);
    for (const r of ranges) map.set(r.key, r);
    for (const a of attributeSections) map.set(a.key, a);
    return map;
  }, [categoricals, ranges, attributeSections]);

  // Full ordered list — covers everything the backend returned, before
  // density / per-user visibility is applied. Kept around so the
  // "+ Add facet" menu can offer the user any data-having facet that's
  // currently filtered out.
  const orderedKeysAll = useMemo(() => {
    const naturalOrder = sortBySectionOrder([
      ...categoricals.map((c) => ({ key: c.key, label: c.label })),
      ...ranges.map((r) => ({ key: r.key, label: r.label })),
      ...attributeSections.map((a) => ({ key: a.key, label: a.label })),
    ]).map((s) => s.key);
    return applyLensOrder(naturalOrder, lensSectionOrder);
  }, [categoricals, ranges, attributeSections, lensSectionOrder]);

  // Visible ordered list — what the sidebar actually renders. Filtered
  // by density + per-user prefs + active-AST. Drops both "would-be-shown
  // but explicitly hidden" and "would-be-hidden but not explicitly
  // shown" sections in one pass so the downstream `partitionIntoGroups`
  // produces clean group buckets.
  const orderedKeys = useMemo(
    () => orderedKeysAll.filter(isSectionVisibleForDensity),
    [orderedKeysAll, isSectionVisibleForDensity],
  );

  const orderedGroups = useMemo(
    () => partitionIntoGroups(orderedKeys, lensGroupOrder),
    [orderedKeys, lensGroupOrder],
  );

  // Hidden-by-group: section keys (with labels) that exist (backend
  // returned data for them) but are currently filtered out by density
  // / user prefs. Drives the "+ Add facet" picker on each
  // FacetGroupHeader so users can re-introduce the ones they care
  // about without flipping density. Labels come from sectionByKey so
  // the menu reads "Trace name" / "Span attributes" — not raw keys.
  const hiddenByGroup = useMemo<
    Record<string, Array<{ key: string; label: string }>>
  >(() => {
    const out: Record<string, Array<{ key: string; label: string }>> = {};
    for (const key of orderedKeysAll) {
      if (isSectionVisibleForDensity(key)) continue;
      const groupId = getFacetGroupId(key) ?? "custom";
      const label = sectionByKey.get(key)?.label ?? key;
      (out[groupId] ??= []).push({ key, label });
    }
    return out;
  }, [orderedKeysAll, isSectionVisibleForDensity, sectionByKey]);

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
  const resetAllFacetsForProject = useCallback(() => {
    if (projectId) resetAllVisibility(projectId);
  }, [projectId, resetAllVisibility]);

  return {
    ast,
    categoricals,
    ranges,
    traceAttributeKeys,
    metadataAttributeKeys,
    spanAttributeKeys,
    eventAttributeKeys,
    attributeSections,
    facetItems,
    getValueStates,
    facetsLoading,
    descriptors,
    orderedKeys,
    orderedGroups,
    hiddenByGroup,
    sectionByKey,
    /** Effective presentation mode per discrete-eligible numeric facet
     *  (`override ?? "discrete"`). A missing key = not eligible (slider only). */
    numericModeByKey,
    /** Switch a numeric facet's presentation (persisted per project). */
    setNumericMode,
    toggleFacet,
    /** Force a value to excluded (`NOT field:value`) / back to neutral —
     *  drives the row's trailing exclude affordance. */
    excludeFacet,
    setRange,
    removeRange,
    /** Evaluator-scoped group mutations — the drilldown wraps verdict /
     *  score / label sub-conditions in `(evaluator:X AND …)` so they bind to
     *  one evaluation. See {@link toggleEvaluatorSubFilter}. */
    toggleEvaluatorSubFilter,
    setEvaluatorScoreRange,
    removeEvaluatorScoreRange,
    setSectionOrder,
    setGroupOrder,
    setAllSectionsOpen,
    showFacet: showFacetForProject,
    hideFacet: hideFacetForProject,
    /** Resets all per-user show/hide overrides — sidebar returns to the
     *  density-default visibility. Wired into the facet picker's
     *  "Reset to defaults" footer button. */
    resetAllFacets: resetAllFacetsForProject,
    /** Full inventory the picker walks — every key the backend has
     *  data for, regardless of current visibility. */
    orderedKeysAll,
    /** Predicate the picker uses to render the checked state of each
     *  row. Reads density + per-user prefs + AST-active fields. */
    isSectionVisibleForDensity,
  };
}

export interface FacetGroupSlice {
  // `"other"` is the synthetic trailing bucket for keys that don't map
  // to any registered FACET_GROUPS entry — kept distinct from the
  // user-facing `"custom"` group so the two never collide on `.id`.
  id: FacetGroupDef["id"] | "other";
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
    slices.push({ id: "other", label: "Other", keys: ungrouped });
  }
  return slices;
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
      // Keep a categorical section mounted when (a) it has buckets to
      // show, (b) the AST has an active filter on this field, or (c) it
      // was synthesised as a placeholder before traces arrive. Without
      // (b), filtering on a categorical with zero matching distinct
      // values would drop the section from the sidebar — the user would
      // have no way to clear the filter. Without (c), cold tenants see
      // a blank sidebar on first load.
      const isSynthetic = (d as { synthetic?: boolean }).synthetic;
      if (d.topValues.length > 0 || activeFieldSet.has(d.key) || isSynthetic) {
        cats.push({
          kind: "cat",
          key: d.key,
          label: d.label,
          group: d.group,
          topValues: d.topValues,
          synthetic: isSynthetic,
        });
      }
    } else if (d.kind === "range") {
      // Keep range sections when (a) the span is non-zero, (b) the AST
      // has an active filter, or (c) it was synthesised as a placeholder.
      const isSynthetic = (d as { synthetic?: boolean }).synthetic;
      if (d.max > 0 || activeFieldSet.has(d.key) || isSynthetic) {
        rngs.push({
          kind: "range",
          key: d.key,
          label: d.label,
          group: d.group,
          min: d.min,
          max: d.max,
          discrete: d.discrete,
          synthetic: isSynthetic,
        });
      }
    } else if (d.kind === "dynamic_keys") {
      // Parallel attribute discovery streams. Each one corresponds to a
      // distinct `Map` (or `Array(Map)`) column in ClickHouse — except
      // `metadata`, which is the `metadata.*` subset of the same
      // `trace_summaries.Attributes` map as `metadataKeys`, scoped
      // server-side:
      //   `metadataKeys`        → `trace_summaries.Attributes` (all keys)
      //   `metadata`            → `trace_summaries.Attributes` (metadata.* only)
      //   `spanAttributeKeys`   → `stored_spans.SpanAttributes`
      //   `eventAttributeKeys`  → `stored_spans.Events.Attributes`
      // Split here so the sidebar can render distinct sections under
      // their respective groups (event keys live with the trace block
      // because span events are hoisted onto the trace at ingest).
      if (d.key === "metadataKeys") traceAttrs = d.topKeys;
      else if (d.key === "metadata") metadataAttrs = d.topKeys;
      else if (d.key === "spanAttributeKeys") spanAttrs = d.topKeys;
      else if (d.key === "eventAttributeKeys") eventAttrs = d.topKeys;
    }
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
 * True when a partition surfaced no renderable section at all — no
 * categoricals, no ranges, no attribute keys. This is the "discover
 * returned descriptors but every one of them partitioned away" case
 * (zero-bucket categoricals, zero-span ranges, no attribute keys),
 * which would otherwise leave a blank rail. The caller swaps in the
 * synthetic FACET_DEFAULTS set so the minimal facets always render.
 */
function isPartitionEmpty(
  partition: ReturnType<typeof partitionDescriptors>,
): boolean {
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
 * Build a synthetic descriptor list from FACET_DEFAULTS and RANGE_DEFAULTS
 * — used to render the sidebar before discover responds (or when discover
 * returns empty because the project has no traces yet), so users see the
 * well-known facets immediately instead of a blank sidebar.
 *
 * Categorical rows carry count=0 and are flagged synthetic so FacetRow
 * hides the count + value bar. Range descriptors use min=0, max=0 and are
 * flagged synthetic so RangeSection renders a placeholder caption.
 *
 * `partitionDescriptors` keeps synthetic rows even when empty because of
 * the `isSynthetic` guard — no filter needed here.
 */
type Descriptors = NonNullable<ReturnType<typeof useTraceFacets>["data"]>;
function synthesizeDefaultDescriptors(): Descriptors {
  const out: (Descriptors[number] & { synthetic?: boolean })[] = [];

  for (const [key, values] of Object.entries(FACET_DEFAULTS)) {
    // `descriptor.group` here uses the backend's `SectionGroup`
    // taxonomy (evaluation/metadata/prompt/span/trace), which is
    // distinct from the registry's UI-group taxonomy returned by
    // `getFacetGroupId` (evaluators/metrics/prompts/span/subjects/
    // trace) — they don't 1:1 map.
    //
    // Section PLACEMENT for the sidebar is driven by
    // `getFacetGroupId(key)` downstream (in `partitionIntoGroups`),
    // not by this `group` field. The field only feeds an icon
    // fallback when `FACET_ICONS[key]` is missing. Every key in
    // FACET_DEFAULTS except `spanStatus` has a curated icon today,
    // so the synthetic placeholder still renders correctly. Pinning
    // `"trace"` here keeps the type clean; if the icon-fallback path
    // ever matters we'll wire a registry→SectionGroup mapping.
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
function buildDiscreteFacetItems(
  range: RangeSectionData,
  synthetic: boolean,
): FacetItem[] {
  const dimmed = !VIBRANT_FIELDS.has(range.key);
  return (range.discrete?.values ?? []).map((dv) => ({
    value: String(dv.value),
    label: String(dv.value),
    count: dv.count,
    dotColor: hashColor(String(dv.value)),
    dimmed,
    synthetic,
  }));
}

function buildFacetItems(
  cat: CategoricalSection,
  synthetic: boolean,
): FacetItem[] {
  const curatedColors = FACET_COLORS[cat.key];
  const dimmed = !VIBRANT_FIELDS.has(cat.key);
  const counts = new Map(cat.topValues.map((v) => [v.value, v.count]));
  const labels = new Map(cat.topValues.map((v) => [v.value, v.label]));
  // Evaluator-only — every other facet skips this map entirely. We
  // forward the descriptor's per-value aggregates onto FacetItem so
  // the sidebar drilldown for `evaluator:<id>` can show pass/fail /
  // score-range without a second round-trip.
  const aggregates = new Map(
    cat.topValues
      .filter((v) => v.aggregates !== undefined)
      .map((v) => [v.value, v.aggregates!]),
  );
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
    synthetic,
    aggregates: aggregates.get(value),
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

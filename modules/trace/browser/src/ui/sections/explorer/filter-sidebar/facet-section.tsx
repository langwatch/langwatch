import { Kbd } from "@langwatch/design-system/kbd";
import {
  Box,
  Button,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type FacetItem,
  type FacetValueState,
} from "../../../../behavior/explorer/filter-sidebar/types.ts";
import { useDebouncedValue } from "../../../../behavior/explorer/use-debounced-value.ts";
import { MAX_EXPANDED_FACETS, MAX_VISIBLE_FACETS } from "../../../../behavior/facet-constants.ts";
import { useFacetLensStore } from "../../../../behavior/facet-lens.store.ts";
import { dedupeByValue } from "../../../../model/dedupe-by-value.ts";
import { NoneFacetRow } from "../../../blocks/explorer/filter-sidebar/none-facet-row.tsx";
import { SidebarSection } from "../../../elements/explorer/filter-sidebar/sidebar-section.tsx";
import { useFacetSearch } from "../hooks/use-facet-search.ts";
import { FacetRow } from "./facet-row.tsx";
import { countPresentValues } from "./utils.ts";

interface FacetSectionProps {
  title: string;
  icon?: React.ElementType;
  field: string;
  items: FacetItem[];
  getValueState: (value: string) => FacetValueState;
  onToggle: (field: string, value: string) => void;
  /** Force a value to excluded (`NOT field:value`) / back to neutral —
   * drives each row's trailing exclude (`−`) affordance. */
  onExclude: (field: string, value: string) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  /** When set, renders a "(none)" row pinned at the bottom that toggles a `none:`/`has:` filter. */
  noneRow?: { active: boolean; onToggle: () => void };
  onShiftToggle?: (nextOpen: boolean) => void;
  /** Remove this section from the sidebar (per-user). */
  onHide?: () => void;
  /**
   * True when this section was synthesised before traces arrive. When
   * `items.length === 0` and this is set, renders a "No values yet"
   * placeholder instead of an empty section.
   */
  synthetic?: boolean;
  /** Slider ↔ tick-list presentation toggle, forwarded to the header for
   *  numeric facets rendered in discrete mode. */
  modeToggleProps?: {
    mode: "range" | "discrete";
    onToggle: () => void;
  };
  /**
   * When true, the per-facet value search ALSO reaches the SERVER (queries
   * `facetValues` with the typed text as a `prefix`) to SUPPLEMENT — not replace — the
   * client-side filter over `items`, so values beyond the preloaded top-N surface too.
   */
  serverValueSearch?: boolean;
  /**
   * Optional per-row extras renderer. Invoked for any row whose value is currently
   * active (i.e. surfaced via `pinnedContent`).
   */
  renderActiveRowExtras?: (item: FacetItem) => React.ReactNode;
  // Two slots (trailing chevron, below panel) with derived expansion to stay
  // in sync regardless of filter source.
  renderInactiveRowExtras?: (
    item: FacetItem,
    isExpanded: boolean,
    onToggleExpand: () => void,
  ) => InactiveRowExtras | null;
}

interface InactiveRowExtras {
  /** Inline accessory rendered at the row's trailing edge (e.g. an
   *  expand chevron). Sits beside the row, not inside its button. */
  trailing?: React.ReactNode;
  /** Content rendered directly below the row (e.g. the expanded
   *  drilldown panel). Only present while the row is expanded. */
  below?: React.ReactNode;
}

/**
 * Whether a row's drilldown is open: open while its value is filtered on,
 * unless the chevron overrode it, and an override lapses once the filter state
 * it was made against changes.
 */
function useRowExpansion(getValueState: (value: string) => FacetValueState) {
  const [overrides, setOverrides] = useState<
    Map<string, { open: boolean; against: FacetValueState }>
  >(() => new Map());
  const isRowExpanded = useCallback(
    (value: string) => {
      const state = getValueState(value);
      const override = overrides.get(value);
      if (override && override.against === state) return override.open;
      return state !== "neutral";
    },
    [overrides, getValueState],
  );
  const toggleExpand = useCallback(
    (value: string) => {
      const against = getValueState(value);
      const open = !isRowExpanded(value);
      setOverrides((prev) => new Map(prev).set(value, { open, against }));
    },
    [getValueState, isRowExpanded],
  );
  return { isRowExpanded, toggleExpand };
}

/**
 * The typed-value filter, hidden until the header's funnel reveals and focuses
 * it. Closing it clears the query, so reopening never shows a stale filter.
 */
function useFacetSearchInput() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
    else setSearchQuery("");
  }, [searchOpen]);
  return { searchOpen, setSearchOpen, searchQuery, setSearchQuery, searchInputRef };
}

/**
 * The preloaded values, supplemented while a search is typed by the server's
 * prefix matches across all of the facet's values. Preloaded rows win on a
 * shared value, keeping their colour and aggregates.
 */
function useSearchedItems({
  items,
  field,
  enabled,
  searchQuery,
}: {
  items: FacetItem[];
  field: string;
  enabled: boolean;
  searchQuery: string;
}) {
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
  const serverSearchActive =
    enabled && searchQuery.trim().length > 0 && debouncedSearchQuery.trim().length > 0;
  const serverSearch = useFacetSearch({
    facetKey: field,
    prefix: debouncedSearchQuery,
    enabled: serverSearchActive,
  });
  const baseItems = useMemo(() => {
    if (!serverSearchActive) return items;
    const serverItems = serverSearch.values.map((v) => ({
      value: v.value,
      label: v.label ?? v.value,
      count: v.count,
    }));
    return dedupeByValue([...items, ...serverItems]);
  }, [serverSearchActive, items, serverSearch.values]);
  return { baseItems, isSearching: serverSearchActive && serverSearch.isFetching };
}

type FacetLayout = { activeItems: FacetItem[]; facetWindow: FacetWindow; maxCount: number };

/**
 * The row layout, frozen while the pointer is inside the section so a click
 * never yanks a row to the pinned area or reshuffles the list under the cursor.
 * A typed search bypasses the freeze so the list narrows live.
 */
function useFrozenLayout({ live, searching }: { live: FacetLayout; searching: boolean }) {
  const liveRef = useRef(live);
  liveRef.current = live;
  const [frozen, setFrozen] = useState<FacetLayout | null>(null);
  const freeze = useCallback(() => setFrozen((prev) => prev ?? { ...liveRef.current }), []);
  const thaw = useCallback(() => setFrozen(null), []);
  return { layout: searching ? live : (frozen ?? live), freeze, thaw };
}

/**
 * Active rows (the filtered-on values) pinned above the rest, and the window of
 * the rest the list shows, with the largest count for the bars.
 */
function useFacetLayout({
  baseItems,
  searchQuery,
  showMore,
  getValueState,
}: {
  baseItems: FacetItem[];
  searchQuery: string;
  showMore: boolean;
  getValueState: (value: string) => FacetValueState;
}) {
  return useMemo(() => {
    const filtered = filterAndSortItems({ items: baseItems, searchQuery });
    const activeItems = filtered.filter((item) => getValueState(item.value) !== "neutral");
    const activeValues = new Set(activeItems.map((i) => i.value));
    const restItems = filtered.filter((item) => !activeValues.has(item.value));
    const isHighCardinality = restItems.length >= MAX_VISIBLE_FACETS;
    const facetWindow = computeWindow({
      filtered: restItems,
      isHighCardinality,
      showMore,
      searchActive: searchQuery.length > 0,
    });
    const maxCount = facetWindow.visible.reduce((m, i) => (i.count > m ? i.count : m), 0);
    return { live: { activeItems, facetWindow, maxCount }, isHighCardinality };
  }, [baseItems, searchQuery, showMore, getValueState]);
}

/** The value a typed entry names: an exact value or label match, else the text itself. */
function valueForTyped({ items, typed }: { items: FacetItem[]; typed: string }): string {
  const lowered = typed.toLowerCase();
  const matched = items.find(
    (i) => i.value.toLowerCase() === lowered || i.label.toLowerCase() === lowered,
  );
  return matched?.value ?? typed;
}

/**
 * Shown when two or more values are included: a field holds one value at a
 * time, so they combine with OR, and the header says so.
 */
function AnyOfHint() {
  return (
    <Text
      textStyle="2xs"
      color="blue.fg"
      fontWeight="500"
      textTransform="none"
      letterSpacing="normal"
      flexShrink={0}
      title="These values are combined with OR: traces matching any of them are shown"
      data-testid="facet-any-of-hint"
    >
      any of
    </Text>
  );
}

/** A row with its trailing accessory (the expand chevron) beside it and its panel below. */
function RowWithExtras({
  row,
  extras,
}: {
  row: React.ReactNode;
  extras: InactiveRowExtras | null | undefined;
}) {
  return (
    <Box>
      {extras?.trailing ? (
        <HStack gap={0.5} align="center">
          <Box flex={1} minWidth={0}>
            {row}
          </Box>
          {extras.trailing}
        </HStack>
      ) : (
        row
      )}
      {extras?.below}
    </Box>
  );
}

/**
 * The typed-value filter. Enter applies the typed value; the focus ring is
 * inset so the sidebar's overflow cannot clip it.
 */
function FacetSearchInput({
  inputRef,
  searchQuery,
  onQueryChange,
  onSubmit,
  isSearching,
  hasNoMatch,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onQueryChange: (query: string) => void;
  onSubmit: (typed: string) => void;
  isSearching: boolean;
  hasNoMatch: boolean;
}) {
  return (
    <VStack gap={0.5} align="stretch" marginTop={1} paddingX={0.5} paddingY={0.5}>
      <Input
        ref={inputRef}
        size="xs"
        placeholder="Search or press Enter to apply…"
        value={searchQuery}
        _focusVisible={{
          outlineWidth: "2px",
          outlineStyle: "solid",
          outlineColor: "blue.focusRing",
          outlineOffset: "-2px",
        }}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          const typed = searchQuery.trim();
          if (e.key !== "Enter" || !typed) return;
          e.preventDefault();
          onSubmit(typed);
        }}
        textStyle="xs"
      />
      {isSearching && (
        <HStack data-testid="facet-search-spinner" gap={2} paddingX={1} paddingY={1}>
          <Spinner size="xs" />
          <Text textStyle="2xs" color="fg.subtle">
            Searching all values…
          </Text>
        </HStack>
      )}
      {searchQuery.trim() && !isSearching && hasNoMatch && (
        <Text textStyle="2xs" color="fg.muted" paddingX={1}>
          No match. Press <Kbd>Enter</Kbd> to filter by "
          <Box as="span" fontWeight="600" color="fg">
            {searchQuery.trim()}
          </Box>
          " anyway.
        </Text>
      )}
    </VStack>
  );
}

const FacetSectionInner: React.FC<FacetSectionProps> = ({
  title,
  icon,
  field,
  items,
  getValueState,
  onToggle,
  onExclude,
  dragHandleProps,
  noneRow,
  onShiftToggle,
  onHide,
  renderActiveRowExtras,
  renderInactiveRowExtras,
  synthetic,
  modeToggleProps,
  serverValueSearch,
}) => {
  const { isRowExpanded, toggleExpand } = useRowExpansion(getValueState);
  const lensOverride = useFacetLensStore((s) => s.lens.sectionOpen[field]);
  const setSectionOpen = useFacetLensStore((s) => s.setSectionOpen);
  const [showMore, setShowMore] = useState(false);
  const search = useFacetSearchInput();
  const { searchQuery } = search;

  const handleToggle = useCallback((value: string) => onToggle(field, value), [onToggle, field]);
  const handleExclude = useCallback((value: string) => onExclude(field, value), [onExclude, field]);

  const activeCount =
    items.filter((i) => getValueState(i.value) !== "neutral").length + (noneRow?.active ? 1 : 0);
  const includedCount = items.filter((i) => getValueState(i.value) === "include").length;
  // The badge counts only values with matching traces; zero-count rows stay listed.
  const presentValueCount = useMemo(() => countPresentValues(items), [items]);

  const { baseItems, isSearching } = useSearchedItems({
    items,
    field,
    enabled: !!serverValueSearch && search.searchOpen,
    searchQuery,
  });
  const { live, isHighCardinality } = useFacetLayout({
    baseItems,
    searchQuery,
    showMore,
    getValueState,
  });
  const { layout, freeze, thaw } = useFrozenLayout({ live, searching: !!searchQuery });

  const row = (item: FacetItem) => (
    <FacetRow
      item={item}
      state={getValueState(item.value)}
      maxCount={layout.maxCount}
      onToggle={handleToggle}
      onExclude={handleExclude}
      field={field}
    />
  );

  // Collapsed by default, open when a value is filtered on; the reader's own
  // open or close always wins. See specs/traces-v2/filter-bar-interactions.feature.
  const effectiveOpen = lensOverride ?? activeCount > 0;

  return (
    <Box onMouseEnter={freeze} onMouseLeave={thaw}>
      <SidebarSection
        title={title}
        icon={icon}
        open={effectiveOpen}
        onOpenChange={(next) => setSectionOpen(field, next)}
        dragHandleProps={dragHandleProps}
        onShiftToggle={onShiftToggle}
        onHide={onHide}
        hideLabel={`Hide ${title}`}
        searchToggleProps={
          items.length > 0
            ? { open: search.searchOpen, onToggle: () => search.setSearchOpen((prev) => !prev) }
            : undefined
        }
        modeToggleProps={modeToggleProps}
        valueCount={presentValueCount}
        hasActive={activeCount > 0}
        pinnedContent={
          layout.activeItems.length > 0 ? (
            <VStack gap={0.5} align="stretch">
              {layout.activeItems.map((item) => (
                <Box key={item.value}>
                  {row(item)}
                  {renderActiveRowExtras?.(item)}
                </Box>
              ))}
            </VStack>
          ) : undefined
        }
        activeIndicator={includedCount >= 2 ? <AnyOfHint /> : undefined}
      >
        <VStack gap={0.5} align="stretch">
          {items.length === 0 && synthetic && (
            <Text textStyle="2xs" color="fg.subtle" paddingX={1} paddingY={1}>
              No values yet
            </Text>
          )}
          {layout.facetWindow.visible.map((item) => (
            <RowWithExtras
              key={item.value}
              row={row(item)}
              extras={renderInactiveRowExtras?.(item, isRowExpanded(item.value), () =>
                toggleExpand(item.value),
              )}
            />
          ))}
          {noneRow && !searchQuery && (
            <NoneFacetRow active={noneRow.active} onToggle={noneRow.onToggle} />
          )}
          {isHighCardinality && !searchQuery && (
            <ExpandToggle
              showMore={showMore}
              collapsedRemaining={layout.facetWindow.collapsedRemaining}
              beyondExpanded={layout.facetWindow.beyondExpanded}
              onShowMore={() => setShowMore(true)}
              onShowLess={() => setShowMore(false)}
            />
          )}
          {items.length > 0 && search.searchOpen && (
            <FacetSearchInput
              inputRef={search.searchInputRef}
              searchQuery={searchQuery}
              onQueryChange={search.setSearchQuery}
              onSubmit={(typed) => {
                handleToggle(valueForTyped({ items, typed }));
                search.setSearchQuery("");
              }}
              isSearching={isSearching}
              hasNoMatch={layout.facetWindow.visible.length === 0}
            />
          )}
        </VStack>
      </SidebarSection>
    </Box>
  );
};

export const FacetSection = memo(FacetSectionInner);

function filterAndSortItems({
  items,
  searchQuery,
}: {
  items: FacetItem[];
  searchQuery: string;
}): FacetItem[] {
  const sorted = [...items].toSorted((a, b) => b.count - a.count);
  if (!searchQuery) return sorted;
  const q = searchQuery.toLowerCase();
  // Match both label and value: for facets where label !== value
  // (friendly topic names, IDs displayed with a label), typing
  // either should reveal the row.
  return sorted.filter(
    (i) => i.label.toLowerCase().includes(q) || i.value.toLowerCase().includes(q),
  );
}

interface FacetWindow {
  visible: FacetItem[];
  collapsedRemaining: number;
  beyondExpanded: number;
}

function computeWindow({
  filtered,
  isHighCardinality,
  showMore,
  searchActive,
}: {
  filtered: FacetItem[];
  isHighCardinality: boolean;
  showMore: boolean;
  searchActive: boolean;
}): FacetWindow {
  if (searchActive || !isHighCardinality) {
    return { visible: filtered, collapsedRemaining: 0, beyondExpanded: 0 };
  }

  const limit = showMore ? MAX_EXPANDED_FACETS : MAX_VISIBLE_FACETS;
  const collapsedRemaining = Math.min(
    filtered.length - MAX_VISIBLE_FACETS,
    MAX_EXPANDED_FACETS - MAX_VISIBLE_FACETS,
  );
  const beyondExpanded = Math.max(filtered.length - MAX_EXPANDED_FACETS, 0);

  return {
    visible: filtered.slice(0, limit),
    collapsedRemaining: Math.max(collapsedRemaining, 0),
    beyondExpanded,
  };
}

interface ExpandToggleProps {
  showMore: boolean;
  collapsedRemaining: number;
  beyondExpanded: number;
  onShowMore: () => void;
  onShowLess: () => void;
}

const ExpandToggle: React.FC<ExpandToggleProps> = ({
  showMore,
  collapsedRemaining,
  beyondExpanded,
  onShowMore,
  onShowLess,
}) => {
  if (!showMore) {
    if (collapsedRemaining <= 0) return null;
    return <LinkButton onClick={onShowMore}>Show {collapsedRemaining} more</LinkButton>;
  }
  return (
    <>
      {beyondExpanded > 0 && (
        // The 50 backend-returned values are now all visible —
        // anything beyond that didn't surface in the top response,
        // so the hint points at the always-on search input (which
        // doubles as Enter-to-filter for arbitrary values).
        <Text textStyle="xs" color="fg.subtle" paddingX={1} paddingY={0.5}>
          {beyondExpanded}+ rare values aren't shown. Type a value and press Enter to filter.
        </Text>
      )}
      <LinkButton onClick={onShowLess}>Show less</LinkButton>
    </>
  );
};

const LinkButton: React.FC<{
  children: React.ReactNode;
  onClick: () => void;
}> = ({ children, onClick }) => (
  <Button
    variant="plain"
    size="xs"
    justifyContent="flex-start"
    width="fit-content"
    color="blue.fg"
    paddingX={1}
    paddingY={1}
    height="auto"
    _hover={{ textDecoration: "underline" }}
    onClick={onClick}
  >
    {children}
  </Button>
);

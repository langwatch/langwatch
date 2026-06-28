import {
  Box,
  Button,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useFacetSearch } from "../../hooks/useFacetSearch";
import { useFacetLensStore } from "../../stores/facetLensStore";
import { dedupeByValue } from "../../utils/dedupeByValue";
import {
  AUTO_EXPAND_THRESHOLD,
  MAX_EXPANDED_FACETS,
  MAX_VISIBLE_FACETS,
} from "./constants";
import { FacetRow } from "./FacetRow";
import { NoneFacetRow } from "./NoneFacetRow";
import { SidebarSection } from "./SidebarSection";
import type { FacetItem, FacetValueState } from "./types";
import { countPresentValues } from "./utils";

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
   * `facetValues` with the typed text as a `prefix`) to SUPPLEMENT — not
   * replace — the client-side filter over `items`, so values beyond the
   * preloaded top-N surface too. Set only by the categorical render branch;
   * see {@link useFacetSearch} — server search is categorical-only. The
   * Enter-to-filter fallback is kept regardless for not-yet-ingested values.
   */
  serverValueSearch?: boolean;
  /**
   * Optional per-row extras renderer. Invoked for any row whose value
   * is currently active (i.e. surfaced via `pinnedContent`). The
   * returned node is rendered immediately below the active row so the
   * extras read as a continuation of the row's UI. The evaluator
   * section uses this to inline a drilldown (verdict pills, score
   * range slider) under each active evaluator without firing a second
   * server query. Returns `null` to skip extras for a given item.
   */
  renderActiveRowExtras?: (item: FacetItem) => React.ReactNode;
  /**
   * Optional extras renderer for INACTIVE rows. Invoked for each
   * inactive item in the visible window. Receives the item, whether
   * this row is currently expanded, and a callback to toggle the
   * expansion. Returns `null` to skip extras for that item.
   *
   * Split into two slots: `trailing` renders inline at the row's right
   * edge (the expand chevron) and `below` renders underneath the row
   * (the expanded drilldown panel). Keeping the toggle inline — rather
   * than as a full-width row beneath — is why the contract is an object
   * rather than a single node.
   *
   * FacetSection owns the `expandedInactiveRows` Set so the state is
   * automatically reset whenever the section unmounts or the sidebar
   * is closed — no external persistence needed.
   */
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
  const [expandedInactiveRows, setExpandedInactiveRows] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleInactiveExpand = useCallback((value: string) => {
    setExpandedInactiveRows((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }, []);
  const lensOverride = useFacetLensStore((s) => s.lens.sectionOpen[field]);
  const setSectionOpen = useFacetLensStore((s) => s.setSectionOpen);
  const [showMore, setShowMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // The typed-value filter is hidden by default; the SidebarSection
  // header shows a list-filter funnel icon that reveals (and auto-
  // focuses) the input. Audit feedback was that the always-on input took
  // ~32px off every section's vertical real estate for an affordance most
  // operators only reach for on long-tail values. We keep it
  // *available* (one click) but stop spending the space.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);
  // When the user types something then closes the search, reset the
  // query so reopening the search doesn't surprise them with a stale
  // filter from a previous session.
  useEffect(() => {
    if (!searchOpen) setSearchQuery("");
  }, [searchOpen]);

  const handleToggle = useCallback(
    (value: string) => onToggle(field, value),
    [onToggle, field],
  );
  const handleExclude = useCallback(
    (value: string) => onExclude(field, value),
    [onExclude, field],
  );

  const activeCount = useMemo(
    () =>
      items.filter((i) => getValueState(i.value) !== "neutral").length +
      (noneRow?.active ? 1 : 0),
    [items, getValueState, noneRow?.active],
  );

  // "Any of" hint: 2+ INCLUDED values of the same field combine with OR
  // (a trace's field can equal only one value at a time). Surfacing this on
  // the header tells the user the selection is a set of alternatives, not a
  // narrowing AND — without making them read the query bar. Excluded values
  // don't count: `NOT a AND NOT b` is a genuine AND, not an "any of".
  const includedCount = useMemo(
    () => items.filter((i) => getValueState(i.value) === "include").length,
    [items, getValueState],
  );
  const showAnyOfHint = includedCount >= 2;

  // Header value-count badge counts only values that actually have matching
  // traces — see countPresentValues. The zero-count default rows stay visible
  // in the list for one-click filtering; the badge just stops tallying them.
  const presentValueCount = useMemo(() => countPresentValues(items), [items]);

  // Server-side value search. When the per-facet search is open with a
  // non-empty query, ALSO query `facetValues` with that text as a `prefix` so
  // the match reaches ALL of this facet's distinct values — not just the
  // preloaded top-N `items`. The typed text is debounced before it hits the
  // server: a per-keystroke prefix scan over a high-cardinality facet is a real
  // ClickHouse round-trip. Gated on `serverValueSearch` — see useFacetSearch
  // (server search is categorical-only) — AND on BOTH the live and debounced
  // query: the debounced value drives the fetch (wait for typing to settle),
  // while the live value disables it the instant the input is cleared so a
  // stale prefix can't keep firing for the debounce window. The hook is always
  // called (hooks can't be conditional) but stays disabled until the gate opens.
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
  const serverSearchActive =
    !!serverValueSearch &&
    searchOpen &&
    searchQuery.trim().length > 0 &&
    debouncedSearchQuery.trim().length > 0;
  const serverSearch = useFacetSearch({
    facetKey: field,
    prefix: debouncedSearchQuery,
    enabled: serverSearchActive,
  });
  const serverItems = useMemo<FacetItem[]>(
    () =>
      serverSearch.values.map((v) => ({
        value: v.value,
        label: v.label ?? v.value,
        count: v.count,
      })),
    [serverSearch.values],
  );

  // SUPPLEMENT, don't replace: while server search is active, feed the UNION of
  // the preloaded items and the server prefix results (preloaded first so it
  // wins on a shared value, keeping its dotColor / aggregates). The client-side
  // substring filter still runs over that union on the LIVE query every
  // keystroke — a server prefix hit is also a substring match, so it survives,
  // while a substring living WITHIN a preloaded value (e.g. "gpt-4o" inside
  // "openai/gpt-4o-mini", which the server's anchored prefix match misses) is
  // still found locally.
  const baseItems = useMemo(
    () =>
      serverSearchActive ? dedupeByValue([...items, ...serverItems]) : items,
    [serverSearchActive, items, serverItems],
  );
  const filtered = useMemo(
    () => filterAndSortItems({ items: baseItems, searchQuery }),
    [baseItems, searchQuery],
  );

  // Active rows = currently-filtered values (same-field OR values are
  // already active here via getValueState). We pin them above the
  // collapsible content so they stay visible even when the section is
  // collapsed — the user can see / remove what's filtered without
  // expanding the whole list.
  const activeItems = useMemo(
    () => filtered.filter((item) => getValueState(item.value) !== "neutral"),
    [filtered, getValueState],
  );
  const activeValueSet = useMemo(
    () => new Set(activeItems.map((i) => i.value)),
    [activeItems],
  );
  const restItems = useMemo(
    () => filtered.filter((item) => !activeValueSet.has(item.value)),
    [filtered, activeValueSet],
  );

  const isHighCardinality = restItems.length >= MAX_VISIBLE_FACETS;
  const facetWindow = useMemo(
    () =>
      computeWindow({
        filtered: restItems,
        isHighCardinality,
        showMore,
        searchActive: searchQuery.length > 0,
      }),
    [restItems, isHighCardinality, showMore, searchQuery],
  );

  const maxCount = useMemo(
    () => facetWindow.visible.reduce((m, i) => (i.count > m ? i.count : m), 0),
    [facetWindow.visible],
  );

  // Freeze the row layout while the pointer is inside the section. A click
  // toggles a value's state but must not yank it up to the pinned area or
  // reshuffle the count-sorted list under the cursor (jarring). We snapshot
  // the rendered partition (pinned actives + windowed rest) on pointer-enter
  // and keep rendering it until the pointer leaves, at which point the live
  // partition re-flows. Each row still reads its *live* state, so the clicked
  // value lights up in place without moving.
  const liveLayoutRef = useRef({ activeItems, facetWindow, maxCount });
  liveLayoutRef.current = { activeItems, facetWindow, maxCount };
  const [frozenLayout, setFrozenLayout] = useState<{
    activeItems: FacetItem[];
    facetWindow: FacetWindow;
    maxCount: number;
  } | null>(null);
  const freezeLayout = useCallback(
    () => setFrozenLayout((prev) => prev ?? { ...liveLayoutRef.current }),
    [],
  );
  const thawLayout = useCallback(() => setFrozenLayout(null), []);
  // Bypass freeze whenever a typed-search is active: the value-search input
  // lives inside the same hover-Box, so by the time the user types the
  // layout is already frozen — `searchQuery → filtered → facetWindow`
  // narrows live, but a frozen `layout.facetWindow.visible` would keep
  // showing the pre-search snapshot. We re-flow on every keystroke so the
  // list narrows as the user types. Reorder-on-click (the reason the
  // freeze exists) doesn't intersect search, since clicking a row blurs
  // the input and dismounts the search affordance.
  const layout = searchQuery
    ? { activeItems, facetWindow, maxCount }
    : (frozenLayout ?? { activeItems, facetWindow, maxCount });

  const smartDefaultOpen =
    items.length <= AUTO_EXPAND_THRESHOLD || activeCount > 0;
  const effectiveOpen = lensOverride ?? smartDefaultOpen;

  return (
    <Box onMouseEnter={freezeLayout} onMouseLeave={thawLayout}>
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
            ? {
                open: searchOpen,
                onToggle: () => setSearchOpen((prev) => !prev),
              }
            : undefined
        }
        modeToggleProps={modeToggleProps}
        valueCount={presentValueCount}
        hasActive={activeCount > 0}
        pinnedContent={
          layout.activeItems.length > 0 ? (
            <VStack gap={0.5} align="stretch">
              {layout.activeItems.map((item) => {
                const extras = renderActiveRowExtras?.(item);
                return (
                  <Box key={item.value}>
                    <FacetRow
                      item={item}
                      state={getValueState(item.value)}
                      maxCount={layout.maxCount}
                      onToggle={handleToggle}
                      onExclude={handleExclude}
                      field={field}
                    />
                    {extras}
                  </Box>
                );
              })}
            </VStack>
          ) : undefined
        }
        activeIndicator={
          // "Any of" hint — the only header indicator left. Shown when 2+
          // values are INCLUDED, i.e. the same-field OR case, telling the
          // user the selection is a set of alternatives (OR), not a
          // narrowing AND, without making them read the query bar. The old
          // numeric selection badge was removed: it floated mid-header,
          // double-counted against the present-value count on the right,
          // and was wrong for off-list custom values (it only tallied
          // values present in `items`). The selection is already legible —
          // chosen values stay pinned + visible above the list (even when
          // collapsed) and the title goes bold via `hasActive`.
          showAnyOfHint ? (
            <Text
              textStyle="2xs"
              color="blue.fg"
              fontWeight="500"
              textTransform="none"
              letterSpacing="normal"
              flexShrink={0}
              title="These values are combined with OR — traces matching any of them are shown"
              data-testid="facet-any-of-hint"
            >
              any of
            </Text>
          ) : undefined
        }
      >
        <VStack gap={0.5} align="stretch">
          {/* Placeholder row for sections that exist but have no values yet
            (synthetic state — project has no traces, or discover is loading). */}
          {items.length === 0 && synthetic && (
            <Text textStyle="2xs" color="fg.subtle" paddingX={1} paddingY={1}>
              No values yet
            </Text>
          )}
          {layout.facetWindow.visible.map((item) => {
            const inactiveExtras = renderInactiveRowExtras?.(
              item,
              expandedInactiveRows.has(item.value),
              () => toggleInactiveExpand(item.value),
            );
            const row = (
              <FacetRow
                item={item}
                state={getValueState(item.value)}
                maxCount={layout.maxCount}
                onToggle={handleToggle}
                onExclude={handleExclude}
                field={field}
              />
            );
            return (
              <Box key={item.value}>
                {inactiveExtras?.trailing ? (
                  // Pair the row with its inline trailing accessory (the
                  // expand chevron) so the toggle sits at the row's end
                  // instead of as a full-width strip beneath it.
                  <HStack gap={0.5} align="center">
                    <Box flex={1} minWidth={0}>
                      {row}
                    </Box>
                    {inactiveExtras.trailing}
                  </HStack>
                ) : (
                  row
                )}
                {inactiveExtras?.below}
              </Box>
            );
          })}

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

          {/* Typed-value filter — revealed only when the user clicks the
            list-filter funnel icon in the section header (searchToggleProps).
            Audit feedback was that the always-on input took ~32px off
            every section's vertical real estate for an affordance most
            operators only reach for on long-tail values. The toggle
            keeps it one click away; reopening auto-focuses the Input
            so the user can start typing immediately. */}
          {items.length > 0 && searchOpen && (
            // The Input carries an inset focus ring (outlineOffset -2px) so
            // the keyboard outline renders fully inside the element instead
            // of being clipped at the edge by the sidebar scroll
            // container's overflow (#18b). The small paddingX/paddingY
            // gutter is kept purely for visual breathing room around the
            // focused input.
            <VStack
              gap={0.5}
              align="stretch"
              marginTop={1}
              paddingX={0.5}
              paddingY={0.5}
            >
              <Input
                ref={searchInputRef}
                size="xs"
                placeholder="Search or press Enter to apply…"
                value={searchQuery}
                // Inset focus ring so the keyboard outline renders fully —
                // the sidebar scroll container's overflow clips an outset
                // ring's edges (#18b). The paddingX/paddingY gutter on the
                // wrapper above is kept as belt-and-braces.
                _focusVisible={{
                  outlineWidth: "2px",
                  outlineStyle: "solid",
                  outlineColor: "blue.focusRing",
                  outlineOffset: "-2px",
                }}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const typed = searchQuery.trim();
                  if (!typed) return;
                  // Prefer an exact match against a known FacetItem so
                  // facets where label !== value (friendly topic names,
                  // etc.) submit `value` rather than the typed `label`.
                  // Fall back to the raw typed value for rare values
                  // (a one-off `metadata.tenant`, a long error string
                  // copy-pasted from a log) that don't surface in the
                  // top-50 facet response. Toggle is symmetric: typing
                  // the same value again removes the filter.
                  const lowered = typed.toLowerCase();
                  const matched = items.find(
                    (i) =>
                      i.value.toLowerCase() === lowered ||
                      i.label.toLowerCase() === lowered,
                  );
                  e.preventDefault();
                  handleToggle(matched?.value ?? typed);
                  setSearchQuery("");
                }}
                textStyle="xs"
              />
              {serverSearchActive && serverSearch.isFetching && (
                <HStack
                  data-testid="facet-search-spinner"
                  gap={2}
                  paddingX={1}
                  paddingY={1}
                >
                  <Spinner size="xs" />
                  <Text textStyle="2xs" color="fg.subtle">
                    Searching all values…
                  </Text>
                </HStack>
              )}
              {searchQuery.trim() &&
                !(serverSearchActive && serverSearch.isFetching) &&
                layout.facetWindow.visible.length === 0 && (
                  <Text textStyle="2xs" color="fg.muted" paddingX={1}>
                    No match. Press <Kbd>Enter</Kbd> to filter by "
                    <Box as="span" fontWeight="600" color="fg">
                      {searchQuery.trim()}
                    </Box>
                    " anyway.
                  </Text>
                )}
            </VStack>
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
  const sorted = [...items].sort((a, b) => b.count - a.count);
  if (!searchQuery) return sorted;
  const q = searchQuery.toLowerCase();
  // Match both label and value: for facets where label !== value
  // (friendly topic names, IDs displayed with a label), typing
  // either should reveal the row.
  return sorted.filter(
    (i) =>
      i.label.toLowerCase().includes(q) || i.value.toLowerCase().includes(q),
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
    return (
      <LinkButton onClick={onShowMore}>
        Show {collapsedRemaining} more
      </LinkButton>
    );
  }
  return (
    <>
      {beyondExpanded > 0 && (
        // The 50 backend-returned values are now all visible —
        // anything beyond that didn't surface in the top response,
        // so the hint points at the always-on search input (which
        // doubles as Enter-to-filter for arbitrary values).
        <Text textStyle="xs" color="fg.subtle" paddingX={1} paddingY={0.5}>
          {beyondExpanded}+ rare values aren't shown — type a value and press
          Enter to filter.
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

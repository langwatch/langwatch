import { Badge, Box, Button, Input, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { useFacetLensStore } from "../../stores/facetLensStore";
import {
  AUTO_EXPAND_THRESHOLD,
  MAX_EXPANDED_FACETS,
  MAX_VISIBLE_FACETS,
} from "./constants";
import { FacetRow } from "./FacetRow";
import { NoneFacetRow } from "./NoneFacetRow";
import { SidebarSection } from "./SidebarSection";
import type { FacetItem, FacetValueState } from "./types";

interface FacetSectionProps {
  title: string;
  icon?: React.ElementType;
  field: string;
  items: FacetItem[];
  getValueState: (value: string) => FacetValueState;
  onToggle: (
    field: string,
    value: string,
    options?: { modifierKey?: boolean },
  ) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  /** When set, renders a "(none)" row pinned at the bottom that toggles a `none:`/`has:` filter. */
  noneRow?: { active: boolean; onToggle: () => void };
  onShiftToggle?: (nextOpen: boolean) => void;
  /** Remove this section from the sidebar (per-user). */
  onHide?: () => void;
  orGroupId?: string;
  orPeers?: readonly string[];
  orMemberValues?: ReadonlySet<string>;
  /**
   * True when this section was synthesised before traces arrive. When
   * `items.length === 0` and this is set, renders a "No values yet"
   * placeholder instead of an empty section.
   */
  synthetic?: boolean;
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
   * FacetSection owns the `expandedInactiveRows` Set so the state is
   * automatically reset whenever the section unmounts or the sidebar
   * is closed — no external persistence needed.
   */
  renderInactiveRowExtras?: (
    item: FacetItem,
    isExpanded: boolean,
    onToggleExpand: () => void,
  ) => React.ReactNode;
}

const FacetSectionInner: React.FC<FacetSectionProps> = ({
  title,
  icon,
  field,
  items,
  getValueState,
  onToggle,
  dragHandleProps,
  noneRow,
  onShiftToggle,
  onHide,
  orGroupId,
  orPeers,
  orMemberValues,
  renderActiveRowExtras,
  renderInactiveRowExtras,
  synthetic,
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
  // header shows a sliders icon that reveals (and auto-focuses) the
  // input. Audit feedback was that the always-on input took ~32px
  // off every section's vertical real estate for an affordance most
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
    (value: string, options?: { modifierKey?: boolean }) =>
      onToggle(field, value, options),
    [onToggle, field],
  );

  const activeCount = useMemo(
    () =>
      items.filter((i) => getValueState(i.value) !== "neutral").length +
      (noneRow?.active ? 1 : 0),
    [items, getValueState, noneRow?.active],
  );

  const filtered = useMemo(
    () => filterAndSortItems({ items, searchQuery }),
    [items, searchQuery],
  );

  // Active rows = currently-filtered values + OR-group members. We
  // pin them above the collapsible content so they stay visible even
  // when the section is collapsed — the connector line keeps its
  // anchors and the user can see / remove what's filtered without
  // expanding the whole list.
  const activeItems = useMemo(
    () =>
      filtered.filter(
        (item) =>
          getValueState(item.value) !== "neutral" ||
          orMemberValues?.has(item.value),
      ),
    [filtered, getValueState, orMemberValues],
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

  const smartDefaultOpen =
    items.length <= AUTO_EXPAND_THRESHOLD || activeCount > 0;
  const effectiveOpen = lensOverride ?? smartDefaultOpen;

  return (
    <SidebarSection
      title={title}
      icon={icon}
      open={effectiveOpen}
      onOpenChange={(next) => setSectionOpen(field, next)}
      dragHandleProps={dragHandleProps}
      onShiftToggle={onShiftToggle}
      onHide={onHide}
      hideLabel={`Hide ${title}`}
      orGroupId={orGroupId}
      orPeers={orPeers}
      searchToggleProps={
        items.length > 0
          ? {
              open: searchOpen,
              onToggle: () => setSearchOpen((prev) => !prev),
            }
          : undefined
      }
      valueCount={items.length}
      hasActive={activeCount > 0}
      pinnedContent={
        activeItems.length > 0 ? (
          <VStack gap={0.5} align="stretch">
            {activeItems.map((item) => {
              const extras = renderActiveRowExtras?.(item);
              return (
                <Box key={item.value}>
                  <FacetRow
                    item={item}
                    state={getValueState(item.value)}
                    maxCount={maxCount}
                    onToggle={handleToggle}
                    orGroupId={
                      orMemberValues?.has(item.value) ? orGroupId : undefined
                    }
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
        activeCount > 0 ? (
          <Badge
            variant="solid"
            size="xs"
            colorPalette="blue"
            borderRadius="full"
            minW="4"
            height="4"
            paddingX={1}
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
          >
            {activeCount}
          </Badge>
        ) : undefined
      }
    >
      <VStack gap={0.5} align="stretch">
        {/* Placeholder row for sections that exist but have no values yet
            (synthetic state — project has no traces, or discover is loading). */}
        {items.length === 0 && synthetic && (
          <Text
            textStyle="2xs"
            color="fg.subtle"
            paddingX={1}
            paddingY={1}
          >
            No values yet
          </Text>
        )}
        {facetWindow.visible.map((item) => {
          const inactiveExtras = renderInactiveRowExtras?.(
            item,
            expandedInactiveRows.has(item.value),
            () => toggleInactiveExpand(item.value),
          );
          return (
            <Box key={item.value}>
              <FacetRow
                item={item}
                state={getValueState(item.value)}
                maxCount={maxCount}
                onToggle={handleToggle}
                orGroupId={
                  orMemberValues?.has(item.value) ? orGroupId : undefined
                }
                field={field}
              />
              {inactiveExtras}
            </Box>
          );
        })}

        {noneRow && !searchQuery && (
          <NoneFacetRow active={noneRow.active} onToggle={noneRow.onToggle} />
        )}

        {isHighCardinality && !searchQuery && (
          <ExpandToggle
            showMore={showMore}
            collapsedRemaining={facetWindow.collapsedRemaining}
            beyondExpanded={facetWindow.beyondExpanded}
            onShowMore={() => setShowMore(true)}
            onShowLess={() => setShowMore(false)}
          />
        )}

        {/* Typed-value filter — revealed only when the user clicks the
            sliders icon in the section header (searchToggleProps).
            Audit feedback was that the always-on input took ~32px off
            every section's vertical real estate for an affordance most
            operators only reach for on long-tail values. The toggle
            keeps it one click away; reopening auto-focuses the Input
            so the user can start typing immediately. */}
        {items.length > 0 && searchOpen && (
          // Inset paddingX so the Input's 2px focus ring has room to
          // render — without it, the ring's left/right edges were
          // clipped by the sidebar scroll container's
          // `overflowX: "hidden"`. The 2px gutter on each side keeps
          // the focused state legible without pulling the input far
          // away from the rest of the section's content.
          // paddingY mirrors paddingX so the focus ring has the same
          // 2px gutter top and bottom. Without it the ring's bottom
          // edge was clipped by the next sibling block (the
          // facetWindow rows) once the input gained focus.
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
            {searchQuery.trim() && facetWindow.visible.length === 0 && (
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

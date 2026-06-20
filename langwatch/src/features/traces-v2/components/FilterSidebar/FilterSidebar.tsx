import { Box, HStack, IconButton, Input, Text, VStack } from "@chakra-ui/react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  FilterX,
  GripVertical,
  type LucideIcon,
  PanelLeftClose,
  TextSearch,
  X,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { IsolatedErrorBoundary } from "~/components/ui/IsolatedErrorBoundary";
import { Tooltip } from "~/components/ui/tooltip";
import { useProjectHasTraces } from "../../hooks/useProjectHasTraces";
import { useDrawerStore } from "../../stores/drawerStore";
import { useFilterStore } from "../../stores/filterStore";
import { useUIStore } from "../../stores/uiStore";
import { useViewStore } from "../../stores/viewStore";
import { FacetManagerPopover } from "./FacetManagerPopover";
import { FilterSidebarSkeleton } from "./FilterSidebarSkeleton";
import { useFilterSidebarData } from "./hooks/useFilterSidebarData";
import { HoverHighlightStyle } from "./HoverHighlightStyle";
import { SectionRenderer } from "./SectionRenderer";
import { SortableSection } from "./SortableSection";
import { getFacetIcon } from "./utils";

const DRAG_ACTIVATION_DISTANCE_PX = 5;

// Effective width of the sidebar when the user hasn't dragged it (the store
// holds `null`, which TracesPage renders as SIDEBAR_WIDTH_EXPANDED = 220).
// Used to decide whether the Configure "shown / total" chip has room.
const SIDEBAR_DEFAULT_WIDTH = 220;
// Approx width each optional ghost icon button (clear / reset) claims in the
// header row — folded into the chip's visibility threshold so the chip yields
// only when those buttons are actually present and crowding it.
const HEADER_BUTTON_WIDTH = 32;

export const FilterSidebar: React.FC = () => {
  // The collapsed-state branch lives one level up: when collapsed,
  // `FilterAside` returns `null` and the page renders no sidebar DOM at
  // all (the expand affordance sits on the table footer's pagination
  // row). So this component is only ever mounted in the expanded path.
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const { hasAnyTraces } = useProjectHasTraces();
  const facetManagerOpen = useUIStore((s) => s.facetManagerOpen);
  const setFacetManagerOpen = useUIStore((s) => s.setFacetManagerOpen);
  // Clear-all-filters affordance: facet selections AND free-text search
  // both compile into the same query, so `queryText` non-empty ⇒ there's
  // something to clear, and `clearAll` resets the lot. See
  // specs/traces-v2/filter-bar-interactions.feature
  const queryText = useFilterStore((s) => s.queryText);
  const clearAllFilters = useFilterStore((s) => s.clearAll);
  const hasActiveFilters = queryText.trim().length > 0;
  // "Reset to lens" restores the active lens's saved filter/sort/columns
  // (revertLens). Distinct from Clear (which empties) — shown only when the
  // view deviates from the lens (a local draft exists). See
  // specs/traces-v2/filter-bar-interactions.feature
  const activeLensId = useViewStore((s) => s.activeLensId);
  const isDraft = useViewStore((s) => s.isDraft);
  const revertLens = useViewStore((s) => s.revertLens);
  // "Reset to lens" (now lives in the lens bar) is meaningless on the All lens
  // — it IS the unfiltered baseline. Kept here only to gate the `r` shortcut.
  const canResetToLens = isDraft(activeLensId) && activeLensId !== "all-traces";

  // Whether the Configure trigger shows its "shown / total" chip. With reset
  // moved to the lens bar, the only optional header button left is Clear, so
  // the chip is hidden ONLY when Clear is present AND the rail is narrow enough
  // that it'd crowd — otherwise it always shows (the "don't hide it when it's
  // not needed" rule). The header cluster is [clear?] [finder] [Configure
  // (+chip)] [expand-all].
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const headerExtraButtons = hasActiveFilters ? 1 : 0;
  const showConfigureCount =
    (sidebarWidth ?? SIDEBAR_DEFAULT_WIDTH) >=
    SIDEBAR_DEFAULT_WIDTH + headerExtraButtons * HEADER_BUTTON_WIDTH;

  const {
    ast,
    categoricals,
    facetItems,
    getValueStates,
    facetsLoading,
    descriptors,
    orderedKeys,
    sectionByKey,
    numericModeByKey,
    setNumericMode,
    toggleFacet,
    excludeFacet,
    setRange,
    removeRange,
    toggleEvaluatorSubFilter,
    setEvaluatorScoreRange,
    removeEvaluatorScoreRange,
    setSectionOrder,
    setAllSectionsOpen,
    showFacet,
    hideFacet,
    resetAllFacets,
    orderedKeysAll,
    isSectionVisibleForDensity,
  } = useFilterSidebarData();

  // Facet finder: a header search that filters which facet SECTIONS render so
  // the user can jump to a facet by name. Transient — it never touches the
  // per-project visibility settings (that's Configure) or facet values (that's
  // the per-facet search). See specs/traces-v2/search.feature "Facet finder".
  const [finderOpen, setFinderOpen] = useState(false);
  const [finderQuery, setFinderQuery] = useState("");
  const closeFinder = useCallback(() => {
    setFinderOpen(false);
    setFinderQuery("");
  }, []);
  const visibleKeys = useMemo(() => {
    const q = finderQuery.trim().toLowerCase();
    if (!q) return orderedKeys;
    return orderedKeys.filter((key) => {
      const label = (sectionByKey.get(key)?.label ?? key).toLowerCase();
      return label.includes(q) || key.toLowerCase().includes(q);
    });
  }, [orderedKeys, sectionByKey, finderQuery]);

  // Track which section is being dragged so we can render a lightweight
  // DragOverlay (and tell SortableSection a drag is in progress).
  const [activeId, setActiveId] = useState<string | null>(null);

  // Stable per-key onHide callbacks — recreating them inline in renderSection
  // creates fresh function references each render, which defeats memo on
  // SectionRenderer. Cache them in a ref-backed Map so each key gets exactly
  // one stable identity for the lifetime of the sidebar.
  const hideFacetCallbacksRef = useRef<Map<string, () => void>>(new Map());
  const getHideFacetCallback = useCallback(
    (key: string) => {
      let cb = hideFacetCallbacksRef.current.get(key);
      if (!cb) {
        cb = () => hideFacet(key);
        hideFacetCallbacksRef.current.set(key, cb);
      }
      return cb;
    },
    [hideFacet],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // With group-of-groups gone, individual sections are the unit users
  // drag. The flat-list reorder writes through to `setSectionOrder`,
  // which `useFilterSidebarData` reads alongside the registry order to
  // compute the next render's `orderedKeys`. Sections that aren't
  // currently visible (filtered out by density) keep their place in the
  // saved order — we only reorder among the visible keys, then merge
  // the result with any non-visible ones still in the stored order.
  const handleDragStart = useCallback(({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
  }, []);

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      setActiveId(null);
      if (!over || active.id === over.id) return;
      const oldIndex = visibleKeys.indexOf(String(active.id));
      const newIndex = visibleKeys.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return;
      const reorderedVisible = arrayMove(visibleKeys, oldIndex, newIndex);
      // Preserve any hidden keys' relative positions: walk the full
      // saved order, replacing the visible-key slots with the new
      // sequence in turn. Keys that weren't in the saved order yet get
      // appended at the end.
      const visibleSet = new Set(reorderedVisible);
      const next: string[] = [];
      const visibleQueue = [...reorderedVisible];
      for (const key of orderedKeysAll) {
        if (visibleSet.has(key)) {
          const nextVisible = visibleQueue.shift();
          if (nextVisible) next.push(nextVisible);
        } else {
          next.push(key);
        }
      }
      setSectionOrder(next);
    },
    [visibleKeys, orderedKeysAll, setSectionOrder],
  );

  const handleShiftToggle = useCallback(
    (nextOpen: boolean) => setAllSectionsOpen(orderedKeys, nextOpen),
    [orderedKeys, setAllSectionsOpen],
  );

  // Header-bar expand/collapse-all toggle. Mirror state locally so the
  // icon flips between "expand" and "collapse" on each click without
  // having to inspect per-section open state through the lens store
  // (sections have a smart per-key default that the store doesn't
  // explicitly record). First click expands all → flip to "collapse";
  // next click collapses all → flip back. Resets to the conservative
  // "expand" affordance whenever the user manually toggles a section
  // back is *not* something we attempt to detect — the explicit button
  // is for "do them all at once," not "track which mode I'm in."
  const [allExpanded, setAllExpanded] = useState(false);
  const handleToggleAll = useCallback(() => {
    const next = !allExpanded;
    setAllSectionsOpen(orderedKeys, next);
    setAllExpanded(next);
  }, [allExpanded, orderedKeys, setAllSectionsOpen]);

  // Sidebar keyboard shortcuts — one per header button. Scoped to the
  // sidebar's lifetime (these listeners only exist while it's mounted /
  // expanded) and bound to the local handlers next to each action:
  //   c → Configure facets (open the manager popover)
  //   f → Find a facet (open the finder)
  //   e → Expand / collapse all sections
  //   x → Clear all filters   (only while there ARE active filters)
  //   r → Reset to the active lens (only while a local draft deviates)
  // (Hide-the-sidebar's `[` is owned by the page-level `useSidebarShortcut`.)
  // Bare single keys, matching the page's existing `[` / `?` / `D` style.
  // Ignored while the user is typing in any input/contentEditable (incl.
  // the search bar, the finder, and per-section value search) and when a
  // modifier is held, so they never hijack ⌘C / Ctrl+F / etc.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't fire sidebar shortcuts while the trace drawer is open — the
      // sidebar stays mounted underneath it, so `x`/`r`/`c`/`f`/`e` would
      // otherwise act behind the drawer (and `c`/`r` collide with the
      // drawer's own shortcuts). Mirrors the page-level shortcut guards.
      if (useDrawerStore.getState().isOpen) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target;
      if (target instanceof HTMLElement) {
        if (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      const key = e.key.toLowerCase();
      if (key === "c") {
        e.preventDefault();
        setFacetManagerOpen(true);
      } else if (key === "f") {
        e.preventDefault();
        setFinderOpen(true);
      } else if (key === "e") {
        e.preventDefault();
        handleToggleAll();
      } else if (key === "x" && hasActiveFilters) {
        e.preventDefault();
        clearAllFilters();
      } else if (key === "r" && canResetToLens) {
        e.preventDefault();
        revertLens(activeLensId);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    setFacetManagerOpen,
    setFinderOpen,
    handleToggleAll,
    hasActiveFilters,
    clearAllFilters,
    canResetToLens,
    revertLens,
    activeLensId,
  ]);

  const renderSection = useCallback(
    ({
      key,
      dragHandleProps,
    }: {
      key: string;
      dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
    }) => {
      const section = sectionByKey.get(key);
      if (!section) return null;
      return (
        // Per-section boundary — a single facet that throws (e.g. malformed
        // descriptor, attribute renderer crash) should show an inline panel
        // for that one row instead of taking out the entire sidebar.
        <IsolatedErrorBoundary
          key={key}
          scope={`Couldn't render the ${key} filter`}
          resetKeys={[key]}
        >
          <SectionRenderer
            section={section}
            ast={ast}
            facetItemsByKey={facetItems}
            valueStateGetters={getValueStates}
            toggleFacet={toggleFacet}
            excludeFacet={excludeFacet}
            setRange={setRange}
            removeRange={removeRange}
            toggleEvaluatorSubFilter={toggleEvaluatorSubFilter}
            setEvaluatorScoreRange={setEvaluatorScoreRange}
            removeEvaluatorScoreRange={removeEvaluatorScoreRange}
            onShiftToggle={handleShiftToggle}
            onHide={getHideFacetCallback(key)}
            dragHandleProps={dragHandleProps}
            numericModeByKey={numericModeByKey}
            setNumericMode={setNumericMode}
          />
        </IsolatedErrorBoundary>
      );
    },
    [
      sectionByKey,
      ast,
      facetItems,
      getValueStates,
      numericModeByKey,
      setNumericMode,
      toggleFacet,
      excludeFacet,
      setRange,
      removeRange,
      toggleEvaluatorSubFilter,
      setEvaluatorScoreRange,
      removeEvaluatorScoreRange,
      handleShiftToggle,
      getHideFacetCallback,
    ],
  );

  // The hook now synthesises FACET_DEFAULTS rows while discover is in
  // flight, so `descriptors.length === 0 && facetsLoading` no longer
  // happens — `categoricals` is always populated. We keep `showSkeleton`
  // wired through but it'll only fire in genuinely degenerate states
  // (empty FACET_DEFAULTS, etc.) so as not to silently regress to a
  // blank rail if the synthesis is ever short-circuited.
  const showSkeleton =
    facetsLoading && descriptors.length === 0 && categoricals.length === 0;

  // Hide the sidebar entirely when the discover endpoint has returned
  // with no descriptors AND the project has never received a real trace.
  // This avoids showing a "Getting filters ready…" hint + skeleton rail
  // that will never populate for projects that haven't integrated yet.
  // Once real traces arrive (hasAnyTraces flips true), the sidebar
  // reveals itself on the next render because this condition no longer
  // holds. The genuine loading state (facetsLoading true) is a different
  // branch and still shows the caption + skeleton below.
  if (hasAnyTraces === false && !facetsLoading && descriptors.length === 0) {
    return null;
  }

  return (
    <VStack
      height="full"
      gap={0}
      align="stretch"
      overflow="hidden"
      as="aside"
      position="relative"
      data-spotlight="facet-sidebar"
    >
      {/* Single-facet hover highlighter — paints the sidebar row and the
          matching search-bar chip together when either is hovered. Mounted
          here (a single instance) so the cross-surface style block applies
          wherever the matching elements live. */}
      <HoverHighlightStyle />
      {/* Header bar: Configure (text), expand/collapse-all toggle, and
          hide-sidebar. minHeight=36px matches the Toolbar's tab row at
          the top of the trace table, so the two bars sit on the same
          horizontal grid across the page. Border-bottom delineates the
          bar from the scrolling section list. */}
      {/* Header bar: the hide-sidebar toggle anchors on the LEFT so its
          horizontal position is rock-stable across renders — count of
          right-side affordances can change (Configure popover may grow,
          expand-all toggle, etc.) without the close button drifting.
          Other actions cluster on the right. */}
      <HStack
        flexShrink={0}
        minHeight="36px"
        paddingX={2}
        borderBottomWidth="1px"
        borderColor="border"
        bg={{ base: "bg.subtle", _dark: "bg.surface" }}
        gap={1}
        align="center"
        justify="space-between"
      >
        <Tooltip
          positioning={{ placement: "bottom" }}
          content={
            <HStack gap={1.5}>
              <Text>Hide filters sidebar</Text>
              <Kbd>{"["}</Kbd>
            </HStack>
          }
        >
          <IconButton
            aria-label="Hide filters sidebar"
            size="2xs"
            variant="ghost"
            color="fg.subtle"
            onClick={toggleSidebar}
          >
            <PanelLeftClose size={14} />
          </IconButton>
        </Tooltip>
        <HStack gap={1} align="center">
          {/* Clear-all and Reset-to-lens only mount while there's something
              to act on (active filters / a local draft). Both carry a soft
              accent + halo ring so the live state is noticeable amid the
              otherwise-quiet ghost chrome — clear in blue (the "active
              filters" hue used by the facet selection badge), reset in orange
              (the lens / unsaved-draft hue shared with the lens-tab draft
              dot). The ring uses the colour's `.subtle` token so it reads as
              a gentle glow, not a hard outline (T17). */}
          {hasActiveFilters && (
            <Tooltip
              positioning={{ placement: "bottom" }}
              content={
                <HStack gap={1.5}>
                  <Text>Clear all filters</Text>
                  <Kbd>X</Kbd>
                </HStack>
              }
            >
              <IconButton
                aria-label="Clear all filters"
                size="2xs"
                variant="ghost"
                color="blue.fg"
                boxShadow="0 0 0 2px var(--chakra-colors-blue-subtle)"
                _hover={{ bg: "blue.subtle", color: "blue.fg" }}
                onClick={() => clearAllFilters()}
              >
                <FilterX size={14} />
              </IconButton>
            </Tooltip>
          )}
          {/* "Reset to lens" was moved OUT of the sidebar into the lens bar
              (LensTabs), where it sits right next to the draft lens tab — a
              clearer home than buried among the sidebar's filter chrome. The
              `r` shortcut + `revertLens` stay wired here for keyboard users. */}
          <Tooltip
            positioning={{ placement: "bottom" }}
            content={
              <HStack gap={1.5}>
                <Text>Find a facet</Text>
                <Kbd>F</Kbd>
              </HStack>
            }
          >
            <IconButton
              aria-label="Find a facet"
              aria-pressed={finderOpen}
              size="2xs"
              variant="ghost"
              color={finderOpen ? "fg" : "fg.subtle"}
              bg={finderOpen ? "bg.muted" : undefined}
              onClick={() => (finderOpen ? closeFinder() : setFinderOpen(true))}
            >
              <TextSearch size={14} />
            </IconButton>
          </Tooltip>
          <FacetManagerPopover
            orderedKeysAll={orderedKeysAll}
            sectionByKey={sectionByKey}
            isVisible={isSectionVisibleForDensity}
            onShow={showFacet}
            onHide={hideFacet}
            onResetAll={resetAllFacets}
            numericModeByKey={numericModeByKey}
            setNumericMode={setNumericMode}
            open={facetManagerOpen}
            onOpenChange={setFacetManagerOpen}
            triggerLabel="Configure"
            showCount={showConfigureCount}
          />
          <Tooltip
            positioning={{ placement: "bottom" }}
            content={
              <HStack gap={1.5}>
                <Text>
                  {allExpanded ? "Collapse all sections" : "Expand all sections"}
                </Text>
                <Kbd>E</Kbd>
              </HStack>
            }
          >
            <IconButton
              aria-label={
                allExpanded ? "Collapse all sections" : "Expand all sections"
              }
              size="2xs"
              variant="ghost"
              color="fg.subtle"
              onClick={handleToggleAll}
            >
              {allExpanded ? (
                <ChevronsDownUp size={14} />
              ) : (
                <ChevronsUpDown size={14} />
              )}
            </IconButton>
          </Tooltip>
        </HStack>
      </HStack>
      {/* Facet finder input — a slim row that appears under the header when
          the search toggle is on. Filters which sections render (visibleKeys)
          without changing any visibility setting. */}
      {finderOpen && (
        <HStack
          flexShrink={0}
          gap={1.5}
          paddingX={2.5}
          paddingY={1.5}
          borderBottomWidth="1px"
          borderColor="border"
          bg={{ base: "bg.subtle", _dark: "bg.surface" }}
        >
          <Input
            aria-label="Find a facet"
            autoFocus
            size="xs"
            variant="flushed"
            placeholder="Find a facet…"
            value={finderQuery}
            onChange={(e) => setFinderQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeFinder();
              }
            }}
            border="none"
            _focus={{ boxShadow: "none" }}
            height="22px"
            paddingY={0}
            flex={1}
          />
          {finderQuery.trim().length > 0 && (
            <Text
              textStyle="2xs"
              color="fg.subtle"
              flexShrink={0}
              fontVariantNumeric="tabular-nums"
            >
              {visibleKeys.length} of {orderedKeys.length}
            </Text>
          )}
          <IconButton
            aria-label="Clear facet finder"
            size="2xs"
            variant="ghost"
            color="fg.subtle"
            onClick={closeFinder}
          >
            <X size={12} />
          </IconButton>
        </HStack>
      )}
      <Box
        flex="1"
        display="flex"
        flexDirection="column"
        overflowY="auto"
        overflowX="hidden"
        // Symmetric outer gutter (8px) for the whole scroll area. The drag grip
        // lives in the left one with clear breathing room from the sidebar edge
        // (was hugging it); the thin 4px scrollbar below overlays the right one.
        paddingX={2}
        css={{
          // Slim the scrollbar so it overlays the right gutter instead of the
          // fat default overlay that painted over the section chevrons.
          "&::-webkit-scrollbar": { width: "4px" },
          "&::-webkit-scrollbar-thumb": {
            background: "var(--chakra-colors-border-emphasized)",
            borderRadius: "2px",
          },
          "&::-webkit-scrollbar-track": { background: "transparent" },
          scrollbarWidth: "thin",
        }}
      >
        {/* Loading caption — shown when discover is in flight and no cached
            facets exist yet. The synthetic sections already render below it
            so the sidebar isn't blank, but a small hint reassures the user
            that live data is coming. Disappears as soon as discover responds. */}
        {facetsLoading && (!descriptors || descriptors.length === 0) && (
          <Text
            textStyle="2xs"
            color="fg.subtle"
            paddingX={3}
            paddingTop={2}
            paddingBottom={1}
          >
            Getting filters ready…
          </Text>
        )}
        {showSkeleton ? (
          <FilterSidebarSkeleton />
        ) : (
          // Flat list — no Trace/Subjects/Evaluators/Metrics/Prompts
          // headings between sections. Grouping still exists in the
          // FacetManagerPopover for "browse what's available"; the
          // sidebar itself reads as one continuous, drag-reorderable
          // column of facets.
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={visibleKeys}
              strategy={verticalListSortingStrategy}
            >
              {visibleKeys.map((key) => (
                <SortableSection key={key} id={key} isAnyDragging={!!activeId}>
                  {(dragHandleProps) => renderSection({ key, dragHandleProps })}
                </SortableSection>
              ))}
            </SortableContext>
            {finderQuery.trim().length > 0 && visibleKeys.length === 0 && (
              <Text textStyle="xs" color="fg.subtle" paddingX={3} paddingY={3}>
                No facets match “{finderQuery.trim()}”.
              </Text>
            )}
            {/* Lightweight drag ghost — renders only the header strip (icon +
                title + grip) so the full section content doesn't move with the
                cursor. Keeps the animation smooth by painting a tiny node rather
                than the entire section tree. */}
            <DragOverlay>
              {activeId ? (
                <DragGhostHeader
                  label={sectionByKey.get(activeId)?.label ?? activeId}
                  icon={getFacetIcon({
                    key: activeId,
                    group: sectionByKey.get(activeId)?.group,
                  })}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </Box>
    </VStack>
  );
};

/**
 * Lightweight ghost rendered in the DragOverlay while the user is dragging a
 * section. Shows only the header strip (icon + label + grip icon) — much
 * cheaper to paint than the full section tree, which avoids jank on slow
 * devices. Styled to match the SidebarSection header so it looks like a
 * real row being lifted.
 */
const DragGhostHeader: React.FC<{
  label: string;
  icon: LucideIcon | undefined;
}> = ({ label, icon: SectionIcon }) => (
  <HStack
    gap={1}
    paddingX={3}
    paddingY={2}
    bg="bg.panel"
    borderWidth="1px"
    borderColor="border"
    borderRadius="md"
    boxShadow="md"
    opacity={0.9}
    cursor="grabbing"
  >
    <HStack gap={1} minWidth={0} flex={1}>
      {SectionIcon && (
        <Text as="span" color="fg.subtle" display="flex" alignItems="center">
          <SectionIcon size={12} />
        </Text>
      )}
      <Text
        textStyle="2xs"
        fontWeight="500"
        color="fg.subtle"
        textTransform="uppercase"
        letterSpacing="0.08em"
        truncate
      >
        {label}
      </Text>
    </HStack>
    <GripVertical size={12} color="var(--chakra-colors-fg-subtle)" />
  </HStack>
);

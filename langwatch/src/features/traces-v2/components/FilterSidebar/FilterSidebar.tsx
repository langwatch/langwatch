import { HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { useProjectHasTraces } from "../../hooks/useProjectHasTraces";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  type DragEndEvent,
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
import { ChevronsDownUp, ChevronsUpDown, GripVertical, type LucideIcon, PanelLeftClose } from "lucide-react";
import type React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { IsolatedErrorBoundary } from "~/components/ui/IsolatedErrorBoundary";
import { Tooltip } from "~/components/ui/tooltip";
import { useUIStore } from "../../stores/uiStore";
import { FacetManagerPopover } from "./FacetManagerPopover";
import { FilterSidebarSkeleton } from "./FilterSidebarSkeleton";
import { useFilterSidebarData } from "./hooks/useFilterSidebarData";
import {
  ConnectorLaneWidth as CONNECTOR_LANE_WIDTH,
  OrConnectorOverlay,
} from "./OrConnectorOverlay";
import { SectionRenderer } from "./SectionRenderer";
import { SortableSection } from "./SortableSection";
import { getFacetIcon } from "./utils";

const DRAG_ACTIVATION_DISTANCE_PX = 5;

export const FilterSidebar: React.FC = () => {
  // The collapsed-state branch lives one level up: when collapsed,
  // `FilterAside` returns `null` and the page renders no sidebar DOM at
  // all (the expand affordance sits on the table footer's pagination
  // row). So this component is only ever mounted in the expanded path.
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const { hasAnyTraces } = useProjectHasTraces();
  const facetManagerOpen = useUIStore((s) => s.facetManagerOpen);
  const setFacetManagerOpen = useUIStore((s) => s.setFacetManagerOpen);

  const {
    ast,
    categoricals,
    facetItems,
    getValueStates,
    facetsLoading,
    descriptors,
    orderedKeys,
    sectionByKey,
    toggleFacet,
    setRange,
    removeRange,
    setSectionOrder,
    setAllSectionsOpen,
    orAnalysis,
    showFacet,
    hideFacet,
    resetAllFacets,
    orderedKeysAll,
    isSectionVisibleForDensity,
  } = useFilterSidebarData();

  // Ref to the inner scroll container so OrConnectorOverlay can read
  // FacetRow positions and re-measure on scroll/resize.
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  // Track which section is being dragged so we can (a) render a lightweight
  // DragOverlay and (b) suppress the OrConnectorOverlay recompute during drag.
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

  // Pre-compute the OR props for every key in one pass over orAnalysis.
  // Previously these were three IIFEs per key inside renderSection, which
  // ran fresh every render and returned new object/array references — making
  // React.memo on SectionRenderer useless.
  const orPropsByKey = useMemo(() => {
    const map = new Map<
      string,
      {
        orGroupId: string | undefined;
        orPeers: readonly string[] | undefined;
        orMemberValues: ReadonlySet<string> | undefined;
      }
    >();
    for (const [key, ids] of orAnalysis.fieldToGroupIds) {
      const orGroupId =
        ids && ids.length === 1 ? ids[0] : undefined;
      let orPeers: readonly string[] | undefined;
      if (ids && ids.length > 0) {
        const peers = new Set<string>();
        for (const id of ids) {
          const group = orAnalysis.groups.find((g) => g.id === id);
          if (!group) continue;
          for (const f of group.fields) if (f !== key) peers.add(f);
        }
        orPeers = peers.size > 0 ? [...peers] : undefined;
      }
      let orMemberValues: ReadonlySet<string> | undefined;
      if (ids && ids.length > 0) {
        const values = new Set<string>();
        for (const id of ids) {
          const group = orAnalysis.groups.find((g) => g.id === id);
          if (!group) continue;
          for (const m of group.members) {
            if (m.field === key) values.add(m.value);
          }
        }
        orMemberValues = values.size > 0 ? values : undefined;
      }
      map.set(key, { orGroupId, orPeers, orMemberValues });
    }
    return map;
  }, [orAnalysis]);

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
      const oldIndex = orderedKeys.indexOf(String(active.id));
      const newIndex = orderedKeys.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return;
      const reorderedVisible = arrayMove(orderedKeys, oldIndex, newIndex);
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
    [orderedKeys, orderedKeysAll, setSectionOrder],
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
      const orProps = orPropsByKey.get(key);
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
            setRange={setRange}
            removeRange={removeRange}
            onShiftToggle={handleShiftToggle}
            onHide={getHideFacetCallback(key)}
            dragHandleProps={dragHandleProps}
            orGroupId={orProps?.orGroupId}
            orPeers={orProps?.orPeers}
            orMemberValues={orProps?.orMemberValues}
          />
        </IsolatedErrorBoundary>
      );
    },
    [
      sectionByKey,
      ast,
      facetItems,
      getValueStates,
      toggleFacet,
      setRange,
      removeRange,
      handleShiftToggle,
      getHideFacetCallback,
      orPropsByKey,
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
      {/* Suppress the overlay during drag — recomputing DOM positions on every
          pointer-move frame causes layout thrashing. Lines snap back on dragEnd. */}
      {!activeId && (
        <OrConnectorOverlay
          groups={orAnalysis.groups}
          containerRef={scrollAreaRef}
        />
      )}
      {/* Header bar: Configure (text), expand/collapse-all toggle, and
          hide-sidebar. minHeight=36px matches the Toolbar's tab row at
          the top of the trace table, so the two bars sit on the same
          horizontal grid across the page. Border-bottom delineates the
          bar from the scrolling section list. */}
      <HStack
        flexShrink={0}
        minHeight="36px"
        paddingX={2}
        borderBottomWidth="1px"
        borderColor="border"
        bg={{ base: "bg.subtle", _dark: "bg.surface" }}
        gap={1}
        align="center"
        justify="flex-end"
      >
        <FacetManagerPopover
          orderedKeysAll={orderedKeysAll}
          sectionByKey={sectionByKey}
          isVisible={isSectionVisibleForDensity}
          onShow={showFacet}
          onHide={hideFacet}
          onResetAll={resetAllFacets}
          open={facetManagerOpen}
          onOpenChange={setFacetManagerOpen}
          triggerLabel="Configure"
        />
        <Tooltip
          positioning={{ placement: "bottom" }}
          content={
            allExpanded ? "Collapse all sections" : "Expand all sections"
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
      </HStack>
      <div
        ref={scrollAreaRef}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          overflowX: "hidden",
          // Reserve right-side gutter for OR connector lanes — one lane
          // per OR group, sized to match `OrConnectorOverlay`'s internal
          // LANE_WIDTH. Plus a constant 4px so the auto-scroll's track
          // sits to the LEFT of the resize handle line, not on top of
          // it. Without this 4px the scrollbar visually overlapped the
          // 1px sidebar divider and read as "bleeding past the
          // sidebar's right edge."
          paddingRight: `${4 + orAnalysis.groups.length * CONNECTOR_LANE_WIDTH}px`,
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
              items={orderedKeys}
              strategy={verticalListSortingStrategy}
            >
              {orderedKeys.map((key) => (
                <SortableSection key={key} id={key} isAnyDragging={!!activeId}>
                  {(dragHandleProps) => renderSection({ key, dragHandleProps })}
                </SortableSection>
              ))}
            </SortableContext>
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
      </div>
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

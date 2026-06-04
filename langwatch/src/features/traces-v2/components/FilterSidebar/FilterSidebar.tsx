import { HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
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
import { PanelLeftClose } from "lucide-react";
import type React from "react";
import { useCallback, useRef } from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { IsolatedErrorBoundary } from "~/components/ui/IsolatedErrorBoundary";
import { Tooltip } from "~/components/ui/tooltip";
import { useUIStore } from "../../stores/uiStore";
import { FacetManagerPopover } from "./FacetManagerPopover";
import { FilterSidebarSkeleton } from "./FilterSidebarSkeleton";
import {
  ConnectorLaneWidth as CONNECTOR_LANE_WIDTH,
  OrConnectorOverlay,
} from "./OrConnectorOverlay";
import { useFilterSidebarData } from "./hooks/useFilterSidebarData";
import { SectionRenderer } from "./SectionRenderer";
import { SortableSection } from "./SortableSection";

const DRAG_ACTIVATION_DISTANCE_PX = 5;

export const FilterSidebar: React.FC = () => {
  // The collapsed-state branch lives one level up: when collapsed,
  // `FilterAside` returns `null` and the page renders no sidebar DOM at
  // all (the expand affordance sits on the table footer's pagination
  // row). So this component is only ever mounted in the expanded path.
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const facetManagerOpen = useUIStore((s) => s.facetManagerOpen);
  const setFacetManagerOpen = useUIStore((s) => s.setFacetManagerOpen);

  const {
    ast,
    categoricals,
    ranges,
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
  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
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

  const renderSection = useCallback(
    (
      key: string,
      dragHandleProps?: React.HTMLAttributes<HTMLDivElement>,
    ) => {
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
            setRange={setRange}
            removeRange={removeRange}
            onShiftToggle={handleShiftToggle}
            onHide={() => hideFacet(key)}
            dragHandleProps={dragHandleProps}
            // INTENTIONAL: `fieldToGroupIds` includes same-field OR groups
            // (e.g. `status:error OR status:warning`), so a same-field OR
            // query gets the full visual treatment — colored ring on rows,
            // pinning via `orMemberValues`, AND a connector line via the
            // overlay scanning `[data-or-group=...]`. Same-field ORs are
            // already visually adjacent within their own facet section, but
            // the connector + ring confirm to the user that those values
            // are bound by OR (not just both checked under the implicit
            // sidebar-ANDing). If this ever feels noisy, filter to
            // `g.fields.size > 1` here — but the current call is to keep
            // the link visible.
            //
            // Only project a single id when the field belongs to exactly
            // one group. With multiple disjoint OR groups (e.g.
            // `(status:error OR model:gpt-4o) AND (status:warning OR
            // origin:application)`), `status:warning` would otherwise
            // render under the FIRST group's id/colour/lane — wrong half
            // of the time. Leaving it `undefined` for ambiguous fields
            // means the row drops the ring/lane assignment but still
            // joins both groups' peer/member sets via the unions below.
            orGroupId={(() => {
              const ids = orAnalysis.fieldToGroupIds.get(key);
              return ids && ids.length === 1 ? ids[0] : undefined;
            })()}
            orPeers={(() => {
              const ids = orAnalysis.fieldToGroupIds.get(key);
              if (!ids || ids.length === 0) return undefined;
              // Union peers across every group this field touches — when
              // a field shows up in multiple disjoint OR groups, the
              // sidebar should mention all of its co-facets.
              const peers = new Set<string>();
              for (const id of ids) {
                const group = orAnalysis.groups.find((g) => g.id === id);
                if (!group) continue;
                for (const f of group.fields) if (f !== key) peers.add(f);
              }
              return peers.size > 0 ? [...peers] : undefined;
            })()}
            orMemberValues={(() => {
              const ids = orAnalysis.fieldToGroupIds.get(key);
              if (!ids || ids.length === 0) return undefined;
              const values = new Set<string>();
              for (const id of ids) {
                const group = orAnalysis.groups.find((g) => g.id === id);
                if (!group) continue;
                for (const m of group.members) {
                  if (m.field === key) values.add(m.value);
                }
              }
              return values.size > 0 ? values : undefined;
            })()}
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
      hideFacet,
      orAnalysis,
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

  return (
    <VStack
      height="full"
      gap={0}
      align="stretch"
      overflow="hidden"
      as="aside"
      position="relative"
    >
      <OrConnectorOverlay
        groups={orAnalysis.groups}
        containerRef={scrollAreaRef}
      />
      {/* Header bar — owns the close affordance in a flex row instead
          of an absolutely-positioned overlay. The previous overlay sat
          at top:6 / right:6 with z-index:2 and visibly overlapped the
          first group's heading ("TRACE") because both lived in the
          same ~24px-tall band on the right edge. Putting the close
          button in its own row keeps the math obvious: the scrollable
          area below starts AFTER the header bar, so there's no overlap
          to reason about. Padding-y matches the group header so
          the close icon's vertical center aligns with the heading
          baseline that appears just below it. */}
      <HStack
        gap={1}
        paddingX={2}
        paddingY={1.5}
        height="28px"
        align="center"
        justify="flex-end"
        flexShrink={0}
        borderBottomWidth="0"
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
        />
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
          paddingTop: 0,
          // Reserve right-side gutter for OR connector lanes — one lane
          // per OR group, sized to match `OrConnectorOverlay`'s internal
          // LANE_WIDTH. With no OR groups the gutter collapses to zero
          // and the rail looks identical to before this feature.
          paddingRight: `${orAnalysis.groups.length * CONNECTOR_LANE_WIDTH}px`,
        }}
      >
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
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedKeys}
              strategy={verticalListSortingStrategy}
            >
              {orderedKeys.map((key) => (
                <SortableSection key={key} id={key}>
                  {(dragHandleProps) => renderSection(key, dragHandleProps)}
                </SortableSection>
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

    </VStack>
  );
};

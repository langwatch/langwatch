import {
  Button,
  HStack,
  Separator,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
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
import { useCallback, useMemo } from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { IsolatedErrorBoundary } from "~/components/ui/IsolatedErrorBoundary";
import {
  FIELD_NAMES,
  SEARCH_FIELDS,
} from "~/server/app-layer/traces/query-language/metadata";
import {
  getFacetValues,
  getRangeValue,
} from "~/server/app-layer/traces/query-language/queries";
import { useUIStore } from "../../stores/uiStore";
import { CollapsedSidebar } from "./CollapsedSidebar";
import { CollapsedSidebarSkeleton } from "./CollapsedSidebarSkeleton";
import { getFacetGroupId } from "./constants";
import { FacetGroupHeader } from "./FacetGroupHeader";
import { FilterSidebarSkeleton } from "./FilterSidebarSkeleton";
import { useFilterSidebarData } from "./hooks/useFilterSidebarData";
import { SectionRenderer } from "./SectionRenderer";

const GROUP_ID_PREFIX = "__group:";
const groupSortableId = (id: string): string => `${GROUP_ID_PREFIX}${id}`;
const isGroupSortableId = (id: string): boolean =>
  id.startsWith(GROUP_ID_PREFIX);
const groupIdFromSortableId = (id: string): string =>
  id.slice(GROUP_ID_PREFIX.length);

const DRAG_ACTIVATION_DISTANCE_PX = 5;

export const FilterSidebar: React.FC = () => {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  const {
    ast,
    categoricals,
    ranges,
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
    setGroupOrder,
    setAllSectionsOpen,
  } = useFilterSidebarData();

  const groupSortableIds = useMemo(
    () => orderedGroups.map((g) => groupSortableId(g.id)),
    [orderedGroups],
  );

  // A group is "modified" when at least one of its sections has an active
  // filter in the working AST. We walk every known SEARCH_FIELD (not just
  // sections present in the current discover response) so the dot still
  // lights when a filter has been applied to a section that hasn't
  // rendered yet — e.g. a query bar typed `selectedPrompt:foo` before any
  // matching trace has come back.
  const modifiedGroupIds = useMemo(() => {
    const set = new Set<string>();
    for (const field of FIELD_NAMES) {
      const meta = SEARCH_FIELDS[field];
      if (!meta?.hasSidebar || !meta.facetField) continue;
      const groupId = getFacetGroupId(meta.facetField);
      if (!groupId) continue;
      if (set.has(groupId)) continue;
      if (meta.valueType === "range") {
        if (getRangeValue(ast, field) !== null) set.add(groupId);
      } else if (meta.valueType === "categorical") {
        const { include, exclude } = getFacetValues(ast, field);
        if (include.length + exclude.length > 0) set.add(groupId);
      }
    }
    return set;
  }, [ast]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Only the group headers are reorderable. Sections inside a group sit in
  // their registry order — letting users shuffle them turned out to be more
  // confusing than useful (everyone's sidebar looked subtly different).
  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      if (!over || active.id === over.id) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      if (!isGroupSortableId(activeId) || !isGroupSortableId(overId)) return;
      const oldIndex = groupSortableIds.indexOf(activeId);
      const newIndex = groupSortableIds.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0) return;
      const reordered = arrayMove(groupSortableIds, oldIndex, newIndex).map(
        groupIdFromSortableId,
      );
      setGroupOrder(reordered);
    },
    [groupSortableIds, setGroupOrder],
  );

  const handleShiftToggle = useCallback(
    (nextOpen: boolean) => setAllSectionsOpen(orderedKeys, nextOpen),
    [orderedKeys, setAllSectionsOpen],
  );

  const renderSection = useCallback(
    (key: string) => {
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
    ],
  );

  const showSkeleton = facetsLoading && descriptors.length === 0;

  if (collapsed) {
    // Mirror the expanded-sidebar skeleton policy on the collapsed
    // rail: until the first facet payload lands the rail used to
    // render as an empty 40px column, which read as a layout glitch
    // rather than "filters are loading." Showing circular icon
    // placeholders matches the live rail's silhouette so the swap
    // when data arrives feels like a fade-in, not a pop-in.
    if (showSkeleton) return <CollapsedSidebarSkeleton />;
    return (
      <CollapsedSidebar
        ast={ast}
        categoricals={categoricals}
        ranges={ranges}
        onExpand={toggleSidebar}
      />
    );
  }

  return (
    <VStack height="full" gap={0} align="stretch" overflow="hidden" as="aside">
      <VStack
        flex={1}
        gap={0}
        align="stretch"
        overflowY="auto"
        overflowX="hidden"
        paddingTop={1}
      >
        {showSkeleton ? (
          <FilterSidebarSkeleton />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={groupSortableIds}
              strategy={verticalListSortingStrategy}
            >
              {orderedGroups.map((group) => (
                <IsolatedErrorBoundary
                  key={group.id}
                  scope={`Couldn't render the ${group.label} filter group`}
                  resetKeys={[group.id]}
                >
                  <FacetGroupHeader
                    id={groupSortableId(group.id)}
                    label={group.label}
                    isModified={modifiedGroupIds.has(group.id)}
                  >
                    {group.keys.map(renderSection)}
                  </FacetGroupHeader>
                </IsolatedErrorBoundary>
              ))}
            </SortableContext>
          </DndContext>
        )}
      </VStack>

      <Separator />
      <HStack paddingX={3} paddingY={1.5}>
        <Spacer />
        <Button
          aria-label="Collapse sidebar"
          size="2xs"
          variant="ghost"
          color="fg.subtle"
          onClick={toggleSidebar}
        >
          <PanelLeftClose size={12} />
          <Text textStyle="2xs">Collapse</Text>
          <Kbd>{"["}</Kbd>
        </Button>
      </HStack>
    </VStack>
  );
};

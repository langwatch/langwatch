import { Button, HStack, Separator, Spacer, Text, VStack } from "@chakra-ui/react";
import { Kbd } from "~/components/ops/shared/Kbd";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
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
import { useUIStore } from "../../stores/uiStore";
import { CollapsedSidebar } from "./CollapsedSidebar";
import { FacetGroupHeader } from "./FacetGroupHeader";
import { FilterSidebarSkeleton } from "./FilterSidebarSkeleton";
import { SectionRenderer } from "./SectionRenderer";
import { SortableSection } from "./SortableSection";
import { useFilterSidebarData } from "./hooks/useFilterSidebarData";

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
    attributeKeys,
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
  } = useFilterSidebarData();

  const groupSortableIds = useMemo(
    () => orderedGroups.map((g) => groupSortableId(g.id)),
    [orderedGroups],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      if (!over || active.id === over.id) return;
      const activeId = String(active.id);
      const overId = String(over.id);

      // Group-level drag — both ids carry the GROUP prefix.
      if (isGroupSortableId(activeId) && isGroupSortableId(overId)) {
        const oldIndex = groupSortableIds.indexOf(activeId);
        const newIndex = groupSortableIds.indexOf(overId);
        if (oldIndex < 0 || newIndex < 0) return;
        const reordered = arrayMove(groupSortableIds, oldIndex, newIndex).map(
          groupIdFromSortableId,
        );
        setGroupOrder(reordered);
        return;
      }

      // Section-level drag — reject if it crosses a group boundary.
      if (isGroupSortableId(activeId) || isGroupSortableId(overId)) return;
      const sourceGroup = orderedGroups.find((g) => g.keys.includes(activeId));
      const targetGroup = orderedGroups.find((g) => g.keys.includes(overId));
      if (!sourceGroup || sourceGroup.id !== targetGroup?.id) return;
      const oldIndex = orderedKeys.indexOf(activeId);
      const newIndex = orderedKeys.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0) return;
      setSectionOrder(arrayMove(orderedKeys, oldIndex, newIndex));
    },
    [
      orderedKeys,
      orderedGroups,
      groupSortableIds,
      setSectionOrder,
      setGroupOrder,
    ],
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
        <SortableSection key={key} id={key}>
          {({ dragHandleProps }) => (
            <SectionRenderer
              section={section}
              ast={ast}
              attributeKeys={attributeKeys}
              facetItemsByKey={facetItems}
              valueStateGetters={getValueStates}
              toggleFacet={toggleFacet}
              setRange={setRange}
              removeRange={removeRange}
              onShiftToggle={handleShiftToggle}
              dragHandleProps={dragHandleProps}
            />
          )}
        </SortableSection>
      );
    },
    [
      sectionByKey,
      ast,
      attributeKeys,
      facetItems,
      getValueStates,
      toggleFacet,
      setRange,
      removeRange,
      handleShiftToggle,
    ],
  );

  if (collapsed) {
    return (
      <CollapsedSidebar
        ast={ast}
        categoricals={categoricals}
        ranges={ranges}
        onExpand={toggleSidebar}
      />
    );
  }

  const showSkeleton = facetsLoading && descriptors.length === 0;

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
                <FacetGroupHeader
                  key={group.id}
                  id={groupSortableId(group.id)}
                  label={group.label}
                >
                  <SortableContext
                    items={group.keys}
                    strategy={verticalListSortingStrategy}
                  >
                    {group.keys.map(renderSection)}
                  </SortableContext>
                </FacetGroupHeader>
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

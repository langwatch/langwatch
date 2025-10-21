import React from "react";
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BrowserLikeTabs } from "./BrowserLikeTabs";
import { HStack } from "@chakra-ui/react";

// Context for managing drag state and callbacks
interface DraggableTabsContextValue {
  onTabMove: (params: {
    tabId: string;
    from: { groupId: string; index: number };
    to: { groupId: string; index: number };
  }) => void;
  activeDrag: {
    groupId: string;
    tabId: string;
    label?: React.ReactNode;
  } | null;
  setActiveDrag: (
    drag: { groupId: string; tabId: string; label?: React.ReactNode } | null,
  ) => void;
}

const DraggableTabsContext =
  React.createContext<DraggableTabsContextValue | null>(null);

// Context for managing group state
interface TabGroupContextValue {
  groupId: string;
  activeTabId?: string;
  onTabChange?: (groupId: string, tabId: string) => void;
}

const TabGroupContext = React.createContext<TabGroupContextValue | null>(null);

function useTabGroupContext() {
  const context = React.useContext(TabGroupContext);
  if (!context) {
    throw new Error(
      "Tab components must be used within DraggableTabsBrowser.Group",
    );
  }
  return context;
}

/**
 * DraggableTabsBrowser Root Component
 *
 * Single Responsibility: Provides drag-and-drop context and orchestrates tab movement between groups
 */
interface DraggableTabsBrowserProps {
  children: React.ReactNode;
  onTabMove: (params: {
    tabId: string;
    from: { groupId: string; index: number };
    to: { groupId: string; index: number };
  }) => void;
}

function DraggableTabsBrowserRoot({
  children,
  onTabMove,
}: DraggableTabsBrowserProps) {
  const [activeDrag, setActiveDrag] = React.useState<{
    groupId: string;
    tabId: string;
    label?: React.ReactNode;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Drag starts after moving 8 pixels
      },
    }),
  );

  function handleDragStart(event: any) {
    const { groupId, tabId, label } = event.active.data.current;
    console.log("handleDragStart", groupId, tabId, label);
    setActiveDrag({ groupId, tabId, label });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;
    if (!activeData || !overData) return;

    console.log("handleDragEnd", activeData, overData);

    // Use the sortable index from the drag data
    const activeIndex = activeData.sortable?.index;
    const overIndex = overData.sortable?.index;

    // Only move if group or tab positions differ
    if (activeData.groupId !== overData.groupId || activeIndex !== overIndex) {
      onTabMove({
        tabId: activeData.tabId,
        from: { groupId: activeData.groupId, index: activeIndex },
        to: { groupId: overData.groupId, index: overIndex },
      });
    }
  }

  const contextValue: DraggableTabsContextValue = {
    onTabMove,
    activeDrag,
    setActiveDrag,
  };

  return (
    <DraggableTabsContext.Provider value={contextValue}>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        collisionDetection={closestCenter}
      >
        <HStack width="full" height="full" gap={0}>
          {children}
          <DragOverlay>
            {activeDrag ? <DragOverlayContent activeDrag={activeDrag} /> : null}
          </DragOverlay>
        </HStack>
      </DndContext>
    </DraggableTabsContext.Provider>
  );
}

/**
 * DragOverlayContent Component
 *
 * Single Responsibility: Renders the dragging tab overlay
 * TODO: Move to a separate file
 */
function DragOverlayContent({
  activeDrag,
}: {
  activeDrag: { groupId: string; tabId: string; label?: React.ReactNode };
}) {
  return (
    <div
      style={{
        background: "white",
        padding: 8,
        border: "1px solid #DDD",
        borderRadius: 6,
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        pointerEvents: "none",
      }}
    >
      {activeDrag.label ?? "Dragging tab..."}
    </div>
  );
}

/**
 * DraggableTabsBrowser Group Component
 *
 * Single Responsibility: Manages a group of tabs with shared state and drop zone
 */
interface DraggableTabsGroupProps {
  children: React.ReactNode;
  groupId: string;
  activeTabId?: string;
  onTabChange?: (groupId: string, tabId: string) => void;
  onClick?: (groupId: string, tabId: string) => void;
}

function DraggableTabsGroup({
  children,
  groupId,
  activeTabId,
  onTabChange,
  onClick,
}: DraggableTabsGroupProps) {
  const groupContextValue: TabGroupContextValue = {
    groupId,
    activeTabId,
    onTabChange,
  };

  return (
    <TabGroupContext.Provider value={groupContextValue}>
      <BrowserLikeTabs.Root
        value={activeTabId}
        onValueChange={(tabId) => onTabChange?.(groupId, tabId)}
        onClick={() => onClick?.(groupId, activeTabId ?? "")}
      >
        {children}
      </BrowserLikeTabs.Root>
    </TabGroupContext.Provider>
  );
}

/**
 * DraggableTabsBrowser TabBar Component
 *
 * Single Responsibility: Provides the droppable area for tabs and renders the tab bar
 */
interface DraggableTabsTabBarProps {
  children: React.ReactNode;
}

function DraggableTabsTabBar({ children }: DraggableTabsTabBarProps) {
  // Extract tab IDs directly from children
  const tabIds = React.useMemo(() => {
    return React.Children.map(children, (child) => {
      if (React.isValidElement(child)) {
        const props = child.props as { value?: string };
        if (props.value) {
          return props.value;
        }
      }
      return null;
    })?.filter(Boolean)!;
  }, [children]);

  return (
    <BrowserLikeTabs.Bar>
      <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
        <BrowserLikeTabs.List>{children}</BrowserLikeTabs.List>
      </SortableContext>
    </BrowserLikeTabs.Bar>
  );
}

/**
 * DraggableTabTrigger Component
 *
 * Single Responsibility: Handles both dragging and tab selection trigger functionality
 */
interface DraggableTabTriggerProps {
  value: string;
  children: React.ReactNode;
}

function DraggableTabTrigger({ value, children }: DraggableTabTriggerProps) {
  const { groupId } = useTabGroupContext();

  // Extract label from children for drag overlay
  const label = React.useMemo(() => {
    const child = React.Children.only(children);
    if (React.isValidElement(child) && child.type === DraggableBrowserTab) {
      const props = child.props as DraggableBrowserTabProps;
      return props.label ?? props.children;
    }
    return children;
  }, [children]);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: value,
    data: { groupId, tabId: value, label },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        display: "flex",
        alignItems: "stretch",
        ...style,
        cursor: isDragging ? "grabbing" : "grab",
      }}
      {...attributes}
      {...listeners}
    >
      <BrowserLikeTabs.Trigger value={value}>
        {children}
      </BrowserLikeTabs.Trigger>
    </div>
  );
}

/**
 * DraggableBrowserTab Component
 *
 * Single Responsibility: Renders tab content with browser-like styling
 */
interface DraggableBrowserTabProps {
  label?: React.ReactNode;
  children?: React.ReactNode;
}

function DraggableBrowserTab({ label, children }: DraggableBrowserTabProps) {
  return <>{label ?? children}</>;
}

/**
 * DraggableTabsBrowser Content Component
 *
 * Single Responsibility: Renders tab panel content
 */
interface DraggableTabsContentProps {
  value: string;
  children: React.ReactNode;
}

function DraggableTabsContent({ value, children }: DraggableTabsContentProps) {
  return (
    <BrowserLikeTabs.Content value={value}>{children}</BrowserLikeTabs.Content>
  );
}

// Export compound component
export const DraggableTabsBrowser = {
  Root: DraggableTabsBrowserRoot,
  Group: DraggableTabsGroup,
  TabBar: DraggableTabsTabBar,
  Trigger: DraggableTabTrigger,
  Tab: DraggableBrowserTab,
  Content: DraggableTabsContent,
};

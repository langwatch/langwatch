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
import { Box, HStack, type StackProps, type BoxProps } from "@chakra-ui/react";
import { PromptBrowserTab } from "../tab/PromptBrowserTab";
import { TabIdProvider } from "./TabContext";

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

export function useDraggableTabsContext() {
  const context = React.useContext(DraggableTabsContext);
  if (!context) {
    throw new Error(
      "DraggableTabsBrowser components must be used within DraggableTabsBrowser.Root",
    );
  }
  return context;
}

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

    // Use the sortable index from the drag data
    const activeIndex = activeData.sortable?.index;
    const overIndex = overData.sortable?.index;

    // Only move if group or tab positions differ
    // if (activeData.groupId !== overData.groupId || activeIndex !== overIndex) {
    onTabMove({
      tabId: activeData.tabId,
      from: { groupId: activeData.groupId, index: activeIndex },
      to: { groupId: overData.groupId, index: overIndex },
    });
    // }
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
        <HStack width="full" gap={0} height="full">
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
interface DraggableTabsGroupProps
  extends Omit<StackProps, "onClick" | "defaultValue"> {
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
  ...props
}: DraggableTabsGroupProps) {
  const groupContextValue: TabGroupContextValue = {
    groupId,
    activeTabId,
    onTabChange,
  };

  return (
    <TabGroupContext.Provider value={groupContextValue}>
      <BrowserLikeTabs.Root
        {...props}
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
    })?.filter(Boolean);
  }, [children]);

  return (
    <BrowserLikeTabs.Bar>
      <SortableContext
        items={tabIds ?? []}
        strategy={horizontalListSortingStrategy}
      >
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
interface DraggableTabTriggerProps extends BoxProps {
  children: React.ReactNode;
  id: string;
}

const DraggableBrowserTabTrigger = BrowserLikeTabs.Trigger;

function DraggableTab({ id, children, ...rest }: DraggableTabTriggerProps) {
  const { groupId } = useTabGroupContext();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id,
    data: {
      groupId,
      tabId: id,
      label: (
        <TabIdProvider tabId={id}>
          <PromptBrowserTab
            onRemove={() => {
              console.log("remove tab", id);
            }}
            dimmed={false}
          />
        </TabIdProvider>
      ),
    },
  });

  const style: React.CSSProperties = {
    ...rest.style,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging || isOver ? 0.5 : 1,
  };

  return (
    <Box
      {...rest}
      ref={setNodeRef}
      style={{
        flex: 1,
        display: "flex",
        alignItems: "stretch",
        ...style,
        cursor: isDragging ? "grabbing" : "grab",
      }}
      {...attributes}
      {...listeners}
    >
      {children}
    </Box>
  );
}

const DraggableTabsContent = BrowserLikeTabs.Content;

// Export compound component
export const DraggableTabsBrowser = {
  Root: DraggableTabsBrowserRoot,
  Group: DraggableTabsGroup,
  TabBar: DraggableTabsTabBar,
  Trigger: DraggableBrowserTabTrigger,
  Tab: DraggableTab,
  Content: DraggableTabsContent,
};

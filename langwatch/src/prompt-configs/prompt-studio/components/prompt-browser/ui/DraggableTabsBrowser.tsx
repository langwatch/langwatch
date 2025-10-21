import React from "react";
import {
  DndContext,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  DragOverlay,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { BrowserLikeTabs } from "./BrowserLikeTabs";

// Context for managing drag state and callbacks
interface DraggableTabsContextValue {
  onTabMove: (
    fromGroupId: string,
    toGroupId: string,
    tabId: string,
    destinationIndex: number,
  ) => void;
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

function useDraggableTabsContext() {
  const context = React.useContext(DraggableTabsContext);
  if (!context) {
    throw new Error(
      "DraggableTabs components must be used within DraggableTabsBrowser",
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
  onTabMove: (
    fromGroupId: string,
    toGroupId: string,
    tabId: string,
    destinationIndex: number,
  ) => void;
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

  function handleDragStart(event: any) {
    const { groupId, tabId, label } = event.active.data.current;
    setActiveDrag({ groupId, tabId, label });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;
    if (!activeData || !overData) return;

    // Only move if group or tab positions differ
    if (
      activeData.groupId !== overData.groupId ||
      activeData.tabIndex !== overData.tabIndex
    ) {
      onTabMove(
        activeData.groupId,
        overData.groupId,
        activeData.tabId,
        overData.tabIndex,
      );
    }
  }

  const contextValue: DraggableTabsContextValue = {
    onTabMove,
    activeDrag,
    setActiveDrag,
  };

  return (
    <DraggableTabsContext.Provider value={contextValue}>
      <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <React.Fragment>
          {children}
          <DragOverlay>
            {activeDrag ? <DragOverlayContent activeDrag={activeDrag} /> : null}
          </DragOverlay>
        </React.Fragment>
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
      {activeDrag.label || "Dragging tab..."}
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
}

function DraggableTabsGroup({
  children,
  groupId,
  activeTabId,
  onTabChange,
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
  rightSlot?: React.ReactNode;
}

function DraggableTabsTabBar({
  children,
  rightSlot,
}: DraggableTabsTabBarProps) {
  const { groupId } = useTabGroupContext();

  // The entire bar is the drop area for new tabs/tabs reordered
  const { setNodeRef: setDropRef } = useDroppable({
    id: `tab-bar-drop-${groupId}`,
    data: { groupId },
  });

  return (
    <BrowserLikeTabs.Bar rightSlot={rightSlot}>
      <div ref={setDropRef} style={{ display: "contents" }}>
        <BrowserLikeTabs.List>{children}</BrowserLikeTabs.List>
      </div>
    </BrowserLikeTabs.Bar>
  );
}

/**
 * DraggableTabsBrowser Trigger Component
 *
 * Single Responsibility: Wraps a tab with drag-and-drop functionality
 */
interface DraggableTabsTriggerProps {
  value: string;
  children: React.ReactNode;
}

function DraggableTabsTrigger({ value, children }: DraggableTabsTriggerProps) {
  const { activeDrag } = useDraggableTabsContext();
  const { groupId } = useTabGroupContext();

  // Extract label from children for drag overlay
  const label = React.useMemo(() => {
    const child = React.Children.only(children);
    if (React.isValidElement(child) && child.type === DraggableTabsTab) {
      return (
        (child.props as DraggableTabsTabProps).label ??
        (child.props as DraggableTabsTabProps).children
      );
    }
    return children;
  }, [children]);

  // Get tab index by finding position in parent
  const tabIndex = React.useMemo(() => {
    // This is a bit hacky, but we need the index for drag-and-drop
    // In a real implementation, you might want to use a ref or context to track this
    return 0; // TODO: Implement proper index tracking
  }, []);

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `tab-${groupId}-${value}`,
      data: { groupId, tabId: value, tabIndex, label },
      disabled: !!activeDrag && activeDrag.tabId !== value,
    });

  const style: React.CSSProperties = transform
    ? {
        transform: CSS.Transform.toString(transform),
        opacity: 0.75,
        zIndex: 10,
      }
    : {};

  return (
    <div
      ref={setNodeRef}
      style={{
        display: "flex",
        alignItems: "stretch",
        ...style,
        pointerEvents: isDragging ? "none" : undefined,
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
 * DraggableTabsBrowser Tab Component
 *
 * Single Responsibility: Renders tab content (typically used inside Trigger)
 */
interface DraggableTabsTabProps {
  label?: React.ReactNode;
  children?: React.ReactNode;
}

function DraggableTabsTab({ label, children }: DraggableTabsTabProps) {
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
  Trigger: DraggableTabsTrigger,
  Tab: DraggableTabsTab,
  Content: DraggableTabsContent,
};

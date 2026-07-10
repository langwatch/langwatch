import {
  Box,
  type BoxProps,
  HStack,
  type StackProps,
  Tabs,
  type TabsRootProps,
  VStack,
} from "@chakra-ui/react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import React from "react";
import { PromptBrowserTab } from "../tab/PromptBrowserTab";
import { TabIdProvider } from "./TabContext";

// Context for managing drag state and callbacks
/**
 * DraggableTabsContextValue interface
 * Single Responsibility: Provides drag state and callbacks for tab movement.
 */
interface DraggableTabsContextValue {
  onTabMove: (params: {
    tabId: string;
    from: { windowId: string; index: number };
    to: { windowId: string; index: number };
  }) => void;
  activeDrag: {
    windowId: string;
    tabId: string;
    label?: React.ReactNode;
  } | null;
  setActiveDrag: (
    drag: { windowId: string; tabId: string; label?: React.ReactNode } | null,
  ) => void;
}

const DraggableTabsContext =
  React.createContext<DraggableTabsContextValue | null>(null);

/**
 * useDraggableTabsContext
 * Single Responsibility: Provides access to drag context; throws if used outside Root.
 */
export function useDraggableTabsContext() {
  const context = React.useContext(DraggableTabsContext);
  if (!context) {
    throw new Error(
      "DraggableTabsBrowser components must be used within DraggableTabsBrowser.Root",
    );
  }
  return context;
}

// Context for managing window (split-pane) state
/**
 * TabWindowContextValue interface
 * Single Responsibility: Provides window-level tab state and callbacks.
 */
interface TabWindowContextValue {
  windowId: string;
  activeTabId?: string;
  onTabChange?: (windowId: string, tabId: string) => void;
}

const TabWindowContext = React.createContext<TabWindowContextValue | null>(null);

/**
 * useTabWindowContext
 * Single Responsibility: Provides access to window context; throws if used outside Window.
 */
function useTabWindowContext() {
  const context = React.useContext(TabWindowContext);
  if (!context) {
    throw new Error(
      "Tab components must be used within DraggableTabsBrowser.Window",
    );
  }
  return context;
}

/**
 * DraggableTabsBrowser Root Component
 *
 * Single Responsibility: Provides drag-and-drop context and orchestrates tab movement between windows
 */
interface DraggableTabsBrowserProps {
  children: React.ReactNode;
  onTabMove: (params: {
    tabId: string;
    from: { windowId: string; index: number };
    to: { windowId: string; index: number };
  }) => void;
}

/**
 * DraggableTabsBrowserRoot component
 * Single Responsibility: Orchestrates drag-and-drop for tabs across windows
 * @param children - Child window components
 * @param onTabMove - Callback fired when a tab is moved
 */
function DraggableTabsBrowserRoot({
  children,
  onTabMove,
}: DraggableTabsBrowserProps) {
  const [activeDrag, setActiveDrag] = React.useState<{
    windowId: string;
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

  /**
   * handleDragStart
   * Single Responsibility: Sets active drag state when drag begins.
   */
  function handleDragStart(event: any) {
    const { windowId, tabId, label } = event.active.data.current;
    setActiveDrag({ windowId, tabId, label });
  }

  /**
   * handleDragEnd
   * Single Responsibility: Clears drag state and calls onTabMove when drag completes.
   */
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

    // Only move if window or tab positions differ
    // if (activeData.windowId !== overData.windowId || activeIndex !== overIndex) {
    onTabMove({
      tabId: activeData.tabId,
      from: { windowId: activeData.windowId, index: activeIndex },
      to: { windowId: overData.windowId, index: overIndex },
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
        <HStack width="full" gap={2} padding={2} height="full">
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
  activeDrag: { windowId: string; tabId: string; label?: React.ReactNode };
}) {
  return (
    <div
      style={{
        background: "var(--chakra-colors-bg-panel)",
        padding: 8,
        border: "1px solid var(--chakra-colors-border)",
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
 * DraggableTabsBrowser Window Component
 *
 * Single Responsibility: Manages one split-pane window of tabs with shared state and drop zone
 */
interface DraggableTabsWindowProps
  extends Omit<TabsRootProps, "onClick" | "defaultValue"> {
  windowId: string;
  activeTabId?: string;
  onTabChange?: (windowId: string, tabId: string) => void;
  onClick?: (windowId: string, tabId: string) => void;
}

/**
 * DraggableTabsWindow component
 * Single Responsibility: Manages one window of tabs with active state and tab change handler.
 * @param children - Tab bar and content components
 * @param windowId - Unique identifier for this split-pane window
 * @param activeTabId - Currently active tab ID
 * @param onTabChange - Callback fired when active tab changes
 * @param onClick - Callback fired when the window is clicked
 * @param props - Additional stack props
 */
function DraggableTabsWindow({
  children,
  windowId,
  activeTabId,
  onTabChange,
  onClick,
  ...props
}: DraggableTabsWindowProps) {
  const windowContextValue: TabWindowContextValue = {
    windowId,
    activeTabId,
    onTabChange,
  };

  return (
    <TabWindowContext.Provider value={windowContextValue}>
      <VStack height="full" gap={0} align="stretch" width="full">
        <Tabs.Root
          value={activeTabId}
          onValueChange={(change) => onTabChange?.(windowId, change.value)}
          onClick={() => onClick?.(windowId, activeTabId ?? "")}
          width="full"
          height="full"
          display="flex"
          flexDirection="column"
          variant="enclosed"
          lazyMount
          unmountOnExit
          {...props}
        >
          {children}
        </Tabs.Root>
      </VStack>
    </TabWindowContext.Provider>
  );
}

/**
 * DraggableTabsBrowser TabBar Component
 *
 * Single Responsibility: Provides the droppable area for tabs and renders the tab bar
 */
interface DraggableTabsTabBarProps extends StackProps {
  children: React.ReactNode;
  tabIds: string[];
}

/**
 * DraggableTabsTabBar component
 * Single Responsibility: Provides sortable context and renders tab bar with drag-drop support.
 * @param children - Tab trigger components
 * @param tabIds - Array of tab IDs for sortable context
 */
function DraggableTabsTabBar({
  children,
  tabIds,
  ...props
}: DraggableTabsTabBarProps) {
  return (
    <HStack gap={0} width="full" {...props}>
      <SortableContext
        items={tabIds ?? []}
        strategy={horizontalListSortingStrategy}
      >
        <Tabs.List
          width="full"
          gap={0}
          height="full"
          paddingY={0}
          background="none"
        >
          {children}
        </Tabs.List>
      </SortableContext>
    </HStack>
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

/**
 * DraggableBrowserTabTrigger component
 * Single Responsibility: Renders a single tab trigger with browser-like styling.
 * @param value - Tab identifier
 * @param children - Tab content/label
 */
function DraggableBrowserTabTrigger({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  return (
    <Tabs.Trigger
      value={value}
      minWidth="fit-content"
      cursor="pointer"
      transition="all 0.15s ease-in-out"
    >
      {children}
    </Tabs.Trigger>
  );
}

/**
 * DraggableTab component
 * Single Responsibility: Renders a draggable tab with sortable behavior and styling.
 * @param id - Unique tab identifier
 * @param children - Tab content/trigger
 * @param rest - Additional box props
 */
function DraggableTab({ id, children, ...rest }: DraggableTabTriggerProps) {
  const { windowId } = useTabWindowContext();

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
      windowId,
      tabId: id,
      label: (
        <TabIdProvider tabId={id}>
          <PromptBrowserTab dimmed={false} />
        </TabIdProvider>
      ),
    },
  });

  return (
    <Box
      {...rest}
      ref={setNodeRef}
      // Lets the tab switcher find this tab in the strip to scroll it into view.
      data-tab-id={id}
      flex={1}
      alignItems="stretch"
      cursor={isDragging ? "grabbing" : "grab"}
      transform={CSS.Transform.toString(transform)}
      transition={transition}
      opacity={isDragging || isOver ? 0.5 : 1}
      {...attributes}
      {...listeners}
    >
      {children}
    </Box>
  );
}

const DraggableTabsContent = Tabs.Content;

/**
 * Compound component for draggable browser-like tabs.
 * Provides drag-and-drop functionality for tabs across multiple windows.
 *
 * @example
 * ```tsx
 * <DraggableTabsBrowser.Root onTabMove={handleMove}>
 *   <DraggableTabsBrowser.Window windowId="g1" activeTabId="tab1">
 *     <DraggableTabsBrowser.TabBar tabIds={["tab1", "tab2"]}>
 *       <DraggableTabsBrowser.Tab id="tab1">
 *         <DraggableTabsBrowser.Trigger value="tab1">Tab 1</DraggableTabsBrowser.Trigger>
 *       </DraggableTabsBrowser.Tab>
 *     </DraggableTabsBrowser.TabBar>
 *     <DraggableTabsBrowser.Content value="tab1">Content</DraggableTabsBrowser.Content>
 *   </DraggableTabsBrowser.Window>
 * </DraggableTabsBrowser.Root>
 * ```
 */
export const DraggableTabsBrowser = {
  Root: DraggableTabsBrowserRoot,
  Window: DraggableTabsWindow,
  TabBar: DraggableTabsTabBar,
  Trigger: DraggableBrowserTabTrigger,
  Tab: DraggableTab,
  Content: DraggableTabsContent,
};

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
import {
  CARD_BORDER_COLOR,
  CARD_BORDER_WIDTH,
  CARD_RADIUS,
} from "./cardSurface";
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

interface TabWindowContextValue {
  windowId: string;
  activeTabId?: string;
}

const TabWindowContext = React.createContext<TabWindowContextValue | null>(
  null,
);

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
  onTabChange?: (params: { windowId: string; tabId: string }) => void;
  /** Named apart from the DOM's `onClick`, which it shadows and does not match. */
  onWindowClick?: (params: { windowId: string; tabId: string }) => void;
}

function DraggableTabsWindow({
  children,
  windowId,
  activeTabId,
  onTabChange,
  onWindowClick,
  ...props
}: DraggableTabsWindowProps) {
  const windowContextValue: TabWindowContextValue = {
    windowId,
    activeTabId,
  };

  return (
    <TabWindowContext.Provider value={windowContextValue}>
      <VStack height="full" gap={0} align="stretch" width="full">
        {/* Browser tabs: the strip stands on the page ground and the card below
            it holds the prompt. The frame lives on `DraggableTabsBrowser.Panel`
            rather than here, because the strip has to be OUTSIDE it — the
            active tab takes the card's own surface and overlaps its top border,
            so tab and content read as one continuous shape with no rule between
            them. The root keeps only the flex column. */}
        <Tabs.Root
          value={activeTabId}
          onValueChange={(change) =>
            onTabChange?.({ windowId, tabId: change.value })
          }
          onClick={() =>
            onWindowClick?.({ windowId, tabId: activeTabId ?? "" })
          }
          width="full"
          height="full"
          display="flex"
          flexDirection="column"
          minHeight={0}
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
    // The strip stands on the page ground, not on the card: it carries no
    // surface of its own, and the tabs sitting on it are what the eye reads. It
    // overlaps the card below by exactly the card's border width, so the active
    // tab — which paints the card's surface — covers the card's top border for
    // its own width and the two join into one shape. `zIndex` puts the strip
    // above the card so that overlap paints over the border, not under it.
    <HStack
      gap={0}
      width="full"
      flexWrap="nowrap"
      minWidth={0}
      flexShrink={0}
      alignItems="stretch"
      position="relative"
      zIndex={1}
      marginBottom={`-${CARD_BORDER_WIDTH}`}
      {...props}
    >
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
          // The strip, the switcher and the toolbar share one row. Without
          // this the switcher wraps onto a line of its own once the tabs fill
          // the width, and the tab bar grows a second row.
          flexWrap="nowrap"
          // Stretch, so a tab reaches the bottom of the strip and can meet the
          // card. Anything in the strip that is not a tab centres itself.
          alignItems="stretch"
          minWidth={0}
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
  /** A lone tab grows into the space before its joined action cluster. */
  shouldFillAvailableWidth?: boolean;
}

/**
 * A tab never shrinks below this. Past it the strip scrolls instead, and the
 * tab switcher appears to reach what scrolled away. Wide enough to keep a few
 * characters of the title alongside the close button.
 */
export const TAB_MIN_WIDTH = "88px";
/** A lone tab does not stretch across an empty strip. */
export const TAB_MAX_WIDTH = "180px";

/**
 * DraggableBrowserTabTrigger component
 * Single Responsibility: Renders a single tab trigger with browser-like styling.
 * @param value - Tab identifier
 * @param children - Tab content/label
 */
function DraggableBrowserTabTrigger({
  value,
  children,
  isJoinedWithTrailingActions = false,
}: {
  value: string;
  children: React.ReactNode;
  /** The action cluster beside this trigger continues the same tab surface. */
  isJoinedWithTrailingActions?: boolean;
}) {
  return (
    <Tabs.Trigger
      value={value}
      // `min-width: 0` defeats the flex default of `auto`, which would size the
      // trigger to its content and stop the tab from ever shrinking.
      minWidth={0}
      width="full"
      height="calc(100% - 1px)"
      overflow="hidden"
      cursor="pointer"
      transition="background 0.15s ease-in-out, color 0.15s ease-in-out"
      // Rounded at the top only, square at the bottom where it runs into the
      // card. A tab rounded on all four corners is a pill sitting near the card
      // rather than the top edge of it.
      borderTopRadius={CARD_RADIUS}
      borderTopRightRadius={isJoinedWithTrailingActions ? 0 : CARD_RADIUS}
      borderBottomRadius={0}
      background="transparent"
      color="fg.muted"
      // Reserved on every tab and transparent while unselected: a border that
      // only existed on the selected tab would shift its label by a pixel every
      // time the selection moved.
      borderWidth={CARD_BORDER_WIDTH}
      borderBottomWidth={0}
      borderRightWidth={isJoinedWithTrailingActions ? 0 : CARD_BORDER_WIDTH}
      borderColor="transparent"
      // The `enclosed` variant lifts the selected trigger with a drop shadow,
      // which reads as a raised control — a combo box — rather than as a tab.
      boxShadow="none"
      _hover={{ background: "bg.muted", color: "fg" }}
      // The selected tab IS the card: same surface, same border, same radius,
      // and the strip's negative bottom margin pulls it down over the card's
      // top border so no rule runs between the tab and its own content.
      _selected={{
        background: "bg.panel",
        color: "fg",
        borderColor: CARD_BORDER_COLOR,
        boxShadow: "none",
        height: "full",
        _hover: { background: "bg.panel" },
      }}
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
function DraggableTab({
  id,
  children,
  shouldFillAvailableWidth = false,
  ...rest
}: DraggableTabTriggerProps) {
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
      // Not `data-tab-id`: that already marks a tab's chat textarea
      // (SyncedChatInput), which PromptPlaygroundChat queries to focus.
      data-tab-strip-id={id}
      // A tab is as wide as its own title, capped at TAB_MAX_WIDTH, and shrinks
      // from there down to TAB_MIN_WIDTH as the strip fills; only then does the
      // strip scroll. Sizing every tab to an equal share instead stretched a
      // lone tab to its cap and stranded the close button an inch from the name
      // it belongs to. They are never hidden — a hidden element has a zero-size
      // rect, which would corrupt @dnd-kit's drop-index math for these
      // sortables.
      flex={shouldFillAvailableWidth ? "1 1 0" : "0 1 auto"}
      minWidth={TAB_MIN_WIDTH}
      maxWidth={shouldFillAvailableWidth ? "none" : TAB_MAX_WIDTH}
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

/**
 * DraggableTabsPanel
 *
 * Single Responsibility: draws the card that holds the open tab's content.
 *
 * The frame — surface, border, radius — is here rather than around the whole
 * window so that the tab strip stays outside it and the active tab can overlap
 * its top border. `overflow: hidden` is what makes the radius survive: the
 * panes inside paint their own opaque backgrounds and would otherwise square
 * off the corners they cover.
 */
function DraggableTabsPanel({ children, ...props }: BoxProps) {
  return (
    <Box
      data-testid="prompt-card"
      flex={1}
      minHeight={0}
      width="full"
      display="flex"
      flexDirection="column"
      background="bg.panel"
      borderWidth={CARD_BORDER_WIDTH}
      borderColor={CARD_BORDER_COLOR}
      borderRadius={CARD_RADIUS}
      overflow="hidden"
      {...props}
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
 *     <DraggableTabsBrowser.Panel>
 *       <DraggableTabsBrowser.Content value="tab1">Content</DraggableTabsBrowser.Content>
 *     </DraggableTabsBrowser.Panel>
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
  Panel: DraggableTabsPanel,
  Content: DraggableTabsContent,
};

import { Box, Flex } from "@chakra-ui/react";
import { useEffect, useRef } from "react";
import {
  type ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import { IsolatedErrorBoundary } from "~/components/ui/IsolatedErrorBoundary";
import type {
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import { useDrawerStore } from "../../../stores/drawerStore";
import { ConversationContext } from "../ConversationContext";
import { VizPlaceholder } from "../VizPlaceholder";
import { Pane } from "./Pane";
import { SpanDetailPane } from "./SpanDetailPane";
import type { DrawerLayout } from "./usePaneLayout";

interface PaneLayoutProps {
  trace: TraceHeader;
  spans: SpanTreeNode[];
  selectedSpan: SpanTreeNode | null;
  spansLoading: boolean;
  layout: DrawerLayout;
}

const PANE_GROUP_STORAGE_PREFIX = "langwatch:traces-v2:drawer-panel-sizes";

/**
 * Renders the trace drawer body as a stack of independently sized,
 * scrollable panels — Chrome DevTools "Network → Headers / Preview"
 * model.
 *
 * Per operator feedback, only the optional **Conversation Context**
 * panel is wrapped in a `<Pane>` (it gets a real titled header bar
 * with a collapse chevron). The **Visualization** and **Details**
 * panels carry no extra Pane chrome — their own tab strips
 * (VizPlaceholder's viz-tab row and SpanTabBar respectively) are the
 * chrome. The Details collapse affordance lives inside SpanTabBar.
 */
export function PaneLayout({
  trace,
  spans,
  selectedSpan,
  spansLoading,
  layout,
}: PaneLayoutProps) {
  const vizTab = useDrawerStore((s) => s.vizTab);
  const setVizTab = useDrawerStore((s) => s.setVizTab);
  const selectedSpanId = useDrawerStore((s) => s.selectedSpanId);
  const selectSpan = useDrawerStore((s) => s.selectSpan);
  const clearSpan = useDrawerStore((s) => s.clearSpan);

  const paneState = useDrawerStore((s) => s.paneState);
  const togglePaneCollapsed = useDrawerStore((s) => s.togglePaneCollapsed);

  const hasConversation = !!trace.conversationId;
  const ctxState = paneState.conversationContext;
  const detailState = paneState.spanDetail;

  const ctxPanelRef = useRef<ImperativePanelHandle>(null);
  const detailPanelRef = useRef<ImperativePanelHandle>(null);

  useEffect(() => {
    const handle = ctxPanelRef.current;
    if (!handle) return;
    if (ctxState.collapsed && !handle.isCollapsed()) handle.collapse();
    else if (!ctxState.collapsed && handle.isCollapsed()) handle.expand();
  }, [ctxState.collapsed]);
  useEffect(() => {
    const handle = detailPanelRef.current;
    if (!handle) return;
    // When details collapses, shrink the Panel to the SpanTabBar
    // height so only the tab row remains visible. When expanded,
    // restore the persisted relative size.
    if (detailState.collapsed && !handle.isCollapsed()) handle.collapse();
    else if (!detailState.collapsed && handle.isCollapsed()) handle.expand();
  }, [detailState.collapsed]);

  // The Visualization panel renders its own tab strip as chrome — no
  // outer Pane wrapper. A 1px border on the side facing the Details
  // panel is the visible shared separator (the resize handle overlays
  // it with a wider invisible hit area).
  const vizPanel = (
    <Box
      height="100%"
      width="100%"
      minHeight={0}
      minWidth={0}
      borderRightWidth={layout === "horizontal" ? "1px" : undefined}
      borderBottomWidth={layout === "horizontal" ? undefined : "1px"}
      borderColor="border"
      bg={{ base: "bg.surface", _dark: "bg.panel" }}
    >
      <IsolatedErrorBoundary
        scope="Couldn't render visualisation"
        resetKeys={[trace.traceId, vizTab]}
      >
        <VizPlaceholder
          vizTab={vizTab}
          onVizTabChange={setVizTab}
          trace={trace}
          spans={spans}
          isLoading={spansLoading}
          selectedSpanId={selectedSpanId}
          onSelectSpan={selectSpan}
          onClearSpan={clearSpan}
          fillParent
        />
      </IsolatedErrorBoundary>
    </Box>
  );

  // The Details panel renders its own SpanTabBar as chrome (with the
  // collapse toggle sitting at the leftmost edge of the tab row). When
  // collapsed, the Panel itself shrinks to the SpanTabBar height —
  // SpanDetailPane handles hiding its content area.
  const detailPanel = (
    <SpanDetailPane
      trace={trace}
      spans={spans}
      selectedSpan={selectedSpan}
    />
  );

  const ctxPane = hasConversation ? (
    <Pane
      title="Conversation Context"
      collapsed={ctxState.collapsed}
      onToggleCollapsed={() => togglePaneCollapsed("conversationContext")}
      position="top"
    >
      <Box paddingY={3}>
        <IsolatedErrorBoundary
          scope="Couldn't render conversation context"
          resetKeys={[trace.conversationId ?? "", trace.traceId]}
        >
          <ConversationContext
            conversationId={trace.conversationId!}
            traceId={trace.traceId}
          />
        </IsolatedErrorBoundary>
      </Box>
    </Pane>
  ) : null;

  const vizDetailGroupId =
    layout === "horizontal"
      ? `${PANE_GROUP_STORAGE_PREFIX}:viz-detail:h`
      : `${PANE_GROUP_STORAGE_PREFIX}:viz-detail:v`;

  const vizDetailGroup = (
    <PanelGroup
      direction={layout === "horizontal" ? "horizontal" : "vertical"}
      autoSaveId={vizDetailGroupId}
      style={{ flex: 1, minHeight: 0, minWidth: 0 }}
    >
      <Panel
        id="viz"
        order={1}
        defaultSize={layout === "horizontal" ? 55 : 50}
        minSize={15}
      >
        {vizPanel}
      </Panel>
      <PanelResizeHandle>
        <PaneResizeBar orientation={layout} />
      </PanelResizeHandle>
      <Panel
        ref={detailPanelRef}
        id="detail"
        order={2}
        defaultSize={layout === "horizontal" ? 45 : 50}
        minSize={5}
        collapsible
        // Collapsed = SpanTabBar height only (~38px out of ~700px ≈ 5.5%).
        collapsedSize={6}
      >
        {detailPanel}
      </Panel>
    </PanelGroup>
  );

  if (!ctxPane) {
    return (
      <Flex
        flex={1}
        minHeight={0}
        minWidth={0}
        direction="column"
        bg={{ base: "bg.surface", _dark: "bg.panel" }}
      >
        {vizDetailGroup}
      </Flex>
    );
  }

  return (
    <Flex
      flex={1}
      minHeight={0}
      minWidth={0}
      direction="column"
      bg={{ base: "bg.surface", _dark: "bg.panel" }}
    >
      <PanelGroup
        direction="vertical"
        autoSaveId={`${PANE_GROUP_STORAGE_PREFIX}:ctx-body:v`}
        style={{ flex: 1, minHeight: 0, minWidth: 0 }}
      >
        <Panel
          ref={ctxPanelRef}
          id="ctx"
          order={1}
          defaultSize={ctxState.collapsed ? 4 : 18}
          minSize={4}
          collapsible
          collapsedSize={4}
        >
          {ctxPane}
        </Panel>
        <PanelResizeHandle>
          <PaneResizeBar orientation="vertical" />
        </PanelResizeHandle>
        <Panel id="body" order={2} defaultSize={82} minSize={20}>
          {vizDetailGroup}
        </Panel>
      </PanelGroup>
    </Flex>
  );
}

/**
 * The visible separator between two panels AND the drag hit zone in a
 * single element — no pseudo-elements, no nested layers. The element
 * is the line: 1px wide (or tall) `border`, an outer transparent strip
 * that's wider so the cursor target is forgiving. Cursor lives on the
 * outer Box so there's exactly one "I'm a divider" hit reported by the
 * browser, no matter where the user lands inside the strip.
 */
function PaneResizeBar({ orientation }: { orientation: DrawerLayout }) {
  const isHorizontal = orientation === "horizontal";
  return (
    <Box
      role="separator"
      aria-orientation={isHorizontal ? "vertical" : "horizontal"}
      // Transparent strip — the visible 1px line is the adjacent
      // panel's border, this element is purely the drag handle. ZERO
      // width / height in the layout direction so it doesn't double
      // the visible separator. The transparent extra hit area lives
      // ENTIRELY in the negative-margin overlap with the surrounding
      // panels (margin pulls them into each other so the hit zone is
      // 14px wide centered on the 0-width line).
      width={isHorizontal ? "0px" : "100%"}
      height={isHorizontal ? "100%" : "0px"}
      margin={isHorizontal ? "0 -7px" : "-7px 0"}
      padding={isHorizontal ? "0 7px" : "7px 0"}
      cursor={isHorizontal ? "col-resize" : "row-resize"}
      // Reach above the panel contents so the cursor wins; panel
      // bodies are below this in stacking order.
      position="relative"
      zIndex={1}
    />
  );
}

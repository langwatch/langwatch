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
 * scrollable panes — Chrome DevTools "Network → Headers / Preview"
 * model.
 *
 * Three logical panes:
 *
 *   1. Conversation Context (only when the trace belongs to a conversation)
 *      — always sits on top in both layouts, collapsible.
 *   2. Visualization (waterfall / flame / span list / topology / sequence)
 *      — fills the rest of the available space.
 *   3. Span Detail (SpanTabBar + active panel: summary / llm / prompts / span)
 *      — sits next to Visualization in horizontal layout, below it in
 *      vertical.
 *
 * Each pane owns its own scroll container. The drawer body never
 * scrolls. Panel sizes persist to localStorage via react-resizable-panels'
 * built-in `autoSaveId`.
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
  const togglePaneMaximized = useDrawerStore((s) => s.togglePaneMaximized);

  const hasConversation = !!trace.conversationId;
  const ctxState = paneState.conversationContext;
  const vizState = paneState.visualization;
  const detailState = paneState.spanDetail;

  // Maximizing the viz hides the detail and vice versa. We honour
  // whichever was clicked most recently — Zustand updates are
  // synchronous so the user always sees the result of their last action.
  const vizMaximized = vizState.maximizedWithinGroup;
  const detailMaximized = detailState.maximizedWithinGroup;
  const showViz = !detailMaximized;
  const showDetail = !vizMaximized;

  const vizPane = (
    <Pane
      title="Visualization"
      collapsed={vizState.collapsed}
      onToggleCollapsed={() => togglePaneCollapsed("visualization")}
      maximized={vizState.maximizedWithinGroup}
      onToggleMaximized={() => togglePaneMaximized("visualization")}
      canMaximize={showDetail || vizMaximized}
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
    </Pane>
  );

  const detailPane = (
    <Pane
      title="Details"
      collapsed={detailState.collapsed}
      onToggleCollapsed={() => togglePaneCollapsed("spanDetail")}
      maximized={detailState.maximizedWithinGroup}
      onToggleMaximized={() => togglePaneMaximized("spanDetail")}
      canMaximize={showViz || detailMaximized}
    >
      <SpanDetailPane
        trace={trace}
        spans={spans}
        selectedSpan={selectedSpan}
      />
    </Pane>
  );

  const ctxPane = hasConversation ? (
    <Pane
      title="Conversation Context"
      collapsed={ctxState.collapsed}
      onToggleCollapsed={() => togglePaneCollapsed("conversationContext")}
      canMaximize={false}
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

  // PanelGroup auto-save IDs include the orientation so a width
  // remembered for a vertical stack doesn't get reapplied as a
  // horizontal split (and vice versa) — they're different size axes.
  const vizDetailGroupId =
    layout === "horizontal"
      ? `${PANE_GROUP_STORAGE_PREFIX}:viz-detail:h`
      : `${PANE_GROUP_STORAGE_PREFIX}:viz-detail:v`;

  const vizPanelRef = useRef<ImperativePanelHandle>(null);
  const detailPanelRef = useRef<ImperativePanelHandle>(null);
  const ctxPanelRef = useRef<ImperativePanelHandle>(null);

  useEffect(() => {
    const handle = ctxPanelRef.current;
    if (!handle) return;
    if (ctxState.collapsed && !handle.isCollapsed()) handle.collapse();
    else if (!ctxState.collapsed && handle.isCollapsed()) handle.expand();
  }, [ctxState.collapsed]);

  // Sync `paneState[...].collapsed` to the underlying Panel via the
  // imperative API. Without this, collapsing the pane only hides its
  // content while the parent `<Panel>` still reserves the full size —
  // the freed space wouldn't flow to the sibling.
  useEffect(() => {
    const handle = vizPanelRef.current;
    if (!handle) return;
    if (vizState.collapsed && !handle.isCollapsed()) handle.collapse();
    else if (!vizState.collapsed && handle.isCollapsed()) handle.expand();
  }, [vizState.collapsed]);
  useEffect(() => {
    const handle = detailPanelRef.current;
    if (!handle) return;
    if (detailState.collapsed && !handle.isCollapsed()) handle.collapse();
    else if (!detailState.collapsed && handle.isCollapsed()) handle.expand();
  }, [detailState.collapsed]);

  const vizDetailGroup = (
    <PanelGroup
      direction={layout === "horizontal" ? "horizontal" : "vertical"}
      autoSaveId={vizDetailGroupId}
      style={{ flex: 1, minHeight: 0, minWidth: 0 }}
    >
      {showViz ? (
        <Panel
          ref={vizPanelRef}
          id="viz"
          order={1}
          defaultSize={layout === "horizontal" ? 55 : 50}
          minSize={15}
          collapsible
          collapsedSize={4}
        >
          {vizPane}
        </Panel>
      ) : null}
      {showViz && showDetail ? (
        <PanelResizeHandle>
          <PaneResizeBar orientation={layout} />
        </PanelResizeHandle>
      ) : null}
      {showDetail ? (
        <Panel
          ref={detailPanelRef}
          id="detail"
          order={2}
          defaultSize={layout === "horizontal" ? 45 : 50}
          minSize={15}
          collapsible
          collapsedSize={4}
        >
          {detailPane}
        </Panel>
      ) : null}
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

  // Conversation context wraps the rest in a vertical PanelGroup so
  // operators can drag its share too.
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
 * Visual treatment for the `<PanelResizeHandle>` slot. The handle is
 * a thin bar with a tiny pill at its centre — same affordance as the
 * drawer-edge grip, scaled down for inline use.
 */
function PaneResizeBar({ orientation }: { orientation: DrawerLayout }) {
  const isHorizontal = orientation === "horizontal";
  return (
    <Flex
      align="center"
      justify="center"
      role="separator"
      aria-orientation={isHorizontal ? "vertical" : "horizontal"}
      width={isHorizontal ? "6px" : "100%"}
      height={isHorizontal ? "100%" : "6px"}
      cursor={isHorizontal ? "col-resize" : "row-resize"}
      bg="transparent"
      transition="background 120ms ease"
      _hover={{ bg: "bg.muted" }}
    >
      <Box
        width={isHorizontal ? "2px" : "32px"}
        height={isHorizontal ? "32px" : "2px"}
        borderRadius="full"
        bg="gray.emphasized"
        opacity={0.4}
        transition="opacity 120ms ease"
        _groupHover={{ opacity: 1 }}
      />
    </Flex>
  );
}


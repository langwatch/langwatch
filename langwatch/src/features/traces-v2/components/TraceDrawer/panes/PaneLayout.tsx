import { Box, Flex } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
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

// SpanTabBar minHeight. Keep in sync with SpanTabBar.tsx.
const SPAN_TAB_BAR_HEIGHT_PX = 38;

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

  // The Details panel's collapsed size has to equal the SpanTabBar's
  // pixel height in vertical layout so collapsing leaves the tab row
  // flush at the drawer bottom — no trailing empty band. In horizontal
  // layout the panel goes to 0 (fully hidden); a "Show details" button
  // in the viz panel's tab row re-exposes it. react-resizable-panels
  // only accepts percentages, so we measure the PanelGroup's actual
  // size along the relevant axis and convert.
  const vizDetailGroupRef = useRef<HTMLDivElement>(null);
  const [detailCollapsedSize, setDetailCollapsedSize] = useState<number>(6);
  useEffect(() => {
    if (layout === "horizontal") {
      // Fully hide the panel — the reopen affordance lives in the viz
      // panel's tab row (see VizPlaceholder).
      setDetailCollapsedSize(0);
      return;
    }
    const el = vizDetailGroupRef.current;
    if (!el) return;
    const measure = () => {
      const dim = el.clientHeight;
      if (dim <= 0) return;
      const pct = (SPAN_TAB_BAR_HEIGHT_PX / dim) * 100;
      setDetailCollapsedSize(Math.min(50, Math.max(1, pct)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [layout]);

  useEffect(() => {
    const handle = ctxPanelRef.current;
    if (!handle) return;
    if (ctxState.collapsed && !handle.isCollapsed()) handle.collapse();
    else if (!ctxState.collapsed && handle.isCollapsed()) handle.expand();
  }, [ctxState.collapsed]);
  // Remember the user's manually-resized detail size so re-opening
  // after a "Hide details" round-trip lands back at the same width
  // instead of `handle.expand()`'s library default (which could blow
  // the panel up to 60–70% on wide screens).
  const lastExpandedDetailSize = useRef<number | null>(null);
  useEffect(() => {
    const handle = detailPanelRef.current;
    if (!handle) return;
    if (detailState.collapsed && !handle.isCollapsed()) {
      const current = handle.getSize();
      if (current > 1) lastExpandedDetailSize.current = current;
      handle.collapse();
    } else if (!detailState.collapsed && handle.isCollapsed()) {
      const target =
        lastExpandedDetailSize.current ??
        (layout === "horizontal" ? 45 : 50);
      handle.resize(target);
    }
  }, [detailState.collapsed, layout]);

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
          paneLayout={layout}
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
      layout={layout}
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
    <Box
      ref={vizDetailGroupRef}
      style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex" }}
    >
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
          // Computed from the group's measured size so the collapsed
          // state lands exactly on the SpanTabBar height — no trailing
          // empty band below the tab row.
          collapsedSize={detailCollapsedSize}
        >
          {detailPanel}
        </Panel>
      </PanelGroup>
    </Box>
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
      // Zero-area parent so the resize handle claims no space in the
      // layout — the visible 1px separator is the adjacent panel's
      // border. The forgiving hit zone lives in a child rendered with
      // `position: absolute` so it overlaps the surrounding panels by
      // 6px on each side WITHOUT pushing them inward (the previous
      // padding-based approach added 14px to the handle's layout
      // width, which cut off the last viz tab inside the viz panel).
      width={isHorizontal ? "0px" : "100%"}
      height={isHorizontal ? "100%" : "0px"}
      position="relative"
    >
      <Box
        position="absolute"
        top={isHorizontal ? 0 : "-6px"}
        bottom={isHorizontal ? 0 : "-6px"}
        left={isHorizontal ? "-6px" : 0}
        right={isHorizontal ? "-6px" : 0}
        cursor={isHorizontal ? "col-resize" : "row-resize"}
        // Above the adjacent panel contents so the cursor wins where
        // the hit zone overlaps them. No bg — purely a hit target.
        zIndex={2}
      />
    </Box>
  );
}

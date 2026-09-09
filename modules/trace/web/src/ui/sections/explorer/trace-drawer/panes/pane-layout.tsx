import { Box, Flex } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import {
  type ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import { IsolatedErrorBoundary } from "../../../isolated-error-boundary.tsx";
import type { SpanTreeNode, TraceHeader } from "@langwatch/trace-contract";
import { useConversationContext } from "../../hooks/use-conversation-context.ts";
import { useDrawerStore } from "../../../../../behavior/drawer.store.ts";
import { ConversationContext } from "../conversation-context.tsx";
import { VizPlaceholder } from "../viz-placeholder.tsx";
import { SpanDetailPane } from "./span-detail-pane.tsx";
import type { DrawerLayout } from "./use-pane-layout.ts";

interface PaneLayoutProps {
  trace: TraceHeader;
  spans: SpanTreeNode[];
  selectedSpan: SpanTreeNode | null;
  isSpansLoading: boolean;
  layout: DrawerLayout;
}

// Bump the version suffix when the panel layout's structure changes —
// react-resizable-panels persists sizes keyed on `autoSaveId`, and a
// stale snapshot from a previous structure can leave one Panel sized
// at 100% / another at 0%, which reads as "body content disappeared".
const PANE_GROUP_STORAGE_PREFIX = "langwatch:traces-v2:drawer-panel-sizes:v3";

// SpanTabBar minHeight. Keep in sync with SpanTabBar.tsx.
const SPAN_TAB_BAR_HEIGHT_PX = 38;

// Conversation Context header is one row of the accordion-density
// padding plus its borders. Used both to pin the collapsed Panel size
// to header height exactly (no trailing band) and as a sentinel
// minimum when content height measurement hasn't resolved yet.
// Kept in sync with `ContextHeader` paddingY in `ConversationContext.tsx`.
const CTX_HEADER_HEIGHT_PX = 36;

// `contentRef` is attached to the inner row-wrapper Box inside the scroll container (so
// `scrollHeight` doesn't get inflated by the container's clientHeight).
const CTX_SCROLL_VPAD_PX = 24;

// Pixel ceiling for the ctx pane's default / max height. Content shorter
// than this still caps at its natural height ("never taller than actual
// content"); long conversations stop here so the pane can't eat the
// whole drawer. Was 350px — raised ~40% per operator feedback that the
// default strip was too short to read a turn comfortably.
const CTX_MAX_HEIGHT_PX = 500;

// In a horizontal split the detail panel has a pixel floor. `minSize` is a
// percentage in react-resizable-panels, so the group's current width is measured
// and this is converted against it.
const DETAIL_MIN_HORIZONTAL_PX = 200;

/**
 * Renders the trace drawer body as a stack of independently sized, scrollable panels —
 * Chrome DevTools "Network → Headers / Preview" model.
 */
export function PaneLayout({
  trace,
  spans,
  selectedSpan,
  isSpansLoading,
  layout,
}: PaneLayoutProps) {
  const vizTab = useDrawerStore((s) => s.vizTab);
  const setVizTab = useDrawerStore((s) => s.setVizTab);
  const selectedSpanId = useDrawerStore((s) => s.selectedSpanId);
  const selectSpan = useDrawerStore((s) => s.selectSpan);
  const clearSpan = useDrawerStore((s) => s.clearSpan);

  const paneState = useDrawerStore((s) => s.paneState);
  const togglePaneCollapsed = useDrawerStore((s) => s.togglePaneCollapsed);

  // Conversation context pane slot only exists for genuinely multi-turn conversations.
  const ctx = useConversationContext(trace.conversationId, trace.traceId);
  const hasConversation = !!trace.conversationId && (ctx.isLoading || ctx.total > 1);
  const ctxState = paneState.conversationContext;
  const detailState = paneState.spanDetail;

  const ctxPanelRef = useRef<ImperativePanelHandle>(null);
  const detailPanelRef = useRef<ImperativePanelHandle>(null);
  const ctxBodyGroupRef = useRef<HTMLDivElement>(null);
  const ctxContentRef = useRef<HTMLDivElement>(null);
  const ctxHeaderRef = useRef<HTMLDivElement>(null);

  // Mouse-capture leak guard. If the operator drags a resize handle off the browser
  // window and releases the mouse out there, the pointerup never fires inside the
  // document and react-resizable- panels' internal drag state stays "active".
  useEffect(() => listenForOffWindowDragEnd(), []);
  // Cache the last-known expanded content height so collapsing doesn't
  // immediately collapse `ctxMaxSize` to the header height (which would
  // make the next expand land on a hairline-thin pane).
  const lastExpandedContentPx = useRef<number | null>(null);

  // Ctx Panel collapsed size has to equal the ContextHeader pixel height so the
  // collapsed strip sits flush with the body Panel — no trailing empty band beneath the
  // chevron. Same pattern as detailCollapsedSize.
  const [ctxCollapsedSize, setCtxCollapsedSize] = useState<number>(6);
  const [ctxMaxSize, setCtxMaxSize] = useState<number>(45);
  useEffect(
    () =>
      observeCtxPaneSizing({
        collapsed: ctxState.collapsed,
        ctxBodyGroupRef,
        ctxContentRef,
        ctxHeaderRef,
        lastExpandedContentPx,
        setCtxCollapsedSize,
        setCtxMaxSize,
      }),
    [hasConversation, ctxState.collapsed],
  );

  // The Details panel's collapsed size has to equal the SpanTabBar's pixel height in
  // vertical layout so collapsing leaves the tab row flush at the drawer bottom — no
  // trailing empty band.
  const vizDetailGroupRef = useRef<HTMLDivElement>(null);
  const [detailCollapsedSize, setDetailCollapsedSize] = useState<number>(6);
  const [detailMinSize, setDetailMinSize] = useState<number>(20);
  useEffect(
    () =>
      observeDetailPaneSizing({
        layout,
        setDetailCollapsedSize,
        setDetailMinSize,
        vizDetailGroupRef,
      }),
    [layout],
  );

  // Whenever the measured `ctxMaxSize` shrinks below the Panel's current size, clamp it down.
  // react-resizable-panels' `maxSize` prop is enforced on drag but not always on rehydration /
  // dynamic prop change, so this makes the cap stick.
  useEffect(() => {
    clampCtxPaneToMax({ collapsed: ctxState.collapsed, ctxMaxSize, ctxPanelRef });
  }, [ctxMaxSize, ctxState.collapsed]);

  useEffect(() => {
    syncCtxPaneCollapse({
      collapsed: ctxState.collapsed,
      ctxBodyGroupRef,
      ctxContentRef,
      ctxHeaderRef,
      ctxPanelRef,
    });
  }, [ctxState.collapsed]);
  // Remember the user's manually-resized detail size so re-opening
  // after a "Hide details" round-trip lands back at the same width
  // instead of `handle.expand()`'s library default (which could blow
  // the panel up to 60–70% on wide screens).
  const lastExpandedDetailSize = useRef<number | null>(null);
  // Drive the library state from the store, defensively.
  useEffect(() => {
    syncDetailPaneCollapse({
      collapsed: detailState.collapsed,
      detailMinSize,
      detailPanelRef,
      lastExpandedDetailSize,
      layout,
    });
  }, [detailState.collapsed, layout, detailMinSize]);

  // No outer `<Pane>` wrapper — the header lives inside
  // `<ConversationContext>` so the operator sees a single labelled
  // strip (matching the Section style elsewhere in the drawer) instead
  // of two stacked "CONVERSATION CONTEXT" headers.
  const ctxPane = hasConversation ? (
    <IsolatedErrorBoundary
      scope="Couldn't render conversation context"
      resetKeys={[trace.conversationId ?? "", trace.traceId]}
    >
      <ConversationContext
        conversationId={trace.conversationId!}
        traceId={trace.traceId}
        collapsed={ctxState.collapsed}
        onToggleCollapsed={() => togglePaneCollapsed("conversationContext")}
        contentRef={ctxContentRef}
        headerRef={ctxHeaderRef}
      />
    </IsolatedErrorBoundary>
  ) : null;

  const vizDetailGroup = (
    <VizDetailGroup
      detailCollapsedSize={detailCollapsedSize}
      detailMinSize={detailMinSize}
      detailPanelRef={detailPanelRef}
      isSpansLoading={isSpansLoading}
      layout={layout}
      onClearSpan={clearSpan}
      onSelectSpan={selectSpan}
      onTogglePaneCollapsed={togglePaneCollapsed}
      onVizTabChange={setVizTab}
      selectedSpan={selectedSpan}
      selectedSpanId={selectedSpanId}
      spans={spans}
      trace={trace}
      vizDetailGroupRef={vizDetailGroupRef}
      vizTab={vizTab}
    />
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
      <Box ref={ctxBodyGroupRef} style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex" }}>
        <PanelGroup
          direction="vertical"
          autoSaveId={`${PANE_GROUP_STORAGE_PREFIX}:ctx-body:v`}
          style={{ flex: 1, minHeight: 0, minWidth: 0 }}
        >
          <Panel
            ref={ctxPanelRef}
            id="ctx"
            order={1}
            defaultSize={ctxState.collapsed ? ctxCollapsedSize : ctxMaxSize}
            // `minSize` is the floor in the EXPANDED state.
            minSize={Math.max(ctxCollapsedSize + 4, 12)}
            maxSize={ctxMaxSize}
            collapsible
            collapsedSize={ctxCollapsedSize}
            // Library-driven collapse/expand fires when the operator drags the divider
            // across the `collapsedSize` threshold.
            onCollapse={() => {
              const { collapsed } = useDrawerStore.getState().paneState.conversationContext;
              if (!collapsed) togglePaneCollapsed("conversationContext");
            }}
            onExpand={() => {
              const { collapsed } = useDrawerStore.getState().paneState.conversationContext;
              if (collapsed) togglePaneCollapsed("conversationContext");
            }}
          >
            {ctxPane}
          </Panel>
          <PanelResizeHandle hitAreaMargins={{ coarse: 15, fine: 8 }}>
            <PaneResizeBar orientation="vertical" />
          </PanelResizeHandle>
          <Panel id="body" order={2} defaultSize={82} minSize={20}>
            {vizDetailGroup}
          </Panel>
        </PanelGroup>
      </Box>
    </Flex>
  );
}

/**
 * The visible separator between two panels AND the drag hit zone in a single element — no
 * pseudo-elements, no nested layers.
 */
function PaneResizeBar({ orientation }: { orientation: DrawerLayout }) {
  const isHorizontal = orientation === "horizontal";
  return (
    // Single 1px element that IS the visible separator — cheaper and more reliable than a
    // 0-area parent with a sub-pixel absolutely-positioned child, which rounded to 0px in some
    // browsers, making the separator disappear in spots.
    <Box
      width={isHorizontal ? "1px" : "100%"}
      height={isHorizontal ? "100%" : "1px"}
      flexShrink={0}
      // Default visible separator tone. Lit blue via the library-set
      // `[data-resize-handle-state]` attribute (values: `hover` /
      // `drag` / `inactive`) on the parent handle div — gives the
      // user the same "this is grabbable" affordance as the waterfall
      // chart.
      bg={{ base: "gray.200", _dark: "border.muted" }}
      transition="background 100ms ease"
      css={{
        "[data-resize-handle-state='hover'] &, [data-resize-handle-state='drag'] &": {
          background: "var(--chakra-colors-blue-solid)",
        },
      }}
    />
  );
}

type PanelRef = React.RefObject<ImperativePanelHandle | null>;
type ElementRef = React.RefObject<HTMLDivElement | null>;

/**
 * Mouse-capture leak guard. When a resize handle is dragged off the browser
 * window and released out there, the pointerup never fires inside the document
 * and react-resizable-panels' internal drag state stays "active".
 */
function listenForOffWindowDragEnd(): () => void {
  const flushDrag = () => {
    try {
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    } catch {
      // Older browsers without the PointerEvent constructor — mouseup alone is
      // enough for the legacy mousemove/mouseup listeners.
    }
  };
  const onFocus = () => flushDrag();
  const onMouseEnter = (e: MouseEvent) => {
    // The pointer came back into the document with no buttons held, so any
    // drag that was open must have ended off-window.
    if (e.buttons === 0) flushDrag();
  };
  window.addEventListener("focus", onFocus);
  document.addEventListener("mouseenter", onMouseEnter);
  return () => {
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("mouseenter", onMouseEnter);
  };
}

/** The context pane's header height and its content height, in pixels. */
function ctxPaneHeights({
  ctxContentRef,
  ctxHeaderRef,
}: {
  ctxContentRef: ElementRef;
  ctxHeaderRef: ElementRef;
}): { headerPx: number; bodyPx: number; fullPx: number } {
  // The rendered header height comes from the runtime DOM rather than a guessed
  // constant, so density and font changes flow through on their own.
  const headerPx = ctxHeaderRef.current?.offsetHeight ?? CTX_HEADER_HEIGHT_PX;
  // `contentRef` is on a naturally-sized wrapper INSIDE the scroll container, so
  // `scrollHeight` is the rows' own height — independent of the Panel's current
  // pixel height, which is what stops the slow-drag feedback loop.
  const bodyPx = ctxContentRef.current?.scrollHeight ?? 0;
  return {
    headerPx,
    bodyPx,
    fullPx: bodyPx > 0 ? headerPx + CTX_SCROLL_VPAD_PX + bodyPx : headerPx,
  };
}

/**
 * Keeps the context pane's collapsed size flush with its header and its maximum
 * no taller than the conversation actually is, remeasuring on every resize.
 */
function observeCtxPaneSizing({
  collapsed,
  ctxBodyGroupRef,
  ctxContentRef,
  ctxHeaderRef,
  lastExpandedContentPx,
  setCtxCollapsedSize,
  setCtxMaxSize,
}: {
  collapsed: boolean;
  ctxBodyGroupRef: ElementRef;
  ctxContentRef: ElementRef;
  ctxHeaderRef: ElementRef;
  lastExpandedContentPx: { current: number | null };
  setCtxCollapsedSize: (size: number) => void;
  setCtxMaxSize: (size: number) => void;
}): (() => void) | undefined {
  const groupEl = ctxBodyGroupRef.current;
  if (!groupEl) return undefined;

  const measure = () => {
    const dim = groupEl.clientHeight;
    if (dim <= 0) return;
    const { bodyPx, fullPx, headerPx } = ctxPaneHeights({ ctxContentRef, ctxHeaderRef });
    if (!collapsed && bodyPx > 0) lastExpandedContentPx.current = fullPx;
    const effectivePx = lastExpandedContentPx.current ?? fullPx;

    const headerPct = (headerPx / dim) * 100;
    setCtxCollapsedSize(Math.min(20, Math.max(1, headerPct)));

    // +6px so the bottom row's border isn't visually clipped at the max drag
    // position. Capped pixel-wise first — even a long conversation shouldn't eat
    // the whole drawer — then converted to a percentage. The lower bound keeps a
    // single placeholder turn opening to a visible strip.
    const cappedPx = Math.min(effectivePx + 6, CTX_MAX_HEIGHT_PX);
    setCtxMaxSize(Math.max(headerPct + 12, (cappedPx / dim) * 100));
  };

  measure();
  const observers = [groupEl, ctxContentRef.current, ctxHeaderRef.current]
    .filter((el): el is HTMLDivElement => el !== null)
    .map((el) => {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return observer;
    });
  return () => {
    for (const observer of observers) observer.disconnect();
  };
}

/**
 * The details pane's collapsed size equals the SpanTabBar's height in vertical
 * layout, so collapsing leaves the tab row flush at the drawer bottom. In a
 * horizontal split it collapses away entirely and takes a pixel floor instead,
 * converted to the percentage `minSize` the library wants.
 */
function observeDetailPaneSizing({
  layout,
  setDetailCollapsedSize,
  setDetailMinSize,
  vizDetailGroupRef,
}: {
  layout: DrawerLayout;
  setDetailCollapsedSize: (size: number) => void;
  setDetailMinSize: (size: number) => void;
  vizDetailGroupRef: ElementRef;
}): (() => void) | undefined {
  const el = vizDetailGroupRef.current;
  if (!el) return undefined;

  const measureHorizontal = () => {
    // Fully hidden on collapse — the reopen affordance lives in the viz panel's
    // tab row (see VizPlaceholder).
    setDetailCollapsedSize(0);
    const width = el.clientWidth;
    if (width <= 0) return;
    // Capped at 50% so a very narrow drawer can still split.
    setDetailMinSize(Math.min(50, Math.max(5, (DETAIL_MIN_HORIZONTAL_PX / width) * 100)));
  };

  const measureVertical = () => {
    const dim = el.clientHeight;
    if (dim <= 0) return;
    setDetailCollapsedSize(Math.min(50, Math.max(1, (SPAN_TAB_BAR_HEIGHT_PX / dim) * 100)));
    // No pixel floor in vertical layout — the panel always spans the drawer's
    // full width.
    setDetailMinSize(5);
  };

  const measure = () => (layout === "horizontal" ? measureHorizontal() : measureVertical());
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(el);
  return () => observer.disconnect();
}

/**
 * react-resizable-panels enforces `maxSize` on drag but not always on
 * rehydration or a dynamic prop change, so the cap is reapplied here.
 */
function clampCtxPaneToMax({
  collapsed,
  ctxMaxSize,
  ctxPanelRef,
}: {
  collapsed: boolean;
  ctxMaxSize: number;
  ctxPanelRef: PanelRef;
}): void {
  const handle = ctxPanelRef.current;
  if (!handle || collapsed) return;
  if (handle.getSize() > ctxMaxSize + 0.5) handle.resize(ctxMaxSize);
}

/**
 * Grows a freshly-expanded context pane to the height its content wants, over a
 * few frames while layout settles. It only ever grows: a later frame measuring
 * smaller leaves the pane where it is rather than yanking it down on the reader.
 */
function snapCtxPaneToContent({
  attempt,
  ctxBodyGroupRef,
  ctxContentRef,
  ctxHeaderRef,
  ctxPanelRef,
}: {
  attempt: number;
  ctxBodyGroupRef: ElementRef;
  ctxContentRef: ElementRef;
  ctxHeaderRef: ElementRef;
  ctxPanelRef: PanelRef;
}): void {
  const handle = ctxPanelRef.current;
  const groupEl = ctxBodyGroupRef.current;
  if (!handle || handle.isCollapsed() || !groupEl) return;
  const dim = groupEl.clientHeight;
  if (dim <= 0) return;

  const { bodyPx, headerPx } = ctxPaneHeights({ ctxContentRef, ctxHeaderRef });
  const fullPx = bodyPx > 0 ? headerPx + CTX_SCROLL_VPAD_PX + bodyPx + 6 : headerPx;
  // Pixel ceiling on first open even for long conversations; the reader can
  // still drag larger, up to ctxMaxSize.
  const cappedPx = Math.min(fullPx, CTX_MAX_HEIGHT_PX);
  const headerPct = (headerPx / dim) * 100;
  const targetPct = Math.max(headerPct + 12, (cappedPx / dim) * 100);
  if (targetPct > handle.getSize() + 0.5) handle.resize(targetPct);
  if (attempt < 3) {
    requestAnimationFrame(() =>
      snapCtxPaneToContent({
        attempt: attempt + 1,
        ctxBodyGroupRef,
        ctxContentRef,
        ctxHeaderRef,
        ctxPanelRef,
      }),
    );
  }
}

/** Drives the library's own collapsed state from the store's. */
function syncCtxPaneCollapse({
  collapsed,
  ctxBodyGroupRef,
  ctxContentRef,
  ctxHeaderRef,
  ctxPanelRef,
}: {
  collapsed: boolean;
  ctxBodyGroupRef: ElementRef;
  ctxContentRef: ElementRef;
  ctxHeaderRef: ElementRef;
  ctxPanelRef: PanelRef;
}): void {
  const handle = ctxPanelRef.current;
  if (!handle) return;
  if (collapsed) {
    if (!handle.isCollapsed()) handle.collapse();
    return;
  }
  if (!handle.isCollapsed()) return;
  handle.expand();
  requestAnimationFrame(() =>
    snapCtxPaneToContent({
      attempt: 0,
      ctxBodyGroupRef,
      ctxContentRef,
      ctxHeaderRef,
      ctxPanelRef,
    }),
  );
}

/**
 * Drives the details panel from the store, defensively: the library's own
 * `isCollapsed()` is unreliable after a drag, so the size is the check that is
 * trusted. Re-opening lands back on the reader's last manual size rather than
 * the library default, which could blow the panel up to 60-70% on wide screens.
 */
function syncDetailPaneCollapse({
  collapsed,
  detailMinSize,
  detailPanelRef,
  lastExpandedDetailSize,
  layout,
}: {
  collapsed: boolean;
  detailMinSize: number;
  detailPanelRef: PanelRef;
  lastExpandedDetailSize: { current: number | null };
  layout: DrawerLayout;
}): void {
  const handle = detailPanelRef.current;
  if (!handle) return;
  const current = handle.getSize();
  if (collapsed) {
    if (current > detailMinSize + 0.5) lastExpandedDetailSize.current = current;
    if (current > detailMinSize + 0.5 || !handle.isCollapsed()) handle.collapse();
    return;
  }
  const target = lastExpandedDetailSize.current ?? (layout === "horizontal" ? 45 : 50);
  if (current <= detailMinSize + 0.5 || handle.isCollapsed()) handle.resize(target);
}

/**
 * The visualisation panel and, when a span is selected, the details panel beside
 * or below it with a resize handle between. With no selection the same
 * VizPlaceholder fills the group, so its scrolling, height and tab strip behave
 * identically either way.
 */
function VizDetailGroup({
  detailCollapsedSize,
  detailMinSize,
  detailPanelRef,
  isSpansLoading,
  layout,
  onClearSpan,
  onSelectSpan,
  onTogglePaneCollapsed,
  onVizTabChange,
  selectedSpan,
  selectedSpanId,
  spans,
  trace,
  vizDetailGroupRef,
  vizTab,
}: {
  detailCollapsedSize: number;
  detailMinSize: number;
  detailPanelRef: PanelRef;
  isSpansLoading: boolean;
  layout: DrawerLayout;
  onClearSpan: () => void;
  onSelectSpan: (spanId: string) => void;
  onTogglePaneCollapsed: ReturnType<typeof useDrawerStore.getState>["togglePaneCollapsed"];
  onVizTabChange: ReturnType<typeof useDrawerStore.getState>["setVizTab"];
  selectedSpan: SpanTreeNode | null;
  selectedSpanId: string | null;
  spans: SpanTreeNode[];
  trace: TraceHeader;
  vizDetailGroupRef: ElementRef;
  vizTab: ReturnType<typeof useDrawerStore.getState>["vizTab"];
}) {
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
      // No edge border here — the visible 1px separator lives in PaneResizeBar so the
      // hover-to-blue affordance can paint over the entire separator without being
      // obscured by an underlying panel border.
      bg={{ base: "bg.surface", _dark: "bg.panel" }}
    >
      <IsolatedErrorBoundary
        scope="Couldn't render visualisation"
        resetKeys={[trace.traceId, vizTab]}
      >
        <VizPlaceholder
          vizTab={vizTab}
          onVizTabChange={onVizTabChange}
          trace={trace}
          spans={spans}
          isLoading={isSpansLoading}
          selectedSpanId={selectedSpanId}
          onSelectSpan={onSelectSpan}
          onClearSpan={onClearSpan}
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
      isSpansLoading={isSpansLoading}
    />
  );

  const vizDetailGroupId =
    layout === "horizontal"
      ? `${PANE_GROUP_STORAGE_PREFIX}:viz-detail:h`
      : `${PANE_GROUP_STORAGE_PREFIX}:viz-detail:v`;

  // `width/height: 100%` instead of `flex: 1` — react-resizable-panels' `Panel` renders
  // as `<div style="flex: <size> 1 0px">` with no `display: flex`, so a `flex: 1` child
  // collapses to 0 height inside the body Panel of the ctx-body group.
  const hasSpanSelection = selectedSpanId != null;
  return (
    <Box
      ref={vizDetailGroupRef}
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        minWidth: 0,
        display: "flex",
      }}
    >
      {hasSpanSelection ? (
        <PanelGroup
          direction={layout === "horizontal" ? "horizontal" : "vertical"}
          autoSaveId={vizDetailGroupId}
          style={{ flex: 1, minHeight: 0, minWidth: 0 }}
        >
          <Panel id="viz" order={1} defaultSize={layout === "horizontal" ? 55 : 50} minSize={15}>
            {vizPanel}
          </Panel>
          <PanelResizeHandle
            // `hitAreaMargins` extends the library's own pointer hit-area (and cursor
            // coverage) past the visible handle.
            hitAreaMargins={{ coarse: 15, fine: 8 }}
          >
            <PaneResizeBar orientation={layout} />
          </PanelResizeHandle>
          <Panel
            ref={detailPanelRef}
            id="detail"
            order={2}
            defaultSize={layout === "horizontal" ? 45 : 50}
            // Horizontal split: 200px pixel floor converted to a
            // percentage of the current group width (see the measure
            // effect). Vertical split: nominal 5pct minimum.
            minSize={detailMinSize}
            collapsible
            // Computed from the group's measured size so the collapsed
            // state lands exactly on the SpanTabBar height — no trailing
            // empty band below the tab row.
            collapsedSize={detailCollapsedSize}
            // Library-driven collapse/expand mirrors the store so a drag past `minSize`
            // is the SAME state as clicking the "Hide details" button: the pane
            // disappears AND the "Show details" affordance on the viz tab row appears.
            onCollapse={() => {
              const { collapsed } = useDrawerStore.getState().paneState.spanDetail;
              if (!collapsed) onTogglePaneCollapsed("spanDetail");
            }}
            onExpand={() => {
              const { collapsed } = useDrawerStore.getState().paneState.spanDetail;
              if (collapsed) onTogglePaneCollapsed("spanDetail");
            }}
          >
            {detailPanel}
          </Panel>
        </PanelGroup>
      ) : (
        // No selection — full-width viz. We render the same VizPlaceholder
        // (just without a sibling resize handle) so its internal scroll /
        // height / tab strip behave identically.
        <Box style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex" }}>{vizPanel}</Box>
      )}
    </Box>
  );
}

import { Box, Flex } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import {
  type ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import { IsolatedErrorBoundary } from "../../../isolated-error-boundary";
import type { SpanTreeNode, TraceHeader } from "@langwatch/trace-contract";
import { useConversationContext } from "../../hooks/use-conversation-context";
import { useDrawerStore } from "../../../../../index";
import { ConversationContext } from "../conversation-context";
import { VizPlaceholder } from "../viz-placeholder";
import { SpanDetailPane } from "./span-detail-pane";
import type { DrawerLayout } from "./use-pane-layout";

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
  useEffect(() => {
    const flushDrag = () => {
      try {
        window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
        window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
      } catch {
        // Older browsers without PointerEvent ctor — mouseup alone
        // is enough for the legacy mousemove/mouseup listeners.
      }
    };
    const onFocus = () => flushDrag();
    const onMouseEnter = (e: MouseEvent) => {
      // Pointer came back into the document with no buttons held —
      // any drag that was open must have ended off-window.
      if (e.buttons === 0) flushDrag();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("mouseenter", onMouseEnter);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("mouseenter", onMouseEnter);
    };
  }, []);
  // Cache the last-known expanded content height so collapsing doesn't
  // immediately collapse `ctxMaxSize` to the header height (which would
  // make the next expand land on a hairline-thin pane).
  const lastExpandedContentPx = useRef<number | null>(null);

  // Ctx Panel collapsed size has to equal the ContextHeader pixel height so the
  // collapsed strip sits flush with the body Panel — no trailing empty band beneath the
  // chevron. Same pattern as detailCollapsedSize.
  const [ctxCollapsedSize, setCtxCollapsedSize] = useState<number>(6);
  const [ctxMaxSize, setCtxMaxSize] = useState<number>(45);
  useEffect(() => {
    const groupEl = ctxBodyGroupRef.current;
    if (!groupEl) return;
    const measure = () => {
      const dim = groupEl.clientHeight;
      if (dim <= 0) return;
      const headerEl = ctxHeaderRef.current;
      const contentEl = ctxContentRef.current;
      // Actual rendered header height — uses the runtime DOM rather
      // than a guessed pixel constant, so density / font changes flow
      // through automatically.
      const headerPx = headerEl?.offsetHeight ?? CTX_HEADER_HEIGHT_PX;
      // `contentRef` is on a naturally-sized wrapper INSIDE the scroll container.
      // `scrollHeight` is the rows' actual height — independent of the Panel's current
      // pixel height, which is what stops the slow-drag feedback loop.
      const bodyPx = contentEl?.scrollHeight ?? 0;
      const fullPx = bodyPx > 0 ? headerPx + CTX_SCROLL_VPAD_PX + bodyPx : headerPx;
      if (!ctxState.collapsed && bodyPx > 0) {
        lastExpandedContentPx.current = fullPx;
      }
      const effectivePx = lastExpandedContentPx.current ?? fullPx;

      const headerPct = (headerPx / dim) * 100;
      setCtxCollapsedSize(Math.min(20, Math.max(1, headerPct)));

      // +6px so the bottom row's border isn't visually clipped at the
      // max drag position. Cap pixel-wise first (operator spec — even
      // a long conversation shouldn't eat the whole drawer), then
      // convert to a percentage.
      const cappedPx = Math.min(effectivePx + 6, CTX_MAX_HEIGHT_PX);
      const naturalPct = (cappedPx / dim) * 100;
      // Lower bound — at least 12pct above header so a single
      // placeholder turn still opens to a visible strip.
      setCtxMaxSize(Math.max(headerPct + 12, naturalPct));
    };
    measure();
    const groupObserver = new ResizeObserver(measure);
    groupObserver.observe(groupEl);
    let contentObserver: ResizeObserver | null = null;
    let headerObserver: ResizeObserver | null = null;
    if (ctxContentRef.current) {
      contentObserver = new ResizeObserver(measure);
      contentObserver.observe(ctxContentRef.current);
    }
    if (ctxHeaderRef.current) {
      headerObserver = new ResizeObserver(measure);
      headerObserver.observe(ctxHeaderRef.current);
    }
    return () => {
      groupObserver.disconnect();
      contentObserver?.disconnect();
      headerObserver?.disconnect();
    };
  }, [hasConversation, ctxState.collapsed]);

  // The Details panel's collapsed size has to equal the SpanTabBar's pixel height in
  // vertical layout so collapsing leaves the tab row flush at the drawer bottom — no
  // trailing empty band.
  const vizDetailGroupRef = useRef<HTMLDivElement>(null);
  const [detailCollapsedSize, setDetailCollapsedSize] = useState<number>(6);
  // In horizontal split, the detail panel has a pixel floor — `minSize` is a percentage
  // in react-resizable-panels, so we measure the group's current width and convert.
  const DETAIL_MIN_HORIZONTAL_PX = 200;
  const [detailMinSize, setDetailMinSize] = useState<number>(20);
  useEffect(() => {
    const el = vizDetailGroupRef.current;
    if (!el) return;
    const measure = () => {
      if (layout === "horizontal") {
        // Fully hide on collapse — the reopen affordance lives in
        // the viz panel's tab row (see VizPlaceholder).
        setDetailCollapsedSize(0);
        const width = el.clientWidth;
        if (width <= 0) return;
        const pct = (DETAIL_MIN_HORIZONTAL_PX / width) * 100;
        // Cap at 50% so a very narrow drawer can still split.
        setDetailMinSize(Math.min(50, Math.max(5, pct)));
        return;
      }
      const dim = el.clientHeight;
      if (dim <= 0) return;
      const pct = (SPAN_TAB_BAR_HEIGHT_PX / dim) * 100;
      setDetailCollapsedSize(Math.min(50, Math.max(1, pct)));
      // No pixel floor in vertical layout — the panel always spans
      // the drawer's full width.
      setDetailMinSize(5);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [layout]);

  // Whenever the measured `ctxMaxSize` shrinks below the Panel's current size — e.g., content got shorter, or the persisted autoSaveId
  // restored a value from a wider state — clamp the Panel down. react-resizable-panels' `maxSize` prop is enforced on drag but not always
  // on rehydration / dynamic prop change, so this makes the cap stick.
  useEffect(() => {
    const handle = ctxPanelRef.current;
    if (!handle) return;
    if (ctxState.collapsed) return;
    const current = handle.getSize();
    if (current > ctxMaxSize + 0.5) {
      handle.resize(ctxMaxSize);
    }
  }, [ctxMaxSize, ctxState.collapsed]);

  useEffect(() => {
    const handle = ctxPanelRef.current;
    if (!handle) return;
    if (ctxState.collapsed && !handle.isCollapsed()) {
      handle.collapse();
      return;
    }
    if (!ctxState.collapsed && handle.isCollapsed()) {
      handle.expand();
      // After expanding, snap to the actual content height.
      const snap = (attempt: number) => {
        const h = ctxPanelRef.current;
        if (!h || h.isCollapsed()) return;
        const groupEl = ctxBodyGroupRef.current;
        const contentEl = ctxContentRef.current;
        const headerEl = ctxHeaderRef.current;
        if (!groupEl) return;
        const dim = groupEl.clientHeight;
        if (dim <= 0) return;
        const headerPx = headerEl?.offsetHeight ?? CTX_HEADER_HEIGHT_PX;
        const bodyPx = contentEl?.scrollHeight ?? 0;
        const fullPx = bodyPx > 0 ? headerPx + CTX_SCROLL_VPAD_PX + bodyPx + 6 : headerPx;
        // Pixel ceiling on first-open even for long conversations;
        // the operator can still drag larger up to ctxMaxSize.
        const cappedPx = Math.min(fullPx, CTX_MAX_HEIGHT_PX);
        const headerPct = (headerPx / dim) * 100;
        const targetPct = Math.max(headerPct + 12, (cappedPx / dim) * 100);
        const currentPct = h.getSize();
        // Only grow — if a later rAF measures smaller (e.g., layout
        // settled into a slimmer state) leave the pane where it is
        // rather than yanking it down on the user.
        if (targetPct > currentPct + 0.5) h.resize(targetPct);
        if (attempt < 3) {
          requestAnimationFrame(() => snap(attempt + 1));
        }
      };
      requestAnimationFrame(() => snap(0));
    }
  }, [ctxState.collapsed]);
  // Remember the user's manually-resized detail size so re-opening
  // after a "Hide details" round-trip lands back at the same width
  // instead of `handle.expand()`'s library default (which could blow
  // the panel up to 60–70% on wide screens).
  const lastExpandedDetailSize = useRef<number | null>(null);
  // Drive the library state from the store, defensively.
  useEffect(() => {
    const handle = detailPanelRef.current;
    if (!handle) return;
    if (detailState.collapsed) {
      const current = handle.getSize();
      if (current > detailMinSize + 0.5) {
        lastExpandedDetailSize.current = current;
        handle.collapse();
      } else if (!handle.isCollapsed()) {
        // Already at collapsedSize but library doesn't think so —
        // force the flag to align.
        handle.collapse();
      }
      return;
    }
    const target = lastExpandedDetailSize.current ?? (layout === "horizontal" ? 45 : 50);
    const current = handle.getSize();
    // Below the min floor → panel was collapsed-or-near-it, expand.
    // Library's own `isCollapsed()` is unreliable post-drag, so size
    // is the trustworthy check.
    if (current <= detailMinSize + 0.5 || handle.isCollapsed()) {
      handle.resize(target);
    }
  }, [detailState.collapsed, layout, detailMinSize]);

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
          onVizTabChange={setVizTab}
          trace={trace}
          spans={spans}
          isLoading={isSpansLoading}
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
      isSpansLoading={isSpansLoading}
    />
  );

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

  const vizDetailGroupId =
    layout === "horizontal"
      ? `${PANE_GROUP_STORAGE_PREFIX}:viz-detail:h`
      : `${PANE_GROUP_STORAGE_PREFIX}:viz-detail:v`;

  // `width/height: 100%` instead of `flex: 1` — react-resizable-panels' `Panel` renders
  // as `<div style="flex: <size> 1 0px">` with no `display: flex`, so a `flex: 1` child
  // collapses to 0 height inside the body Panel of the ctx-body group.
  const hasSpanSelection = selectedSpanId != null;
  const vizDetailGroup = (
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
              if (!useDrawerStore.getState().paneState.spanDetail.collapsed) {
                togglePaneCollapsed("spanDetail");
              }
            }}
            onExpand={() => {
              if (useDrawerStore.getState().paneState.spanDetail.collapsed) {
                togglePaneCollapsed("spanDetail");
              }
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
              if (!useDrawerStore.getState().paneState.conversationContext.collapsed) {
                togglePaneCollapsed("conversationContext");
              }
            }}
            onExpand={() => {
              if (useDrawerStore.getState().paneState.conversationContext.collapsed) {
                togglePaneCollapsed("conversationContext");
              }
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
 * The visible separator between two panels AND the drag hit zone in a single element — no pseudo-elements, no nested layers.
 */
function PaneResizeBar({ orientation }: { orientation: DrawerLayout }) {
  const isHorizontal = orientation === "horizontal";
  return (
    // Single 1px element that IS the visible separator — claiming exactly 1px of layout space is cheaper and
    // more reliable than a 0-area parent with a sub-pixel absolutely-positioned child (which rounded to 0px in
    // some browsers, making the separator disappear in spots).
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

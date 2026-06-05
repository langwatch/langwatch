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
import { SpanDetailPane } from "./SpanDetailPane";
import type { DrawerLayout } from "./usePaneLayout";

interface PaneLayoutProps {
  trace: TraceHeader;
  spans: SpanTreeNode[];
  selectedSpan: SpanTreeNode | null;
  spansLoading: boolean;
  layout: DrawerLayout;
}

// Bump the version suffix when the panel layout's structure changes —
// react-resizable-panels persists sizes keyed on `autoSaveId`, and a
// stale snapshot from a previous structure can leave one Panel sized
// at 100% / another at 0%, which reads as "body content disappeared".
const PANE_GROUP_STORAGE_PREFIX =
  "langwatch:traces-v2:drawer-panel-sizes:v3";

// SpanTabBar minHeight. Keep in sync with SpanTabBar.tsx.
const SPAN_TAB_BAR_HEIGHT_PX = 38;

// Conversation Context header is one row of the accordion-density
// padding plus its borders. Used both to pin the collapsed Panel size
// to header height exactly (no trailing band) and as a sentinel
// minimum when content height measurement hasn't resolved yet.
// Kept in sync with `ContextHeader` paddingY in `ConversationContext.tsx`.
const CTX_HEADER_HEIGHT_PX = 36;

// `contentRef` is attached to the inner row-wrapper Box inside the
// scroll container (so `scrollHeight` doesn't get inflated by the
// container's clientHeight). The scroll container itself has a
// vertical paddingY={3} (6 * 2 = 24px) which the inner ref doesn't
// see — add it back here so the pane's natural height is
// `header + scroll-container-padding + content`.
const CTX_SCROLL_VPAD_PX = 24;

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

  // Conversation context pane slot is keyed on `conversationId` alone —
  // a stable boolean per trace. We do NOT gate the surrounding layout
  // structure on async `ctx.total`: flipping the top-level <PanelGroup>
  // mid-load unmounts the body group too, which loses viz / detail
  // sizes (some renders ended up blanking the body entirely).
  // Single-turn conversations are handled inside `ConversationContext`
  // by returning null; the Panel slot still exists, it just renders
  // nothing.
  const hasConversation = !!trace.conversationId;
  const ctxState = paneState.conversationContext;
  const detailState = paneState.spanDetail;

  const ctxPanelRef = useRef<ImperativePanelHandle>(null);
  const detailPanelRef = useRef<ImperativePanelHandle>(null);
  const ctxBodyGroupRef = useRef<HTMLDivElement>(null);
  const ctxContentRef = useRef<HTMLDivElement>(null);
  const ctxHeaderRef = useRef<HTMLButtonElement>(null);

  // Mouse-capture leak guard. If the operator drags a resize handle
  // off the browser window and releases the mouse out there, the
  // pointerup never fires inside the document and react-resizable-
  // panels' internal drag state stays "active". On return, the next
  // click on the "Show details" button (or any other sibling) is
  // intercepted by the still-tracking drag and looks dead. Synthesize
  // a window-level pointerup whenever we regain focus or detect
  // mouse movement with no buttons pressed — both signals mean any
  // drag should be over.
  useEffect(() => {
    const flushDrag = () => {
      try {
        window.dispatchEvent(
          new PointerEvent("pointerup", { bubbles: true, cancelable: true }),
        );
        window.dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
        );
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

  // Ctx Panel collapsed size has to equal the ContextHeader pixel height
  // so the collapsed strip sits flush with the body Panel — no trailing
  // empty band beneath the chevron. Same pattern as detailCollapsedSize.
  // Ctx Panel max size caps drag at the measured content height so the
  // user can't pull the divider down past the rows that exist
  // (operator feedback: "shouldn't be able to make it as tall as I want").
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
      // `contentRef` is on a naturally-sized wrapper INSIDE the
      // scroll container. `scrollHeight` is the rows' actual height
      // — independent of the Panel's current pixel height, which is
      // what stops the slow-drag feedback loop.
      // Total natural pane height = header + scroll-container padding
      // + content. When collapsed the body isn't rendered so we fall
      // back to the cached last-expanded value to keep the max-cap
      // stable across collapse/expand cycles.
      const bodyPx = contentEl?.scrollHeight ?? 0;
      const fullPx =
        bodyPx > 0 ? headerPx + CTX_SCROLL_VPAD_PX + bodyPx : headerPx;
      if (!ctxState.collapsed && bodyPx > 0) {
        lastExpandedContentPx.current = fullPx;
      }
      const effectivePx = lastExpandedContentPx.current ?? fullPx;

      const headerPct = (headerPx / dim) * 100;
      setCtxCollapsedSize(Math.min(20, Math.max(1, headerPct)));

      // +6px so the bottom row's border isn't visually clipped at the
      // max drag position. Cap pixel-wise at 350px first (operator
      // spec — even a long conversation shouldn't eat the whole
      // drawer), then convert to a percentage.
      const cappedPx = Math.min(effectivePx + 6, 350);
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

  // The Details panel's collapsed size has to equal the SpanTabBar's
  // pixel height in vertical layout so collapsing leaves the tab row
  // flush at the drawer bottom — no trailing empty band. In horizontal
  // layout the panel goes to 0 (fully hidden); a "Show details" button
  // in the viz panel's tab row re-exposes it. react-resizable-panels
  // only accepts percentages, so we measure the PanelGroup's actual
  // size along the relevant axis and convert.
  const vizDetailGroupRef = useRef<HTMLDivElement>(null);
  const [detailCollapsedSize, setDetailCollapsedSize] = useState<number>(6);
  // In horizontal split, the detail panel has a pixel floor — `minSize`
  // is a percentage in react-resizable-panels, so we measure the group's
  // current width and convert. 200px keeps the chip rows / accordion
  // sections legible even when the operator has yanked the divider as
  // far right as possible. Vertical split doesn't need a pixel floor —
  // there the panel always occupies the full drawer width.
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

  // Whenever the measured `ctxMaxSize` shrinks below the Panel's
  // current size — e.g., content got shorter, or the persisted
  // autoSaveId restored a value from a wider state — clamp the Panel
  // down. react-resizable-panels' `maxSize` prop is enforced on drag
  // but not always on rehydration / dynamic prop change, so this
  // makes the cap stick.
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
      // After expanding, snap to the actual content height. Layout
      // settles over multiple frames — especially when we got here
      // via a tab switch (the ConversationContext subtree was just
      // remounted), the first rAF can land on an intermediate size
      // where only some rows have laid out. We re-measure across a
      // few frames and bump the target up whenever the content turns
      // out taller than what we previously resized to.
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
        const fullPx =
          bodyPx > 0
            ? headerPx + CTX_SCROLL_VPAD_PX + bodyPx + 6
            : headerPx;
        // 350px ceiling on first-open even for long conversations;
        // the operator can still drag larger up to ctxMaxSize.
        const cappedPx = Math.min(fullPx, 350);
        const headerPct = (headerPx / dim) * 100;
        const targetPct = Math.max(
          headerPct + 12,
          (cappedPx / dim) * 100,
        );
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
  // Drive the library state from the store, defensively. Don't trust
  // `handle.isCollapsed()` as the only signal — after a drag-past-min
  // collapse the library can land in a hybrid state where the panel
  // size is at `collapsedSize` but `isCollapsed()` returns false (or
  // vice versa), and the next click on "Show details" then becomes
  // a no-op. Compare the pixel size too: anything below the expected
  // expanded floor is treated as "needs expanding".
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
    const target =
      lastExpandedDetailSize.current ??
      (layout === "horizontal" ? 45 : 50);
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
      // No edge border here — the visible 1px separator lives in
      // PaneResizeBar so the hover-to-blue affordance can paint over
      // the entire separator without being obscured by an underlying
      // panel border. Was: borderRightWidth/borderBottomWidth here
      // (the panel border doubled with the bar line under the old
      // overlay-based handle).
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
      spansLoading={spansLoading}
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

  // `width/height: 100%` instead of `flex: 1` — react-resizable-panels'
  // `Panel` renders as `<div style="flex: <size> 1 0px">` with no
  // `display: flex`, so a `flex: 1` child collapses to 0 height inside
  // the body Panel of the ctx-body group. Explicit 100% works in both
  // contexts (Flex parent in the no-ctx branch, plain Panel parent in
  // the ctx branch).
  // After the trace-view redesign the SpanDetail pane only mounts when
  // a span is selected. With no selection the waterfall takes the full
  // pane width — the user gets a clean, distraction-free trace view
  // until they ask for a specific span. Clicking any span flips
  // `selectedSpanId`, which re-mounts the PanelGroup with the detail
  // half attached. `react-resizable-panels` recreates its sizing state
  // on every children-shape change, so we vary `autoSaveId` between
  // the two shapes to keep saved sizes separate for each mode and
  // avoid silently inheriting widths from one into the other.
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
          <Panel
            id="viz"
            order={1}
            defaultSize={layout === "horizontal" ? 55 : 50}
            minSize={15}
          >
            {vizPanel}
          </Panel>
          <PanelResizeHandle
            // `hitAreaMargins` extends the library's own pointer
            // hit-area (and cursor coverage) past the visible handle.
            // Using the library's mechanism instead of our own overlay
            // ensures one cursor across the whole drag zone — our old
            // overlay used `col-resize`/`row-resize` while the library
            // forces `*{cursor: ew-resize !important}` globally inside
            // its hit area, which read as two different cursors in
            // adjacent slivers.
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
            // Library-driven collapse/expand mirrors the store so a
            // drag past `minSize` is the SAME state as clicking the
            // "Hide details" button: the pane disappears AND the
            // "Show details" affordance on the viz tab row appears.
            // Without these the chevron / button wouldn't show because
            // the store still thought the pane was expanded.
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
        <Box style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex" }}>
          {vizPanel}
        </Box>
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
      <Box
        ref={ctxBodyGroupRef}
        style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex" }}
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
            defaultSize={ctxState.collapsed ? ctxCollapsedSize : ctxMaxSize}
            // `minSize` is the floor in the EXPANDED state. Setting
            // it strictly above `collapsedSize` gives the library a
            // clean snap region — dragging into the gap between the
            // two snaps to collapsedSize (firing onCollapse), instead
            // of leaving the pane parked at some sub-header height
            // that the chevron can't reconcile.
            minSize={Math.max(ctxCollapsedSize + 4, 12)}
            maxSize={ctxMaxSize}
            collapsible
            collapsedSize={ctxCollapsedSize}
            // Library-driven collapse/expand fires when the operator
            // drags the divider across the `collapsedSize` threshold.
            // Without these the drag-to-resize gesture would update
            // the Panel's pixel size but leave the store stuck on the
            // pre-drag state — the chevron would say "open" while the
            // pane was collapsed, and the next chevron click would
            // appear to no-op (it's "already" in the state the store
            // thinks it should reach).
            onCollapse={() => {
              if (!useDrawerStore.getState().paneState.conversationContext
                .collapsed) {
                togglePaneCollapsed("conversationContext");
              }
            }}
            onExpand={() => {
              if (useDrawerStore.getState().paneState.conversationContext
                .collapsed) {
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
 * The visible separator between two panels AND the drag hit zone in a
 * single element — no pseudo-elements, no nested layers. The element
 * is the line: 1px wide (or tall) `border`, an outer transparent strip
 * that's wider so the cursor target is forgiving. Cursor lives on the
 * outer Box so there's exactly one "I'm a divider" hit reported by the
 * browser, no matter where the user lands inside the strip.
 */
/**
 * Visible 1px separator. The hit zone + cursor are handled by
 * `PanelResizeHandle` itself via `hitAreaMargins` — no transparent
 * overlay needed. The line lights up blue on hover/drag using the
 * library-set `data-resize-handle-state` attribute on the parent
 * (values: `hover` | `drag` | `inactive`), so the user gets a clear
 * "this is grabbable" affordance matching the waterfall surface.
 */
function PaneResizeBar({ orientation }: { orientation: DrawerLayout }) {
  const isHorizontal = orientation === "horizontal";
  return (
    // Single 1px element that IS the visible separator — claiming
    // exactly 1px of layout space is cheaper and more reliable than
    // a 0-area parent with a sub-pixel absolutely-positioned child
    // (which rounded to 0px in some browsers, making the separator
    // disappear in spots). The hit area is handled by the
    // PanelResizeHandle's `hitAreaMargins` — this Box only needs to
    // be a visible 1px line.
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
        "[data-resize-handle-state='hover'] &, [data-resize-handle-state='drag'] &":
          {
            background: "var(--chakra-colors-blue-solid)",
          },
      }}
    />
  );
}

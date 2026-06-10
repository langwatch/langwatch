import { Box, CodeBlock, Flex } from "@chakra-ui/react";
import { useRef } from "react";
import { useColorMode } from "~/components/ui/color-mode";
import { Drawer } from "~/components/ui/drawer";
import { IsolatedErrorBoundary } from "~/components/ui/IsolatedErrorBoundary";
import { PeerCursorOverlay } from "~/features/presence/components/PeerCursorOverlay";
import {
  DRAWER_DEFAULT_WIDTH_PX,
  DRAWER_MIN_WIDTH_PX,
  useDrawerStore,
} from "../../stores/drawerStore";
import { ConversationContext } from "./ConversationContext";
import { ConversationView } from "./conversationView";
import { DrawerHeader } from "./drawerHeader";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp";
import { useShikiAdapter } from "./markdownView/shikiAdapter";
import { PaneLayout } from "./panes/PaneLayout";
import { ResizeRail } from "./panes/ResizeRail";
import { usePaneLayout } from "./panes/usePaneLayout";
import { ScenarioRoleProvider } from "./scenarioRoles";
import { TraceDrawerEmptyState } from "./TraceDrawerEmptyState";
import { TraceDrawerSkeleton } from "./TraceDrawerSkeleton";
import { TraceAccordions } from "./traceAccordions";
import { useTraceDrawerScaffold } from "./useTraceDrawerScaffold";

export interface TraceV2DrawerShellProps {
  open?: boolean;
  onClose?: () => void;
  traceId?: string;
  span?: string;
  mode?: string;
  viz?: string;
  /**
   * Approximate trace timestamp (ms since epoch) — read by `useTraceHeader`
   * as a partition-pruning hint when refetching the heavy summary fields.
   * Optional; the bare `traceId` query path still works on cache miss.
   */
  t?: string;
}

export function TraceV2DrawerShell(_props: TraceV2DrawerShellProps) {
  const { colorMode } = useColorMode();
  // One Shiki adapter for the whole drawer. All `<RenderedMarkdown>`,
  // `<ShikiCodeBlock>`, and the JSON tokenizer consume this — without it,
  // each consumer span up its own highlighter (theme + lang JSON +
  // Oniguruma engine), which got expensive once the chunked LLM panel
  // and conversation markdown views started mounting many siblings.
  const shikiAdapter = useShikiAdapter(colorMode);

  const {
    traceId,
    trace,
    spanTree,
    selectedSpan,
    isLoading,
    headerQuery,
    spanTreeQuery,
    canGoBack,
    goBackInTraceHistory,
    handleClose,
    drawerContentRef,
  } = useTraceDrawerScaffold();

  const viewMode = useDrawerStore((s) => s.viewMode);
  const widthPx = useDrawerStore((s) => s.widthPx);
  const shortcutsOpen = useDrawerStore((s) => s.shortcutsOpen);
  const pinned = useDrawerStore((s) => s.pinned);
  const expectedSpanCount = useDrawerStore((s) => s.expectedSpanCount);
  const ctxPaneState = useDrawerStore((s) => s.paneState.conversationContext);
  const togglePaneCollapsed = useDrawerStore((s) => s.togglePaneCollapsed);
  const setShortcutsOpen = useDrawerStore((s) => s.setShortcutsOpen);

  // `open` is hardcoded `true` because the parent (`TracesPage`'s
  // `<TraceDrawerMount>`) only mounts this shell while the drawer
  // store holds a `traceId`. Click → store update → mount lands in
  // the same render; close → store clear → unmount. Wiring `open` to
  // anything reactive would just add a one-frame "open after the URL
  // resolves" beat on top of an already-instant mount.

  // Watch the actual rendered drawer body so the layout decision
  // reflects whatever pixel width the operator dragged the drawer to —
  // not the abstract widthPx state (which may be `null` when at the
  // default 45%).
  const paneContainerRef = useRef<HTMLDivElement>(null);
  const layout = usePaneLayout(paneContainerRef);

  // Error state: trace not found, network failure, or no selection. The
  // dedicated empty-state component differentiates 404 vs load-failed and
  // surfaces the trace ID + retry path.
  if (!isLoading && !trace) {
    return (
      <Drawer.Root
        open={true}
        placement="end"
        size="lg"
        onOpenChange={() => handleClose()}
      >
        <Drawer.Content bg="bg">
          <Drawer.Body padding={0}>
            <TraceDrawerEmptyState
              error={headerQuery.error}
              traceId={traceId}
              onClose={handleClose}
              onRetry={() => void headerQuery.refetch()}
              canGoBack={canGoBack}
              onGoBack={goBackInTraceHistory}
            />
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>
    );
  }

  // The drawer width is driven by the operator's drag (persisted in
  // drawerStore.widthPx). Until they drag, we use a flat
  // `DRAWER_DEFAULT_WIDTH_PX` (920) instead of the previous 45% rule
  // — a deterministic first-paint width that doesn't visibly shift
  // when the user later drags and the persisted px replaces the %.
  // Below the `md` breakpoint (~768px) the drawer goes full viewport
  // so the chrome stays usable on phones. We also cap any
  // persisted/default width against the current viewport so a width
  // remembered on a wide monitor never overflows a narrower window.
  const viewportWidth =
    typeof window !== "undefined" ? window.innerWidth : Infinity;
  const isCompactViewport = viewportWidth < 768;
  const effectiveWidthPx = Math.min(
    widthPx ?? DRAWER_DEFAULT_WIDTH_PX,
    viewportWidth,
  );
  const contentWidthStyle = isCompactViewport
    ? undefined
    : {
        width: `${effectiveWidthPx}px`,
        maxWidth: `${effectiveWidthPx}px`,
        minWidth: `${DRAWER_MIN_WIDTH_PX}px`,
      };

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="lg"
      // When unpinned, the drawer behaves as a standard modal — clicking
      // outside or pressing Esc dismisses it. When pinned (default), it
      // stays put so the operator can interact with the underlying page;
      // dismissal is via the X button, Esc, or the explicit double-click
      // gesture handled in the scaffold.
      modal={!pinned}
      closeOnInteractOutside={!pinned}
      onOpenChange={() => handleClose()}
    >
      <CodeBlock.AdapterProvider value={shikiAdapter}>
        <Drawer.Content
          // Transparent at the Content level so the header section
          // below can run its own translucent + backdrop-blur fill
          // (page content behind the drawer reads through blurred,
          // consistent with the rest of the site's translucent
          // chrome — see BelowFoldIndicator, sequence overlays).
          // The lower pane container has its own `bg.surface` white,
          // so only the header area is translucent — everything
          // below stays solid white.
          bg="transparent"
          ref={drawerContentRef}
          paddingX={0}
          // When `contentWidthStyle` is set (non-compact viewports) the
          // inline style below owns width/maxWidth. The fallback here
          // only matters on compact viewports (<md), where we want
          // the drawer full-bleed — the operator can't drag on a
          // phone-sized window anyway.
          maxWidth={contentWidthStyle ? undefined : "100vw"}
          width={contentWidthStyle ? undefined : "100vw"}
          // The ResizeRail renders the visible pill in a 10px gutter
          // *outside* the drawer's left edge. Allow horizontal overflow
          // so that bit isn't clipped; the body itself still clips its
          // own scroll content.
          overflow="visible"
          // Anchor for the empty-state onboarding tour: a global
          // CSS rule keyed off `body[data-traces-tour-stage]`
          // applies a soft blue glow to this element during
          // `drawerOverview` so the user knows where the tour copy
          // is pointing. No-op outside the onboarding journey.
          data-tour-target="drawer"
          style={contentWidthStyle}
        >
          <ResizeRail />
          <Drawer.Body
            paddingY={0}
            paddingX={0}
            // The drawer body NEVER scrolls — every section inside is
            // its own pane with its own scroll viewport. This is the
            // headline behaviour change in the DevTools-inspired
            // redesign: no more single drawer scroller chasing
            // sections up and down.
            overflow="hidden"
            // Clip the inner panel backgrounds (bg.surface in light
            // mode) to the drawer's rounded chrome. Without this the
            // white pane fills extend past the bottom-left corner of
            // the drawer since Drawer.Content runs with overflow:visible
            // (to let the ResizeRail pill escape the chrome).
            borderRadius="lg"
            display="flex"
            flexDirection="column"
            minHeight={0}
          >
            {isLoading || !trace ? (
              <TraceDrawerSkeleton
                onClose={handleClose}
                expectedSpanCount={expectedSpanCount}
              />
            ) : (
              <>
                <Box
                  flexShrink={0}
                  // Translucent fill + backdrop blur so the page behind
                  // the drawer reads through (same recipe used elsewhere
                  // for chrome — BelowFoldIndicator, sequence overlays,
                  // onboarding panels). The lower pane container keeps
                  // its solid `bg.surface` white, so only the header
                  // strip is translucent.
                  bg="bg.panel/70"
                  backdropFilter="blur(20px) saturate(150%)"
                >
                  <IsolatedErrorBoundary
                    scope="Couldn't render this trace's header"
                    resetKeys={[trace.traceId]}
                  >
                    <DrawerHeader trace={trace} onClose={handleClose} />
                  </IsolatedErrorBoundary>
                </Box>
                <Box borderBottomWidth="1px" borderColor="border" />
                {/*
                  Peer cursors render across the entire drawer body —
                  previously scoped to the viz pane only, which made
                  peers vanish whenever they hovered out of the
                  waterfall. The `anchor` keys the shared coordinate
                  space; everyone looking at the same trace's drawer
                  body shares one (0..1, 0..1) plane regardless of
                  which mode (trace / summary / conversation) they're
                  in. Mounting the overlay here also covers the
                  ConversationView + Summary surfaces without each
                  having to wrap themselves.
                */}
                <PeerCursorOverlay
                  anchor={`trace:${trace.traceId}:drawer`}
                  enabled
                  containerRef={paneContainerRef}
                >
                  {/*
                  `height="100%"` (not `flex={1}`) because PeerCursorOverlay
                  wraps its children in a `position: relative` Box that
                  isn't a flex container, so `flex: 1` is inert here — the
                  Flex would collapse to content height, which broke the
                  Summary tab's scroll (content overflowed the clipped
                  drawer body) and the Trace tab's PanelGroup (percentages
                  resolved against 0px → rendered empty).
                */}
                  <Flex
                    ref={paneContainerRef}
                    height="100%"
                    minHeight={0}
                    minWidth={0}
                    direction="column"
                    bg={{ base: "bg.surface", _dark: "bg.panel" }}
                  >
                    <ScenarioRoleProvider
                      isScenario={
                        !!(
                          trace.scenarioRunId ??
                          trace.attributes["scenario.run_id"]
                        )
                      }
                    >
                      {viewMode === "conversation" && trace.conversationId ? (
                        <IsolatedErrorBoundary
                          scope="Couldn't render conversation view"
                          resetKeys={[trace.conversationId, trace.traceId]}
                        >
                          <Box flex={1} minHeight={0} overflow="auto">
                            <ConversationView
                              conversationId={trace.conversationId}
                              currentTraceId={trace.traceId}
                            />
                          </Box>
                        </IsolatedErrorBoundary>
                      ) : viewMode === "summary" ? (
                        // Summary mode shows the same conversation-context
                        // strip the Trace view renders (via PaneLayout) so
                        // multi-turn context isn't lost when reading the
                        // summary. Same store-backed collapse state, so
                        // collapsing it in one view collapses it in both.
                        // Summary mode: render the trace-scope accordion stack
                        // full-bleed (I/O, metadata, evals, events, exceptions
                        // — whatever the current `TraceSummaryAccordions`
                        // composes for `activeTab="summary"`). Reuses the
                        // existing TraceAccordions surface so all the focus
                        // behaviour (header-chip jumps, exception pulses) keeps
                        // working without a parallel implementation.
                        <IsolatedErrorBoundary
                          scope="Couldn't render trace summary"
                          resetKeys={[trace.traceId]}
                        >
                          {trace.conversationId && (
                            <IsolatedErrorBoundary
                              scope="Couldn't render conversation context"
                              resetKeys={[trace.conversationId, trace.traceId]}
                            >
                              {/* ConversationContext's root is height=100%
                                  (sized by PaneLayout's resizable Panel in
                                  Trace view). Here it sits in a plain flex
                                  column, where 100% would claim the whole
                                  drawer and crush the accordions below —
                                  the wrapper gives it a natural-height,
                                  capped, scrollable slot instead. */}
                              <Box
                                flexShrink={0}
                                maxHeight="40%"
                                overflow="auto"
                              >
                                <ConversationContext
                                  conversationId={trace.conversationId}
                                  traceId={trace.traceId}
                                  collapsed={ctxPaneState.collapsed}
                                  onToggleCollapsed={() =>
                                    togglePaneCollapsed("conversationContext")
                                  }
                                />
                              </Box>
                            </IsolatedErrorBoundary>
                          )}
                          <Box flex={1} minHeight={0} overflow="auto">
                            <TraceAccordions
                              trace={trace}
                              spans={spanTree}
                              selectedSpan={null}
                              activeTab="summary"
                            />
                          </Box>
                        </IsolatedErrorBoundary>
                      ) : (
                        <PaneLayout
                          trace={trace}
                          spans={spanTree}
                          selectedSpan={selectedSpan}
                          isSpansLoading={spanTreeQuery.isLoading}
                          layout={layout}
                        />
                      )}
                    </ScenarioRoleProvider>
                  </Flex>
                </PeerCursorOverlay>
              </>
            )}
          </Drawer.Body>
        </Drawer.Content>
      </CodeBlock.AdapterProvider>
      <KeyboardShortcutsHelp
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </Drawer.Root>
  );
}

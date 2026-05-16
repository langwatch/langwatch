import { Box, CodeBlock, Flex } from "@chakra-ui/react";
import { useRef } from "react";
import { useColorMode } from "~/components/ui/color-mode";
import { Drawer } from "~/components/ui/drawer";
import { IsolatedErrorBoundary } from "~/components/ui/IsolatedErrorBoundary";
import { useDrawer } from "~/hooks/useDrawer";
import {
  DRAWER_MIN_WIDTH_PX,
  useDrawerStore,
} from "../../stores/drawerStore";
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
  const setShortcutsOpen = useDrawerStore((s) => s.setShortcutsOpen);

  // Drive `open` off the URL via `useDrawer().currentDrawer`. The
  // previous `open={true}` hardcode relied entirely on the parent
  // unmounting this shell when the URL stripped `drawer.open` — under
  // the Vite/React-Router compat layer that unmount sometimes lost the
  // race with Chakra's portal, leaving the drawer's DOM stranded after
  // the URL had already cleared. Reading the URL state directly means
  // the close button + Esc both trigger Chakra's own close animation
  // *and* the parent unmount, so the panel can't survive either path.
  const { currentDrawer } = useDrawer();
  const drawerOpen = currentDrawer === "traceV2Details";

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
        open={drawerOpen}
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
  // drawerStore.widthPx). When `null`, we fall back to the legacy 45%
  // viewport rule. Below the `md` breakpoint (~768px) there isn't
  // useful underlying surface to peek at — the drawer goes full
  // viewport so the chrome stays usable on phones. We also skip the
  // inline override if the persisted width is wider than the current
  // viewport, so a width remembered on a wide monitor never overflows
  // a narrower window.
  const viewportWidth =
    typeof window !== "undefined" ? window.innerWidth : Infinity;
  const isCompactViewport = viewportWidth < 768;
  const widthFitsViewport =
    widthPx !== null && widthPx <= viewportWidth;
  const contentWidthStyle =
    widthPx !== null && !isCompactViewport && widthFitsViewport
      ? {
          width: `${widthPx}px`,
          maxWidth: `${widthPx}px`,
          minWidth: `${DRAWER_MIN_WIDTH_PX}px`,
        }
      : undefined;

  return (
    <Drawer.Root
      open={drawerOpen}
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
          bg="bg"
          ref={drawerContentRef}
          paddingX={0}
          maxWidth={
            contentWidthStyle
              ? undefined
              : { base: "100vw", md: "45%" }
          }
          width={
            contentWidthStyle
              ? undefined
              : { base: "100vw", md: "auto" }
          }
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
              <TraceDrawerSkeleton onClose={handleClose} />
            ) : (
              <>
                <Box flexShrink={0}>
                  <IsolatedErrorBoundary
                    scope="Couldn't render this trace's header"
                    resetKeys={[trace.traceId]}
                  >
                    <DrawerHeader trace={trace} onClose={handleClose} />
                  </IsolatedErrorBoundary>
                </Box>
                <Box borderBottomWidth="1px" borderColor="border" />
                <Flex
                  ref={paneContainerRef}
                  flex={1}
                  minHeight={0}
                  minWidth={0}
                  direction="column"
                  bg={{ base: "bg.surface", _dark: "bg.panel" }}
                  opacity={headerQuery.isFetching ? 0.55 : 1}
                  transition="opacity 120ms ease-out"
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
                    ) : (
                      <PaneLayout
                        trace={trace}
                        spans={spanTree}
                        selectedSpan={selectedSpan}
                        spansLoading={spanTreeQuery.isLoading}
                        layout={layout}
                      />
                    )}
                  </ScenarioRoleProvider>
                </Flex>
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

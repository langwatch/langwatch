import { Box, CodeBlock, Flex, Spinner } from "@chakra-ui/react";
import { useRef } from "react";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { IsolatedErrorBoundary } from "../../isolated-error-boundary";
import { useLangyContextTarget } from "@langwatch/langy-web";
import { traceContextChip } from "@langwatch/langy-web";
import { PeerCursorOverlay } from "../../presence/peer-cursor-overlay";
import type { SpanTreeNode, TraceHeader } from "@langwatch/trace-contract";
import { useTraceEditSession } from "../hooks/use-trace-edit-session";
import { useTraceQueryArgs } from "../hooks/use-trace-query-args";
import { useDrawerStore, useShikiAdapter } from "../../../../index";
import { BlurredContentGate } from "../../../blocks/explorer/blurred-content-gate";
import { ConversationContext } from "./conversation-context";
import { ConversationView } from "./conversation-view";
import { DrawerHeader } from "./drawer-header";
import { EditModeBar } from "./edit-mode/edit-mode-bar";
import { PaneLayout } from "./panes/pane-layout";
import { usePaneLayout } from "./panes/use-pane-layout";
import { ScenarioRoleProvider } from "./scenario-roles";
import { SessionTab } from "./session-view";
import { TraceDrawerSkeleton } from "../../../elements/explorer/trace-drawer/trace-drawer-skeleton";
import { TerminalTab } from "./terminal-view";
import { TraceAccordions } from "./trace-accordions";
import { useTraceSwitchOverlay } from "../../../../behavior/explorer/trace-drawer/use-trace-switch-overlay";

export interface TraceDrawerContentProps {
  traceId: string | undefined;
  trace: TraceHeader | null;
  spanTree: SpanTreeNode[];
  selectedSpan: SpanTreeNode | null;
  isLoading: boolean;
  isSpansLoading: boolean;
  onClose: () => void;
  /**
   * Public share view: no session and no drawer chrome. Suppresses the header's
   * mutating affordances and the presence subscriptions. See TraceViewerContext.
   */
  readOnly?: boolean;
}

/**
 * Everything inside the trace drawer that is actually *about the trace* — header,
 * panes, conversation, switch overlay.
 */
export function TraceDrawerContent({
  traceId,
  trace,
  spanTree,
  selectedSpan,
  isLoading,
  isSpansLoading,
  onClose,
  readOnly = false,
}: TraceDrawerContentProps) {
  const { colorMode } = useColorMode();
  // One Shiki adapter for the whole surface. All `<RenderedMarkdown>`,
  // `<ShikiCodeBlock>`, and the JSON tokenizer consume this — without it,
  // each consumer spins up its own highlighter (theme + lang JSON +
  // Oniguruma engine), which got expensive once the chunked LLM panel
  // and conversation markdown views started mounting many siblings.
  const shikiAdapter = useShikiAdapter(colorMode);

  // Brief refreshing overlay when switching to a *different* trace — a
  // same-trace live update leaves this false so the surface doesn't flash.
  const showSwitchOverlay = useTraceSwitchOverlay({ traceId, isLoading });

  // The open trace offers itself to Langy — the HEADER is the target, deliberately not
  // the whole surface.
  const langyTrace = useLangyContextTarget(
    trace && !readOnly ? traceContextChip(trace.traceId, trace.traceName || trace.name) : null,
  );

  const viewMode = useDrawerStore((s) => s.viewMode);
  const expectedSpanCount = useDrawerStore((s) => s.expectedSpanCount);
  // Edit mode is an authenticated affordance, so the share surface never has
  // one to keep alive.
  const isEditing = useDrawerStore((s) => s.isEditing) && !readOnly;
  useTraceEditSession(readOnly ? undefined : traceId);

  // Watch the actual rendered container so the layout decision reflects
  // whatever pixel width the surface has — not the abstract widthPx state.
  const paneContainerRef = useRef<HTMLDivElement>(null);
  const layout = usePaneLayout(paneContainerRef);

  return (
    <CodeBlock.AdapterProvider value={shikiAdapter}>
      {isLoading || !trace ? (
        <TraceDrawerSkeleton onClose={onClose} expectedSpanCount={expectedSpanCount} />
      ) : (
        <>
          <Box
            flexShrink={0}
            // Translucent fill + backdrop blur so the page behind reads
            // through. The lower pane container keeps its solid `bg.surface`
            // white, so only the header strip is translucent.
            bg="bg.panel/70"
            backdropFilter="blur(20px) saturate(150%)"
            // An `outline` follows the element's OWN border-radius.
            borderTopRadius="lg"
            {...langyTrace.targetProps}
          >
            <IsolatedErrorBoundary
              scope="Couldn't render this trace's header"
              resetKeys={[trace.traceId]}
            >
              <DrawerHeader trace={trace} onClose={onClose} readOnly={readOnly} />
            </IsolatedErrorBoundary>
          </Box>
          <Box borderBottomWidth="1px" borderColor="border" />
          {isEditing && <EditModeBar traceId={trace.traceId} />}
          {/*
            Peer cursors render across the entire body. The `anchor` keys the
            shared coordinate space; everyone looking at the same trace shares
            one (0..1, 0..1) plane regardless of view mode. Disabled for share
            viewers: presence opens an SSE subscription and broadcasts cursor
            mutations, both of which need a session.
          */}
          <PeerCursorOverlay
            anchor={`trace:${trace.traceId}:drawer`}
            enabled={!readOnly}
            containerRef={paneContainerRef}
          >
            {/*
              `height="100%"` (not `flex={1}`) because PeerCursorOverlay wraps
              its children in a `position: relative` Box that isn't a flex
              container, so `flex: 1` is inert here.
            */}
            <Flex
              ref={paneContainerRef}
              height="100%"
              minHeight={0}
              minWidth={0}
              direction="column"
              position="relative"
              bg={{ base: "bg.surface", _dark: "bg.panel" }}
            >
              <ScenarioRoleProvider
                isScenario={!!(trace.scenarioRunId ?? trace.attributes["scenario.run_id"])}
              >
                {/* Conversation view is suppressed for read-only share
                    viewers: it is backed by `tracesV2.list` (disabled without
                    a session), so rendering it would show an empty pane and
                    fire protected annotation reads that 401. The gate also
                    covers a `viewMode` persisted as "conversation" from an
                    earlier in-app session. See ADR-057. */}
                {/* Usage/Terminal are coding-agent surfaces backed by the
                    protected tracesV2 session reads, so share viewers fall
                    through to the trace panes — same reasoning (and same
                    persisted-viewMode hole) as the conversation gate below. */}
                {viewMode === "session" && !readOnly ? (
                  <SessionModePane trace={trace} />
                ) : viewMode === "terminal" && !readOnly ? (
                  <TerminalModePane trace={trace} />
                ) : viewMode === "conversation" && trace.conversationId && !readOnly ? (
                  <ConversationModePane
                    conversationId={trace.conversationId}
                    traceId={trace.traceId}
                  />
                ) : viewMode === "summary" ? (
                  <SummaryModePane trace={trace} spanTree={spanTree} />
                ) : (
                  <PaneLayout
                    trace={trace}
                    spans={spanTree}
                    selectedSpan={selectedSpan}
                    isSpansLoading={isSpansLoading}
                    layout={layout}
                  />
                )}
              </ScenarioRoleProvider>
              {trace.redactedByVisibilityWindow ? <BlurredContentGate /> : null}
            </Flex>
          </PeerCursorOverlay>
        </>
      )}
      {showSwitchOverlay && <TraceSwitchOverlay />}
    </CodeBlock.AdapterProvider>
  );
}

/**
 * Trace-switch refresh overlay: a translucent blurred scrim with a spinner that covers
 * the whole body while moving from one trace to another. The caller only renders it on
 * a genuine A→B switch (never on a same-trace live update).
 */
function TraceSwitchOverlay() {
  return (
    <Box
      position="absolute"
      inset={0}
      zIndex={3}
      display="flex"
      alignItems="center"
      justifyContent="center"
      borderRadius="lg"
      bg="bg.panel/60"
      backdropFilter="blur(8px) saturate(140%)"
      pointerEvents="none"
      css={{
        animation: "tracesV2DrawerSwitchFade 140ms ease-out",
        "@keyframes tracesV2DrawerSwitchFade": {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
      }}
    >
      <Spinner size="lg" color="blue.solid" borderWidth="2px" />
    </Box>
  );
}

/**
 * Conversation-view branch. In-app only — the caller gates it behind `!readOnly` (it
 * fetches session-backed reads); this component owns just its error boundary and the
 * room the conversation fills.
 */
function ConversationModePane({
  conversationId,
  traceId,
}: {
  conversationId: string;
  traceId: string;
}) {
  return (
    <IsolatedErrorBoundary
      scope="Couldn't render conversation view"
      resetKeys={[conversationId, traceId]}
    >
      <Box flex={1} minHeight={0}>
        <ConversationView conversationId={conversationId} currentTraceId={traceId} />
      </Box>
    </IsolatedErrorBoundary>
  );
}

/**
 * Summary-view branch: the same conversation-context strip the Trace view renders (via
 * PaneLayout) so multi-turn context isn't lost when reading the summary, above the
 * summary accordions.
 */
function SummaryModePane({ trace, spanTree }: { trace: TraceHeader; spanTree: SpanTreeNode[] }) {
  const ctxPaneState = useDrawerStore((s) => s.paneState.conversationContext);
  const togglePaneCollapsed = useDrawerStore((s) => s.togglePaneCollapsed);
  // Summary-tab span references (eval / event / exception rows) jump into the
  // Trace view and open the span. See
  // specs/traces-v2/span-reference-jump-to-trace.feature
  const openSpanInTrace = useDrawerStore((s) => s.openSpanInTrace);

  return (
    <IsolatedErrorBoundary scope="Couldn't render trace summary" resetKeys={[trace.traceId]}>
      {trace.conversationId && (
        <IsolatedErrorBoundary
          scope="Couldn't render conversation context"
          resetKeys={[trace.conversationId, trace.traceId]}
        >
          {/* ConversationContext's root is height=100% (sized by PaneLayout's
              resizable Panel in Trace view). Here it sits in a plain flex
              column, where 100% would claim the whole surface and crush the
              accordions below — the wrapper gives it a natural-height, capped,
              scrollable slot instead. */}
          <Box flexShrink={0} maxHeight="48%" overflow="auto">
            <ConversationContext
              conversationId={trace.conversationId}
              traceId={trace.traceId}
              collapsed={ctxPaneState.collapsed}
              onToggleCollapsed={() => togglePaneCollapsed("conversationContext")}
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
          onSelectSpan={openSpanInTrace}
        />
      </Box>
    </IsolatedErrorBoundary>
  );
}

/**
 * Session-usage branch (coding-agent traces): counters, cost, and outcome for the agent
 * session this trace belongs to. In-app only — the caller gates it behind `!readOnly`,
 * and the project hook lives here so the share page never mounts it.
 */
function SessionModePane({ trace }: { trace: TraceHeader }) {
  const { projectId } = useTraceQueryArgs();
  return (
    <IsolatedErrorBoundary scope="Couldn't render session overview" resetKeys={[trace.traceId]}>
      <Box flex={1} minHeight={0}>
        <SessionTab projectId={projectId} traceId={trace.traceId} occurredAtMs={trace.timestamp} />
      </Box>
    </IsolatedErrorBoundary>
  );
}

/**
 * Terminal-replay branch (coding-agent traces): the turn as the CLI drew it.
 * In-app only, same gating as SessionModePane.
 */
function TerminalModePane({ trace }: { trace: TraceHeader }) {
  const { projectId } = useTraceQueryArgs();
  return (
    <IsolatedErrorBoundary scope="Couldn't render terminal session" resetKeys={[trace.traceId]}>
      <Box flex={1} minHeight={0}>
        {/* Keyed by trace: stepping to a sibling turn with J/K opens a
            different point in the session, so the turns walked back from the
            old one are not this one's history. */}
        <TerminalTab
          key={trace.traceId}
          projectId={projectId}
          traceId={trace.traceId}
          occurredAtMs={trace.timestamp}
          sessionName={trace.traceName?.trim() || trace.name?.trim() || null}
          conversationId={trace.conversationId ?? null}
        />
      </Box>
    </IsolatedErrorBoundary>
  );
}

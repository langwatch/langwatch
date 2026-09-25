/**
 * The conversation trace lends annotation's queue walker (ARCHITECTURE.md §3.4,
 * rule 7): the item's thread, or its trace as the only turn when it has none.
 */

import { CodeBlock } from "@chakra-ui/react";
import type { UiAnnotationQueueConversationProps } from "@langwatch/browser-host/declarations";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { useShikiAdapter } from "@langwatch/design-system/shiki";
import { useCallback, useMemo } from "react";

import { api } from "../../../behavior/trace-api.ts";
import { useDrawer } from "../../../behavior/use-drawer.ts";
import { useConversationTurns } from "../explorer/hooks/use-conversation-turns.ts";
import { useDrawerProjectId } from "../explorer/hooks/use-drawer-project-id.ts";
import { ConversationView } from "../explorer/trace-drawer/conversation-view/conversation-view.tsx";
import { legacyTraceToTurn } from "../explorer/utils/legacy-trace-to-turn.ts";
import { IsolatedErrorBoundary } from "../isolated-error-boundary.tsx";

/** A trace timestamp is only useful to the drawer when it is a real number. */
const partitionHint = (startedAt: unknown): number | null =>
  typeof startedAt === "number" && Number.isFinite(startedAt) ? startedAt : null;

export function AnnotationQueueConversation({
  traceId,
  conversationId,
}: UiAnnotationQueueConversationProps) {
  const projectId = useDrawerProjectId();
  const { openDrawer } = useDrawer();
  const { colorMode } = useColorMode();
  const shikiAdapter = useShikiAdapter(colorMode);

  const traceDetails = api.traces.getById.useQuery(
    { projectId: projectId ?? "", traceId },
    { enabled: !!projectId && !!traceId, refetchOnWindowFocus: false },
  );

  // The conversation reads back 90 days, so an older thread answers with no
  // turns; once that read has settled, the trace is handed over as the only turn.
  const conversationTurns = useConversationTurns(conversationId);
  const threadResolvedEmpty =
    !!conversationId &&
    !conversationTurns.isLoading &&
    !conversationTurns.isPlaceholderData &&
    (conversationTurns.data?.items.length ?? 0) === 0;

  const fallbackTrace = traceDetails.data ?? null;
  const renderedConversationId = threadResolvedEmpty && fallbackTrace ? null : conversationId;
  const fallbackTurns = useMemo(
    () =>
      renderedConversationId || !fallbackTrace ? undefined : [legacyTraceToTurn(fallbackTrace)],
    [renderedConversationId, fallbackTrace],
  );

  const openTurn = useCallback(
    ({ traceId: turnTraceId, timestamp }: { traceId: string; timestamp: number }) => {
      const occurredAtMs = partitionHint(timestamp);
      openDrawer("traceV2Details", {
        traceId: turnTraceId,
        ...(occurredAtMs === null ? {} : { t: String(occurredAtMs) }),
      });
    },
    [openDrawer],
  );

  return (
    <CodeBlock.AdapterProvider value={shikiAdapter}>
      <IsolatedErrorBoundary scope="Couldn't render this conversation" resetKeys={[traceId]}>
        <ConversationView
          key={traceId}
          conversationId={renderedConversationId}
          currentTraceId={traceId}
          focusTraceId={traceId}
          showSessionCheckboxes
          fallbackTurns={fallbackTurns}
          onSelectTurn={openTurn}
          defaultExpandAll
        />
      </IsolatedErrorBoundary>
    </CodeBlock.AdapterProvider>
  );
}

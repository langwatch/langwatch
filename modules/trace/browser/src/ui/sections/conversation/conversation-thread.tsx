import type {
  UiConversationAudioPlayback,
  UiConversationThreadProps,
} from "@langwatch/browser-host/declarations";
import { Box, VStack } from "@langwatch/design-system/primitives";
import { groupIntoTurns } from "@langwatch/trace-browser-kit";
import type { ConversationRoleMode, DisplayPart } from "@langwatch/trace-contract/conversation";
import { type ReactNode, useEffect, useMemo, useRef } from "react";

import {
  ErrorPart,
  ImagePart,
  MediaRow,
  type RenderMediaPart,
  TextPart,
  ToolPart,
} from "./parts.tsx";
import { PendingReply } from "./pending-reply.tsx";

// Single renderer for playground, simulations grid, and drawer; reuses
// existing components (Bubble, ToolPairCard, MediaPart) in one place.

/**
 * `compact` is the simulations grid cell — smaller type, tighter truncation,
 * no turn separators, since a card is a preview rather than a transcript.
 */
export type ConversationVariant = NonNullable<UiConversationThreadProps["variant"]>;

/** Dispatches one part to the component that knows how to draw it. */
function ConversationPart({
  part,
  compact,
  roleMode,
  labels,
  projectId,
  shouldRenderStructuredOutput,
  actions,
  audioPlayback,
  renderMediaPart,
}: {
  part: DisplayPart;
  compact: boolean;
  roleMode: ConversationRoleMode;
  labels?: { user?: string; assistant?: string };
  projectId: string;
  shouldRenderStructuredOutput: boolean;
  actions?: ReactNode;
  audioPlayback?: UiConversationAudioPlayback;
  renderMediaPart: RenderMediaPart;
}) {
  switch (part.kind) {
    case "text":
      return (
        <TextPart
          part={part}
          compact={compact}
          roleMode={roleMode}
          labels={labels}
          shouldRenderStructuredOutput={shouldRenderStructuredOutput}
          actions={actions}
        />
      );
    case "image":
      return <ImagePart part={part} roleMode={roleMode} />;
    case "media":
      return (
        <MediaRow
          part={part}
          projectId={projectId}
          audioPlayback={audioPlayback}
          roleMode={roleMode}
          renderMediaPart={renderMediaPart}
        />
      );
    case "tool":
      return <ToolPart part={part} compact={compact} />;
    case "error":
      return <ErrorPart part={part} />;
    default:
      return null;
  }
}

/**
 * The thread column's own layout. The drawer's section already pads; the
 * grid cell does not. A panel pads itself so nothing sits flush against
 * its edges; height comes from content, unlike a section that fills its box.
 */
function threadBodyLayout({
  compact,
  panel,
}: {
  compact: boolean;
  panel: UiConversationThreadProps["panel"];
}) {
  return {
    align: "stretch",
    width: "100%",
    gap: compact ? 2 : 4,
    padding: compact ? 2 : 0,
    fontSize: compact ? "xs" : "sm",
    paddingX: panel ? 4 : undefined,
    paddingY: panel ? 6 : undefined,
    maxWidth: panel?.contentMaxWidth,
    marginX: panel ? "auto" : undefined,
    height: panel ? undefined : "100%",
    overflowY: panel ? undefined : "auto",
  } as const;
}

export function ConversationThread({
  parts,
  variant = "regular",
  roleMode = "chat",
  labels,
  projectId,
  renderPartActions,
  shouldAutoScroll = true,
  shouldRenderStructuredOutput = false,
  panel,
  hasPendingReply = false,
  live = false,
  renderMediaPart,
  renderTurnSeparator,
  audioPlaybackFor,
}: UiConversationThreadProps) {
  const compact = variant === "compact";
  const scrollRef = useRef<HTMLDivElement>(null);

  const turns = useMemo(() => groupIntoTurns(parts, { live }), [parts, live]);

  useEffect(() => {
    if (!shouldAutoScroll) return;
    const container = scrollRef.current;
    if (!container) return;
    // The thread's own box is scrolled directly rather than asking the last
    // element to bring itself into view. `scrollIntoView` walks up and scrolls
    // EVERY ancestor scroll container it finds, so the thread re-mounting —
    // switching away from this tab and back — dragged the whole editor beside
    // it to the top and then back down again.
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    // `hasPendingReply` is a dependency because the waiting state is the newest
    // thing in the thread the moment it appears, and it appears before any
    // part of the reply does.
  }, [parts, hasPendingReply, shouldAutoScroll]);

  const renderPart = (part: DisplayPart) => (
    <ConversationPart
      key={part.id}
      part={part}
      compact={compact}
      roleMode={roleMode}
      labels={labels}
      projectId={projectId}
      shouldRenderStructuredOutput={shouldRenderStructuredOutput}
      actions={renderPartActions?.(part)}
      audioPlayback={audioPlaybackFor?.(part)}
      renderMediaPart={renderMediaPart}
    />
  );

  const body = (
    <VStack {...threadBodyLayout({ compact, panel })} ref={panel ? undefined : scrollRef}>
      {compact
        ? parts.map(renderPart)
        : turns.map((turn) => (
            <VStack key={turn.key} align="stretch" gap={4} width="100%">
              {turn.turnNumber != null &&
                renderTurnSeparator?.({
                  index: turn.turnNumber,
                  traceId: turn.traceId,
                  live,
                })}
              {turn.parts.map(renderPart)}
            </VStack>
          ))}
      {hasPendingReply && <PendingReply compact={compact} roleMode={roleMode} />}
    </VStack>
  );

  // The scroll box is the whole panel, not the centred column, so the
  // scrollbar rides the panel's edge instead of appearing mid-content beside
  // the text.
  if (!panel) return body;
  return (
    <Box ref={scrollRef} width="100%" height="100%" overflowY="auto">
      {body}
    </Box>
  );
}

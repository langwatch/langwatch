import { Box, VStack } from "@chakra-ui/react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import type { AudioPlaybackProps } from "../simulations/useSequentialAudioPlayback";
import { useSequentialAudioPlayback } from "../simulations/useSequentialAudioPlayback";
import { groupIntoTurns } from "./flattenMessages";
import { PendingReply } from "./PendingReply";
import { ErrorPart, ImagePart, MediaRow, TextPart, ToolPart } from "./parts";
import { TurnSeparator } from "./TurnSeparator";
import type { DisplayPart } from "./types";

/**
 * ConversationThread — renders flattened conversation parts.
 *
 * The single renderer behind the prompt playground and the simulations grid
 * and drawer. Everything it draws already existed somewhere in the product:
 * `Bubble` from the Traces V2 conversation view, `ToolPairCard` from its
 * transcript, `MediaPart` from simulations. What was missing was one place
 * that put them together, which is why the playground rendered no tool calls
 * at all and simulations drew a different tool card from the trace drawer.
 */

/**
 * `compact` is the simulations grid cell — smaller type, tighter truncation,
 * no turn separators, since a card is a preview rather than a transcript.
 */
export type ConversationVariant = "compact" | "regular";

interface ConversationThreadProps {
  parts: DisplayPart[];
  variant?: ConversationVariant;
  /**
   * Scenario runs invert the roles a reader expects: the `user` messages come
   * from a simulated user and the `assistant` messages from the agent under
   * test. `scenario` swaps the sides so the agent reads as the subject.
   */
  roleMode?: "chat" | "scenario";
  /** Owns the stored objects behind any media parts. */
  projectId: string;
  /** Rendered after each part, keyed by part id — hover actions, delete. */
  renderPartActions?: (part: DisplayPart) => ReactNode;
  /** Scrolls the newest part into view as content arrives. */
  autoScroll?: boolean;
  /**
   * Renders an assistant reply that parses as a JSON object as a value tree
   * rather than as markdown. On for surfaces whose prompts declare structured
   * outputs; off elsewhere, where a JSON-shaped reply is still prose the user
   * wrote and should read as they wrote it.
   */
  structuredOutput?: boolean;
  /**
   * Frames the thread as a standalone chat panel rather than a section inside
   * a drawer: the scrollbar sits at the panel's own edge while the messages
   * stay centred at `contentMaxWidth`, and there is room above the first
   * message and below the last.
   *
   * The simulations drawer supplies its own frame and padding, so it leaves
   * this off and keeps the section behaviour it already had.
   */
  panel?: { contentMaxWidth: string };
  /**
   * A reply has been asked for and has not begun arriving. Draws the waiting
   * state at the end of the thread, where the reply itself will appear — the
   * gap between sending and the first token is otherwise silent, and a silent
   * gap reads as nothing having happened.
   */
  pendingReply?: boolean;
  /**
   * The conversation is being written now rather than read back. A turn is
   * then numbered from the moment it starts, and its trace affordance appears
   * when the trace lands — instead of the whole separator waiting on a trace
   * that arrives after the reply it belongs to.
   *
   * Off for a recorded transcript, where an untraced message is simply one
   * that has no trace to offer.
   */
  live?: boolean;
}

/** Dispatches one part to the component that knows how to draw it. */
function ConversationPart({
  part,
  compact,
  roleMode,
  projectId,
  structuredOutput,
  actions,
  audioPlayback,
}: {
  part: DisplayPart;
  compact: boolean;
  roleMode: "chat" | "scenario";
  projectId: string;
  structuredOutput: boolean;
  actions?: ReactNode;
  audioPlayback?: AudioPlaybackProps;
}) {
  switch (part.kind) {
    case "text":
      return (
        <TextPart
          part={part}
          compact={compact}
          roleMode={roleMode}
          structuredOutput={structuredOutput}
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

export function ConversationThread({
  parts,
  variant = "regular",
  roleMode = "chat",
  projectId,
  renderPartActions,
  autoScroll = true,
  structuredOutput = false,
  panel,
  pendingReply = false,
  live = false,
}: ConversationThreadProps) {
  const compact = variant === "compact";
  const endRef = useRef<HTMLDivElement>(null);

  const turns = useMemo(() => groupIntoTurns(parts, { live }), [parts, live]);

  useEffect(() => {
    if (!autoScroll) return;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
    // `pendingReply` is a dependency because the waiting state is the newest
    // thing in the thread the moment it appears, and it appears before any
    // part of the reply does.
  }, [parts, pendingReply, autoScroll]);

  // Ordered audio ids drive sequential playback: one clip finishing starts the
  // next. Filtered to audio so a sibling video or attachment cannot offset the
  // hook's idea of "next".
  const orderedAudioIds = useMemo(
    () =>
      parts
        .filter(
          (part): part is Extract<DisplayPart, { kind: "media" }> =>
            part.kind === "media" && part.part.type === "audio",
        )
        .map((part) => part.id),
    [parts],
  );

  const { getAudioProps } = useSequentialAudioPlayback({
    orderedIds: orderedAudioIds,
  });

  const renderPart = (part: DisplayPart) => (
    <ConversationPart
      key={part.id}
      part={part}
      compact={compact}
      roleMode={roleMode}
      projectId={projectId}
      structuredOutput={structuredOutput}
      actions={renderPartActions?.(part)}
      audioPlayback={
        part.kind === "media" && part.part.type === "audio"
          ? getAudioProps(part.id)
          : undefined
      }
    />
  );

  const body = (
    <VStack
      align="stretch"
      gap={compact ? 2 : 4}
      // The drawer's section already pads; the grid cell does not. A panel
      // pads itself, so neither the first message nor the avatars beside the
      // messages sit flush against its edges — the horizontal room matches
      // what a bubble sets inside itself.
      padding={compact ? 2 : 0}
      paddingX={panel ? 4 : undefined}
      paddingY={panel ? 6 : undefined}
      fontSize={compact ? "xs" : "sm"}
      width="100%"
      maxWidth={panel?.contentMaxWidth}
      marginX={panel ? "auto" : undefined}
      // A panel's height comes from its content inside the scroll box; a
      // section fills the box it was handed and scrolls inside it.
      height={panel ? undefined : "100%"}
      overflowY={panel ? undefined : "auto"}
    >
      {compact
        ? parts.map(renderPart)
        : turns.map((turn) => (
            <VStack key={turn.key} align="stretch" gap={4} width="100%">
              {turn.turnNumber != null && (
                <TurnSeparator index={turn.turnNumber} traceId={turn.traceId} />
              )}
              {turn.parts.map(renderPart)}
            </VStack>
          ))}
      {pendingReply && <PendingReply compact={compact} roleMode={roleMode} />}
      <div ref={endRef} />
    </VStack>
  );

  // The scroll box is the whole panel, not the centred column, so the
  // scrollbar rides the panel's edge instead of appearing mid-content beside
  // the text.
  if (!panel) return body;
  return (
    <Box width="100%" height="100%" overflowY="auto">
      {body}
    </Box>
  );
}

import { VStack } from "@chakra-ui/react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import type { AudioPlaybackProps } from "../simulations/useSequentialAudioPlayback";
import { useSequentialAudioPlayback } from "../simulations/useSequentialAudioPlayback";
import { groupIntoTurns } from "./flattenMessages";
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
      return <ImagePart part={part} />;
    case "media":
      return (
        <MediaRow
          part={part}
          projectId={projectId}
          audioPlayback={audioPlayback}
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
}: ConversationThreadProps) {
  const compact = variant === "compact";
  const endRef = useRef<HTMLDivElement>(null);

  const turns = useMemo(() => groupIntoTurns(parts), [parts]);

  useEffect(() => {
    if (!autoScroll) return;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [parts, autoScroll]);

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

  return (
    <VStack
      align="stretch"
      gap={compact ? 2 : 4}
      // The drawer's section already pads; the grid cell does not.
      padding={compact ? 2 : 0}
      fontSize={compact ? "xs" : "sm"}
      width="100%"
      height="100%"
      overflowY="auto"
    >
      {compact
        ? parts.map(renderPart)
        : turns.map((turn) => (
            <VStack key={turn.key} align="stretch" gap={4} width="100%">
              {turn.traceId && turn.turnNumber != null && (
                <TurnSeparator index={turn.turnNumber} traceId={turn.traceId} />
              )}
              {turn.parts.map(renderPart)}
            </VStack>
          ))}
      <div ref={endRef} />
    </VStack>
  );
}

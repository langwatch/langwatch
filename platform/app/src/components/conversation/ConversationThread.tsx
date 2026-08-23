import { Box, VStack } from "@chakra-ui/react";
import { type ReactNode, type RefObject, useMemo, useRef } from "react";
import type { AudioPlaybackProps } from "../simulations/useSequentialAudioPlayback";
import { groupIntoTurns } from "./flattenMessages";
import { PendingReply } from "./PendingReply";
import { ErrorPart, ImagePart, MediaRow, TextPart, ToolPart } from "./parts";
import { TurnSeparator } from "./TurnSeparator";
import type { DisplayPart } from "./types";
import { useThreadAudioPlayback } from "./useThreadAudioPlayback";
import { useThreadAutoScroll } from "./useThreadAutoScroll";

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
  /**
   * Names the two sides of the conversation, keyed by the role the message was
   * sent with. A surface supplies this when it knows who is actually speaking:
   * the playground labels one side with the reader's own name and the other
   * with the model under test, because "User" and "Assistant" name neither of
   * the two parties the reader is comparing.
   *
   * A side left unset keeps the label its role already carries, which is what
   * a scenario run depends on to read as "User Simulator" and "Agent".
   */
  labels?: { user?: string; assistant?: string };
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
  labels,
  projectId,
  structuredOutput,
  actions,
  audioPlayback,
}: {
  part: DisplayPart;
  compact: boolean;
  roleMode: "chat" | "scenario";
  labels?: { user?: string; assistant?: string };
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
          labels={labels}
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

/**
 * The stack of turns itself, without the scroll box around it.
 *
 * Separate from `ConversationThread` because the two answer different
 * questions — this one what the thread looks like, the other where it
 * scrolls — and because between them they carry more branching than one
 * function is allowed to.
 */
/**
 * The box styles the thread's stack takes, which differ on two axes.
 *
 * `compact` is the grid cell: tighter type and spacing. `panel` decides where
 * the scrolling happens — a panel's height comes from its content inside a
 * scroll box that wraps it, while a section fills the box it was handed and
 * scrolls inside itself. The drawer's section already pads; the grid cell does
 * not; a panel pads itself, so neither the first message nor the avatars
 * beside the messages sit flush against its edges.
 */
function threadBodyLayout({
  compact,
  panel,
}: {
  compact: boolean;
  panel: ConversationThreadProps["panel"];
}) {
  return {
    gap: compact ? 2 : 4,
    padding: compact ? 2 : 0,
    paddingX: panel ? 4 : undefined,
    paddingY: panel ? 6 : undefined,
    fontSize: compact ? "xs" : "sm",
    maxWidth: panel?.contentMaxWidth,
    marginX: panel ? "auto" : undefined,
    height: panel ? undefined : "100%",
    overflowY: panel ? undefined : ("auto" as const),
  };
}

/** One turn: its separator, when it has a number, and its parts. */
function ThreadTurn({
  turn,
  renderPart,
}: {
  turn: ReturnType<typeof groupIntoTurns>[number];
  renderPart: (part: DisplayPart) => ReactNode;
}) {
  return (
    <VStack align="stretch" gap={4} width="100%">
      {turn.turnNumber != null && (
        <TurnSeparator index={turn.turnNumber} traceId={turn.traceId} />
      )}
      {turn.parts.map(renderPart)}
    </VStack>
  );
}

/**
 * The stack of turns itself, without the scroll box around it.
 *
 * Separate from `ConversationThread` because the two answer different
 * questions — this one what the thread looks like, the other where it scrolls.
 */
function ThreadBody({
  parts,
  turns,
  compact,
  panel,
  pendingReply,
  roleMode,
  scrollRef,
  renderPart,
}: {
  parts: DisplayPart[];
  turns: ReturnType<typeof groupIntoTurns>;
  compact: boolean;
  panel: ConversationThreadProps["panel"];
  pendingReply: boolean;
  roleMode: "chat" | "scenario";
  scrollRef: RefObject<HTMLDivElement | null>;
  renderPart: (part: DisplayPart) => ReactNode;
}) {
  return (
    <VStack
      align="stretch"
      width="100%"
      {...threadBodyLayout({ compact, panel })}
      ref={panel ? undefined : scrollRef}
    >
      {compact
        ? parts.map(renderPart)
        : turns.map((turn) => (
            <ThreadTurn key={turn.key} turn={turn} renderPart={renderPart} />
          ))}
      {pendingReply && <PendingReply compact={compact} roleMode={roleMode} />}
    </VStack>
  );
}

export function ConversationThread({
  parts,
  variant = "regular",
  roleMode = "chat",
  labels,
  projectId,
  renderPartActions,
  autoScroll = true,
  structuredOutput = false,
  panel,
  pendingReply = false,
  live = false,
}: ConversationThreadProps) {
  const compact = variant === "compact";
  const scrollRef = useRef<HTMLDivElement>(null);

  const turns = useMemo(() => groupIntoTurns(parts, { live }), [parts, live]);

  useThreadAutoScroll({ scrollRef, parts, pendingReply, enabled: autoScroll });
  const { audioPropsFor } = useThreadAudioPlayback(parts);

  const renderPart = (part: DisplayPart) => (
    <ConversationPart
      key={part.id}
      part={part}
      compact={compact}
      roleMode={roleMode}
      labels={labels}
      projectId={projectId}
      structuredOutput={structuredOutput}
      actions={renderPartActions?.(part)}
      audioPlayback={audioPropsFor(part)}
    />
  );

  const body = (
    <ThreadBody
      parts={parts}
      turns={turns}
      compact={compact}
      panel={panel}
      pendingReply={pendingReply}
      roleMode={roleMode}
      scrollRef={scrollRef}
      renderPart={renderPart}
    />
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

import { Box, HStack } from "@chakra-ui/react";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { AnnotationByTrace } from "../../../use-annotations-by-trace-ids";
import {
  type TraceAnchor,
  useAnchoredAnnotations,
} from "../../hooks/use-anchored-annotations";
import { AnchorCommentButton } from "../anchored-comments/anchor-comment-button";
import { TranscriptRenderProvider } from "../../../../../index";

interface MessageCommentScopeValue {
  /** The trace a comment left on a message in this transcript is about. */
  traceId: string;
  /** What was already said about one message of it. */
  commentsAt: (anchor: TraceAnchor) => AnnotationByTrace[];
}

const MessageCommentContext = createContext<MessageCommentScopeValue | null>(null);

/**
 * Which trace the transcript underneath belongs to, so a message inside it can
 * be commented on.
 *
 * The transcript components are handed messages and nothing else — the same
 * stack renders a span's input, a trace's output and the terminal replay — so
 * the trace is announced around them rather than threaded through every one.
 * A host that renders a transcript of somebody else's trace, or of nothing in
 * particular, opens no scope and the blocks carry no comment action.
 *
 * The trace's comments are read once here rather than once per block: a
 * transcript can hold fifty of them, and they all want the same list.
 */
export function MessageCommentScope({
  traceId,
  children,
}: {
  traceId?: string;
  children: ReactNode;
}) {
  if (!traceId) {
    return <TranscriptRenderProvider>{children}</TranscriptRenderProvider>;
  }
  return <ScopeProvider traceId={traceId}>{children}</ScopeProvider>;
}

function ScopeProvider({ traceId, children }: { traceId: string; children: ReactNode }) {
  const annotations = useAnchoredAnnotations();
  const value = useMemo(
    () => ({ traceId, commentsAt: annotations.commentsAt }),
    [traceId, annotations.commentsAt],
  );
  return (
    <MessageCommentContext.Provider value={value}>
      <TranscriptRenderProvider
        renderCommentAction={(blockKey) => (
          <MessageCommentButton scope={value} blockKey={blockKey} />
        )}
      >
        {children}
      </TranscriptRenderProvider>
    </MessageCommentContext.Provider>
  );
}

/** Marks the element a block's comment action reveals itself on hover from. */
export const MESSAGE_BLOCK_CLASS = "msg-block";

/**
 * One block of a message, with the way to say something about it.
 *
 * The action sits beside the block rather than over it: a block is anything
 * from one line to a wall of tool output, and an overlay would cover the very
 * text the comment is about. Without a scope around it this renders the block
 * and nothing else, so every transcript that is not part of a trace the reader
 * can annotate is untouched.
 */
export function CommentableBlock({
  blockKey,
  children,
}: {
  blockKey: string;
  children: ReactNode;
}) {
  const scope = useContext(MessageCommentContext);
  if (!scope) return <>{children}</>;
  return (
    <HStack align="flex-start" gap={1} width="full" className={MESSAGE_BLOCK_CLASS}>
      <Box flex={1} minWidth={0}>
        {children}
      </Box>
      <MessageCommentButton scope={scope} blockKey={blockKey} />
    </HStack>
  );
}

function MessageCommentButton({
  scope,
  blockKey,
}: {
  scope: MessageCommentScopeValue;
  blockKey: string;
}) {
  const anchor: TraceAnchor = {
    anchorKind: "message",
    anchorId: scope.traceId,
    anchorPath: blockKey,
  };
  return (
    <AnchorCommentButton
      traceId={scope.traceId}
      anchor={anchor}
      comments={scope.commentsAt(anchor)}
      name="this message"
      dense
      reveal="on-block-hover"
    />
  );
}

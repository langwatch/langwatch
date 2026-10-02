import { createContext, type ReactNode, useMemo } from "react";

import { TranscriptRenderProvider } from "../../../../elements/transcript-render-ports.tsx";
import type { AnnotationByTrace } from "../../../use-annotations-by-trace-ids.ts";
import { type TraceAnchor, useAnchoredAnnotations } from "../../hooks/use-anchored-annotations.ts";
import { AnchorCommentButton } from "../anchored-comments/anchor-comment-button.tsx";

interface MessageCommentScopeValue {
  /** The trace a comment left on a message in this transcript is about. */
  traceId: string;
  /** What was already said about one message of it. */
  commentsAt: (anchor: TraceAnchor) => AnnotationByTrace[];
}

const MessageCommentContext = createContext<MessageCommentScopeValue | null>(null);

/**
 * Which trace the transcript underneath belongs to, so a message inside it can be
 * commented on.
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

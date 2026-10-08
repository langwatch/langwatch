import { useTraceDrawer } from "../../../../../behavior/trace-drawer.ts";
import type { AnnotationByTrace } from "../../../../../behavior/use-annotations-by-trace-ids.ts";
import { useJumpToAnnotationAnchor } from "../../../../../features/annotation/behavior/use-jump-to-annotation-anchor.ts";
import { AnnotationCard as PackageAnnotationCard } from "../../../../blocks/explorer/trace-drawer/annotation-card.tsx";
import { PersonAvatar } from "../../../person-avatar.tsx";

interface AnnotationCardProps {
  annotation: AnnotationByTrace;
  /** Score key names by id, so a card never falls back to a raw id. */
  scoreNamesById: Map<string, string>;
  /**
   * The trace the reader is already looking at, when the card sits inside it.
   * A comment on that trace's own field then names the field alone.
   */
  contextTraceId?: string;
  /** Whether the reader wrote this annotation and may change it. */
  isOwn: boolean;
  onEdit: () => void;
}

/**
 * App composition for the reusable annotation card.
 */
export function AnnotationCard({
  annotation,
  scoreNamesById,
  contextTraceId,
  isOwn,
  onEdit,
}: AnnotationCardProps) {
  const jumpToAnchor = useJumpToAnnotationAnchor();
  const openTraceId = useTraceDrawer((state) => state.traceId);

  return (
    <PackageAnnotationCard
      annotation={annotation}
      scoreNamesById={scoreNamesById}
      contextTraceId={contextTraceId}
      isOwn={isOwn}
      onEdit={onEdit}
      openTraceId={openTraceId}
      onJumpToAnchor={jumpToAnchor}
      renderAvatar={(user) => (
        <PersonAvatar
          size="xs"
          background="gray.solid"
          color="white"
          name={user.name ?? "?"}
          image={user.image}
        />
      )}
    />
  );
}

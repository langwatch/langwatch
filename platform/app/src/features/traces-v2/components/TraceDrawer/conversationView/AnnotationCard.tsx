import { AnnotationCard as PackageAnnotationCard } from "@langwatch/annotation-web";
import { UserAvatar } from "~/components/UserAvatar";
import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import { useJumpToAnnotationAnchor } from "../../../hooks/useJumpToAnnotationAnchor";
import { useDrawerStore } from "@langwatch/trace-web";

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
 *
 * The card owns its presentation in the feature web package. This adapter
 * supplies the app avatar and trace-navigation ports, keeping stores and
 * browser-only navigation at the app boundary.
 */
export function AnnotationCard({
  annotation,
  scoreNamesById,
  contextTraceId,
  isOwn,
  onEdit,
}: AnnotationCardProps) {
  const jumpToAnchor = useJumpToAnnotationAnchor();
  const openTraceId = useDrawerStore((state) => state.traceId);

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
        <UserAvatar
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

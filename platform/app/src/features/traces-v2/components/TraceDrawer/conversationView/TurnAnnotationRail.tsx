import { Button, Icon, Text, VStack } from "@chakra-ui/react";
import { Edit3 } from "lucide-react";
import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import {
  type AnnotationDraft,
  isSameAnnotationTarget,
  useAnnotationDraftStore,
} from "../../../stores/annotationDraftStore";
import { AnnotationCard } from "./AnnotationCard";
import { AnnotationEditorCard } from "./AnnotationEditorCard";
import { useScoreNamesById } from "./useScoreNamesById";

interface TurnAnnotationRailProps {
  traceId: string;
  /** The turn's current output, which a suggestion starts from. */
  output?: string | null;
  /** What was said about the turn as a whole. */
  annotations: AnnotationByTrace[];
  /** What was said about the parts inside the turn, each naming its part. */
  anchoredAnnotations?: AnnotationByTrace[];
}

const NO_ANCHORED_ANNOTATIONS: AnnotationByTrace[] = [];

/**
 * One turn's annotations, in the column beside it.
 *
 * The whole area is a target for starting an annotation on this turn, the way
 * the annotation queue's gutter has always been: click anywhere the cards are
 * not and the composer opens here. Cards claim their own clicks so reading one
 * never starts a second annotation.
 *
 * Comments about the turn come first and comments about its parts after, so the
 * reader meets the remark about the whole answer before the remarks about the
 * steps that produced it.
 */
export function TurnAnnotationRail({
  traceId,
  output,
  annotations,
  anchoredAnnotations = NO_ANCHORED_ANNOTATIONS,
}: TurnAnnotationRailProps) {
  const { hasPermission } = useOrganizationTeamProject();
  const { data: session } = useRequiredSession();
  const draft = useAnnotationDraftStore((s) => s.draft);
  const openDraft = useAnnotationDraftStore((s) => s.openDraft);
  const scoreNamesById = useScoreNamesById();

  const canManage = hasPermission("annotations:manage");
  const cards = [...annotations, ...anchoredAnnotations];
  const turnDraft = resolveRailDraft({ draft, traceId, cards });
  const userId = session?.user?.id;
  // An edit composer takes the place of the card it is editing. It docks at
  // the end instead when there is no card to take the place of: a new
  // annotation, or one this feed has not caught up with yet.
  const isEditorReplacingACard =
    !!turnDraft?.annotationId &&
    cards.some((a) => a.id === turnDraft.annotationId);

  const startAnnotation = () => {
    if (!canManage || turnDraft) return;
    openDraft({ traceId, mode: "annotate", output });
  };

  return (
    <VStack
      align="stretch"
      gap={2}
      // `className="group"` is what the button's `_groupHover` resolves
      // against; the role is what tells a reader the column is one thing.
      className="group"
      role="group"
      onClick={startAnnotation}
      cursor={canManage && !turnDraft ? "pointer" : "default"}
      minHeight="40px"
      data-testid={`turn-annotation-rail-${traceId}`}
    >
      {cards.map((annotation) =>
        turnDraft?.annotationId === annotation.id ? (
          <AnnotationEditorCard
            key={annotation.id}
            draft={turnDraft}
            output={output}
          />
        ) : (
          <AnnotationCard
            key={annotation.id}
            annotation={annotation}
            scoreNamesById={scoreNamesById}
            isOwn={!!userId && annotation.user?.id === userId}
            onEdit={() =>
              openDraft({
                traceId,
                mode: annotation.expectedOutput ? "suggest" : "annotate",
                annotationId: annotation.id,
                output,
                // Editing keeps the comment on the part it was left on: the
                // composer that opens is the composer for that part.
                anchorKind: annotation.anchorKind ?? undefined,
                anchorId: annotation.anchorId ?? undefined,
                anchorPath: annotation.anchorPath ?? undefined,
              })
            }
          />
        ),
      )}

      {turnDraft && !isEditorReplacingACard && (
        <AnnotationEditorCard draft={turnDraft} output={output} />
      )}

      {canManage && !turnDraft && (
        <AddAnnotationButton
          isRailEmpty={cards.length === 0}
          onStart={startAnnotation}
        />
      )}
    </VStack>
  );
}

/**
 * The draft this rail holds the composer for.
 *
 * A new comment written here is about the turn as a whole, so an anchored draft
 * belongs to the part it points at rather than to the rail. The one exception
 * is a card in this rail being edited: that composer takes the card's place,
 * and the card is here because the comment is about this turn.
 */
function resolveRailDraft({
  draft,
  traceId,
  cards,
}: {
  draft: AnnotationDraft | null;
  traceId: string;
  cards: AnnotationByTrace[];
}): AnnotationDraft | null {
  if (!draft) return null;
  if (isSameAnnotationTarget(draft, { traceId })) return draft;
  return draft.traceId === traceId &&
    draft.annotationId &&
    cards.some((a) => a.id === draft.annotationId)
    ? draft
    : null;
}

/** The rail's own way in, for readers who do not know the column is clickable. */
function AddAnnotationButton({
  isRailEmpty,
  onStart,
}: {
  isRailEmpty: boolean;
  onStart: () => void;
}) {
  return (
    <Button
      size="xs"
      variant="ghost"
      color="fg.muted"
      justifyContent="flex-start"
      gap={1.5}
      paddingX={2}
      // Visible on an empty rail so the column advertises what it is for,
      // and out of the way once there are cards to read.
      opacity={isRailEmpty ? 1 : 0}
      _groupHover={{ opacity: 1 }}
      _focusVisible={{ opacity: 1 }}
      transition="opacity 120ms ease"
      onClick={(e) => {
        e.stopPropagation();
        onStart();
      }}
    >
      <Icon as={Edit3} boxSize={3} />
      <Text textStyle="2xs">Add annotation</Text>
    </Button>
  );
}

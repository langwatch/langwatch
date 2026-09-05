import { Button, Icon, Text, VStack } from "@chakra-ui/react";
import { Edit3 } from "lucide-react";
import type { AnnotationByTrace } from "../../../use-annotations-by-trace-ids";
import { useOrganizationTeamProject } from "../../../../../behavior/use-organization-team-project";
import { useRequiredSession } from "../../../../../behavior/auth-session";
import { useScoreNamesById } from "../../../use-score-names-by-id";
import {
  type AnnotationDraft,
  isTurnRailDraft,
  type OpenAnnotationDraftParams,
  useAnnotationDraftStore,
} from "../../../../../index";
import { AnnotationCard } from "./annotation-card";
import { AnnotationEditorCard } from "./annotation-editor-card";

interface TurnAnnotationRailProps {
  traceId: string;
  /** What the user sent, which a correction of the message starts from. */
  input?: string | null;
  /** The turn's current output, which a correction of the reply starts from. */
  output?: string | null;
  /** What was said about the turn as a whole. */
  annotations: AnnotationByTrace[];
  /** What was said about the parts inside the turn, each naming its part. */
  anchoredAnnotations?: AnnotationByTrace[];
}

const NO_ANCHORED_ANNOTATIONS: AnnotationByTrace[] = [];

/**
 * What the rail itself starts: a comment about the turn's reply.
 */
function commentOnTheReply({
  traceId,
  output,
}: {
  traceId: string;
  output?: string | null;
}): OpenAnnotationDraftParams {
  return {
    traceId,
    mode: "annotate",
    output,
    anchorKind: "field",
    anchorId: traceId,
    anchorPath: "output",
  };
}

/**
 * One turn's annotations, in the column beside it.
 */
export function TurnAnnotationRail({
  traceId,
  input,
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
    !!turnDraft?.annotationId && cards.some((a) => a.id === turnDraft.annotationId);

  const startAnnotation = () => {
    if (!canManage || turnDraft) return;
    openDraft(commentOnTheReply({ traceId, output }));
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
            input={input}
            output={output}
          />
        ) : (
          <AnnotationCard
            key={annotation.id}
            annotation={annotation}
            scoreNamesById={scoreNamesById}
            // The card is already beside this turn, so it names the part
            // without repeating the turn it is sitting next to.
            contextTraceId={traceId}
            isOwn={!!userId && annotation.user?.id === userId}
            onEdit={() => openDraft(reopenComment({ annotation, traceId, input, output }))}
          />
        ),
      )}

      {turnDraft && !isEditorReplacingACard && (
        <AnnotationEditorCard draft={turnDraft} input={input} output={output} />
      )}

      {canManage && !turnDraft && (
        <AddAnnotationButton isRailEmpty={cards.length === 0} onStart={startAnnotation} />
      )}
    </VStack>
  );
}

/**
 * Re-opening a comment that is already there.
 */
function reopenComment({
  annotation,
  traceId,
  input,
  output,
}: {
  annotation: AnnotationByTrace;
  traceId: string;
  input?: string | null;
  output?: string | null;
}): OpenAnnotationDraftParams {
  return {
    traceId,
    mode: annotation.expectedOutput ? "suggest" : "annotate",
    annotationId: annotation.id,
    output: annotation.anchorPath === "input" ? input : output,
    anchorKind: annotation.anchorKind ?? undefined,
    anchorId: annotation.anchorId ?? undefined,
    anchorPath: annotation.anchorPath ?? undefined,
  };
}

/**
 * The draft this rail holds the composer for.
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
  if (!draft || draft.traceId !== traceId) return null;
  if (isTurnRailDraft(draft)) return draft;
  return draft.annotationId && cards.some((a) => a.id === draft.annotationId) ? draft : null;
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

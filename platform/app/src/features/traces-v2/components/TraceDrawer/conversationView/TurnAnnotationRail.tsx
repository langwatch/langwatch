import { Button, Icon, Text, VStack } from "@chakra-ui/react";
import { Edit3 } from "lucide-react";
import { useMemo } from "react";
import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";
import { useAnnotationDraftStore } from "../../../stores/annotationDraftStore";
import { AnnotationCard } from "./AnnotationCard";
import { AnnotationEditorCard } from "./AnnotationEditorCard";

interface TurnAnnotationRailProps {
  traceId: string;
  /** The turn's current output, which a suggestion starts from. */
  output?: string | null;
  annotations: AnnotationByTrace[];
}

/**
 * One turn's annotations, in the column beside it.
 *
 * The whole area is a target for starting an annotation on this turn, the way
 * the annotation queue's gutter has always been: click anywhere the cards are
 * not and the composer opens here. Cards claim their own clicks so reading one
 * never starts a second annotation.
 */
export function TurnAnnotationRail({
  traceId,
  output,
  annotations,
}: TurnAnnotationRailProps) {
  const { project, hasPermission } = useOrganizationTeamProject();
  const { data: session } = useRequiredSession();
  const draft = useAnnotationDraftStore((s) => s.draft);
  const openDraft = useAnnotationDraftStore((s) => s.openDraft);

  // Every key the project has ever had, not just the active ones: a score
  // left on a key that was since deactivated still has to read by name.
  const scoreKeys = api.annotationScore.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && hasPermission("annotations:view") },
  );
  const scoreNamesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const key of scoreKeys.data ?? []) map.set(key.id, key.name);
    return map;
  }, [scoreKeys.data]);

  const canManage = hasPermission("annotations:manage");
  const turnDraft = draft?.traceId === traceId ? draft : null;
  const userId = session?.user?.id;
  // An edit composer takes the place of the card it is editing. It docks at
  // the end instead when there is no card to take the place of: a new
  // annotation, or one this feed has not caught up with yet.
  const editorTakesACardsPlace =
    !!turnDraft?.annotationId &&
    annotations.some((a) => a.id === turnDraft.annotationId);

  const startAnnotation = () => {
    if (!canManage || turnDraft) return;
    openDraft({ traceId, mode: "annotate", output });
  };

  return (
    <VStack
      align="stretch"
      gap={2}
      role="group"
      onClick={startAnnotation}
      cursor={canManage && !turnDraft ? "pointer" : "default"}
      minHeight="40px"
      data-testid={`turn-annotation-rail-${traceId}`}
    >
      {annotations.map((annotation) =>
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
              })
            }
          />
        ),
      )}

      {turnDraft && !editorTakesACardsPlace && (
        <AnnotationEditorCard draft={turnDraft} output={output} />
      )}

      {canManage && !turnDraft && (
        <Button
          size="xs"
          variant="ghost"
          color="fg.muted"
          justifyContent="flex-start"
          gap={1.5}
          paddingX={2}
          // Visible on an empty rail so the column advertises what it is for,
          // and out of the way once there are cards to read.
          opacity={annotations.length === 0 ? 1 : 0}
          _groupHover={{ opacity: 1 }}
          _focusVisible={{ opacity: 1 }}
          transition="opacity 120ms ease"
          onClick={(e) => {
            e.stopPropagation();
            startAnnotation();
          }}
        >
          <Icon as={Edit3} boxSize={3} />
          <Text textStyle="2xs">Add annotation</Text>
        </Button>
      )}
    </VStack>
  );
}

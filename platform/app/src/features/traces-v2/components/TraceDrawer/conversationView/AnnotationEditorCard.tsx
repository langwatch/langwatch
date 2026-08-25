import { Box, VStack } from "@chakra-ui/react";
import { useEffect } from "react";
import { describeAnnotationAnchor } from "~/server/annotations/annotationAnchorLabel";
import {
  type AnnotationDraft,
  useAnnotationDraftStore,
} from "../../../stores/annotationDraftStore";
import { AnnotateBody, FormFooter, SuggestBody } from "./AnnotationFormBody";
import type { AnnotationFormState, ScoreOptions } from "./annotationForm.types";
import { useAnnotationMutations } from "./useAnnotationForm";

interface AnnotationEditorCardProps {
  draft: AnnotationDraft;
  /** What the user sent, which a correction of the message reads against. */
  input?: string | null;
  /** The turn's current output, which a correction of the reply reads against. */
  output?: string | null;
}

/**
 * The text a suggestion is a correction of: the side of the turn the comment
 * was left on. A comment about the turn as a whole corrects the reply, which is
 * the answer such a comment is a judgement on.
 */
function originalTextForDraft({
  draft,
  input,
  output,
}: {
  draft: AnnotationDraft;
  input?: string | null;
  output?: string | null;
}): string {
  return (draft.anchorPath === "input" ? input : output) ?? "";
}

/** The form contract, built from the draft store instead of local state. */
function buildComposerFormState({
  draft,
  mutations,
  patchDraft,
  closeDraft,
}: {
  draft: AnnotationDraft;
  mutations: ReturnType<typeof useAnnotationMutations>;
  patchDraft: (patch: Partial<AnnotationDraft>) => void;
  closeDraft: () => void;
}): AnnotationFormState {
  return {
    comment: draft.comment,
    setComment: (comment) => patchDraft({ comment }),
    expectedOutput: draft.expectedOutput,
    setExpectedOutput: (expectedOutput) => patchDraft({ expectedOutput }),
    scoreOptions: draft.scoreOptions,
    setScoreOptions: (update) =>
      patchDraft({
        scoreOptions: typeof update === "function" ? update(draft.scoreOptions) : update,
      }),
    scores: mutations.scores,
    isEdit: mutations.isEdit,
    isSaving: mutations.isSaving,
    isDeleting: mutations.isDeleting,
    hasExisting: mutations.hasExisting,
    isSaveBlocked: mutations.isSaveBlocked,
    anchorLabel: describeAnnotationAnchor({
      anchor: {
        anchorKind: draft.anchorKind ?? null,
        anchorId: draft.anchorId ?? null,
        anchorPath: draft.anchorPath ?? null,
      },
      traceId: draft.traceId,
      // The composer docks beside the turn it is about, so it names the part
      // rather than the turn the reader is already looking at.
      selfLabel: null,
    }),
    suggestTarget: draft.anchorPath === "input" ? "input" : "output",
    handleSave: () =>
      mutations.save({
        comment: draft.comment,
        expectedOutput: draft.expectedOutput,
        scoreOptions: draft.scoreOptions,
      }),
    handleDelete: mutations.remove,
    onCancel: closeDraft,
    mode: draft.mode,
  };
}

/**
 * The annotation composer, docked in the rail where the annotation itself
 * sits. Same form body as the popover; the difference is where the values live
 * (the draft store, so they survive the turn scrolling out of view) and that it
 * takes its place in the column rather than floating over the conversation.
 */
export function AnnotationEditorCard({
  draft,
  input,
  output,
}: AnnotationEditorCardProps) {
  const patchDraft = useAnnotationDraftStore((s) => s.patchDraft);
  const closeDraft = useAnnotationDraftStore((s) => s.closeDraft);

  const mutations = useAnnotationMutations({
    traceId: draft.traceId,
    mode: draft.mode,
    annotationId: draft.annotationId,
    enabled: true,
    onDone: closeDraft,
    anchorKind: draft.anchorKind,
    anchorId: draft.anchorId,
    anchorPath: draft.anchorPath,
  });
  const { existing } = mutations;

  // An edit starts from the annotation as it stands, once. The annotation is
  // read asynchronously, so re-seeding on every render of it would overwrite
  // whatever the reviewer had typed since.
  useEffect(() => {
    if (!draft.annotationId || draft.seededFromExisting || !existing) return;
    patchDraft({
      comment: existing.comment ?? "",
      expectedOutput: existing.expectedOutput ?? "",
      scoreOptions: (existing.scoreOptions as unknown as ScoreOptions) ?? {},
      seededFromExisting: true,
    });
  }, [draft.annotationId, draft.seededFromExisting, existing, patchDraft]);

  const state = buildComposerFormState({
    draft,
    mutations,
    patchDraft,
    closeDraft,
  });

  return (
    <Box
      // Clicks inside the composer are the composer's; the rail behind it
      // starts a new annotation on anything that reaches it.
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      borderRadius="md"
      borderWidth="1px"
      borderColor="blue.solid/40"
      bg="bg.panel"
      padding={3}
      aria-label="Annotation composer"
    >
      <VStack align="stretch" gap={3}>
        {draft.mode === "suggest" ? (
          <SuggestBody
            state={state}
            originalOutput={originalTextForDraft({ draft, input, output })}
          />
        ) : (
          <AnnotateBody state={state} />
        )}
        <FormFooter state={state} padding={0} />
      </VStack>
    </Box>
  );
}

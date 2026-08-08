import { useEffect, useMemo, useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { useAnnotationInvalidation } from "~/hooks/useAnnotationInvalidation";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { AnnotationAnchorColumns } from "~/server/annotations/annotationAnchor";
import { describeAnnotationAnchor } from "~/server/annotations/annotationAnchorLabel";
import { api } from "~/utils/api";
import { useAnnotationSessionStore } from "../../../stores/annotationSessionStore";
import type {
  AnnotationDraftValues,
  AnnotationFormState,
  AnnotationMode,
  AnnotationMutations,
  PopoverAnnotationFormInput,
  ScoreOptions,
  TraceAnnotation,
} from "./annotationForm.types";

/**
 * Reads and writes for one turn's annotation: the annotation being edited,
 * the project's active score keys, and the create / update / delete calls
 * with their toasts and cache invalidation.
 *
 * `enabled` gates the reads, so a host that keeps the form mounted while it is
 * closed pays nothing for it. `onDone` fires after a successful write.
 */
export function useAnnotationMutations({
  traceId,
  mode,
  annotationId,
  enabled,
  onDone,
  anchorKind,
  anchorId,
  anchorPath,
}: {
  traceId: string;
  mode: AnnotationMode;
  annotationId?: string;
  enabled: boolean;
  onDone: () => void;
} & AnnotationAnchorColumns): AnnotationMutations {
  const { project } = useOrganizationTeamProject();
  const invalidateTraceReads = useAnnotationInvalidation({ traceId });

  const annotationsForTrace = api.annotation.getByTraceId.useQuery(
    { projectId: project?.id ?? "", traceId },
    { enabled: !!project?.id && enabled },
  );

  const existing = useMemo(
    () => annotationsForTrace.data?.find((a) => a.id === annotationId),
    [annotationsForTrace.data, annotationId],
  );

  const isEdit = !!annotationId;
  // The annotation being edited has to be in hand before it can be written
  // back: saving without it would fall through to create and leave the turn
  // carrying the same annotation twice, or the same trace two corrections.
  const isSaveBlocked = isEdit && !existing;

  const scores = api.annotationScore.getAllActive.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && enabled },
  );

  const create = api.annotation.create.useMutation();
  const update = api.annotation.updateByTraceId.useMutation();
  const remove = api.annotation.deleteById.useMutation();

  const save = (values: AnnotationDraftValues) => {
    if (!project?.id || isSaveBlocked) return;
    const payload = {
      projectId: project.id,
      traceId,
      comment: values.comment,
      scoreOptions: stripUnratedScores(values.scoreOptions),
      // Rating a turn says nothing about its suggested output, so the field is
      // left out rather than sent empty, which would withdraw the suggestion.
      expectedOutput: mode === "suggest" ? values.expectedOutput : undefined,
    };
    const onSuccess = () => {
      invalidateTraceReads();
      toaster.create({
        title: isEdit ? "Annotation updated" : "Annotation saved",
        type: "success",
      });
      onDone();
    };
    const onError = () => {
      toaster.create({
        title: "Could not save annotation",
        type: "error",
      });
    };
    if (existing) {
      // The anchor is not sent back: editing a comment changes what it says,
      // never what it is about, so pointing it somewhere else is a delete and
      // a new comment.
      update.mutate({ ...payload, id: existing.id }, { onSuccess, onError });
    } else {
      create.mutate(
        { ...payload, anchorKind, anchorId, anchorPath },
        {
          onSuccess: () => {
            useAnnotationSessionStore.getState().recordSaved();
            onSuccess();
          },
          onError,
        },
      );
    }
  };

  const removeExisting = () => {
    if (!project?.id || !existing) return;
    remove.mutate(
      { projectId: project.id, annotationId: existing.id },
      {
        onSuccess: () => {
          invalidateTraceReads();
          toaster.create({ title: "Annotation deleted", type: "success" });
          onDone();
        },
        onError: () => {
          toaster.create({
            title: "Could not delete annotation",
            type: "error",
          });
        },
      },
    );
  };

  return {
    existing,
    isEdit,
    hasExisting: !!existing,
    scores,
    isSaving: create.isLoading || update.isLoading,
    isDeleting: remove.isLoading,
    isSaveBlocked,
    save,
    remove: removeExisting,
  };
}

/**
 * Only the score keys the reviewer actually rated. A key they opened and left
 * blank is not a rating, and storing it would show up as an empty score on the
 * annotation.
 */
function stripUnratedScores(scoreOptions: ScoreOptions): ScoreOptions {
  return Object.fromEntries(
    Object.entries(scoreOptions).filter(([, v]) => {
      if (v.value === "" || v.value == null) return false;
      if (Array.isArray(v.value) && v.value.length === 0) return false;
      return true;
    }),
  );
}

/**
 * What a form starts out holding. Editing an annotation reads its stored
 * values; a new one starts blank, except that suggesting pre-fills the trace's
 * current output so the reviewer corrects it in place.
 */
function seedDraftValues({
  existing,
  mode,
  output,
}: {
  existing: TraceAnnotation | undefined;
  mode: AnnotationMode;
  output?: string | null;
}): AnnotationDraftValues {
  if (existing) {
    return {
      comment: existing.comment ?? "",
      expectedOutput: existing.expectedOutput ?? "",
      scoreOptions: (existing.scoreOptions as unknown as ScoreOptions) ?? {},
    };
  }
  return {
    comment: "",
    expectedOutput: mode === "suggest" ? (output ?? "") : "",
    scoreOptions: {},
  };
}

/**
 * Popover-flavoured form state: draft values live in local state and are
 * seeded each time the popover opens, on top of the shared server half.
 */
export function usePopoverAnnotationForm(
  props: PopoverAnnotationFormInput,
): AnnotationFormState {
  const mutations = useAnnotationMutations({
    traceId: props.traceId,
    mode: props.mode,
    annotationId: props.annotationId,
    enabled: props.open,
    onDone: () => props.onOpenChange(false),
    anchorKind: props.anchorKind,
    anchorId: props.anchorId,
    anchorPath: props.anchorPath,
  });
  const { isEdit, existing } = mutations;

  const [comment, setComment] = useState("");
  const [expectedOutput, setExpectedOutput] = useState("");
  const [scoreOptions, setScoreOptions] = useState<ScoreOptions>({});

  // Seed local form state when the popover opens.
  useEffect(() => {
    if (!props.open) return;
    const seed = seedDraftValues({
      existing: isEdit ? existing : undefined,
      mode: props.mode,
      output: props.output,
    });
    setComment(seed.comment);
    setExpectedOutput(seed.expectedOutput);
    setScoreOptions(seed.scoreOptions);
  }, [props.open, isEdit, existing, props.mode, props.output]);

  return {
    comment,
    setComment,
    expectedOutput,
    setExpectedOutput,
    scoreOptions,
    setScoreOptions,
    scores: mutations.scores,
    isEdit,
    isSaving: mutations.isSaving,
    isDeleting: mutations.isDeleting,
    hasExisting: mutations.hasExisting,
    isSaveBlocked: mutations.isSaveBlocked,
    isAnchored: !!props.anchorKind,
    anchorLabel: describeAnnotationAnchor({
      anchor: {
        anchorKind: props.anchorKind ?? null,
        anchorId: props.anchorId ?? null,
        anchorPath: props.anchorPath ?? null,
      },
      traceId: props.traceId,
    }),
    handleSave: () => mutations.save({ comment, expectedOutput, scoreOptions }),
    handleDelete: mutations.remove,
    onCancel: () => props.onOpenChange(false),
    mode: props.mode,
  };
}

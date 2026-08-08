import type { AnnotationScoreDataType } from "@prisma/client";
import type { AnnotationAnchorColumns } from "~/server/annotations/annotationAnchor";
import type { RouterOutputs } from "~/utils/api";

export type AnnotationScoreList =
  RouterOutputs["annotationScore"]["getAllActive"];
export type TraceAnnotation =
  RouterOutputs["annotation"]["getByTraceId"][number];

/** Rating a turn versus correcting its output. */
export type AnnotationMode = "annotate" | "suggest";

interface ScoreValue {
  value: string | string[];
  reason?: string;
}

export type ScoreOptions = Record<string, ScoreValue>;

export interface AnnotationScoreOption {
  label: string;
  value: number | string;
}

/** What the reviewer typed, before it becomes an annotation. */
export interface AnnotationDraftValues {
  comment: string;
  expectedOutput: string;
  scoreOptions: ScoreOptions;
}

/**
 * Everything the form body renders from and writes to. A host owns the draft
 * values however it likes (popover-local state, a store) and hands the body
 * this one shape.
 */
export interface AnnotationFormState {
  comment: string;
  setComment: (v: string) => void;
  expectedOutput: string;
  setExpectedOutput: (v: string) => void;
  scoreOptions: ScoreOptions;
  setScoreOptions: React.Dispatch<React.SetStateAction<ScoreOptions>>;
  scores: { data: AnnotationScoreList | undefined; isLoading: boolean };
  isEdit: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  hasExisting: boolean;
  /** Whether saving is off the table right now, and Save says so. */
  isSaveBlocked: boolean;
  /**
   * Whether the comment is about one part of the trace rather than the whole of
   * it. A score is a project-wide key with no notion of a target and becomes a
   * column for the trace, so an anchored comment is not offered any.
   */
  isAnchored: boolean;
  /**
   * The part of the trace the comment is about, in words. Null for a comment
   * about the trace as a whole, which has no part to name. The composer says it
   * out loud so a reviewer typing into a form that floats over the trace, or
   * docks in a column beside it, never has to remember what they clicked.
   */
  anchorLabel: string | null;
  handleSave: () => void;
  handleDelete: () => void;
  onCancel: () => void;
  mode: AnnotationMode;
}

/** The server half of an annotation form, independent of where it renders. */
export interface AnnotationMutations {
  existing: TraceAnnotation | undefined;
  isEdit: boolean;
  hasExisting: boolean;
  scores: { data: AnnotationScoreList | undefined; isLoading: boolean };
  isSaving: boolean;
  isDeleting: boolean;
  isSaveBlocked: boolean;
  save: (values: AnnotationDraftValues) => void;
  remove: () => void;
}

/** What a popover host tells the form about the turn it is annotating. */
export interface PopoverAnnotationFormInput extends AnnotationAnchorColumns {
  traceId: string;
  /** Current trace output. Pre-filled into the suggest field. */
  output?: string | null;
  mode: AnnotationMode;
  /** When set, opens in edit mode for this annotation. */
  annotationId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export interface ScoreChipProps {
  name: string;
  description?: string | null;
  dataType: AnnotationScoreDataType;
  options: AnnotationScoreOption[];
  value: string | string[] | undefined;
  reason: string;
  onChange: (value: string | string[], reason?: string) => void;
}

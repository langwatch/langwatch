import type {
  Annotation,
  AnnotationAnchorColumns,
  AnnotationScore,
  AnnotationScoreDataType,
} from "@langwatch/annotation-contract";
import type { Dispatch, ReactNode, SetStateAction } from "react";

export type AnnotationScoreList = AnnotationScore[];
export type TraceAnnotation = Annotation;

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
 * values however it likes and hands the body this one shape.
 */
export interface AnnotationFormState {
  comment: string;
  setComment: (value: string) => void;
  expectedOutput: string;
  setExpectedOutput: (value: string) => void;
  scoreOptions: ScoreOptions;
  setScoreOptions: Dispatch<SetStateAction<ScoreOptions>>;
  scores: { data: AnnotationScoreList | undefined; isLoading: boolean };
  isEdit: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  hasExisting: boolean;
  isSaveBlocked: boolean;
  anchorLabel: string | null;
  suggestTarget: "input" | "output";
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
  output?: string | null;
  mode: AnnotationMode;
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

export interface AnnotationPopoverRenderProps extends PopoverAnnotationFormInput {
  trigger: ReactNode;
  triggerTooltip?: string;
  thread?: ReactNode;
}

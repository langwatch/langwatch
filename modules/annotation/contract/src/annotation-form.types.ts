/**
 * What an annotation form holds and writes, independent of where it renders: the reviewer's
 * draft, the form's state, the server half, and what a popover host tells it.
 */
import { z } from "zod";

import type { AnnotationAnchorColumns } from "./annotation-anchor.schemas.ts";
import type { AnnotationMode, AnnotationScore, ScoreOptions } from "./annotation-score.schemas.ts";
import type { Annotation } from "./annotation.schemas.ts";

/** A score as a query hands it to the browser: its instants arrive as ISO strings. */
export type AnnotationScoreList = (Omit<
  AnnotationScore,
  "createdAt" | "updatedAt" | "deletedAt"
> & {
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
})[];

/** An annotation as a query hands it to the browser: its instants arrive as ISO strings. */
export type TraceAnnotation = Omit<Annotation, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

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
  setScoreOptions: (next: ScoreOptions | ((previous: ScoreOptions) => ScoreOptions)) => void;
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

const annotationScoreOptionSchema = z.object({
  value: z.union([z.string(), z.array(z.string())]),
  reason: z.string().optional(),
});

const annotationScoreOptionsSchema = z.record(z.string(), z.unknown());

/** Reads stored score choices into the controlled annotation form shape. */
export function readAnnotationScoreOptions(value: unknown): ScoreOptions {
  const parsedOptions = annotationScoreOptionsSchema.safeParse(value);
  if (!parsedOptions.success) return {};

  const scoreOptions: ScoreOptions = {};
  for (const [scoreId, rawScore] of Object.entries(parsedOptions.data)) {
    const parsedScore = annotationScoreOptionSchema.safeParse(rawScore);
    if (parsedScore.success) scoreOptions[scoreId] = parsedScore.data;
  }
  return scoreOptions;
}

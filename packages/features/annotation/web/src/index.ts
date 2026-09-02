/**
 * The names `platform/app` still imports from this package.
 *
 * The package was relaid out to the ADR-004 two-scope layout in the annotations
 * page move; this entry keeps serving every name it served before, because a
 * dozen `platform/app` modules import them and the deletes-only ruling forbids
 * repointing a single one. It is the same `ui-web-public-entry` finding
 * `@langwatch/dataset-web`, `@langwatch/ops-web` and `@langwatch/user-web`
 * carry, and it dies with the last platform importer.
 *
 * The pages themselves are NOT here: they are `./screens/annotations`, which is
 * the governed entry `apps/ui` mounts.
 */

export { AnnotationAvatarGroup } from "./ui/elements/annotation-avatar-group";
export { AnnotationCommentsChip } from "./ui/elements/annotation-comments-chip";
export { AnnotationHoverChip } from "./ui/elements/annotation-hover-chip";
export { AnnotationScoresChip } from "./ui/elements/annotation-scores-chip";
export { AnnotationSuggestionsChip } from "./ui/elements/annotation-suggestions-chip";
export { AnnotationCard } from "./ui/blocks/annotation-card";
export {
  AnnotationTable,
  AnnotationTableSkeleton,
  type AnnotationTableProps,
  type AnnotationTableTraceField,
} from "./ui/blocks/annotation-table";
export { AnnotateBody, FormFooter, SuggestBody } from "./ui/blocks/annotation-form-body";
export { DiffCounts, DiffPanel, useOutputDiff } from "./ui/blocks/annotation-output-diff";
export { ScoreFields, ScoreChip } from "./ui/blocks/annotation-score-fields";
export { readAnnotationScoreOptions } from "./model/annotation-score-options";
export {
  AnnotationCommentCard,
  AnnotationCommentEditor,
  AnnotationScoringDisabled,
  type AnnotationCommentEditorProps,
  type AnnotationCommentScore,
  type AnnotationCommentScoreOptions,
} from "./ui/blocks/annotation-comment-editor";
export {
  AnnotationScoreEditor,
  type AnnotationScoreEditorProps,
} from "./ui/blocks/annotation-score-editor";
export type {
  AnnotationDraftValues,
  AnnotationFormState,
  AnnotationMutations,
  AnnotationPopoverRenderProps,
  AnnotationScoreList,
  AnnotationScoreOption,
  PopoverAnnotationFormInput,
  ScoreChipProps,
  TraceAnnotation,
} from "./model/annotation-form-types";
export {
  annotationAnchorLabel,
  annotationRatingExportLabel,
  annotationScores,
  annotationScoresLine,
  countAnnotationScores,
  groupedAnnotationsToRows,
  lastAnnotatedAt,
  queueItemsToRows,
  suggestionExportLine,
  toOccurredAtMsHint,
  type AnnotationAnchorValue,
  type AnnotationRow,
  type AnnotationScoreValue,
  type AnnotationSuggestionValue,
  type AnnotationTrace,
  type AnnotationUser,
} from "./model/annotation-row";

/**
 * Annotation's lent form, stood in for trace's tests by plain controls that read
 * the form state. Annotation's own tests cover the real form.
 */
import type {
  AnnotateBodyProps,
  AnnotationFormFooterProps,
  AnnotationFormState,
  SuggestBodyProps,
} from "@langwatch/annotation-contract";

function CommentAndScores({ state }: { state: AnnotationFormState }) {
  const scores = state.scores.data ?? [];
  return (
    <>
      {state.anchorLabel && (
        <span data-testid="annotation-composer-anchor">{state.anchorLabel}</span>
      )}
      {state.isEdit && state.hasExisting && (
        <button type="button" aria-label="Delete annotation" onClick={state.handleDelete} />
      )}
      <textarea
        placeholder="Optional"
        value={state.comment}
        onChange={(e) => state.setComment(e.target.value)}
      />
      {scores.length > 0 && <span>Scores</span>}
      {scores.map((score) => (
        <span key={score.id}>{score.name}</span>
      ))}
    </>
  );
}

export function AnnotateBody({ state }: AnnotateBodyProps) {
  return (
    <>
      <span>{state.isEdit ? "Edit annotation" : "Add annotation"}</span>
      <CommentAndScores state={state} />
    </>
  );
}

export function SuggestBody({ state, originalOutput }: SuggestBodyProps) {
  return (
    <>
      <span>{state.suggestTarget === "input" ? "Suggested input" : "Expected output"}</span>
      <textarea
        placeholder={`What should the ${state.suggestTarget} have been?`}
        value={state.expectedOutput}
        onChange={(e) => state.setExpectedOutput(e.target.value)}
      />
      <button type="button" onClick={() => state.setExpectedOutput(originalOutput)}>
        Reset
      </button>
      <CommentAndScores state={state} />
    </>
  );
}

export function FormFooter({ state }: AnnotationFormFooterProps) {
  return (
    <>
      <button type="button" onClick={state.onCancel}>
        Cancel
      </button>
      <button type="button" onClick={state.handleSave} disabled={state.isSaveBlocked}>
        {state.isEdit ? "Update" : "Save"}
      </button>
    </>
  );
}

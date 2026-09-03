import type { EvaluationsV3State } from "../../types";

/**
 * The slice of workbench state every transform reads and writes.
 *
 * Structurally the persisted projection (`PersistedEvaluationsV3State` minus
 * `results` and the persisted UI settings): the same `name` / `datasets` /
 * `activeDatasetId` / `evaluators` / `targets` fields the autosave writes and
 * `zundo` partializes for undo. Transforms never see execution results, drawer
 * state, selections or column widths, so the same function runs unchanged in
 * the browser store and on the server.
 */
export type WorkbenchState = Pick<
  EvaluationsV3State,
  "name" | "datasets" | "activeDatasetId" | "evaluators" | "targets"
> & {
  experimentId?: string;
  experimentSlug?: string;
};

/**
 * Stable failure codes. Callers (the store, the action executor, the copilot)
 * map these onto their own error presentation; the message is for logs only.
 */
export const TRANSFORM_ERROR_CODES = [
  "target_not_found",
  "evaluator_not_found",
  "dataset_not_found",
  /** The dataset is saved, so its rows and columns belong to the dataset API. */
  "dataset_not_editable",
  /** The target has no local prompt config to merge the change into. */
  "target_prompt_config_missing",
  "column_not_found",
  "column_already_exists",
  /** The payload named a target id the workbench already holds. */
  "target_already_exists",
  /** The payload named an evaluator id the workbench already holds. */
  "evaluator_already_exists",
  /**
   * A `comparison` config was given for an evaluator type that cannot own a
   * standalone comparison column.
   */
  "evaluator_comparison_type_invalid",
  "invalid_payload",
] as const;

export type TransformErrorCode = (typeof TRANSFORM_ERROR_CODES)[number];

/**
 * The one failure type a transform throws. Carries a stable `code` so callers
 * can act on it without reading prose, plus optional `meta` naming the ids
 * involved.
 */
export class TransformError extends Error {
  readonly code: TransformErrorCode;
  readonly meta?: Record<string, unknown>;

  constructor({
    code,
    message,
    meta,
  }: {
    code: TransformErrorCode;
    message?: string;
    meta?: Record<string, unknown>;
  }) {
    super(message ?? code);
    this.name = "TransformError";
    this.code = code;
    this.meta = meta;
  }
}

export const isTransformError = (error: unknown): error is TransformError =>
  error instanceof TransformError;

/**
 * A pure workbench transform: state in, state out, plus an optional result the
 * caller reports back (a generated id, a row count).
 */
export type Transform<Payload, Result = undefined> = (args: {
  state: WorkbenchState;
  payload: Payload;
}) => { state: WorkbenchState; result?: Result };

/**
 * A transform with its payload type erased, for the manifest.
 *
 * `payload: never` is what makes every concrete `Transform<P, R>` assignable
 * here: function parameters are contravariant, and `never` is assignable to
 * every `P`. The executor parses the payload with the kind's schema before it
 * calls through, which is where the real type is checked.
 */
export type AnyTransform = (args: { state: WorkbenchState; payload: never }) => {
  state: WorkbenchState;
  result?: unknown;
};

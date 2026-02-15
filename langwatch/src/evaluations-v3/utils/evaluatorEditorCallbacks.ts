/**
 * Helper to create type-safe evaluator editor callbacks for evaluations-v3.
 *
 * This ensures we never forget a required callback when opening the evaluator editor
 * for a target. If we add a new callback that all evaluations-v3 flows need,
 * we add it here and TypeScript will enforce it everywhere.
 *
 * Mirrors the pattern in promptEditorCallbacks.ts for prompt targets.
 */

import type { LocalEvaluatorConfig } from "../types";

/**
 * Parameters required to create evaluator editor callbacks.
 * All fields are required to ensure we don't forget anything.
 */
export type CreateEvaluatorEditorCallbacksParams = {
  targetId: string;
  updateTarget: (
    id: string,
    updates: {
      localEvaluatorConfig?: LocalEvaluatorConfig;
    },
  ) => void;
};

/**
 * The callbacks object returned by createEvaluatorEditorCallbacks.
 * All callbacks are required - this is what gets passed to setFlowCallbacks.
 */
export type EvaluatorEditorCallbacksForTarget = {
  onLocalConfigChange: (
    localConfig: LocalEvaluatorConfig | undefined,
  ) => void;
};

/**
 * Creates the standard set of evaluator editor callbacks for a target in evaluations-v3.
 *
 * This helper ensures we always set up all required callbacks consistently.
 * If you need to add a new callback that all evaluations-v3 flows need,
 * add it here and TypeScript will enforce it everywhere.
 *
 * @example
 * ```ts
 * const callbacks = createEvaluatorEditorCallbacks({
 *   targetId,
 *   updateTarget,
 * });
 * setFlowCallbacks("evaluatorEditor", callbacks);
 * ```
 */
export const createEvaluatorEditorCallbacks = ({
  targetId,
  updateTarget,
}: CreateEvaluatorEditorCallbacksParams): EvaluatorEditorCallbacksForTarget => ({
  onLocalConfigChange: (localConfig) => {
    // Only update localEvaluatorConfig for tracking unsaved changes
    updateTarget(targetId, { localEvaluatorConfig: localConfig });
  },
});

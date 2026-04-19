/**
 * Helper to create type-safe evaluator editor callbacks for evaluations-v3.
 *
 * This ensures we never forget a required callback when opening the evaluator editor
 * for a target. If we add a new callback that all evaluations-v3 flows need,
 * we add it here and TypeScript will enforce it everywhere.
 *
 * Mirrors the pattern in promptEditorCallbacks.ts for prompt targets.
 */

import type { FieldMapping as UIFieldMapping } from "~/components/variables";
import type { LocalEvaluatorConfig } from "../types";

/**
 * Parameters to create evaluator editor callbacks.
 *
 * `targetId` + `updateTarget` are only required when the caller wants an
 * `onLocalConfigChange` wired up to a specific evaluations-v3 target. Contexts
 * that do not have a target (e.g. OnlineEvaluationDrawer) omit them.
 */
export type CreateEvaluatorEditorCallbacksParams = {
  targetId?: string;
  updateTarget?: (
    id: string,
    updates: {
      localEvaluatorConfig?: LocalEvaluatorConfig;
    },
  ) => void;
  onMappingChange?: (
    identifier: string,
    mapping: UIFieldMapping | undefined,
  ) => void;
  onSave?: (evaluator: {
    id: string;
    name: string;
    evaluatorType?: string;
  }) => boolean | void | Promise<void> | Promise<boolean>;
};

/**
 * The callbacks object returned by createEvaluatorEditorCallbacks.
 * All fields are optional so callers only pay for what they use.
 */
export type EvaluatorEditorCallbacksForTarget = {
  onLocalConfigChange?: (
    localConfig: LocalEvaluatorConfig | undefined,
  ) => void;
  onMappingChange?: (
    identifier: string,
    mapping: UIFieldMapping | undefined,
  ) => void;
  onSave?: (evaluator: {
    id: string;
    name: string;
    evaluatorType?: string;
  }) => boolean | void | Promise<void> | Promise<boolean>;
};

/**
 * Creates a canonical set of evaluator editor flow callbacks.
 *
 * This centralizes the "open the evaluator editor" callback registration so
 * every site routes non-serializable callbacks through `setFlowCallbacks`
 * (durable) rather than embedding them in `mappingsConfig` (ephemeral,
 * cleared on ErrorBoundary remount — see issue #3087).
 *
 * @example Evaluations-v3 (with target-bound local config tracking):
 * ```ts
 * setFlowCallbacks("evaluatorEditor",
 *   createEvaluatorEditorCallbacks({ targetId, updateTarget, onMappingChange }),
 * );
 * ```
 *
 * @example OnlineEvaluationDrawer (no target, only mapping persistence):
 * ```ts
 * setFlowCallbacks("evaluatorEditor",
 *   createEvaluatorEditorCallbacks({ onMappingChange }),
 * );
 * ```
 */
export const createEvaluatorEditorCallbacks = ({
  targetId,
  updateTarget,
  onMappingChange,
  onSave,
}: CreateEvaluatorEditorCallbacksParams): EvaluatorEditorCallbacksForTarget => {
  const callbacks: EvaluatorEditorCallbacksForTarget = {};
  if (targetId !== undefined && updateTarget) {
    callbacks.onLocalConfigChange = (localConfig) => {
      updateTarget(targetId, { localEvaluatorConfig: localConfig });
    };
  }
  if (onMappingChange) callbacks.onMappingChange = onMappingChange;
  if (onSave) callbacks.onSave = onSave;
  return callbacks;
};

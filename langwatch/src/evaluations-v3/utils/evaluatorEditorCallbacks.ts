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
 * Two ways to wire `onLocalConfigChange`:
 *
 * 1. **Direct** — pass `onLocalConfigChange` (recommended for sites that
 *    don't need the evaluations-v3 target-bound convenience, e.g. an
 *    evaluator chip whose local config updates an evaluator, not a target).
 *
 * 2. **Target-bound convenience** — pass `targetId + updateTarget`. The
 *    helper synthesizes `onLocalConfigChange` as
 *    `(lc) => updateTarget(targetId, { localEvaluatorConfig: lc })`. Used by
 *    `useOpenTargetEditor` for the prompt-target / agent-target / evaluator-
 *    target editor flows where a real target id exists.
 *
 * If both are provided, the direct `onLocalConfigChange` wins and the
 * target-bound convenience is ignored. Contexts without any local-config
 * persistence (e.g. `OnlineEvaluationDrawer`) omit all three.
 */
export type CreateEvaluatorEditorCallbacksParams = {
  /** Direct local-config sink (use this when no target id is available). */
  onLocalConfigChange?: (
    localConfig: LocalEvaluatorConfig | undefined,
  ) => void;
  /** Target-bound convenience: requires `updateTarget` to also be provided. */
  targetId?: string;
  /** Target-bound convenience: requires `targetId` to also be provided. */
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
 * @example Direct (TargetCell evaluator chip — local config updates the evaluator, not a target):
 * ```ts
 * setFlowCallbacks("evaluatorEditor",
 *   createEvaluatorEditorCallbacks({
 *     onLocalConfigChange: (lc) => updateEvaluator(evaluator.id, { localEvaluatorConfig: lc }),
 *     onMappingChange,
 *   }),
 * );
 * ```
 *
 * @example Target-bound convenience (useOpenTargetEditor — prompt/agent/evaluator-target editors):
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
  onLocalConfigChange,
  targetId,
  updateTarget,
  onMappingChange,
  onSave,
}: CreateEvaluatorEditorCallbacksParams): EvaluatorEditorCallbacksForTarget => {
  const callbacks: EvaluatorEditorCallbacksForTarget = {};
  if (onLocalConfigChange) {
    callbacks.onLocalConfigChange = onLocalConfigChange;
  } else if (targetId !== undefined && updateTarget) {
    callbacks.onLocalConfigChange = (localConfig) => {
      updateTarget(targetId, { localEvaluatorConfig: localConfig });
    };
  }
  if (onMappingChange) callbacks.onMappingChange = onMappingChange;
  if (onSave) callbacks.onSave = onSave;
  return callbacks;
};

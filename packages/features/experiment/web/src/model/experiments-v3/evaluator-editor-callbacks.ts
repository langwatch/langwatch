/**
 * Helper to create type-safe evaluator editor callbacks for experiments-v3.
 */

import type { FieldMapping as UIFieldMapping } from "@langwatch/prompt-web/surfaces/variables";
import type { ComparisonEvaluatorConfig, LocalEvaluatorConfig } from "./types";

/**
 * Parameters to create evaluator editor callbacks.
 */
export type CreateEvaluatorEditorCallbacksParams = {
  /** Direct local-config sink (use this when no target id is available). */
  onLocalConfigChange?: (localConfig: LocalEvaluatorConfig | undefined) => void;
  /** Target-bound convenience: requires `updateTarget` to also be provided. */
  targetId?: string;
  /** Target-bound convenience: requires `targetId` to also be provided. */
  updateTarget?: (
    id: string,
    updates: {
      localEvaluatorConfig?: LocalEvaluatorConfig;
    },
  ) => void;
  onMappingChange?: (identifier: string, mapping: UIFieldMapping | undefined) => void;
  /**
   * Comparison evaluator config sink.
   */
  onComparisonChange?: (config: ComparisonEvaluatorConfig) => void;
  onSave?: (evaluator: {
    id: string;
    name: string;
    evaluatorType?: string;
  }) => boolean | undefined | Promise<void> | Promise<boolean>;
};

/**
 * The callbacks object returned by createEvaluatorEditorCallbacks.
 * All fields are optional so callers only pay for what they use.
 */
export type EvaluatorEditorCallbacksForTarget = {
  onLocalConfigChange?: (localConfig: LocalEvaluatorConfig | undefined) => void;
  onMappingChange?: (identifier: string, mapping: UIFieldMapping | undefined) => void;
  onComparisonChange?: (config: ComparisonEvaluatorConfig) => void;
  onSave?: (evaluator: {
    id: string;
    name: string;
    evaluatorType?: string;
  }) => boolean | undefined | Promise<void> | Promise<boolean>;
};

/**
 * Creates a canonical set of evaluator editor flow callbacks.
 */
export const createEvaluatorEditorCallbacks = ({
  onLocalConfigChange,
  targetId,
  updateTarget,
  onMappingChange,
  onComparisonChange,
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
  if (onComparisonChange) callbacks.onComparisonChange = onComparisonChange;
  if (onSave) callbacks.onSave = onSave;
  return callbacks;
};

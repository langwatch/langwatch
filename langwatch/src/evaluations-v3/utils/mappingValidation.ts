/**
 * Mapping Validation Utility for Evaluations V3
 *
 * Provides functions to detect missing mappings for runners and evaluators.
 * Used to show validation alerts and highlight fields that need attention.
 */

import type {
  DatasetReference,
  RunnerConfig,
  EvaluatorConfig,
  FieldMapping,
} from "../types";
import type { Field } from "~/optimization_studio/types/dsl";

// ============================================================================
// Types
// ============================================================================

export type MissingMapping = {
  /** The field identifier that is missing a mapping */
  fieldId: string;
  /** The field name (may be same as identifier) */
  fieldName: string;
  /** Whether this field is required (optional fields don't block execution) */
  isRequired: boolean;
};

export type RunnerValidationResult = {
  /** Whether the runner has all required mappings */
  isValid: boolean;
  /** List of fields missing mappings */
  missingMappings: MissingMapping[];
};

export type EvaluatorValidationResult = {
  /** Whether the evaluator has all required mappings for the given runner */
  isValid: boolean;
  /** List of fields missing mappings */
  missingMappings: MissingMapping[];
};

export type WorkbenchValidationResult = {
  /** Whether all runners and evaluators have valid mappings */
  isValid: boolean;
  /** First runner with missing mappings (if any) */
  firstInvalidRunner?: {
    runner: RunnerConfig;
    missingMappings: MissingMapping[];
  };
  /** First evaluator with missing mappings (if any) */
  firstInvalidEvaluator?: {
    evaluator: EvaluatorConfig;
    runnerId: string;
    missingMappings: MissingMapping[];
  };
};

// ============================================================================
// Field Usage Detection
// ============================================================================

/**
 * Extract fields used in a prompt's message content.
 * Fields are referenced using {{fieldName}} syntax.
 *
 * @param content - The prompt message content
 * @returns Set of field names used in the content
 */
export const extractFieldsFromContent = (content: string): Set<string> => {
  const pattern = /\{\{(\w+)\}\}/g;
  const fields = new Set<string>();
  let match;

  while ((match = pattern.exec(content)) !== null) {
    fields.add(match[1]!);
  }

  return fields;
};

/**
 * Get all fields that are actually used in a runner's prompt.
 * For prompts, checks message content for {{fieldName}} references.
 * For code runners, all inputs are considered used.
 *
 * @param runner - The runner to check
 * @returns Set of field identifiers that are used
 */
export const getUsedFields = (runner: RunnerConfig): Set<string> => {
  const usedFields = new Set<string>();

  if (runner.type === "prompt") {
    // For prompt runners, only check localPromptConfig if available
    if (runner.localPromptConfig) {
      for (const message of runner.localPromptConfig.messages) {
        const fieldsInMessage = extractFieldsFromContent(message.content);
        for (const field of fieldsInMessage) {
          usedFields.add(field);
        }
      }
    }
    // If no localPromptConfig, we can't determine used fields yet
    // (prompt content will be loaded when drawer opens)
    // Return empty set - no fields are known to be used
  } else {
    // For code runners, all inputs are used
    for (const input of runner.inputs) {
      usedFields.add(input.identifier);
    }
  }

  return usedFields;
};

// ============================================================================
// Runner Validation
// ============================================================================

/**
 * Check if a runner has all required mappings for a dataset.
 *
 * A mapping is required if the field is BOTH:
 * 1. Used in the prompt (referenced via {{fieldName}})
 * 2. Listed in the inputs array (explicitly defined by user)
 *
 * Fields that are only used but not listed ("Undefined variables") are NOT required -
 * the user may intentionally leave them undefined for pass-through.
 *
 * For code runners, all inputs are required.
 *
 * @param runner - The runner to validate
 * @param datasetId - The dataset to validate against
 * @returns Validation result with missing mappings
 */
export const getRunnerMissingMappings = (
  runner: RunnerConfig,
  datasetId: string
): RunnerValidationResult => {
  const missingMappings: MissingMapping[] = [];
  const usedFields = getUsedFields(runner);
  const datasetMappings = runner.mappings[datasetId] ?? {};

  // Get the set of input identifiers (fields explicitly defined by user)
  // Use localPromptConfig.inputs if available (has latest form state),
  // otherwise fall back to runner.inputs
  const inputs = runner.localPromptConfig?.inputs ?? runner.inputs;
  const inputIds = new Set(inputs.map((i) => i.identifier));

  // A field is required if it's BOTH used AND in the inputs list
  // "Undefined variables" (used but not in inputs) don't require mappings
  for (const fieldId of usedFields) {
    // Skip if not in inputs list - user hasn't defined this variable
    if (!inputIds.has(fieldId)) continue;

    const hasMapping = datasetMappings[fieldId] !== undefined;

    if (!hasMapping) {
      missingMappings.push({
        fieldId,
        fieldName: fieldId,
        isRequired: true,
      });
    }
  }

  return {
    isValid: missingMappings.filter((m) => m.isRequired).length === 0,
    missingMappings,
  };
};

/**
 * Check if a runner has any missing mappings (simpler check for UI alerts).
 *
 * @param runner - The runner to check
 * @param datasetId - The dataset to check against
 * @returns true if there are missing required mappings
 */
export const runnerHasMissingMappings = (
  runner: RunnerConfig,
  datasetId: string
): boolean => {
  const { isValid } = getRunnerMissingMappings(runner, datasetId);
  return !isValid;
};

// ============================================================================
// Evaluator Validation
// ============================================================================

/**
 * Check if an evaluator has all required mappings for a specific runner and dataset.
 *
 * Evaluators have standard inputs like:
 * - input: Usually from dataset
 * - output: Usually from runner
 * - expected_output: Usually from dataset
 *
 * @param evaluator - The evaluator to validate
 * @param datasetId - The dataset to validate against
 * @param runnerId - The runner to validate against
 * @returns Validation result with missing mappings
 */
export const getEvaluatorMissingMappings = (
  evaluator: EvaluatorConfig,
  datasetId: string,
  runnerId: string
): EvaluatorValidationResult => {
  const missingMappings: MissingMapping[] = [];
  const runnerMappings = evaluator.mappings[datasetId]?.[runnerId] ?? {};

  for (const input of evaluator.inputs) {
    const hasMapping = runnerMappings[input.identifier] !== undefined;

    if (!hasMapping) {
      missingMappings.push({
        fieldId: input.identifier,
        fieldName: input.identifier,
        isRequired: true, // All evaluator inputs are typically required
      });
    }
  }

  return {
    isValid: missingMappings.filter((m) => m.isRequired).length === 0,
    missingMappings,
  };
};

/**
 * Check if an evaluator has any missing mappings for a runner.
 *
 * @param evaluator - The evaluator to check
 * @param datasetId - The dataset to check against
 * @param runnerId - The runner to check against
 * @returns true if there are missing required mappings
 */
export const evaluatorHasMissingMappings = (
  evaluator: EvaluatorConfig,
  datasetId: string,
  runnerId: string
): boolean => {
  const { isValid } = getEvaluatorMissingMappings(evaluator, datasetId, runnerId);
  return !isValid;
};

// ============================================================================
// Workbench Validation (All Runners + Evaluators)
// ============================================================================

/**
 * Validate all runners and evaluators in the workbench.
 * Returns the first invalid entity found (useful for opening the right drawer).
 *
 * @param runners - All runners in the workbench
 * @param evaluators - All evaluators in the workbench
 * @param activeDatasetId - The currently active dataset
 * @returns Validation result with first invalid entity
 */
export const validateWorkbench = (
  runners: RunnerConfig[],
  evaluators: EvaluatorConfig[],
  activeDatasetId: string
): WorkbenchValidationResult => {
  // Check runners first
  for (const runner of runners) {
    const validation = getRunnerMissingMappings(runner, activeDatasetId);
    if (!validation.isValid) {
      return {
        isValid: false,
        firstInvalidRunner: {
          runner,
          missingMappings: validation.missingMappings,
        },
      };
    }

    // Check evaluators for this runner
    for (const evaluatorId of runner.evaluatorIds) {
      const evaluator = evaluators.find((e) => e.id === evaluatorId);
      if (!evaluator) continue;

      const evalValidation = getEvaluatorMissingMappings(
        evaluator,
        activeDatasetId,
        runner.id
      );
      if (!evalValidation.isValid) {
        return {
          isValid: false,
          firstInvalidEvaluator: {
            evaluator,
            runnerId: runner.id,
            missingMappings: evalValidation.missingMappings,
          },
        };
      }
    }
  }

  return { isValid: true };
};

/**
 * Get all missing mappings for all runners (used for batch display).
 *
 * @param runners - All runners to check
 * @param datasetId - The dataset to check against
 * @returns Map of runnerId -> missing mappings
 */
export const getAllRunnerMissingMappings = (
  runners: RunnerConfig[],
  datasetId: string
): Map<string, MissingMapping[]> => {
  const result = new Map<string, MissingMapping[]>();

  for (const runner of runners) {
    const validation = getRunnerMissingMappings(runner, datasetId);
    if (validation.missingMappings.length > 0) {
      result.set(runner.id, validation.missingMappings);
    }
  }

  return result;
};

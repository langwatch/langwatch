/**
 * Mapping Validation Utility for Evaluations V3
 *
 * Provides functions to detect missing mappings for targets and evaluators.
 * Used to show validation alerts and highlight fields that need attention.
 */

import type {
  DatasetReference,
  TargetConfig,
  EvaluatorConfig,
  FieldMapping,
} from "../types";
import type { Field } from "~/optimization_studio/types/dsl";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "~/server/evaluations/evaluators.generated";

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

export type TargetValidationResult = {
  /** Whether the target has all required mappings */
  isValid: boolean;
  /** List of fields missing mappings */
  missingMappings: MissingMapping[];
};

export type EvaluatorValidationResult = {
  /** Whether the evaluator has all required mappings for the given target */
  isValid: boolean;
  /** List of fields missing mappings */
  missingMappings: MissingMapping[];
};

export type WorkbenchValidationResult = {
  /** Whether all targets and evaluators have valid mappings */
  isValid: boolean;
  /** First target with missing mappings (if any) */
  firstInvalidTarget?: {
    target: TargetConfig;
    missingMappings: MissingMapping[];
  };
  /** First evaluator with missing mappings (if any) */
  firstInvalidEvaluator?: {
    evaluator: EvaluatorConfig;
    targetId: string;
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
 * Get all fields that are actually used in a target's prompt.
 * For prompts, checks message content for {{fieldName}} references.
 * For code targets, all inputs are considered used.
 *
 * @param target - The target to check
 * @returns Set of field identifiers that are used
 */
export const getUsedFields = (target: TargetConfig): Set<string> => {
  const usedFields = new Set<string>();

  if (target.type === "prompt") {
    // For prompt targets, check localPromptConfig if available (has actual content)
    if (target.localPromptConfig) {
      for (const message of target.localPromptConfig.messages) {
        const fieldsInMessage = extractFieldsFromContent(message.content);
        for (const field of fieldsInMessage) {
          usedFields.add(field);
        }
      }
    } else {
      // If no localPromptConfig yet, fall back to target.inputs
      // These are the explicitly defined variables that need mappings
      for (const input of target.inputs ?? []) {
        usedFields.add(input.identifier);
      }
    }
  } else {
    // For code targets, all inputs are used
    for (const input of target.inputs ?? []) {
      usedFields.add(input.identifier);
    }
  }

  return usedFields;
};

// ============================================================================
// Target Validation
// ============================================================================

/**
 * Check if a target has all required mappings for a dataset.
 *
 * A mapping is required if the field is BOTH:
 * 1. Used in the prompt (referenced via {{fieldName}})
 * 2. Listed in the inputs array (explicitly defined by user)
 *
 * Fields that are only used but not listed ("Undefined variables") are NOT required -
 * the user may intentionally leave them undefined for pass-through.
 *
 * For code targets, all inputs are required.
 *
 * @param target - The target to validate
 * @param datasetId - The dataset to validate against
 * @returns Validation result with missing mappings
 */
export const getTargetMissingMappings = (
  target: TargetConfig,
  datasetId: string
): TargetValidationResult => {
  const missingMappings: MissingMapping[] = [];
  const usedFields = getUsedFields(target);
  const datasetMappings = target.mappings[datasetId] ?? {};

  // Get the set of input identifiers (fields explicitly defined by user)
  // Use localPromptConfig.inputs if available (has latest form state),
  // otherwise fall back to target.inputs
  const inputs = target.localPromptConfig?.inputs ?? target.inputs ?? [];
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
 * Check if a target has any missing mappings (simpler check for UI alerts).
 *
 * @param target - The target to check
 * @param datasetId - The dataset to check against
 * @returns true if there are missing required mappings
 */
export const targetHasMissingMappings = (
  target: TargetConfig,
  datasetId: string
): boolean => {
  const { isValid } = getTargetMissingMappings(target, datasetId);
  return !isValid;
};

// ============================================================================
// Evaluator Validation
// ============================================================================

/**
 * Check if an evaluator has all required mappings for a specific target and dataset.
 *
 * Validation rules:
 * 1. ALL required fields MUST have mappings
 * 2. Optional fields MAY have mappings
 * 3. BUT if ALL fields (required + optional) are empty, that's also invalid
 *    (at least one field must be mapped)
 *
 * @param evaluator - The evaluator to validate
 * @param datasetId - The dataset to validate against
 * @param targetId - The target to validate against
 * @returns Validation result with missing mappings
 */
export const getEvaluatorMissingMappings = (
  evaluator: EvaluatorConfig,
  datasetId: string,
  targetId: string
): EvaluatorValidationResult => {
  const missingMappings: MissingMapping[] = [];
  const targetMappings = evaluator.mappings[datasetId]?.[targetId] ?? {};

  // Get the evaluator definition to know which fields are required vs optional
  const evaluatorDef = AVAILABLE_EVALUATORS[evaluator.evaluatorType as EvaluatorTypes];
  const requiredFieldsArr = evaluatorDef?.requiredFields ?? [];
  const optionalFieldsArr = evaluatorDef?.optionalFields ?? [];

  // Build sets from string arrays for easy lookup
  const requiredFieldsSet = new Set<string>(requiredFieldsArr);
  const optionalFieldsSet = new Set<string>(optionalFieldsArr);

  let hasAnyMapping = false;
  let missingRequiredCount = 0;

  for (const input of evaluator.inputs) {
    const hasMapping = targetMappings[input.identifier] !== undefined;

    if (hasMapping) {
      hasAnyMapping = true;
    } else {
      const isRequired = requiredFieldsSet.has(input.identifier);
      const isOptional = optionalFieldsSet.has(input.identifier);

      // Only add to missing if it's a required field
      if (isRequired) {
        missingRequiredCount++;
        missingMappings.push({
          fieldId: input.identifier,
          fieldName: input.identifier,
          isRequired: true,
        });
      } else if (isOptional) {
        // Optional fields are not added to missingMappings
        // They don't block validation
      } else {
        // Unknown field (not in either list) - treat as required for safety
        missingRequiredCount++;
        missingMappings.push({
          fieldId: input.identifier,
          fieldName: input.identifier,
          isRequired: true,
        });
      }
    }
  }

  // Invalid if:
  // 1. Any required field is missing, OR
  // 2. ALL fields are empty (must have at least one mapping)
  const allFieldsCount = evaluator.inputs.length;
  const isValid = missingRequiredCount === 0 && (allFieldsCount === 0 || hasAnyMapping);

  return {
    isValid,
    missingMappings,
  };
};

/**
 * Check if an evaluator has any missing mappings for a target.
 *
 * @param evaluator - The evaluator to check
 * @param datasetId - The dataset to check against
 * @param targetId - The target to check against
 * @returns true if there are missing required mappings
 */
export const evaluatorHasMissingMappings = (
  evaluator: EvaluatorConfig,
  datasetId: string,
  targetId: string
): boolean => {
  const { isValid } = getEvaluatorMissingMappings(evaluator, datasetId, targetId);
  return !isValid;
};

// ============================================================================
// Workbench Validation (All Targets + Evaluators)
// ============================================================================

/**
 * Validate all targets and evaluators in the workbench.
 * Returns the first invalid entity found (useful for opening the right drawer).
 *
 * @param targets - All targets in the workbench
 * @param evaluators - All evaluators in the workbench
 * @param activeDatasetId - The currently active dataset
 * @returns Validation result with first invalid entity
 */
export const validateWorkbench = (
  targets: TargetConfig[],
  evaluators: EvaluatorConfig[],
  activeDatasetId: string
): WorkbenchValidationResult => {
  // Check targets first
  for (const target of targets) {
    const validation = getTargetMissingMappings(target, activeDatasetId);
    if (!validation.isValid) {
      return {
        isValid: false,
        firstInvalidTarget: {
          target,
          missingMappings: validation.missingMappings,
        },
      };
    }

    // Check all evaluators for this target (evaluators apply to all targets)
    for (const evaluator of evaluators) {
      const evalValidation = getEvaluatorMissingMappings(
        evaluator,
        activeDatasetId,
        target.id
      );
      if (!evalValidation.isValid) {
        return {
          isValid: false,
          firstInvalidEvaluator: {
            evaluator,
            targetId: target.id,
            missingMappings: evalValidation.missingMappings,
          },
        };
      }
    }
  }

  return { isValid: true };
};

/**
 * Get all missing mappings for all targets (used for batch display).
 *
 * @param targets - All targets to check
 * @param datasetId - The dataset to check against
 * @returns Map of targetId -> missing mappings
 */
export const getAllTargetMissingMappings = (
  targets: TargetConfig[],
  datasetId: string
): Map<string, MissingMapping[]> => {
  const result = new Map<string, MissingMapping[]>();

  for (const target of targets) {
    const validation = getTargetMissingMappings(target, datasetId);
    if (validation.missingMappings.length > 0) {
      result.set(target.id, validation.missingMappings);
    }
  }

  return result;
};

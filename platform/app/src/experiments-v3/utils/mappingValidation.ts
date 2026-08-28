/**
 * Mapping Validation Utility for Evaluations V3
 *
 * Provides functions to detect missing mappings for targets and evaluators.
 * Used to show validation alerts and highlight fields that need attention.
 */

import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "~/server/evaluations/evaluators";
import type { EvaluatorConfig, TargetConfig } from "../types";
import { isGoldenFieldSatisfied } from "../types";
import { extractVariablesFromBodyTemplate } from "./httpAgentUtils";
import { toComparisonConfig } from "./normalizeComparison";

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

/** A message of a prompt template, as stored on the prompt or its draft. */
export type PromptTemplateMessage = {
  role: string;
  content: string;
};

/**
 * Resolves the variables a prompt target's saved template consumes.
 *
 * Only asked for prompt targets that carry no local draft. Returns undefined
 * when the template is not loaded, and the target then has nothing that can be
 * proven required.
 */
export type PromptTemplateFieldsLookup = (
  target: TargetConfig,
) => Set<string> | undefined;

export type MappingValidationOptions = {
  promptTemplateFields?: PromptTemplateFieldsLookup;
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
 * The variables a prompt template consumes.
 *
 * A `{{variable}}` reference in any message counts, the system message
 * included: the engine renders the system prompt from the same variable map as
 * the rest of the template (`buildMessages`, engine.go).
 *
 * A template with no user or assistant message consumes every declared input
 * instead. With no turn to render, the engine folds the scalar inputs into a
 * single user turn (`composeUserPrompt`, engine.go), so each declared input
 * reaches the model and needs a value.
 *
 * @param messages - The template messages, system message included
 * @param declaredFieldIds - The variables the prompt declares
 * @returns Set of variables the template consumes
 */
export const getFieldsUsedByPromptTemplate = ({
  messages,
  declaredFieldIds,
}: {
  messages: PromptTemplateMessage[];
  declaredFieldIds: string[];
}): Set<string> => {
  const hasConversationTurn = messages.some(
    (message) => message.role !== "system",
  );
  if (!hasConversationTurn) {
    return new Set(declaredFieldIds);
  }

  const usedFields = new Set<string>();
  for (const message of messages) {
    for (const field of extractFieldsFromContent(message.content)) {
      usedFields.add(field);
    }
  }

  return usedFields;
};

type UsedFieldsResolution = {
  usedFields: Set<string>;
  /**
   * Whether a template proved which variables the target consumes. False only
   * for a prompt target with neither a draft nor a loaded template, where the
   * declared input list is a guess and never a requirement.
   */
  isProven: boolean;
};

const declaredFieldIdsOf = (target: TargetConfig): string[] =>
  (target.inputs ?? []).map((input) => input.identifier);

const resolveUsedFields = (
  target: TargetConfig,
  options?: MappingValidationOptions,
): UsedFieldsResolution => {
  // Every input of a code, agent or evaluator target is passed to it.
  if (target.type !== "prompt") {
    return { usedFields: new Set(declaredFieldIdsOf(target)), isProven: true };
  }

  // A draft carries the message content the user is editing right now.
  if (target.localPromptConfig) {
    return {
      usedFields: getFieldsUsedByPromptTemplate({
        messages: target.localPromptConfig.messages,
        declaredFieldIds: target.localPromptConfig.inputs.map(
          (input) => input.identifier,
        ),
      }),
      isProven: true,
    };
  }

  const templateFields = options?.promptTemplateFields?.(target);
  if (templateFields) {
    return { usedFields: templateFields, isProven: true };
  }

  return { usedFields: new Set(declaredFieldIdsOf(target)), isProven: false };
};

/**
 * Get all fields that a target consumes.
 * For prompts, the template decides (see getFieldsUsedByPromptTemplate).
 * For code targets, all inputs are consumed.
 *
 * @param target - The target to check
 * @param options - Resolves the saved template of an undrafted prompt target
 * @returns Set of field identifiers that are used
 */
export const getUsedFields = (
  target: TargetConfig,
  options?: MappingValidationOptions,
): Set<string> => resolveUsedFields(target, options).usedFields;

// ============================================================================
// Target Validation
// ============================================================================

/**
 * Check if a target has all required mappings for a dataset.
 *
 * Validation rules vary by target type:
 *
 * **Prompts:**
 * - A mapping is required if the field is BOTH consumed by the template AND in inputs
 * - Fields only used but not listed ("Undefined variables") are NOT required
 * - A declared field the template does not consume is never required
 * - With no template at hand, nothing is required
 *
 * **HTTP Agents:**
 * - All fields are OPTIONAL (no individual field is required)
 * - BUT at least ONE field must have a mapping
 * - This allows flexibility in what data to send to the HTTP endpoint
 *
 * **Code/Other Agents:**
 * - All inputs are required (must have mappings)
 *
 * @param target - The target to validate
 * @param datasetId - The dataset to validate against
 * @param options - Resolves the saved template of an undrafted prompt target
 * @returns Validation result with missing mappings
 */
export const getTargetMissingMappings = (
  target: TargetConfig,
  datasetId: string,
  options?: MappingValidationOptions,
): TargetValidationResult => {
  const missingMappings: MissingMapping[] = [];
  const { usedFields, isProven } = resolveUsedFields(target, options);
  const datasetMappings = target.mappings[datasetId] ?? {};

  // Get the set of input identifiers (fields explicitly defined by user)
  // Use localPromptConfig.inputs if available (has latest form state),
  // otherwise fall back to target.inputs
  const inputs = target.localPromptConfig?.inputs ?? target.inputs ?? [];
  const inputIds = new Set(inputs.map((i) => i.identifier));

  // HTTP agents have special validation: all optional, but at least one required
  const isHttpAgent =
    target.type === "agent" &&
    "agentType" in target &&
    target.agentType === "http";

  // Evaluator targets use requiredFields/optionalFields from AVAILABLE_EVALUATORS
  const isEvaluatorTarget = target.type === "evaluator";

  // Comparison column-target: the high-level ComparisonConfigForm replaces the
  // per-row mappings UI. Validate against the comparison config (Variants /
  // Golden) instead of walking the input field list — those rows are derived
  // from the variants at save time, so the user never has to fill them in.
  const targetComparison = isEvaluatorTarget
    ? toComparisonConfig(target)
    : undefined;
  if (targetComparison) {
    // Filter empty slots, not just array length: a folded legacy pairwise
    // config keeps both variantA/variantB positions even when one is unset
    // (see fromPairwise in normalizeComparison.ts), so an under-filled
    // config can have variants.length === 2 while one entry is "".
    if (targetComparison.variants.filter(Boolean).length < 2) {
      missingMappings.push({
        fieldId: "variants",
        fieldName: "Variants",
        isRequired: true,
      });
    }
    // Golden field is only required when the user hasn't opted out of
    // golden-answer comparison (#5378) — see isGoldenFieldSatisfied.
    if (!isGoldenFieldSatisfied(targetComparison)) {
      missingMappings.push({
        fieldId: "goldenField",
        fieldName: "Golden field",
        isRequired: true,
      });
    }
    return {
      isValid: missingMappings.length === 0,
      missingMappings,
    };
  }

  if (isEvaluatorTarget) {
    // For evaluator targets, use the optional property on each input field
    // Fields without optional: true are considered required
    // Note: evaluator targets use target.inputs directly (no localPromptConfig)
    const evaluatorInputs = target.inputs ?? [];
    let hasAnyMapping = false;
    let missingRequiredCount = 0;

    for (const input of evaluatorInputs) {
      const hasMapping = datasetMappings[input.identifier] !== undefined;

      if (hasMapping) {
        hasAnyMapping = true;
      } else if (!input.optional) {
        // Required field (not marked as optional) is missing
        missingRequiredCount++;
        missingMappings.push({
          fieldId: input.identifier,
          fieldName: input.identifier,
          isRequired: true,
        });
      }
      // Optional fields don't block validation - don't add to missingMappings
    }

    // Valid if no required fields are missing AND at least one field has a mapping (or no fields)
    const isValid =
      missingRequiredCount === 0 &&
      (evaluatorInputs.length === 0 || hasAnyMapping);

    return {
      isValid,
      missingMappings,
    };
  }

  if (isHttpAgent) {
    // Derive the effective variable set from the body template (source of truth).
    // Only fall back to persisted inputs when no body template is available.
    const templateVars = extractVariablesFromBodyTemplate(
      target.httpConfig?.bodyTemplate,
    );
    const httpFieldIds = new Set(
      templateVars.length > 0
        ? templateVars
        : inputs.map((input) => input.identifier),
    );

    // HTTP agents: all fields are optional, but at least one must be mapped.
    // Check the value too — Object.keys includes keys with undefined values.
    const hasAtLeastOneMapping = Object.entries(datasetMappings).some(
      ([fieldId, mapping]) =>
        mapping !== undefined && httpFieldIds.has(fieldId),
    );

    for (const fieldId of httpFieldIds) {
      if (datasetMappings[fieldId] === undefined) {
        // Add to missing but mark as NOT required (optional)
        missingMappings.push({
          fieldId,
          fieldName: fieldId,
          isRequired: false, // HTTP agent fields are optional
        });
      }
    }

    // Valid if at least one field has a mapping (or there are no fields)
    const isValid = httpFieldIds.size === 0 || hasAtLeastOneMapping;

    return {
      isValid,
      missingMappings,
    };
  }

  // A prompt target with no draft and no loaded template gives us only its
  // declared input list, and a prompt scaffold declares variables it never
  // references (every prompt is born with an `input` the template may drop).
  // Report those as advisory so an unreferenced variable neither warns nor
  // blocks the run.
  const isUnprovenPromptUsage = target.type === "prompt" && !isProven;

  // Standard validation for prompts and code agents
  for (const fieldId of usedFields) {
    // Skip if not in inputs list - user hasn't defined this variable
    if (!inputIds.has(fieldId)) continue;

    const hasMapping = datasetMappings[fieldId] !== undefined;

    if (!hasMapping) {
      missingMappings.push({
        fieldId,
        fieldName: fieldId,
        isRequired: !isUnprovenPromptUsage,
      });
    }
  }

  return {
    isValid: missingMappings.filter((m) => m.isRequired).length === 0,
    missingMappings,
  };
};

/**
 * Check if a target is short of a mapping it needs to run.
 *
 * Drives the alert icon on the column header and the per-column play button,
 * so it answers the same question the run buttons ask: can this target run as
 * configured. Advisory misses, such as a declared variable the template never
 * consumes, are not missing mappings the user can act on and are excluded.
 *
 * @param target - The target to check
 * @param datasetId - The dataset to check against
 * @param options - Resolves the saved template of an undrafted prompt target
 * @returns true if a mapping the target needs is absent
 */
export const targetHasMissingMappings = (
  target: TargetConfig,
  datasetId: string,
  options?: MappingValidationOptions,
): boolean => !getTargetMissingMappings(target, datasetId, options).isValid;

// ============================================================================
// Evaluator Validation
// ============================================================================

/**
 * Simple mapping validation result.
 */
export type SimpleMappingValidationResult = {
  /** Whether the mappings are valid */
  isValid: boolean;
  /** Whether at least one field has a mapping */
  hasAnyMapping: boolean;
  /** Fields that are missing required mappings */
  missingRequiredFields: string[];
};

/**
 * Core validation logic for evaluator mappings.
 * Used by validateEvaluatorMappingsWithFields.
 */
const validateMappingsCore = (
  requiredFields: string[],
  optionalFields: string[],
  mappings: Record<string, { type: string; path?: string[] } | undefined>,
): SimpleMappingValidationResult => {
  const allFields = [...requiredFields, ...optionalFields];

  let hasAnyMapping = false;
  const missingRequiredFields: string[] = [];

  // Check all fields
  for (const field of allFields) {
    const mapping = mappings[field];
    // A mapping is valid if it exists and has a non-empty path (for source type)
    // or has a value (for value type)
    const isValidMapping =
      mapping &&
      (mapping.type === "value" ||
        (mapping.type === "source" && mapping.path && mapping.path.length > 0));

    if (isValidMapping) {
      hasAnyMapping = true;
    } else if (requiredFields.includes(field)) {
      missingRequiredFields.push(field);
    }
  }

  // Invalid if:
  // 1. Any required field is missing, OR
  // 2. ALL fields are empty (must have at least one mapping) - unless there are no fields
  const isValid =
    missingRequiredFields.length === 0 &&
    (allFields.length === 0 || hasAnyMapping);

  return {
    isValid,
    hasAnyMapping,
    missingRequiredFields,
  };
};

/**
 * Check if mappings are valid given explicit field definitions.
 * Use this when you already have the field definitions and don't need to look them up.
 *
 * @param requiredFields - List of required field names
 * @param optionalFields - List of optional field names
 * @param mappings - The current mappings (field -> mapping)
 * @returns Validation result
 */
export const validateEvaluatorMappingsWithFields = (
  requiredFields: string[],
  optionalFields: string[],
  mappings: Record<string, { type: string; path?: string[] } | undefined>,
): SimpleMappingValidationResult => {
  return validateMappingsCore(requiredFields, optionalFields, mappings);
};

/**
 * Whether the evaluator's fields come from somewhere other than the built-in
 * catalog, so a missing catalog entry says nothing about it.
 */
const isDefinedOutsideTheCatalog = (evaluatorType: string): boolean =>
  evaluatorType.startsWith("custom/") ||
  evaluatorType.startsWith("code/") ||
  evaluatorType === "workflow";

/**
 * What to report for a built-in evaluator with no catalog entry: it cannot run
 * whatever the mappings say, so the evaluator itself is the finding. Calling
 * the mappings complete would let the row be queued against an evaluator that
 * is not there.
 */
const unavailableEvaluatorResult = (
  evaluatorType: string,
): EvaluatorValidationResult => ({
  isValid: false,
  missingMappings: [
    {
      fieldId: "evaluatorType",
      fieldName: `${evaluatorType} is not available`,
      isRequired: true,
    },
  ],
});

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
  targetId: string,
): EvaluatorValidationResult => {
  const missingMappings: MissingMapping[] = [];
  const targetMappings = evaluator.mappings[datasetId]?.[targetId] ?? {};

  // Comparison evaluator chips: the high-level ComparisonConfigForm replaces
  // the per-row mappings UI, writing its config to `evaluator.comparison`
  // instead of `evaluator.mappings`. Validate against that config directly —
  // otherwise the evaluator's required field ("candidates") never gets an
  // `evaluator.mappings` entry and is permanently reported missing, which
  // forces every Run / Rerun / Run-on-all-rows click to reopen the config
  // editor instead of executing. Mirrors the analogous target-level exemption
  // in getTargetMissingMappings.
  const comparison = toComparisonConfig(evaluator);
  if (comparison) {
    // Filter empty slots, not just array length — see the analogous comment
    // in getTargetMissingMappings.
    if (comparison.variants.filter(Boolean).length < 2) {
      missingMappings.push({
        fieldId: "variants",
        fieldName: "Variants",
        isRequired: true,
      });
    }
    // Golden field is only required when the user opted into golden-answer
    // comparison (#5378).
    if (!isGoldenFieldSatisfied(comparison)) {
      missingMappings.push({
        fieldId: "goldenField",
        fieldName: "Golden field",
        isRequired: true,
      });
    }
    return {
      isValid: missingMappings.length === 0,
      missingMappings,
    };
  }

  // Get the evaluator definition to know which fields are required vs optional
  const evaluatorDef =
    AVAILABLE_EVALUATORS[evaluator.evaluatorType as EvaluatorTypes];

  if (!evaluatorDef && !isDefinedOutsideTheCatalog(evaluator.evaluatorType)) {
    return unavailableEvaluatorResult(evaluator.evaluatorType);
  }

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
  const isValid =
    missingRequiredCount === 0 && (allFieldsCount === 0 || hasAnyMapping);

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
  targetId: string,
): boolean => {
  const { isValid } = getEvaluatorMissingMappings(
    evaluator,
    datasetId,
    targetId,
  );
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
 * @param promptTemplateFields - Resolves the saved template of an undrafted
 *   prompt target
 * @returns Validation result with first invalid entity
 */
export const validateWorkbench = ({
  targets,
  evaluators,
  activeDatasetId,
  promptTemplateFields,
}: {
  targets: TargetConfig[];
  evaluators: EvaluatorConfig[];
  activeDatasetId: string;
} & MappingValidationOptions): WorkbenchValidationResult => {
  // Check targets first
  for (const target of targets) {
    const validation = getTargetMissingMappings(target, activeDatasetId, {
      promptTemplateFields,
    });
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
        target.id,
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
 * @param options - Resolves the saved template of an undrafted prompt target
 * @returns Map of targetId -> missing mappings
 */
export const getAllTargetMissingMappings = (
  targets: TargetConfig[],
  datasetId: string,
  options?: MappingValidationOptions,
): Map<string, MissingMapping[]> => {
  const result = new Map<string, MissingMapping[]>();

  for (const target of targets) {
    const validation = getTargetMissingMappings(target, datasetId, options);
    if (validation.missingMappings.length > 0) {
      result.set(target.id, validation.missingMappings);
    }
  }

  return result;
};

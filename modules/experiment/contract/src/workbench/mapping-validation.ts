/**
 * Mapping Validation Utility for Evaluations V3
 */

import { AVAILABLE_EVALUATORS, type EvaluatorTypes } from "@langwatch/evaluator-contract";

import type {
  ComparisonEvaluatorConfig,
  EvaluatorConfig,
  TargetConfig,
} from "../experiment-workbench.ts";
import { isGoldenFieldSatisfied } from "../experiment-workbench.ts";
import { extractVariablesFromBodyTemplate } from "./body-template-variables.ts";
import { toComparisonConfig } from "./normalize-comparison.ts";

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
 */
export type PromptTemplateFieldsLookup = (target: TargetConfig) => Set<string> | undefined;

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
 * @param content - The prompt message content
 * @returns Set of field names used in the content
 */
export const extractFieldsFromContent = (content: string): Set<string> => {
  const pattern = /\{\{(\w+)\}\}/g;
  const fields = new Set<string>();
  for (let match = pattern.exec(content); match !== null; match = pattern.exec(content)) {
    fields.add(match[1]!);
  }

  return fields;
};

/**
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
  const hasConversationTurn = messages.some((message) => message.role !== "system");
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
        declaredFieldIds: target.localPromptConfig.inputs.map((input) => input.identifier),
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

type DatasetMappings = TargetConfig["mappings"][string];

const requiredGap = (fieldId: string): MissingMapping => ({
  fieldId,
  fieldName: fieldId,
  isRequired: true,
});

/**
 * Comparison column-target: validated against the comparison config (Variants /
 * Golden), not the per-row input list, which is derived from the variants at save time.
 */
const comparisonTargetValidation = (
  comparison: ComparisonEvaluatorConfig,
): TargetValidationResult => {
  const missingMappings: MissingMapping[] = [];
  // Filter empty slots: a folded legacy pairwise config keeps both positions
  // even when one is unset (see fromPairwise in normalize-comparison.ts).
  if (comparison.variants.filter(Boolean).length < 2) {
    missingMappings.push({ fieldId: "variants", fieldName: "Variants", isRequired: true });
  }
  // Golden is only required when golden-answer comparison is on (#5378).
  if (!isGoldenFieldSatisfied(comparison)) {
    missingMappings.push({ fieldId: "goldenField", fieldName: "Golden field", isRequired: true });
  }
  return { isValid: missingMappings.length === 0, missingMappings };
};

/**
 * Evaluator targets: an input without `optional: true` is required, and at least
 * one input must be mapped when there are any.
 */
const evaluatorTargetValidation = ({
  target,
  datasetMappings,
}: {
  target: TargetConfig;
  datasetMappings: DatasetMappings;
}): TargetValidationResult => {
  const evaluatorInputs = target.inputs ?? [];
  const unmapped = evaluatorInputs.filter(
    (input) => datasetMappings[input.identifier] === undefined,
  );
  const missingMappings = unmapped
    .filter((input) => !input.optional)
    .map((input) => requiredGap(input.identifier));
  const hasAnyMapping = unmapped.length < evaluatorInputs.length;

  return {
    isValid: missingMappings.length === 0 && (evaluatorInputs.length === 0 || hasAnyMapping),
    missingMappings,
  };
};

/**
 * HTTP agents: every body-template variable is optional, but at least one must be
 * mapped. The body template is the source of truth; persisted inputs are the fallback.
 */
const httpAgentValidation = ({
  target,
  inputs,
  datasetMappings,
}: {
  target: TargetConfig;
  inputs: readonly { identifier: string }[];
  datasetMappings: DatasetMappings;
}): TargetValidationResult => {
  const templateVars = extractVariablesFromBodyTemplate(target.httpConfig?.bodyTemplate);
  const httpFieldIds = new Set(
    templateVars.length > 0 ? templateVars : inputs.map((input) => input.identifier),
  );
  // Check the value too: Object.entries includes keys holding undefined.
  const hasAtLeastOneMapping = Object.entries(datasetMappings).some(
    ([fieldId, mapping]) => mapping !== undefined && httpFieldIds.has(fieldId),
  );
  const missingMappings = [...httpFieldIds]
    .filter((fieldId) => datasetMappings[fieldId] === undefined)
    .map((fieldId) => ({ fieldId, fieldName: fieldId, isRequired: false }));

  return { isValid: httpFieldIds.size === 0 || hasAtLeastOneMapping, missingMappings };
};

/** Prompts and code/connected agents: every used, declared field must be mapped. */
const usedFieldsValidation = ({
  target,
  inputs,
  datasetMappings,
  options,
}: {
  target: TargetConfig;
  inputs: readonly { identifier: string }[];
  datasetMappings: DatasetMappings;
  options?: MappingValidationOptions;
}): TargetValidationResult => {
  const { usedFields, isProven } = resolveUsedFields(target, options);
  const inputIds = new Set(inputs.map((i) => i.identifier));
  // A connected agent's parameters carry the function's own defaults; only its turn must be mapped.
  const isConnectedAgent =
    target.type === "agent" && "agentType" in target && target.agentType === "connected";
  const defaultedIds = new Set(
    isConnectedAgent
      ? inputs.filter((input) => "optional" in input && input.optional).map((i) => i.identifier)
      : [],
  );
  // A prompt with no draft and no loaded template only proves its declared inputs,
  // so its gaps are advisory: a scaffolded but unreferenced variable neither warns nor blocks.
  const isRequired = !(target.type === "prompt" && !isProven);

  const missingMappings = [...usedFields]
    .filter((fieldId) => inputIds.has(fieldId) && !defaultedIds.has(fieldId))
    .filter((fieldId) => datasetMappings[fieldId] === undefined)
    .map((fieldId) => ({ fieldId, fieldName: fieldId, isRequired }));

  return {
    isValid: missingMappings.filter((m) => m.isRequired).length === 0,
    missingMappings,
  };
};

/**
 * Validates `target`'s mappings against `datasetId`, returning every mapping its
 * fields still need.
 */
export const getTargetMissingMappings = (
  target: TargetConfig,
  datasetId: string,
  options?: MappingValidationOptions,
): TargetValidationResult => {
  const datasetMappings = target.mappings[datasetId] ?? {};
  // localPromptConfig.inputs carries the latest form state; target.inputs is the fallback.
  const inputs = target.localPromptConfig?.inputs ?? target.inputs ?? [];

  const targetComparison = target.type === "evaluator" ? toComparisonConfig(target) : undefined;
  if (targetComparison) return comparisonTargetValidation(targetComparison);
  if (target.type === "evaluator") return evaluatorTargetValidation({ target, datasetMappings });
  if (target.type === "agent" && "agentType" in target && target.agentType === "http") {
    return httpAgentValidation({ target, inputs, datasetMappings });
  }

  return usedFieldsValidation({ target, inputs, datasetMappings, options });
};

/** Whether `target` is still missing a mapping it needs against `datasetId`. */
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
  const isValid = missingRequiredFields.length === 0 && (allFields.length === 0 || hasAnyMapping);

  return {
    isValid,
    hasAnyMapping,
    missingRequiredFields,
  };
};

/**
 * Validates `mappings` against a plain list of required/optional field names.
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
 * What to report for a built-in evaluator with no catalog entry: it cannot run whatever
 * the mappings say, so the evaluator itself is the finding. Calling the mappings
 * complete would let the row be queued against an evaluator that is not there.
 */
const unavailableEvaluatorResult = (evaluatorType: string): EvaluatorValidationResult => ({
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
 * Validates `evaluator`'s mappings against `datasetId`/`targetId`, returning every
 * mapping its fields still need.
 */
export const getEvaluatorMissingMappings = (
  evaluator: EvaluatorConfig,
  datasetId: string,
  targetId: string,
): EvaluatorValidationResult => {
  const missingMappings: MissingMapping[] = [];
  const targetMappings = evaluator.mappings[datasetId]?.[targetId] ?? {};

  // Comparison evaluator chips: the high-level ComparisonConfigForm replaces the
  // per-row mappings UI, writing its config to `evaluator.comparison` instead of
  // `evaluator.mappings`.
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
  const evaluatorDef = AVAILABLE_EVALUATORS[evaluator.evaluatorType as EvaluatorTypes];

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
    if (targetMappings[input.identifier] !== undefined) {
      hasAnyMapping = true;
      continue;
    }

    // Optional fields don't block validation; an unknown field (in neither
    // list) is treated as required for safety.
    const isOptionalOnly =
      !requiredFieldsSet.has(input.identifier) && optionalFieldsSet.has(input.identifier);
    if (isOptionalOnly) continue;

    missingRequiredCount++;
    missingMappings.push({
      fieldId: input.identifier,
      fieldName: input.identifier,
      isRequired: true,
    });
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
 * Whether `evaluator` is still missing a required mapping against `datasetId`/`targetId`.
 */
export const evaluatorHasMissingMappings = (
  evaluator: EvaluatorConfig,
  datasetId: string,
  targetId: string,
): boolean => {
  const { isValid } = getEvaluatorMissingMappings(evaluator, datasetId, targetId);
  return !isValid;
};

// ============================================================================
// Workbench Validation (All Targets + Evaluators)
// ============================================================================

/**
 * Validates every target and evaluator in the workbench against `activeDatasetId`,
 * returning the first invalid entity found.
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
      const evalValidation = getEvaluatorMissingMappings(evaluator, activeDatasetId, target.id);
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
 * Maps each of `targets` to its own missing mappings against `datasetId`.
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

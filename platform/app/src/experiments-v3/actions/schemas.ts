import { z } from "zod";
import type { Field } from "~/optimization_studio/types/dsl";
import { fieldSchema } from "~/optimization_studio/types/dsl";
import { AVAILABLE_EVALUATORS } from "~/server/evaluations/evaluators";
import {
  COMPARISON_COLUMN_REFUSAL,
  datasetColumnSchema,
  evaluatorConfigSchema,
  fieldMappingSchema,
  isComparisonEvaluatorType,
  localPromptConfigSchema,
  targetConfigSchema,
} from "../types";

/**
 * Payload and result schemas for every workbench action.
 *
 * Every piece here is reused from `../types` — the workbench state schemas are
 * the source of truth for what a mapping, a column, a prompt config or a target
 * looks like, and an action payload is only ever a slice of them.
 */

// ============================================================================
// Targets
// ============================================================================

/**
 * The target object without the `type === "workflow" requires workflowId`
 * refinement, so it can be extended. The refinement stays on
 * `targetConfigSchema`, which is what validates the state written back.
 */
const targetObjectSchema = targetConfigSchema.innerType();

export const addTargetPayloadSchema = targetObjectSchema.extend({
  /** Generated as `target-<nanoid(8)>` when omitted. */
  id: z.string().min(1).optional(),
  inputs: z.array(fieldSchema).default([]),
  outputs: z.array(fieldSchema).default([]),
  mappings: z
    .record(z.string(), z.record(z.string(), fieldMappingSchema))
    .default({}),
});
/**
 * Field lists are typed as the domain `Field`, the way `TargetConfig` and
 * `EvaluatorConfig` are in `../types`: the inferred zod shape spells
 * `json_schema` as a passthrough object and stops accepting a target read
 * straight out of the store. The schema is still what validates at runtime.
 */
export type AddTargetPayload = Omit<
  z.input<typeof addTargetPayloadSchema>,
  "inputs" | "outputs"
> & {
  inputs?: Field[];
  outputs?: Field[];
};

export const addTargetResultSchema = z.object({
  targetId: z.string(),
});

export const duplicateTargetPayloadSchema = z.object({
  targetId: z.string(),
  /**
   * Name for the copy. Only evaluator targets carry a name in workbench state
   * (`localEvaluatorConfig.name`); for prompt, agent and workflow targets the
   * displayed name comes from the referenced entity, so the override is
   * reported back as unapplied rather than invented.
   */
  name: z.string().optional(),
});
export type DuplicateTargetPayload = z.infer<
  typeof duplicateTargetPayloadSchema
>;

export const duplicateTargetResultSchema = z.object({
  targetId: z.string(),
  /** The name held in state after the copy, when the target can hold one. */
  name: z.string().optional(),
});

export const removeTargetPayloadSchema = z.object({
  targetId: z.string(),
});
export type RemoveTargetPayload = z.infer<typeof removeTargetPayloadSchema>;

export const removeTargetResultSchema = z.object({
  targetId: z.string(),
});

export const setTargetPromptPayloadSchema = z.object({
  targetId: z.string(),
  localPromptConfig: localPromptConfigSchema,
  inputs: z.array(fieldSchema).optional(),
  outputs: z.array(fieldSchema).optional(),
});
export type SetTargetPromptPayload = Omit<
  z.infer<typeof setTargetPromptPayloadSchema>,
  "inputs" | "outputs"
> & {
  inputs?: Field[];
  outputs?: Field[];
};

export const setTargetPromptResultSchema = z.object({
  targetId: z.string(),
});

export const updateTargetModelPayloadSchema = z.object({
  targetId: z.string(),
  model: z.string().min(1),
});
export type UpdateTargetModelPayload = z.infer<
  typeof updateTargetModelPayloadSchema
>;

export const updateTargetModelResultSchema = z.object({
  targetId: z.string(),
  model: z.string(),
});

// ============================================================================
// Mappings
// ============================================================================

export const setMappingPayloadSchema = z.object({
  targetId: z.string(),
  datasetId: z.string(),
  inputField: z.string(),
  mapping: fieldMappingSchema,
});
export type SetMappingPayload = z.infer<typeof setMappingPayloadSchema>;

export const setEvaluatorMappingPayloadSchema = z.object({
  evaluatorId: z.string(),
  datasetId: z.string(),
  targetId: z.string(),
  inputField: z.string(),
  mapping: fieldMappingSchema,
});
export type SetEvaluatorMappingPayload = z.infer<
  typeof setEvaluatorMappingPayloadSchema
>;

// ============================================================================
// Evaluators
// ============================================================================

/**
 * A project's own evaluators are stored under one of these prefixes, followed
 * by the row id, so their types cannot be checked against a fixed list. The
 * whole-workflow evaluator has no id in its type at all.
 *
 * Same set `mappingValidation` treats as defined outside the built-in catalog,
 * which is what keeps a type accepted here from failing mapping validation
 * later for not being in the catalog.
 */
const DB_EVALUATOR_TYPE_PREFIXES = ["custom/", "code/"];
const WORKFLOW_EVALUATOR_TYPE = "workflow";

const isKnownEvaluatorType = (evaluatorType: string): boolean =>
  Object.hasOwn(AVAILABLE_EVALUATORS, evaluatorType) ||
  evaluatorType === WORKFLOW_EVALUATOR_TYPE ||
  DB_EVALUATOR_TYPE_PREFIXES.some(
    (prefix) =>
      evaluatorType.startsWith(prefix) && evaluatorType.length > prefix.length,
  );

export const addEvaluatorPayloadSchema = evaluatorConfigSchema
  .pick({
    evaluatorType: true,
    dbEvaluatorId: true,
    comparison: true,
    localEvaluatorConfig: true,
  })
  .extend({
    /** Generated as `evaluator_<nanoid(8)>` when omitted. */
    id: z.string().min(1).optional(),
    inputs: z.array(fieldSchema).default([]),
    /** Given mappings win; every gap is auto-inferred across datasets x targets. */
    mappings: z
      .record(
        z.string(),
        z.record(z.string(), z.record(z.string(), fieldMappingSchema)),
      )
      .default({}),
  })
  /**
   * Two rules the field types alone cannot state, both refused with the reason
   * so the caller can correct the payload instead of guessing:
   *
   * - the type has to name an evaluator that exists, otherwise the column is
   *   added and every row of it fails at run time;
   * - only the comparison judge may carry a `comparison` config, otherwise the
   *   column renders as a standalone comparison and runs as something that
   *   never receives the candidates it is asked to compare.
   */
  .superRefine((payload, ctx) => {
    if (!isKnownEvaluatorType(payload.evaluatorType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluatorType"],
        message: `Unknown evaluator type "${payload.evaluatorType}". Run "langwatch evaluator types" to list every type this workbench accepts.`,
      });
    }

    if (
      payload.comparison &&
      !isComparisonEvaluatorType(payload.evaluatorType)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["comparison"],
        message: COMPARISON_COLUMN_REFUSAL,
      });
    }
  });
export type AddEvaluatorPayload = Omit<
  z.input<typeof addEvaluatorPayloadSchema>,
  "inputs"
> & {
  inputs?: Field[];
};

export const addEvaluatorResultSchema = z.object({
  evaluatorId: z.string(),
});

// ============================================================================
// Datasets (inline only — saved datasets belong to the dataset API)
// ============================================================================

export const setCellValuePayloadSchema = z.object({
  datasetId: z.string(),
  rowIndex: z.number().int().min(0),
  columnId: z.string(),
  value: z.string(),
});
export type SetCellValuePayload = z.infer<typeof setCellValuePayloadSchema>;

export const addColumnPayloadSchema = z.object({
  datasetId: z.string(),
  column: datasetColumnSchema.extend({
    /** Defaults to the column name. */
    id: z.string().optional(),
    type: z.string().default("string"),
  }),
});
export type AddColumnPayload = z.input<typeof addColumnPayloadSchema>;

export const addColumnResultSchema = z.object({
  datasetId: z.string(),
  columnId: z.string(),
});

export const addRowsPayloadSchema = z.object({
  datasetId: z.string(),
  /** One record per row, keyed by column id or column name. */
  rows: z.array(z.record(z.string(), z.string())).min(1),
});
export type AddRowsPayload = z.infer<typeof addRowsPayloadSchema>;

export const addRowsResultSchema = z.object({
  datasetId: z.string(),
  addedRows: z.number(),
  rowCount: z.number(),
});

// ============================================================================
// Read and run
// ============================================================================

export const getStatePayloadSchema = z.object({
  /** Include the per-target results summary. */
  includeResults: z.boolean().optional(),
});
export type GetStatePayload = z.infer<typeof getStatePayloadSchema>;

export const runPayloadSchema = z.object({
  /**
   * Targets to run. Omitted means every target in the workbench.
   *
   * An entry has to name a target: an empty string is not a target, and a list
   * holding one narrows to nothing, which the scope mapping would read as "no
   * filter given" and widen back to the whole workbench.
   */
  targetIds: z.array(z.string().min(1)).optional(),
  /** Rows to run. Omitted means every row of the active dataset. */
  rowIndices: z.array(z.number().int().min(0)).optional(),
});
export type RunPayload = z.infer<typeof runPayloadSchema>;

export const runResultSchema = z.object({
  runId: z.string().optional(),
  status: z.enum(["idle", "running", "success", "error", "stopped"]),
});

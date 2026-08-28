import { z } from "zod";
import type { Field } from "@langwatch/workflow-contract";
import { fieldSchema } from "@langwatch/workflow-contract";
import { AVAILABLE_EVALUATORS } from "@langwatch/evaluator-contract";
import {
  COMPARISON_COLUMN_REFUSAL,
  COMPARISON_EVALUATOR_TYPE,
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
 *
 * The `.describe()` prose is not decoration. `GET /api/langy/ui/actions`
 * renders these schemas as JSON Schema, and that listing is the ONLY
 * documentation a caller has for this surface: what an action does to the page,
 * when to reach for it, and what each field means. An undescribed field is a
 * field the caller has to guess at.
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

export const addTargetPayloadSchema = targetObjectSchema
  .extend({
    id: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Id for the new column. Generated as target-<nanoid> when omitted.",
      ),
    inputs: z
      .array(fieldSchema)
      .default([])
      .describe("Fields the column reads from the dataset."),
    outputs: z
      .array(fieldSchema)
      .default([])
      .describe("Fields the column produces for each row."),
    mappings: z
      .record(z.string(), z.record(z.string(), fieldMappingSchema))
      .default({})
      .describe(
        "Which dataset column feeds each input field, per dataset: mappings[datasetId][inputField]. Gaps are inferred from the dataset column names.",
      ),
  })
  .describe(
    "Add a column to the workbench that produces an output for every row: a prompt, an agent, a saved workflow, or an evaluator run as its own column. " +
      "Use it to put a new candidate beside the ones already on the board. " +
      "The column lands to the right of the existing ones and runs nothing until a run covers it.",
  );
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
  targetId: z.string().describe("Id of the column that was added."),
});

export const duplicateTargetPayloadSchema = z
  .object({
    targetId: z.string().describe("Id of the column to copy."),
    /**
     * Only evaluator targets carry a name in workbench state
     * (`localEvaluatorConfig.name`); for prompt, agent and workflow targets the
     * displayed name comes from the referenced entity, so the override is
     * reported back as unapplied rather than invented.
     */
    name: z
      .string()
      .optional()
      .describe(
        "Name for the copy. Only an evaluator column can hold its own name, so for a prompt, agent or workflow column the answer reports the name as not applied.",
      ),
  })
  .describe(
    "Copy a column, with its prompt, its model and its mappings. " +
      "Use it to start a candidate from a column already on the board, then change one thing about the copy. " +
      "The copy shares the original's name, so both columns read as the same name with a (1) and a (2) suffix.",
  );
export type DuplicateTargetPayload = z.infer<
  typeof duplicateTargetPayloadSchema
>;

export const duplicateTargetResultSchema = z.object({
  targetId: z.string().describe("Id of the new copy."),
  name: z
    .string()
    .optional()
    .describe(
      "The name held in state after the copy, when the column can hold one.",
    ),
});

export const removeTargetPayloadSchema = z
  .object({
    targetId: z.string().describe("Id of the column to remove."),
  })
  .describe(
    "Remove a column from the workbench, with its results. " +
      "Use it to drop a candidate that lost. " +
      "A comparison that judges the removed column keeps naming it and refuses to run until its variants are picked again.",
  );
export type RemoveTargetPayload = z.infer<typeof removeTargetPayloadSchema>;

export const removeTargetResultSchema = z.object({
  targetId: z.string().describe("Id of the column that was removed."),
});

export const setTargetPromptPayloadSchema = z
  .object({
    targetId: z.string().describe("Id of the column to write the prompt into."),
    localPromptConfig: localPromptConfigSchema.describe(
      "The whole prompt: its messages, its model and its declared input and output fields. This replaces the column's prompt rather than merging into it.",
    ),
    inputs: z
      .array(fieldSchema)
      .optional()
      .describe(
        "Fields the column reads. Defaults to the fields the prompt config declares.",
      ),
    outputs: z
      .array(fieldSchema)
      .optional()
      .describe(
        "Fields the column produces. Defaults to the fields the prompt config declares.",
      ),
  })
  .describe(
    "Replace a column's prompt with a draft that is not saved to the prompt library. " +
      "Use it to try a rewrite: the column runs the draft, and the library keeps the version other experiments use. " +
      "The column shows an unsaved marker until someone saves the draft.",
  );
export type SetTargetPromptPayload = Omit<
  z.infer<typeof setTargetPromptPayloadSchema>,
  "inputs" | "outputs"
> & {
  inputs?: Field[];
  outputs?: Field[];
};

export const setTargetPromptResultSchema = z.object({
  targetId: z.string().describe("Id of the column that now runs the draft."),
});

export const updateTargetModelPayloadSchema = z
  .object({
    targetId: z.string().describe("Id of the column to change."),
    model: z
      .string()
      .min(1)
      .describe(
        'The model this column runs, written as provider/model, for example "openai/gpt-5-mini".',
      ),
  })
  .describe(
    "Change the model a column runs, and nothing else about it. " +
      "Use it to compare the same prompt on two models. " +
      "The column needs a prompt already: a column with none is refused.",
  );
export type UpdateTargetModelPayload = z.infer<
  typeof updateTargetModelPayloadSchema
>;

export const updateTargetModelResultSchema = z.object({
  targetId: z.string().describe("Id of the column that was changed."),
  model: z.string().describe("The model the column runs now."),
});

// ============================================================================
// Mappings
// ============================================================================

export const setMappingPayloadSchema = z
  .object({
    targetId: z
      .string()
      .describe("Id of the column whose input is being wired."),
    datasetId: z
      .string()
      .describe(
        "Dataset the mapping belongs to. A column can read different columns in different datasets.",
      ),
    inputField: z
      .string()
      .describe(
        "Name of the column's own input field, as the prompt declares it.",
      ),
    mapping: fieldMappingSchema.describe(
      "Where the value comes from: a dataset column, or a fixed value used for every row.",
    ),
  })
  .describe(
    "Wire one input field of a column to a dataset column or to a fixed value. " +
      "Use it when a column reads nothing, or reads the incorrect column. " +
      "An input field left unwired makes every row of that column fail.",
  );
export type SetMappingPayload = z.infer<typeof setMappingPayloadSchema>;

export const setEvaluatorMappingPayloadSchema = z
  .object({
    evaluatorId: z.string().describe("Id of the evaluator being wired."),
    datasetId: z.string().describe("Dataset the mapping belongs to."),
    targetId: z
      .string()
      .describe(
        "Column this mapping applies to. An evaluator is wired once per column, because each column names its output field its own way.",
      ),
    inputField: z
      .string()
      .describe(
        "Name of the evaluator's own input field, for example expected_output.",
      ),
    mapping: fieldMappingSchema.describe(
      "Where the value comes from: a dataset column, the column's own output, or a fixed value.",
    ),
  })
  .describe(
    "Wire one input field of an evaluator, for one column. " +
      "Use it after adding an evaluator whose fields the workbench could not infer. " +
      "An evaluator that resolves no input reports the row as an error instead of scoring empty against empty.",
  );
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
    id: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Id for the new evaluator. Generated as evaluator_<nanoid> when omitted.",
      ),
    name: z
      .string()
      .trim()
      .min(1)
      .describe(
        "What this evaluator is called on every chip, header and export. Required, and it has to tell this evaluator apart from its siblings: one board often carries several evaluators of ONE type, so the type name alone leaves a reader with three identical chips. Name what this one checks, for example `l1 exact match` beside `l2 exact match`.",
      ),
    inputs: z
      .array(fieldSchema)
      .default([])
      .describe(
        "Fields the evaluator reads. Defaults to the fields its type declares in the catalog.",
      ),
    mappings: z
      .record(
        z.string(),
        z.record(z.string(), z.record(z.string(), fieldMappingSchema)),
      )
      .default({})
      .describe(
        "Where each field reads from, per dataset and per column: mappings[datasetId][targetId][inputField]. Given mappings win, and every gap is inferred from the dataset and the column output names.",
      ),
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
  })
  .describe(
    "Add an evaluator to the workbench. " +
      "`name` is required and is what every chip reads, so give each evaluator a name that says what it checks. " +
      "Leave `comparison` out and the evaluator attaches to EVERY target column as a score, one chip per cell, which is what grading candidates asks for. " +
      `Set \`comparison\` and the evaluator becomes a column of its own that judges the columns it names against each other. Only the Comparison judge (${COMPARISON_EVALUATOR_TYPE}) may do that, and any other type given a comparison config is refused. ` +
      "Run `langwatch evaluator types` to list the types this workbench accepts.",
  );
export type AddEvaluatorPayload = Omit<
  z.input<typeof addEvaluatorPayloadSchema>,
  "inputs"
> & {
  inputs?: Field[];
};

export const addEvaluatorResultSchema = z.object({
  evaluatorId: z.string().describe("Id of the evaluator that was added."),
});

// ============================================================================
// Datasets (inline only — saved datasets belong to the dataset API)
// ============================================================================

export const setCellValuePayloadSchema = z
  .object({
    datasetId: z.string().describe("Id of the dataset holding the cell."),
    rowIndex: z.number().int().min(0).describe("Row to write, counted from 0."),
    columnId: z.string().describe("Id of the dataset column to write."),
    value: z.string().describe("The new value of the cell."),
  })
  .describe(
    "Write one cell of an inline dataset. " +
      "Use it to correct a test case, or to fill an expected answer. " +
      "Only an inline dataset can be edited here: a saved dataset belongs to the dataset API, and a column the dataset does not have is refused.",
  );
export type SetCellValuePayload = z.infer<typeof setCellValuePayloadSchema>;

export const addColumnPayloadSchema = z
  .object({
    datasetId: z.string().describe("Id of the inline dataset to add to."),
    column: datasetColumnSchema
      .extend({
        id: z.string().optional().describe("Defaults to the column name."),
        type: z
          .string()
          .default("string")
          .describe('Column type, for example "string" or "json".'),
      })
      .describe("The column to add."),
  })
  .describe(
    "Add a column to an inline dataset. " +
      "Use it to hold a value a target or an evaluator needs to read, such as an expected answer. " +
      "Existing rows get an empty cell for the new column.",
  );
export type AddColumnPayload = z.input<typeof addColumnPayloadSchema>;

export const addColumnResultSchema = z.object({
  datasetId: z.string().describe("Id of the dataset that was changed."),
  columnId: z.string().describe("Id of the column that was added."),
});

export const addRowsPayloadSchema = z
  .object({
    datasetId: z.string().describe("Id of the inline dataset to add to."),
    rows: z
      .array(z.record(z.string(), z.string()))
      .min(1)
      .describe(
        "One record per row, keyed by column id or by column name. A column a row leaves out gets an empty cell.",
      ),
  })
  .describe(
    "Append rows to an inline dataset. " +
      "Use it to add test cases, for example the ones a failing run exposed. " +
      "The rows are added at the end and are not run until a run covers them.",
  );
export type AddRowsPayload = z.infer<typeof addRowsPayloadSchema>;

export const addRowsResultSchema = z.object({
  datasetId: z.string().describe("Id of the dataset that was changed."),
  addedRows: z.number().describe("How many rows were appended."),
  rowCount: z.number().describe("How many rows the dataset holds now."),
});

// ============================================================================
// Read and run
// ============================================================================

export const getStatePayloadSchema = z
  .object({
    includeResults: z
      .boolean()
      .optional()
      .describe(
        "Include the per-column results summary: how many cells the last run filled, how many failed and with which failure kinds, the evaluator pass rates and scores, and the id of the run they came from. Defaults to true.",
      ),
  })
  .describe(
    "Read the workbench: its datasets and their columns, every target column with its name, model and wiring, every evaluator, every comparison with the columns it judges, and how the last run went. " +
      "Use it before deciding anything, and again after a run finishes. " +
      "The answer is capped in size, so sample rows go first and `truncated` says when anything was left out.",
  );
export type GetStatePayload = z.infer<typeof getStatePayloadSchema>;

export const runPayloadSchema = z
  .object({
    /**
     * An entry has to name a target: an empty string is not a target, and a list
     * holding one narrows to nothing, which the scope mapping would read as "no
     * filter given" and widen back to the whole workbench.
     */
    targetIds: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "Columns to run, by target id. Omitted means every column. A column a comparison judges is run or reused as the comparison needs it, so naming one candidate is enough.",
      ),
    rowIndices: z
      .array(z.number().int().min(0))
      .optional()
      .describe(
        "Rows to run, counted from 0. Omitted means every row of the active dataset.",
      ),
  })
  .describe(
    "Run the evaluation and answer at once with the id of the run, without waiting for it to finish. " +
      "It runs on the open page when there is one, and on the server when there is not, and both answer the same way. " +
      "Use the run id to follow the run: `langwatch experiment status` for progress, `langwatch experiment results` for the cells. " +
      "Read the workbench again once the run ends, because that is where the cells land.",
  );
export type RunPayload = z.infer<typeof runPayloadSchema>;

export const runResultSchema = z.object({
  runId: z
    .string()
    .optional()
    .describe(
      "The run to poll. Absent only when the run could not be named, which does not mean it did not start.",
    ),
  status: z
    .enum(["idle", "running", "success", "error", "stopped"])
    .describe("The run's state when it answered, which is normally running."),
});

import { z } from "zod";
import {
  MAX_PARAMETER_NAME_LENGTH,
  MAX_RUN_PARAMETER_KEYS,
  runNoteSchema,
  runParameterValuesSchema,
} from "@langwatch/scenario-contract";
import { suiteKindSchema } from "./suite.kind";
import { suiteScopeSchema } from "./suite.scope";

export const RUN_ALL_SUITE_LABEL = "managed:run-all";
export const RUN_ALL_SUITE_NAME = "All test cases";

export const suiteTargetTypeSchema = z.enum(["prompt", "http", "code", "workflow"]);
export type SuiteTargetType = z.infer<typeof suiteTargetTypeSchema>;

export const suiteFieldMappingSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("source"),
      sourceId: z.string().min(1),
      path: z.array(z.string()),
    })
    .strict(),
  z.object({ type: z.literal("value"), value: z.string() }).strict(),
]);
export type SuiteFieldMapping = z.infer<typeof suiteFieldMappingSchema>;

const suiteTargetBaseSchema = z
  .object({
    type: suiteTargetTypeSchema,
    referenceId: z.string().min(1),
    scenarioMappings: z.record(z.string(), suiteFieldMappingSchema).optional(),
    runParameters: runParameterValuesSchema.optional(),
    runSecretParameterNames: z
      .array(z.string().max(MAX_PARAMETER_NAME_LENGTH))
      .max(MAX_RUN_PARAMETER_KEYS)
      .optional(),
  })
  .strict();

export const suiteTargetSchema = suiteTargetBaseSchema.superRefine((target, context) => {
  if (target.type === "prompt" || target.scenarioMappings === undefined) return;
  context.addIssue({
    code: "custom",
    path: ["scenarioMappings"],
    message: `A ${target.type} target cannot carry scenarioMappings.`,
  });
});
export type SuiteTarget = z.infer<typeof suiteTargetSchema>;

/** Browser and transport callers use the same target parser as the service boundary. */
export function parseSuiteTargets(value: unknown): SuiteTarget[] {
  return z.array(suiteTargetSchema).parse(value);
}

/** Keeps the authoring limit aligned with the established suite-run transport. */
export const MAX_SUITE_REPEAT_COUNT = 5;

export const suiteSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
    kind: suiteKindSchema,
    description: z.string().nullable(),
    scenarioIds: z.array(z.string()),
    scope: suiteScopeSchema.nullable(),
    targets: z.array(suiteTargetSchema),
    repeatCount: z.number().int().positive(),
    labels: z.array(z.string()),
    simulatorModel: z.string().nullable(),
    judgeModel: z.string().nullable(),
    archivedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type Suite = z.infer<typeof suiteSchema>;

/**
 * The named values a run carries.
 *
 * The name is bounded in a refinement rather than as `z.string().min(1)` on
 * the key. A key schema's refusal is reported as zod's `invalid_key`, wrapping
 * the real issue a level down, so `flatten()` — which is what the boundary
 * sends a caller — reduces it to "Invalid key in record": it names neither the
 * offending parameter nor what was wrong with it, and "record" is our storage
 * rather than the caller's vocabulary.
 */
export const suiteRunParametersSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .superRefine((parameters, ctx) => {
    for (const name of Object.keys(parameters)) {
      if (name.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_small,
          origin: "string",
          minimum: 1,
          inclusive: true,
          message: "A run parameter must have a name",
        });
      }
    }
  });
export type SuiteRunParameters = z.infer<typeof suiteRunParametersSchema>;

export const suiteRunInputSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    organizationId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    batchRunId: z.string().min(1).optional(),
    parameters: suiteRunParametersSchema.optional(),
    note: runNoteSchema,
  })
  .strict();
export type SuiteRunInput = z.infer<typeof suiteRunInputSchema>;

export const suiteRunAllInputSchema = suiteRunInputSchema
  .omit({ id: true })
  .extend({ targets: z.array(suiteTargetSchema).optional() })
  .strict();
export type SuiteRunAllInput = z.infer<typeof suiteRunAllInputSchema>;

export const suiteArchivedNamesInputSchema = z
  .object({
    projectId: z.string().min(1),
    organizationId: z.string().min(1),
    scenarioIds: z.array(z.string().min(1)),
    targets: z.array(suiteTargetSchema),
  })
  .strict();
export type SuiteArchivedNamesInput = z.infer<typeof suiteArchivedNamesInputSchema>;

export type SuiteRunResult = {
  batchRunId: string;
  setId: string;
  jobCount: number;
  skippedArchived: {
    scenarios: string[];
    targets: string[];
  };
  items: Array<{
    scenarioRunId: string;
    scenarioId: string;
    target: SuiteTarget;
    name: string | undefined;
  }>;
};

export type SuiteRunAllResult = SuiteRunResult & { suiteId: string };

/** The durable fold state exposed by the Suite run read model. */
export const suiteRunStateDataSchema = z
  .object({
    SuiteRunId: z.string(),
    BatchRunId: z.string(),
    ScenarioSetId: z.string(),
    SuiteId: z.string(),
    Status: z.string(),
    Total: z.number(),
    StartedCount: z.number(),
    CompletedCount: z.number(),
    FailedCount: z.number(),
    Progress: z.number(),
    PassRateBps: z.number().nullable(),
    CreatedAt: z.number(),
    UpdatedAt: z.number(),
    LastEventOccurredAt: z.number(),
    StartedAt: z.number().nullable(),
    FinishedAt: z.number().nullable(),
    PassedCount: z.number(),
    GradedCount: z.number(),
  })
  .strict();
export type SuiteRunStateData = z.infer<typeof suiteRunStateDataSchema>;

export const suiteRunStateInputSchema = z
  .object({
    projectId: z.string().min(1),
    batchRunId: z.string().min(1),
  })
  .strict();
export type SuiteRunStateInput = z.infer<typeof suiteRunStateInputSchema>;

export const suiteBatchHistoryInputSchema = z
  .object({
    projectId: z.string().min(1),
    // Empty is a legacy value that the read repository expands to the default
    // set alongside the current "default" value.
    scenarioSetId: z.string(),
    limit: z.number().int().positive().optional(),
  })
  .strict();
export type SuiteBatchHistoryInput = z.infer<typeof suiteBatchHistoryInputSchema>;

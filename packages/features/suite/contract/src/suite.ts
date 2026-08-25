import { z } from "zod";

export const suiteTargetTypeSchema = z.enum(["prompt", "http", "code", "workflow"]);
export type SuiteTargetType = z.infer<typeof suiteTargetTypeSchema>;

export const suiteFieldMappingSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("source"),
    sourceId: z.string().min(1),
    path: z.array(z.string()),
  }).strict(),
  z.object({ type: z.literal("value"), value: z.string() }).strict(),
]);
export type SuiteFieldMapping = z.infer<typeof suiteFieldMappingSchema>;

const suiteTargetBaseSchema = z.object({
  type: suiteTargetTypeSchema,
  referenceId: z.string().min(1),
  scenarioMappings: z.record(z.string(), suiteFieldMappingSchema).optional(),
}).strict();

export const suiteTargetSchema = suiteTargetBaseSchema.superRefine((target, context) => {
  if (target.type === "prompt" || target.scenarioMappings === undefined) return;
  context.addIssue({
    code: "custom",
    path: ["scenarioMappings"],
    message: `A ${target.type} target cannot carry scenarioMappings.`,
  });
});
export type SuiteTarget = z.infer<typeof suiteTargetSchema>;

export const suiteSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().nullable(),
  scenarioIds: z.array(z.string()),
  targets: z.array(suiteTargetSchema),
  repeatCount: z.number().int().positive(),
  labels: z.array(z.string()),
  simulatorModel: z.string().nullable(),
  judgeModel: z.string().nullable(),
  archivedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
}).strict();
export type Suite = z.infer<typeof suiteSchema>;

export const suiteRunParametersSchema = z.record(
  z.string().min(1),
  z.union([z.string(), z.number(), z.boolean()]),
);
export type SuiteRunParameters = z.infer<typeof suiteRunParametersSchema>;

export const suiteRunInputSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  organizationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  batchRunId: z.string().min(1).optional(),
  parameters: suiteRunParametersSchema.optional(),
}).strict();
export type SuiteRunInput = z.infer<typeof suiteRunInputSchema>;

export const suiteArchivedNamesInputSchema = z.object({
  projectId: z.string().min(1),
  organizationId: z.string().min(1),
  scenarioIds: z.array(z.string().min(1)),
  targets: z.array(suiteTargetSchema),
}).strict();
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

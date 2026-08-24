import { z } from "zod/v4";
import { suiteTargetSchema } from "./suite";

const suiteDefinitionSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  scenarioIds: z.array(z.string().min(1)).min(1),
  targets: z.array(suiteTargetSchema).min(1),
  repeatCount: z.number().int().min(1).max(100).default(1),
  labels: z.array(z.string()).default([]),
  simulatorModel: z.string().nullable().optional(),
  judgeModel: z.string().nullable().optional(),
}).strict();

export const createSuiteCommandSchema = suiteDefinitionSchema;
export type CreateSuiteCommand = z.input<typeof createSuiteCommandSchema>;

export const updateSuiteCommandSchema = suiteDefinitionSchema
  .omit({ projectId: true })
  .partial()
  .extend({ id: z.string().min(1), projectId: z.string().min(1) })
  .strict();
export type UpdateSuiteCommand = z.input<typeof updateSuiteCommandSchema>;

export const suiteIdInputSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
}).strict();
export type SuiteIdInput = z.infer<typeof suiteIdInputSchema>;

import { z } from "zod";
import { scenarioParameterDefinitionsSchema } from "./scenario.parameters";

export const jsonValueSchema = z.json();
export type JsonValue = z.infer<typeof jsonValueSchema>;

export const scenarioSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    name: z.string().min(1),
    situation: z.string(),
    criteria: z.array(z.string()),
    labels: z.array(z.string()),
    parameters: jsonValueSchema,
    simulatorModel: z.string().nullable(),
    judgeModel: z.string().nullable(),
    maxTurns: z.number().int().nullable(),
    minTurns: z.number().int().nullable(),
    lastUpdatedById: z.string().nullable(),
    archivedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type Scenario = z.infer<typeof scenarioSchema>;

export const scenarioIdInputSchema = z
  .object({ id: z.string().min(1), projectId: z.string().min(1) })
  .strict();
export type ScenarioIdInput = z.infer<typeof scenarioIdInputSchema>;

const scenarioFieldsSchema = z
  .object({
    name: z.string().min(1),
    situation: z.string(),
    criteria: z.array(z.string()).default([]),
    labels: z.array(z.string()).default([]),
    parameters: scenarioParameterDefinitionsSchema.optional(),
    simulatorModel: z.string().nullable().optional(),
    judgeModel: z.string().nullable().optional(),
    maxTurns: z.number().int().min(1).max(100).nullable().optional(),
    minTurns: z.number().int().min(0).max(100).nullable().optional(),
    lastUpdatedById: z.string().nullable().optional(),
  })
  .strict();

export const scenarioCreateInputSchema = scenarioFieldsSchema.extend({
  projectId: z.string().min(1),
});
export type ScenarioCreateInput = z.infer<typeof scenarioCreateInputSchema>;

export const scenarioUpdateInputSchema = scenarioFieldsSchema
  .partial()
  .extend(scenarioIdInputSchema.shape)
  .strict();
export type ScenarioUpdateInput = z.infer<typeof scenarioUpdateInputSchema>;

export const scenarioRunConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    situation: z.string(),
    criteria: z.array(z.string()),
    parameters: jsonValueSchema,
  })
  .strict();
export type ScenarioRunConfig = z.infer<typeof scenarioRunConfigSchema>;

export type ScenarioReferenceState = {
  id: string;
  archivedAt: Date | null;
};

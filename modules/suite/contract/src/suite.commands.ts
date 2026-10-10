import type { Named } from "@langwatch/module";
import {
  evaluatorAttachmentsSchema,
  suiteFieldDefinitionsSchema,
} from "@langwatch/scenario-contract";
import { z } from "zod";

import { suiteScopeSchema } from "./suite.scope.ts";
import { suiteTargetSchema } from "./suite.ts";

const suiteDefinitionFieldsSchema = z
  .object({
    projectId: z.string().min(1),
    name: z.string().trim().min(1),
    description: z.string().nullable().optional(),
    scenarioIds: z.array(z.string().min(1)),
    scope: suiteScopeSchema.optional(),
    targets: z.array(suiteTargetSchema),
    repeatCount: z.number().int().min(1).max(100),
    labels: z.array(z.string()),
    simulatorModel: z.string().nullable().optional(),
    judgeModel: z.string().nullable().optional(),
  })
  .strict();

const createSuiteCommandSchemaDefinition = z.strictObject({
  ...suiteDefinitionFieldsSchema.shape,
  scenarioIds: suiteDefinitionFieldsSchema.shape.scenarioIds.default([]),
  targets: suiteDefinitionFieldsSchema.shape.targets.default([]),
  repeatCount: suiteDefinitionFieldsSchema.shape.repeatCount.default(1),
  labels: suiteDefinitionFieldsSchema.shape.labels.default([]),
});
export interface CreateSuiteCommandSchema extends Named<
  typeof createSuiteCommandSchemaDefinition
> {}
export const createSuiteCommandSchema: CreateSuiteCommandSchema =
  createSuiteCommandSchemaDefinition;
export type CreateSuiteCommand = z.input<typeof createSuiteCommandSchema>;

const updateSuiteCommandSchemaDefinition = suiteDefinitionFieldsSchema
  .omit({ projectId: true })
  .partial()
  .safeExtend({
    id: z.string().min(1),
    projectId: z.string().min(1),
    /** The fields a test suite declares; refused on a run plan. */
    fields: suiteFieldDefinitionsSchema.optional(),
    /** The evaluators the suite or plan attaches, the full list. */
    evaluators: evaluatorAttachmentsSchema.optional(),
  })
  .strict();
export interface UpdateSuiteCommandSchema extends Named<
  typeof updateSuiteCommandSchemaDefinition
> {}
export const updateSuiteCommandSchema: UpdateSuiteCommandSchema =
  updateSuiteCommandSchemaDefinition;
export type UpdateSuiteCommand = z.input<typeof updateSuiteCommandSchema>;

const suiteIdInputSchemaDefinition = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
  })
  .strict();
export interface SuiteIdInputSchema extends Named<typeof suiteIdInputSchemaDefinition> {}
export const suiteIdInputSchema: SuiteIdInputSchema = suiteIdInputSchemaDefinition;
export type SuiteIdInput = z.infer<typeof suiteIdInputSchema>;

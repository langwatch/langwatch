import { z } from "zod";
import { scenarioParameterDefinitionsSchema } from "./scenario.parameters";

export const scenarioAuthorLabelSchema = z.enum(["user", "api", "cli", "langy"]);
export type ScenarioAuthorLabel = z.infer<typeof scenarioAuthorLabelSchema>;

export const scenarioActorSchema = z
  .object({
    userId: z.string().min(1).nullable(),
    label: scenarioAuthorLabelSchema,
  })
  .strict();
export type ScenarioActor = z.infer<typeof scenarioActorSchema>;

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
    folderId: z.string().min(1).nullable().default(null),
    version: z.number().int().positive().default(1),
    lastUpdatedById: z.string().nullable(),
    archivedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type Scenario = z.infer<typeof scenarioSchema>;

/** A Scenario-owned folder backed by a `SimulationSuite` row of kind `folder`. */
export const scenarioFolderSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
    description: z.string().nullable(),
    scenarioIds: z.array(z.string().min(1)),
    targets: z.array(jsonValueSchema),
    repeatCount: z.number().int().positive(),
    labels: z.array(z.string()),
    simulatorModel: z.string().nullable(),
    judgeModel: z.string().nullable(),
    kind: z.literal("folder"),
    scope: jsonValueSchema.nullable(),
    archivedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type ScenarioFolder = z.infer<typeof scenarioFolderSchema>;

export const scenarioFolderCreateInputSchema = z
  .object({ projectId: z.string().min(1), name: z.string().trim().min(1) })
  .strict();
export type ScenarioFolderCreateInput = z.infer<typeof scenarioFolderCreateInputSchema>;

export const scenarioFolderIdInputSchema = z
  .object({ projectId: z.string().min(1), folderId: z.string().min(1) })
  .strict();
export type ScenarioFolderIdInput = z.infer<typeof scenarioFolderIdInputSchema>;

export const scenarioFolderRenameInputSchema = scenarioFolderIdInputSchema
  .extend({ name: z.string().trim().min(1) })
  .strict();
export type ScenarioFolderRenameInput = z.infer<typeof scenarioFolderRenameInputSchema>;

export const scenarioFolderUpdateInputSchema = scenarioFolderIdInputSchema
  .extend({
    name: z.string().trim().min(1).optional(),
    description: z.string().nullable().optional(),
    targets: z.array(jsonValueSchema).optional(),
    repeatCount: z.number().int().min(1).max(100).optional(),
    labels: z.array(z.string()).optional(),
    simulatorModel: z.string().nullable().optional(),
    judgeModel: z.string().nullable().optional(),
  })
  .strict();
export type ScenarioFolderUpdateInput = z.infer<typeof scenarioFolderUpdateInputSchema>;

export type ScenarioFolderRunDefinition = {
  folder: ScenarioFolder;
  scenarioIds: string[];
};

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
    parameters: scenarioParameterDefinitionsSchema.nullable().optional(),
    simulatorModel: z.string().nullable().optional(),
    judgeModel: z.string().nullable().optional(),
    maxTurns: z.number().int().min(1).max(100).nullable().optional(),
    minTurns: z.number().int().min(0).max(100).nullable().optional(),
    lastUpdatedById: z.string().nullable().optional(),
    folderId: z.string().min(1).nullable().optional(),
  })
  .strict();

export const scenarioCreateInputSchema = scenarioFieldsSchema.extend({
  projectId: z.string().min(1),
  actor: scenarioActorSchema.optional(),
});
export type ScenarioCreateInput = z.infer<typeof scenarioCreateInputSchema>;

export const scenarioUpdateInputSchema = scenarioFieldsSchema
  .partial()
  .extend({
    ...scenarioIdInputSchema.shape,
    actor: scenarioActorSchema.optional(),
    expectedVersion: z.number().int().positive().optional(),
    changeDescription: z.string().min(1).optional(),
  })
  .strict();
export type ScenarioUpdateInput = z.infer<typeof scenarioUpdateInputSchema>;

export const scenarioRunConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    version: z.number().int().nonnegative().default(0),
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

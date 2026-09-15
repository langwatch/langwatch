import { z } from "zod";
import { evaluatorAttachmentsSchema, parseEvaluatorAttachments } from "./evaluator-attachments.ts";
import { scenarioParameterDefinitionsSchema } from "./scenario.parameters.ts";
import { callerVoiceConfigSchema } from "./voice/caller-voice.config.ts";
import {
  parseScenarioFieldValues,
  parseSuiteFieldDefinitions,
  scenarioFieldValuesSchema,
  suiteFieldDefinitionsSchema,
} from "./suite-fields.ts";

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
    // The value this scenario carries for each field its test suite declares,
    // keyed by field identifier. A field with no value has no key. See
    // specs/scenarios/scenario-fields.feature.
    fields: z.preprocess((raw) => parseScenarioFieldValues(raw), scenarioFieldValuesSchema),
    // The simulated caller's voice for a voice target, stored as written.
    // Null for a non-voice scenario. Read with `parseCallerVoiceConfig`,
    // which tolerates older stored shapes. Defaulted so pre-column fixtures
    // still parse. See specs/features/agents/voice-agents-v1.feature.
    callerVoice: jsonValueSchema.nullable().default(null),
    testSuiteId: z.string().min(1).nullable().default(null),
    version: z.number().int().positive().default(1),
    lastUpdatedById: z.string().nullable(),
    archivedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type Scenario = z.infer<typeof scenarioSchema>;

/** A Scenario-owned test suite backed by a `SimulationSuite` row of kind `test suite`. */
export const scenarioTestSuiteSchema = z
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
    kind: z.literal("test_suite"),
    scope: jsonValueSchema.nullable(),
    fields: z.preprocess((raw) => parseSuiteFieldDefinitions(raw), suiteFieldDefinitionsSchema),
    evaluators: z.preprocess((raw) => parseEvaluatorAttachments(raw), evaluatorAttachmentsSchema),
    archivedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type ScenarioTestSuite = z.infer<typeof scenarioTestSuiteSchema>;

export const scenarioTestSuiteCreateInputSchema = z
  .object({
    projectId: z.string().min(1),
    name: z.string().trim().min(1),
    fields: suiteFieldDefinitionsSchema.optional(),
    evaluators: evaluatorAttachmentsSchema.optional(),
  })
  .strict();
export type ScenarioTestSuiteCreateInput = z.infer<typeof scenarioTestSuiteCreateInputSchema>;

export const scenarioTestSuiteIdInputSchema = z
  .object({ projectId: z.string().min(1), testSuiteId: z.string().min(1) })
  .strict();
export type ScenarioTestSuiteIdInput = z.infer<typeof scenarioTestSuiteIdInputSchema>;

export const scenarioTestSuiteRenameInputSchema = scenarioTestSuiteIdInputSchema
  .extend({ name: z.string().trim().min(1) })
  .strict();
export type ScenarioTestSuiteRenameInput = z.infer<typeof scenarioTestSuiteRenameInputSchema>;

export const scenarioTestSuiteUpdateInputSchema = scenarioTestSuiteIdInputSchema
  .extend({
    name: z.string().trim().min(1).optional(),
    description: z.string().nullable().optional(),
    targets: z.array(jsonValueSchema).optional(),
    repeatCount: z.number().int().min(1).max(100).optional(),
    labels: z.array(z.string()).optional(),
    simulatorModel: z.string().nullable().optional(),
    judgeModel: z.string().nullable().optional(),
    fields: suiteFieldDefinitionsSchema.optional(),
    evaluators: evaluatorAttachmentsSchema.optional(),
  })
  .strict();
export type ScenarioTestSuiteUpdateInput = z.infer<typeof scenarioTestSuiteUpdateInputSchema>;

export type ScenarioTestSuiteRunDefinition = {
  testSuite: ScenarioTestSuite;
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
    testSuiteId: z.string().min(1).nullable().optional(),
    fields: scenarioFieldValuesSchema.optional(),
    // The simulated caller's voice for a voice target. Absent leaves it
    // unset (create) or keeps the current voice (update); send the default
    // config to clear. Never null: a plain null is not a valid Prisma JSON
    // write, matching the pre-module router's contract.
    callerVoice: callerVoiceConfigSchema.optional(),
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

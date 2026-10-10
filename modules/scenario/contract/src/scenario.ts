import { generate } from "@langwatch/ksuid";
import type { Named } from "@langwatch/module";
import type { Instant } from "@langwatch/time";
import { z } from "zod";

import { evaluatorAttachmentsSchema, parseEvaluatorAttachments } from "./evaluator-attachments.ts";
import { scenarioParameterDefinitionsSchema } from "./scenario.parameters.ts";
import {
  parseScenarioFieldValues,
  parseSuiteFieldDefinitions,
  scenarioFieldValuesSchema,
  suiteFieldDefinitionsSchema,
} from "./suite-fields.ts";
import { callerVoiceConfigSchema } from "./voice/caller-voice.config.ts";

export const scenarioAuthorLabelSchema = z.enum(["user", "api", "cli", "langy"]);
export type ScenarioAuthorLabel = z.infer<typeof scenarioAuthorLabelSchema>;

const scenarioActorSchemaDefinition = z
  .object({
    userId: z.string().min(1).nullable(),
    label: scenarioAuthorLabelSchema,
  })
  .strict();
export interface ScenarioActorSchema extends Named<typeof scenarioActorSchemaDefinition> {}
export const scenarioActorSchema: ScenarioActorSchema = scenarioActorSchemaDefinition;
export type ScenarioActor = z.infer<typeof scenarioActorSchema>;

export const jsonValueSchema = z.json();
export type JsonValue = z.infer<typeof jsonValueSchema>;

const scenarioSchemaDefinition = z
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
export interface ScenarioSchema extends Named<typeof scenarioSchemaDefinition> {}
export const scenarioSchema: ScenarioSchema = scenarioSchemaDefinition;
export type Scenario = z.infer<typeof scenarioSchema>;

/** A scenario read by id, archived rows included; a miss answers `found: false`. */
export type ScenarioLookup = { found: true; scenario: Scenario } | { found: false };

/** A Scenario-owned test suite backed by a `SimulationSuite` row of kind `test suite`. */
const scenarioTestSuiteSchemaDefinition = z
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
export interface ScenarioTestSuiteSchema extends Named<typeof scenarioTestSuiteSchemaDefinition> {}
export const scenarioTestSuiteSchema: ScenarioTestSuiteSchema = scenarioTestSuiteSchemaDefinition;
export type ScenarioTestSuite = z.infer<typeof scenarioTestSuiteSchema>;

const scenarioTestSuiteCreateInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    name: z.string().trim().min(1),
    fields: suiteFieldDefinitionsSchema.optional(),
    evaluators: evaluatorAttachmentsSchema.optional(),
  })
  .strict();
export interface ScenarioTestSuiteCreateInputSchema extends Named<
  typeof scenarioTestSuiteCreateInputSchemaDefinition
> {}
export const scenarioTestSuiteCreateInputSchema: ScenarioTestSuiteCreateInputSchema =
  scenarioTestSuiteCreateInputSchemaDefinition;
export type ScenarioTestSuiteCreateInput = z.infer<typeof scenarioTestSuiteCreateInputSchema>;

const scenarioTestSuiteIdInputSchemaDefinition = z
  .object({ projectId: z.string().min(1), testSuiteId: z.string().min(1) })
  .strict();
export interface ScenarioTestSuiteIdInputSchema extends Named<
  typeof scenarioTestSuiteIdInputSchemaDefinition
> {}
export const scenarioTestSuiteIdInputSchema: ScenarioTestSuiteIdInputSchema =
  scenarioTestSuiteIdInputSchemaDefinition;
export type ScenarioTestSuiteIdInput = z.infer<typeof scenarioTestSuiteIdInputSchema>;

const scenarioTestSuiteRenameInputSchemaDefinition = scenarioTestSuiteIdInputSchema
  .safeExtend({ name: z.string().trim().min(1) })
  .strict();
export interface ScenarioTestSuiteRenameInputSchema extends Named<
  typeof scenarioTestSuiteRenameInputSchemaDefinition
> {}
export const scenarioTestSuiteRenameInputSchema: ScenarioTestSuiteRenameInputSchema =
  scenarioTestSuiteRenameInputSchemaDefinition;
export type ScenarioTestSuiteRenameInput = z.infer<typeof scenarioTestSuiteRenameInputSchema>;

const scenarioTestSuiteUpdateInputSchemaDefinition = scenarioTestSuiteIdInputSchema
  .safeExtend({
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
export interface ScenarioTestSuiteUpdateInputSchema extends Named<
  typeof scenarioTestSuiteUpdateInputSchemaDefinition
> {}
export const scenarioTestSuiteUpdateInputSchema: ScenarioTestSuiteUpdateInputSchema =
  scenarioTestSuiteUpdateInputSchemaDefinition;
export type ScenarioTestSuiteUpdateInput = z.infer<typeof scenarioTestSuiteUpdateInputSchema>;

export type ScenarioTestSuiteRunDefinition = {
  testSuite: ScenarioTestSuite;
  scenarioIds: string[];
};

const scenarioIdInputSchemaDefinition = z
  .object({ id: z.string().min(1), projectId: z.string().min(1) })
  .strict();
export interface ScenarioIdInputSchema extends Named<typeof scenarioIdInputSchemaDefinition> {}
export const scenarioIdInputSchema: ScenarioIdInputSchema = scenarioIdInputSchemaDefinition;
export type ScenarioIdInput = z.infer<typeof scenarioIdInputSchema>;

// No defaults here: under `.partial()` Zod still applies a default, so an
// update that never named criteria or labels would write them as empty.
const scenarioFieldsShape = {
  name: z.string().min(1),
  situation: z.string(),
  criteria: z.array(z.string()),
  labels: z.array(z.string()),
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
};

const scenarioCreateInputSchemaDefinition = z
  .object({
    ...scenarioFieldsShape,
    criteria: z.array(z.string()).default([]),
    labels: z.array(z.string()).default([]),
    projectId: z.string().min(1),
    actor: scenarioActorSchema.optional(),
  })
  .strict();
export interface ScenarioCreateInputSchema extends Named<
  typeof scenarioCreateInputSchemaDefinition
> {}
export const scenarioCreateInputSchema: ScenarioCreateInputSchema =
  scenarioCreateInputSchemaDefinition;
export type ScenarioCreateInput = z.infer<typeof scenarioCreateInputSchema>;

const scenarioUpdateInputSchemaDefinition = z
  .object(scenarioFieldsShape)
  .partial()
  .safeExtend({
    ...scenarioIdInputSchema.shape,
    actor: scenarioActorSchema.optional(),
    expectedVersion: z.number().int().positive().optional(),
    changeDescription: z.string().min(1).optional(),
  })
  .strict();
export interface ScenarioUpdateInputSchema extends Named<
  typeof scenarioUpdateInputSchemaDefinition
> {}
export const scenarioUpdateInputSchema: ScenarioUpdateInputSchema =
  scenarioUpdateInputSchemaDefinition;
export type ScenarioUpdateInput = z.infer<typeof scenarioUpdateInputSchema>;

const scenarioRunConfigSchemaDefinition = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    version: z.number().int().nonnegative().default(0),
    situation: z.string(),
    criteria: z.array(z.string()),
    parameters: jsonValueSchema,
  })
  .strict();
export interface ScenarioRunConfigSchema extends Named<typeof scenarioRunConfigSchemaDefinition> {}
export const scenarioRunConfigSchema: ScenarioRunConfigSchema = scenarioRunConfigSchemaDefinition;
export type ScenarioRunConfig = z.infer<typeof scenarioRunConfigSchema>;

export type ScenarioReferenceState = {
  id: string;
  archivedAt: Instant | null;
};

/**
 * ID generators for scenario execution.
 *
 * Kept in their own module so callers can mint IDs without importing the queue.
 */

/** Generates a unique batch run ID for grouping scenario executions */
export function generateBatchRunId(): string {
  return generate("scenariobatch").toString();
}

/** Generates a unique scenario run ID with `scenariorun_` prefix for SDK passthrough */
export function generateScenarioRunId(): string {
  return generate("scenariorun").toString();
}

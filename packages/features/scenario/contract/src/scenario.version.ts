import { z } from "zod";
import {
  scenarioActorSchema,
  scenarioAuthorLabelSchema,
  scenarioIdInputSchema,
  type Scenario,
  type ScenarioUpdateInput,
} from "./scenario";
import { scenarioParameterDefinitionsSchema } from "./scenario.parameters";

export type { ScenarioActor, ScenarioAuthorLabel } from "./scenario";

export const scenarioVersionedFields = [
  "name",
  "situation",
  "criteria",
  "labels",
  "parameters",
  "simulatorModel",
  "judgeModel",
  "maxTurns",
  "minTurns",
] as const;
export type ScenarioVersionedField = (typeof scenarioVersionedFields)[number];

export const scenarioSnapshotFieldsSchema = z
  .object({
    name: z.string(),
    situation: z.string(),
    criteria: z.array(z.string()),
    labels: z.array(z.string()),
    parameters: scenarioParameterDefinitionsSchema.nullable(),
    simulatorModel: z.string().nullable(),
    judgeModel: z.string().nullable(),
    maxTurns: z.number().int().nullable(),
    minTurns: z.number().int().nullable(),
  })
  .strict();
export type ScenarioSnapshotFields = z.infer<typeof scenarioSnapshotFieldsSchema>;

export const scenarioSnapshotSchemaVersion = 1;

const scenarioSnapshotEnvelopeSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    fields: scenarioSnapshotFieldsSchema,
    changedFields: z.array(z.string()),
  })
  .strict();
export type ScenarioSnapshotEnvelope = z.infer<typeof scenarioSnapshotEnvelopeSchema>;

export function snapshotFieldsOf(scenario: Scenario): ScenarioSnapshotFields {
  return {
    name: scenario.name,
    situation: scenario.situation,
    criteria: scenario.criteria,
    labels: scenario.labels,
    parameters: scenarioParameterDefinitionsSchema.nullable().parse(scenario.parameters),
    simulatorModel: scenario.simulatorModel,
    judgeModel: scenario.judgeModel,
    maxTurns: scenario.maxTurns,
    minTurns: scenario.minTurns,
  };
}

export function changedSnapshotFields(
  previous: ScenarioSnapshotFields,
  next: ScenarioSnapshotFields,
): ScenarioVersionedField[] {
  return scenarioVersionedFields.filter(
    (field) => JSON.stringify(previous[field] ?? null) !== JSON.stringify(next[field] ?? null),
  );
}

export function touchesVersionedFields(input: ScenarioUpdateInput): boolean {
  return scenarioVersionedFields.some((field) => input[field] !== void 0);
}

export function buildSnapshotEnvelope(
  fields: ScenarioSnapshotFields,
  changedFields: string[],
): ScenarioSnapshotEnvelope {
  return scenarioSnapshotEnvelopeSchema.parse({
    schemaVersion: scenarioSnapshotSchemaVersion,
    fields,
    changedFields,
  });
}

export function parseSnapshotEnvelope(snapshot: unknown): ScenarioSnapshotEnvelope {
  return scenarioSnapshotEnvelopeSchema.parse(snapshot);
}

export const scenarioVersionSummarySchema = z
  .object({
    version: z.number().int().positive(),
    authorId: z.string().nullable(),
    authorLabel: scenarioAuthorLabelSchema.nullable(),
    changeDescription: z.string().nullable(),
    changedFields: z.array(z.string()),
    createdAt: z.date(),
    isSynthesized: z.boolean(),
  })
  .strict();
export type ScenarioVersionSummary = z.infer<typeof scenarioVersionSummarySchema>;

export const scenarioVersionDetailSchema = scenarioVersionSummarySchema
  .extend({
    fields: scenarioSnapshotFieldsSchema,
    schemaVersion: z.number().int().positive(),
  })
  .strict();
export type ScenarioVersionDetail = z.infer<typeof scenarioVersionDetailSchema>;

export const scenarioVersionListInputSchema = scenarioIdInputSchema
  .omit({ id: true })
  .extend({
    scenarioId: z.string().min(1),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.number().int().optional(),
  })
  .strict();
export type ScenarioVersionListInput = z.infer<typeof scenarioVersionListInputSchema>;

export const scenarioVersionInputSchema = scenarioVersionListInputSchema
  .pick({ projectId: true, scenarioId: true })
  .extend({ version: z.number().int().positive() })
  .strict();
export type ScenarioVersionInput = z.infer<typeof scenarioVersionInputSchema>;

export const scenarioVersionRestoreInputSchema = scenarioVersionInputSchema
  .extend({ actor: scenarioActorSchema })
  .strict();
export type ScenarioVersionRestoreInput = z.infer<typeof scenarioVersionRestoreInputSchema>;

export const scenarioMoveInputSchema = scenarioIdInputSchema
  .omit({ id: true })
  .extend({
    scenarioId: z.string().min(1),
    testSuiteId: z.string().min(1).nullable(),
  })
  .strict();
export type ScenarioMoveInput = z.infer<typeof scenarioMoveInputSchema>;

export const scenarioDuplicateInputSchema = scenarioIdInputSchema
  .omit({ id: true })
  .extend({
    scenarioId: z.string().min(1),
    lastUpdatedById: z.string().min(1).optional(),
  })
  .strict();
export type ScenarioDuplicateInput = z.infer<typeof scenarioDuplicateInputSchema>;

import type { Named } from "@langwatch/module";
import { z } from "zod";

import { scenarioParameterDefinitionsSchema } from "./scenario.parameters.ts";
import {
  scenarioActorSchema,
  scenarioAuthorLabelSchema,
  scenarioIdInputSchema,
  type Scenario,
  type ScenarioUpdateInput,
} from "./scenario.ts";
import {
  parseScenarioFieldValues,
  scenarioFieldValuesSchema,
  type ScenarioFieldValues,
} from "./suite-fields.ts";

export type { ScenarioActor, ScenarioAuthorLabel } from "./scenario.ts";

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
  "fields",
] as const;
export type ScenarioVersionedField = (typeof scenarioVersionedFields)[number];

const scenarioSnapshotFieldsSchemaDefinition = z
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
    // Absent on a version snapshot written before scenario fields existed,
    // which reads the same as a scenario that carries no values.
    fields: scenarioFieldValuesSchema.nullable().optional(),
  })
  .strict();
export interface ScenarioSnapshotFieldsSchema extends Named<
  typeof scenarioSnapshotFieldsSchemaDefinition
> {}
export const scenarioSnapshotFieldsSchema: ScenarioSnapshotFieldsSchema =
  scenarioSnapshotFieldsSchemaDefinition;
export type ScenarioSnapshotFields = z.infer<typeof scenarioSnapshotFieldsSchema>;

/** Version 2 added `fields`; a version 1 snapshot has no such key and reads as null (main). */
export const scenarioSnapshotSchemaVersion = 2;

const scenarioSnapshotEnvelopeSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    fields: scenarioSnapshotFieldsSchema,
    changedFields: z.array(z.string()),
  })
  .strict();
export type ScenarioSnapshotEnvelope = z.infer<typeof scenarioSnapshotEnvelopeSchema>;

export function snapshotFieldsOf(
  scenario: Pick<Scenario, Exclude<ScenarioVersionedField, "fields">> & { fields?: unknown },
): ScenarioSnapshotFields {
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
    fields: normalizeFieldValues(scenario.fields),
  };
}

/**
 * A scenario with no field values stores either null (never given any) or an
 * empty record (cleared); the snapshot keeps one spelling so the two never
 * diff as a change.
 */
function normalizeFieldValues(raw: unknown): ScenarioFieldValues | null {
  const parsed = parseScenarioFieldValues(raw);
  return Object.keys(parsed).length === 0 ? null : parsed;
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
  const envelope = scenarioSnapshotEnvelopeSchema.parse(snapshot);
  return { ...envelope, fields: { ...envelope.fields, fields: envelope.fields.fields ?? null } };
}

const scenarioVersionSummarySchemaDefinition = z
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
export interface ScenarioVersionSummarySchema extends Named<
  typeof scenarioVersionSummarySchemaDefinition
> {}
export const scenarioVersionSummarySchema: ScenarioVersionSummarySchema =
  scenarioVersionSummarySchemaDefinition;
export type ScenarioVersionSummary = z.infer<typeof scenarioVersionSummarySchema>;

const scenarioVersionDetailSchemaDefinition = scenarioVersionSummarySchema
  .safeExtend({
    fields: scenarioSnapshotFieldsSchema,
    schemaVersion: z.number().int().positive(),
  })
  .strict();
export interface ScenarioVersionDetailSchema extends Named<
  typeof scenarioVersionDetailSchemaDefinition
> {}
export const scenarioVersionDetailSchema: ScenarioVersionDetailSchema =
  scenarioVersionDetailSchemaDefinition;
export type ScenarioVersionDetail = z.infer<typeof scenarioVersionDetailSchema>;

const scenarioVersionListInputSchemaDefinition = scenarioIdInputSchema
  .omit({ id: true })
  .safeExtend({
    scenarioId: z.string().min(1),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.number().int().optional(),
  })
  .strict();
export interface ScenarioVersionListInputSchema extends Named<
  typeof scenarioVersionListInputSchemaDefinition
> {}
export const scenarioVersionListInputSchema: ScenarioVersionListInputSchema =
  scenarioVersionListInputSchemaDefinition;
export type ScenarioVersionListInput = z.infer<typeof scenarioVersionListInputSchema>;

const scenarioVersionInputSchemaDefinition = scenarioVersionListInputSchema
  .pick({ projectId: true, scenarioId: true })
  .safeExtend({ version: z.number().int().positive() })
  .strict();
export interface ScenarioVersionInputSchema extends Named<
  typeof scenarioVersionInputSchemaDefinition
> {}
export const scenarioVersionInputSchema: ScenarioVersionInputSchema =
  scenarioVersionInputSchemaDefinition;
export type ScenarioVersionInput = z.infer<typeof scenarioVersionInputSchema>;

const scenarioVersionRestoreInputSchemaDefinition = scenarioVersionInputSchema
  .safeExtend({ actor: scenarioActorSchema })
  .strict();
export interface ScenarioVersionRestoreInputSchema extends Named<
  typeof scenarioVersionRestoreInputSchemaDefinition
> {}
export const scenarioVersionRestoreInputSchema: ScenarioVersionRestoreInputSchema =
  scenarioVersionRestoreInputSchemaDefinition;
export type ScenarioVersionRestoreInput = z.infer<typeof scenarioVersionRestoreInputSchema>;

const scenarioMoveInputSchemaDefinition = scenarioIdInputSchema
  .omit({ id: true })
  .safeExtend({
    scenarioId: z.string().min(1),
    testSuiteId: z.string().min(1).nullable(),
  })
  .strict();
export interface ScenarioMoveInputSchema extends Named<typeof scenarioMoveInputSchemaDefinition> {}
export const scenarioMoveInputSchema: ScenarioMoveInputSchema = scenarioMoveInputSchemaDefinition;
export type ScenarioMoveInput = z.infer<typeof scenarioMoveInputSchema>;

const scenarioDuplicateInputSchemaDefinition = scenarioIdInputSchema
  .omit({ id: true })
  .safeExtend({
    scenarioId: z.string().min(1),
    lastUpdatedById: z.string().min(1).optional(),
  })
  .strict();
export interface ScenarioDuplicateInputSchema extends Named<
  typeof scenarioDuplicateInputSchemaDefinition
> {}
export const scenarioDuplicateInputSchema: ScenarioDuplicateInputSchema =
  scenarioDuplicateInputSchemaDefinition;
export type ScenarioDuplicateInput = z.infer<typeof scenarioDuplicateInputSchema>;

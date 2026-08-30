/**
 * The versioned shape of a scenario: which fields a version keeps, how a
 * saved state becomes a snapshot, and how two states diff into the changed
 * field list a history entry shows.
 *
 * The snapshot holds the editable content and nothing else. Test suite
 * membership, archive state and run history live beside the content, so a
 * restore brings the text back without moving the scenario or touching what ran.
 *
 * @see specs/scenarios/scenario-versioning.feature
 * @see specs/scenarios/scenario-version-restore.feature
 */

import { z } from "zod";
import type { Prisma, Scenario } from "~/generated/prisma/client";
import type { UpdateScenarioInput } from "./scenario.repository";

/** Schema version written into every snapshot envelope and version row. */
export const SCENARIO_SNAPSHOT_SCHEMA_VERSION = 1;

/** Who a version row names as its writer. */
export const SCENARIO_AUTHOR_LABELS = ["user", "api", "cli", "langy"] as const;
export type ScenarioAuthorLabel = (typeof SCENARIO_AUTHOR_LABELS)[number];

/** The caller a save is recorded against. */
export type ScenarioActor = {
  userId: string | null;
  label: ScenarioAuthorLabel;
};

/**
 * The fields a version snapshots. An update that names none of these (a
 * test suite move, an author stamp) is not a save of the scenario's content and
 * writes no version.
 */
export const SCENARIO_VERSIONED_FIELDS = [
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
export type ScenarioVersionedField = (typeof SCENARIO_VERSIONED_FIELDS)[number];

/** One saved state of the editable fields, as the snapshot stores it. */
export type ScenarioSnapshotFields = {
  name: string;
  situation: string;
  criteria: string[];
  labels: string[];
  parameters: Prisma.JsonValue | null;
  simulatorModel: string | null;
  judgeModel: string | null;
  maxTurns: number | null;
  minTurns: number | null;
};

const snapshotFieldsSchema = z.object({
  name: z.string(),
  situation: z.string(),
  criteria: z.array(z.string()),
  labels: z.array(z.string()),
  parameters: z.unknown().nullable(),
  simulatorModel: z.string().nullable(),
  judgeModel: z.string().nullable(),
  maxTurns: z.number().nullable(),
  minTurns: z.number().nullable(),
});

const snapshotEnvelopeSchema = z.object({
  schemaVersion: z.number(),
  fields: snapshotFieldsSchema,
  changedFields: z.array(z.string()),
});

export type ScenarioSnapshotEnvelope = z.infer<typeof snapshotEnvelopeSchema>;

/** The editable field set of a stored scenario row. */
export function snapshotFieldsOf(
  scenario: Pick<Scenario, ScenarioVersionedField>,
): ScenarioSnapshotFields {
  return {
    name: scenario.name,
    situation: scenario.situation,
    criteria: scenario.criteria,
    labels: scenario.labels,
    parameters: scenario.parameters ?? null,
    simulatorModel: scenario.simulatorModel,
    judgeModel: scenario.judgeModel,
    maxTurns: scenario.maxTurns,
    minTurns: scenario.minTurns,
  };
}

/**
 * The fields whose value differs between two states, in the field order the
 * snapshot declares. A save that changed nothing diffs to an empty list, and
 * still records a version: the save happened, the history says so.
 */
export function diffSnapshotFields(
  previous: ScenarioSnapshotFields,
  next: ScenarioSnapshotFields,
): ScenarioVersionedField[] {
  return SCENARIO_VERSIONED_FIELDS.filter(
    (field) =>
      JSON.stringify(previous[field] ?? null) !==
      JSON.stringify(next[field] ?? null),
  );
}

/**
 * Whether an update writes any versioned field. `undefined` values are keys
 * the caller did not send, so they name nothing.
 */
export function touchesVersionedFields(data: UpdateScenarioInput): boolean {
  return SCENARIO_VERSIONED_FIELDS.some((field) => data[field] !== undefined);
}

/** The snapshot envelope a version row stores. */
export function buildSnapshotEnvelope({
  fields,
  changedFields,
}: {
  fields: ScenarioSnapshotFields;
  changedFields: string[];
}): Prisma.InputJsonValue {
  return {
    schemaVersion: SCENARIO_SNAPSHOT_SCHEMA_VERSION,
    fields,
    changedFields,
  } as unknown as Prisma.InputJsonValue;
}

/**
 * Reads a stored snapshot back into its envelope. A row that does not parse
 * is a platform bug: nothing user-supplied writes this column.
 */
export function parseSnapshotEnvelope(
  snapshot: Prisma.JsonValue,
): ScenarioSnapshotEnvelope {
  return snapshotEnvelopeSchema.parse(snapshot);
}

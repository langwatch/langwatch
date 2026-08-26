/**
 * @vitest-environment node
 *
 * The pure half of scenario versioning: what a snapshot holds, how two
 * states diff into a changed field list, and which updates count as a save.
 *
 * @see specs/scenarios/scenario-versioning.feature
 * @see specs/scenarios/scenario-version-restore.feature
 */
import { describe, expect, it } from "vitest";
import {
  buildSnapshotEnvelope,
  diffSnapshotFields,
  parseSnapshotEnvelope,
  SCENARIO_SNAPSHOT_SCHEMA_VERSION,
  SCENARIO_VERSIONED_FIELDS,
  type ScenarioSnapshotFields,
  snapshotFieldsOf,
  touchesVersionedFields,
} from "../scenario-versioning";

function fields(
  overrides: Partial<ScenarioSnapshotFields> = {},
): ScenarioSnapshotFields {
  return {
    name: "Refund flow",
    situation: "A customer asks for a refund",
    criteria: ["The agent helps"],
    labels: ["billing"],
    parameters: null,
    simulatorModel: null,
    judgeModel: null,
    maxTurns: null,
    minTurns: null,
    ...overrides,
  };
}

describe("diffSnapshotFields", () => {
  /** @scenario "The changed field list holds only the fields whose value differs" */
  it("holds only the fields whose value differs", () => {
    const previous = fields();
    const next = fields({ situation: "A customer asks for a replacement" });

    expect(diffSnapshotFields(previous, next)).toEqual(["situation"]);
  });

  it("diffs to an empty list when nothing changed", () => {
    expect(diffSnapshotFields(fields(), fields())).toEqual([]);
  });

  it("compares array and json fields by value, not by reference", () => {
    const previous = fields({
      criteria: ["The agent helps"],
      parameters: [{ name: "tier", defaultValue: "gold" }],
    });
    const next = fields({
      criteria: ["The agent helps"],
      parameters: [{ name: "tier", defaultValue: "gold" }],
    });

    expect(diffSnapshotFields(previous, next)).toEqual([]);
  });

  it("lists every differing field in snapshot order", () => {
    const previous = fields();
    const next = fields({
      name: "Replacement flow",
      criteria: ["The agent replaces the item"],
      maxTurns: 12,
    });

    expect(diffSnapshotFields(previous, next)).toEqual([
      "name",
      "criteria",
      "maxTurns",
    ]);
  });
});

describe("touchesVersionedFields", () => {
  it("is true when an editable field is sent", () => {
    expect(touchesVersionedFields({ situation: "New text" })).toBe(true);
  });

  it("is false for a folder move", () => {
    expect(touchesVersionedFields({ folderId: "suite_1" })).toBe(false);
    expect(touchesVersionedFields({ folderId: null })).toBe(false);
  });

  it("is false for an author stamp alone", () => {
    expect(touchesVersionedFields({ lastUpdatedById: "user_1" })).toBe(false);
  });
});

describe("the snapshot envelope", () => {
  /** @scenario "A restore brings back the editable content and nothing else" */
  it("holds the editable content and nothing else", () => {
    // The versioned field list is the restore's write set: no folder, no
    // archive state, no run history.
    expect(SCENARIO_VERSIONED_FIELDS).not.toContain("folderId");
    expect(SCENARIO_VERSIONED_FIELDS).not.toContain("archivedAt");
    expect(SCENARIO_VERSIONED_FIELDS).toEqual([
      "name",
      "situation",
      "criteria",
      "labels",
      "parameters",
      "simulatorModel",
      "judgeModel",
      "maxTurns",
      "minTurns",
    ]);

    const scenarioRow = {
      ...fields(),
      // Columns a stored row carries beside the editable content.
      id: "scenario_1",
      projectId: "project_1",
      folderId: "suite_1",
      version: 4,
    };
    expect(Object.keys(snapshotFieldsOf(scenarioRow)).sort()).toEqual(
      [...SCENARIO_VERSIONED_FIELDS].sort(),
    );
  });

  it("round-trips through build and parse", () => {
    const envelope = buildSnapshotEnvelope({
      fields: fields({ parameters: [{ name: "tier" }] }),
      changedFields: ["parameters"],
    });

    const parsed = parseSnapshotEnvelope(envelope as never);
    expect(parsed.schemaVersion).toBe(SCENARIO_SNAPSHOT_SCHEMA_VERSION);
    expect(parsed.changedFields).toEqual(["parameters"]);
    expect(parsed.fields.name).toBe("Refund flow");
    expect(parsed.fields.parameters).toEqual([{ name: "tier" }]);
  });
});

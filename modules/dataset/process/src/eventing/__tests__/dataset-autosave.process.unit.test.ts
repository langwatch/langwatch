import { DATASET_VERSION_QUIET_MS, type DatasetVersionAuthor } from "@langwatch/dataset-contract";
import { buildIntentAccessor } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import {
  DATASET_AUTOSAVE_INITIAL_STATE,
  type DatasetAutosaveState,
  datasetAutosaveEdited,
  datasetAutosaveIntentSchema,
  datasetAutosaveWake,
} from "../dataset-autosave.process.ts";

const ALICE: DatasetVersionAuthor = { kind: "user", id: "user-alice" };
const intent = buildIntentAccessor({
  snapshot: { schema: datasetAutosaveIntentSchema, run: async () => {} },
});
const context = (at: number) => ({ at, now: at, key: "dataset-1", projectId: "project-1", intent });

const edit = (state: DatasetAutosaveState, at: number) =>
  datasetAutosaveEdited(
    state,
    { projectId: "project-1", datasetId: "dataset-1", editedBy: ALICE },
    context(at),
  );

describe("the dataset autosave process", () => {
  describe("given an edit", () => {
    /** @scenario "Edits that go quiet save a version" */
    it("wakes once the quiet period has passed and asks for one snapshot by the editor", () => {
      const edited = edit(DATASET_AUTOSAVE_INITIAL_STATE, 1_000);
      expect(edited.nextWakeAt).toBe(1_000 + DATASET_VERSION_QUIET_MS);

      const woken = datasetAutosaveWake(edited.state, context(1_000 + DATASET_VERSION_QUIET_MS));

      expect(woken.intents).toHaveLength(1);
      expect(woken.intents?.[0]).toMatchObject({
        messageKey: `autosave:dataset-1:${1_000 + DATASET_VERSION_QUIET_MS}`,
      });
      expect(woken.state).toEqual(DATASET_AUTOSAVE_INITIAL_STATE);
      expect(woken.nextWakeAt).toBeNull();
    });
  });

  describe("given three edits, each within the quiet period of the last", () => {
    /** @scenario "Edits inside the quiet period save one version" */
    it("saves once, after the last edit has been quiet for the whole period", () => {
      const half = DATASET_VERSION_QUIET_MS / 2;
      const first = edit(DATASET_AUTOSAVE_INITIAL_STATE, 0);
      const second = edit(first.state, half);
      const third = edit(second.state, 2 * half);

      const early = datasetAutosaveWake(third.state, context(first.nextWakeAt!));
      expect(early.intents ?? []).toEqual([]);
      expect(early.nextWakeAt).toBe(2 * half + DATASET_VERSION_QUIET_MS);

      const due = datasetAutosaveWake(early.state, context(early.nextWakeAt!));
      expect(due.intents).toHaveLength(1);
    });
  });

  describe("given nothing waits", () => {
    /** @scenario "Edits that go quiet save a version" */
    it("asks for nothing on a stray wake", () => {
      const woken = datasetAutosaveWake(DATASET_AUTOSAVE_INITIAL_STATE, context(5_000));

      expect(woken.intents ?? []).toEqual([]);
      expect(woken.nextWakeAt).toBeNull();
    });
  });
});

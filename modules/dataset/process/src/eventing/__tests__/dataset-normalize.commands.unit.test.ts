/**
 * A normalize states where its dataset came to rest, so the dataset's reads refresh (WEB-5150).
 * Spec: specs/datasets/bulk-dataset-upload.feature
 */
import {
  DATASET_NORMALIZATION_SETTLED_EVENT_TYPE,
  type DatasetNormalizePayload,
} from "@langwatch/dataset-contract";
import { type Command, createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import type { DatasetNormalizeOutcome } from "../../app/dataset.app.ts";
import { DatasetNormalizeCommandHandler } from "../dataset-normalize.commands.ts";

const payload: DatasetNormalizePayload = {
  id: "ds_1",
  tenantId: "project_1",
  projectId: "project_1",
  datasetId: "ds_1",
  filename: "rows.csv",
  sourceStoredObjectId: "so_1",
};

const command = {
  tenantId: createTenantId("project_1"),
  data: payload,
} as Command<DatasetNormalizePayload>;

const handlerSettling = (outcome: DatasetNormalizeOutcome) =>
  DatasetNormalizeCommandHandler.create({ normalize: { normalize: async () => outcome } });

describe("DatasetNormalizeCommandHandler", () => {
  /** @scenario "A file's row leaves Preparing when its dataset settles, without polling" */
  it.each(["ready", "failed"] as const)(
    "states the dataset settled as %s, in the project's tenant",
    async (status) => {
      const events = await handlerSettling(status).handle(command);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: DATASET_NORMALIZATION_SETTLED_EVENT_TYPE,
        aggregateType: "dataset",
        aggregateId: "ds_1",
        tenantId: "project_1",
        data: { projectId: "project_1", datasetId: "ds_1", status },
      });
    },
  );

  it("states nothing when the run was not the dataset's to settle", async () => {
    await expect(handlerSettling("skipped").handle(command)).resolves.toEqual([]);
  });
});

/**
 * @vitest-environment node
 * A copied dataset lists its entries where its source did.
 * @see modules/dataset/specs/dataset-service.feature
 */
import { describe, expect, it } from "vitest";

import { createDatasetTestApp } from "./dataset.fixture.ts";

const ROWS = 450;

describe("a copied dataset", () => {
  describe("given a source of several hundred entries written in one batch", () => {
    describe("when it is copied", () => {
      /** @scenario "A copied dataset lists its entries in the order of its source" */
      it("lists its entries in the order the source lists them", async () => {
        const app = createDatasetTestApp();
        const source = await app.upsertDataset({
          projectId: "project-1",
          name: "Ordered",
          columnTypes: [{ name: "text", type: "string" }],
        });
        await app.batchCreateRecords({
          projectId: "project-1",
          slugOrId: source.id,
          entries: Array.from({ length: ROWS }, (_, row) => ({ text: `row ${row}` })),
        });

        const copy = await app.copyDataset({
          sourceDatasetId: source.id,
          sourceProjectId: "project-1",
          targetProjectId: "project-2",
        });

        const read = (projectId: string, slugOrId: string) =>
          app
            .getDatasetPage({ projectId, slugOrId, page: 1, limit: ROWS })
            .then((page) => page.datasetRecords.map((record) => record.entry));
        const copied = await read("project-2", copy.id);

        expect(copied).toEqual(await read("project-1", source.id));
        expect(copied).toEqual(Array.from({ length: ROWS }, (_, row) => ({ text: `row ${row}` })));
      });
    });
  });
});

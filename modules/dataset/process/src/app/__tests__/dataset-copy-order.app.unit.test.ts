/**
 * A copy keeps the source's row order. Its rows share one `createdAt`, so reads order them by id,
 * and a collation sorts mixed-case base62 ids out of their minting order.
 * Spec: modules/dataset/specs/dataset-single-file.feature
 */
import type * as ksuidModule from "@langwatch/ksuid";
import { describe, expect, it, vi } from "vitest";

import { MemoryDatasetRepositories } from "../../repositories/memory/memory.dataset.repositories.ts";
import { createDatasetTestApp } from "./dataset.fixture.ts";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const { minted } = vi.hoisted(() => ({ minted: { count: 0 } }));

/** Ids that count up in base62, as KSUIDs minted in one second do: byte order is minting order. */
vi.mock("@langwatch/ksuid", async (importOriginal) => ({
  ...(await importOriginal<typeof ksuidModule>()),
  generate: (resource: string) => {
    let value = minted.count++;
    let encoded = "";
    for (let digit = 0; digit < 4; digit++) {
      encoded = BASE62[value % 62] + encoded;
      value = Math.floor(value / 62);
    }
    return { toString: () => `${resource}_${encoded}` };
  },
}));

const projectId = "project_copy_order";

describe("copying a single-file dataset", () => {
  describe("given more rows than base62 has digits, all written in one batch", () => {
    /** @scenario "A single-file dataset copies its records into the new dataset" */
    it("lists the copy in the source's order", async () => {
      const repositories = MemoryDatasetRepositories.create();
      const file = Array.from({ length: 62 }, (_, index) => ({
        id: `rec_${index}`,
        entry: { question: `Question ${index}` },
        datasetId: "",
        projectId,
      }));
      const dataset = await repositories.content.create({
        projectId,
        name: "Ordered Questions",
        slug: "ordered-questions",
        columnTypes: [{ name: "question", type: "string" }],
        useS3: true,
        s3RecordCount: file.length,
      });
      await repositories.singleFiles.putSingleFile({
        projectId,
        datasetId: dataset.id,
        text: JSON.stringify(file),
      });
      const app = createDatasetTestApp({ repositories });

      const copy = await app.copyDataset({
        sourceDatasetId: dataset.id,
        sourceProjectId: projectId,
        targetProjectId: projectId,
      });

      const page = await app.getDatasetPage({ slugOrId: copy.id, projectId, page: 1, limit: 100 });
      expect(page.datasetRecords.map((record) => record.entry)).toEqual(
        file.map((record) => record.entry),
      );
    });
  });
});

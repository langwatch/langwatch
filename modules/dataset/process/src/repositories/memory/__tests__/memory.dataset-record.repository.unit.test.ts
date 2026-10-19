import { describe, expect, it } from "vitest";

import { MemoryDatasetRecordRepository } from "../memory.dataset-record.repository.ts";
import { MemoryDatasetDatabase } from "../memory.dataset.database.ts";

const scope = { datasetId: "dataset_1", projectId: "project_1" };

// `Z` (0x5A) sorts before `a` (0x61) in code units, which is ksuid creation order.
// Locale collation puts `a` before `Z`, so only a code-unit comparison passes.
const earlier = "datasetrecord_00Z";
const later = "datasetrecord_00a";

async function seedLaterFirst() {
  const repository = MemoryDatasetRecordRepository.create({
    database: MemoryDatasetDatabase.create(),
  });

  await repository.createMany({
    ...scope,
    entries: [
      { id: later, entry: { n: "later" } },
      { id: earlier, entry: { n: "earlier" } },
    ],
  });

  return repository;
}

describe("MemoryDatasetRecordRepository", () => {
  describe("given two records created at the same instant whose ids differ only at Z versus a", () => {
    describe("when createMany returns them", () => {
      /** @scenario "Records created at the same instant read back in creation order" */
      it("orders them by code-unit id", async () => {
        const repository = MemoryDatasetRecordRepository.create({
          database: MemoryDatasetDatabase.create(),
        });

        const created = await repository.createMany({
          ...scope,
          entries: [
            { id: later, entry: {} },
            { id: earlier, entry: {} },
          ],
        });

        expect(created.map((record) => record.id)).toEqual([earlier, later]);
      });
    });

    describe("when findPage reads them", () => {
      /** @scenario "Records created at the same instant read back in creation order" */
      it("returns the Z id before the a id", async () => {
        const repository = await seedLaterFirst();

        const page = await repository.findPage({ ...scope, limit: 10 });

        expect(page.map((record) => record.id)).toEqual([earlier, later]);
      });
    });

    describe("when findPage continues after the Z id", () => {
      /** @scenario "Records created at the same instant read back in creation order" */
      it("returns the a id", async () => {
        const repository = await seedLaterFirst();

        const page = await repository.findPage({ ...scope, limit: 10, cursorId: earlier });

        expect(page.map((record) => record.id)).toEqual([later]);
      });
    });

    describe("when listAll reads them", () => {
      /** @scenario "Records created at the same instant read back in creation order" */
      it("returns the Z id before the a id", async () => {
        const repository = await seedLaterFirst();

        const { records } = await repository.listAll({ ...scope, page: 1, limit: 10 });

        expect(records.map((record) => record.id)).toEqual([earlier, later]);
      });
    });
  });
});

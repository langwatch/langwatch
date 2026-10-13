import { describe, expect, it } from "vitest";

import { MemoryDatasetDatabase } from "../memory.dataset.database.ts";
import { MemoryDatasetRepository } from "../memory.dataset.repository.ts";

describe("MemoryDatasetRepository", () => {
  describe("when two instances share one database", () => {
    it("hands out distinct ids", async () => {
      const database = MemoryDatasetDatabase.create();
      const input = { projectId: "project_1", name: "a", slug: "a", columnTypes: [] };

      const first = await MemoryDatasetRepository.create({ database }).create(input);
      const second = await MemoryDatasetRepository.create({ database }).create({
        ...input,
        name: "b",
        slug: "b",
      });

      expect(first.id).not.toBe(second.id);
    });
  });
});

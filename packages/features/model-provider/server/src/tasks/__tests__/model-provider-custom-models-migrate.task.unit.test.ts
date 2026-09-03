import { describe, expect, it, vi } from "vitest";
import { ModelProviderCustomModelsMigrateTask } from "../model-provider-custom-models-migrate.task";
import type { ModelProviderMigrationDatabase } from "../model-provider-migration.shared";

function emptyDatabase(): ModelProviderMigrationDatabase {
  return {
    project: { findMany: vi.fn(async () => []) },
    modelProvider: { findMany: vi.fn(async () => []), update: vi.fn(async () => undefined) },
  };
}

describe("ModelProviderCustomModelsMigrateTask", () => {
  describe("given a database with no projects", () => {
    /** @scenario "A task runs by name with its arguments" */
    it("is named model-provider-migrate-custom-models and runs to completion", async () => {
      const database = emptyDatabase();
      const task = ModelProviderCustomModelsMigrateTask.create({ database: () => database });
      expect(task.name).toBe("model-provider-migrate-custom-models");

      const controller = new AbortController();
      await task.run({ args: [], signal: controller.signal });

      expect(database.project.findMany).toHaveBeenCalledOnce();
    });
  });
});

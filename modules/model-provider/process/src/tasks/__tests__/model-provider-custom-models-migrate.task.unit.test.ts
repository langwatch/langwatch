import { describe, expect, it, vi } from "vitest";

import type { ModelProviderMigrationDatabase } from "../../rules/model-provider-migration.rules.ts";
import { ModelProviderCustomModelsMigrateTask } from "../model-provider-custom-models-migrate.task.ts";

function emptyDatabase() {
  return {
    findProjectScopedLegacyColumns: vi.fn(async () => []),
    updateLegacyColumns: vi.fn(async () => undefined),
  } satisfies ModelProviderMigrationDatabase;
}

describe("ModelProviderCustomModelsMigrateTask", () => {
  describe("given a database with no project-scoped providers", () => {
    /** @scenario "A task runs by name with its arguments" */
    it("is named model-provider-migrate-custom-models and runs to completion", async () => {
      const database = emptyDatabase();
      const task = ModelProviderCustomModelsMigrateTask.create({ database: () => database });
      expect(task.name).toBe("model-provider-migrate-custom-models");

      const controller = new AbortController();
      await task.run({ args: [], signal: controller.signal });

      expect(database.findProjectScopedLegacyColumns).toHaveBeenCalledOnce();
      expect(database.updateLegacyColumns).not.toHaveBeenCalled();
    });
  });
});

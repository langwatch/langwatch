import { describe, expect, it, vi } from "vitest";

import type { ModelProviderMigrationDatabase } from "../../rules/model-provider-migration.rules.ts";
import { ModelProviderCredentialsMigrateTask } from "../model-provider-credentials-migrate.task.ts";

function emptyDatabase() {
  return {
    findProjectScopedLegacyColumns: vi.fn(async () => []),
    updateLegacyColumns: vi.fn(async () => undefined),
  } satisfies ModelProviderMigrationDatabase;
}

describe("ModelProviderCredentialsMigrateTask", () => {
  describe("given a database with no project-scoped providers", () => {
    /** @scenario "The legacy credential and custom-model migrations read only provider rows" */
    it("is named model-provider-migrate-credentials and runs to completion", async () => {
      const database = emptyDatabase();
      const task = ModelProviderCredentialsMigrateTask.create({
        database: () => database,
      });
      expect(task.name).toBe("model-provider-migrate-credentials");

      const controller = new AbortController();
      await task.run({ args: [], signal: controller.signal });

      expect(database.findProjectScopedLegacyColumns).toHaveBeenCalledOnce();
      expect(database.updateLegacyColumns).not.toHaveBeenCalled();
    });
  });
});

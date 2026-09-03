import { describe, expect, it, vi } from "vitest";
import {
  ModelProviderCredentialsMigrateTask,
  modelProviderCredentialCipherFromEnv,
} from "../model-provider-credentials-migrate.task";
import type { ModelProviderMigrationDatabase } from "../model-provider-migration.shared";

function emptyDatabase(): ModelProviderMigrationDatabase {
  return {
    project: { findMany: vi.fn(async () => []) },
    modelProvider: { findMany: vi.fn(async () => []), update: vi.fn(async () => undefined) },
  };
}

describe("ModelProviderCredentialsMigrateTask", () => {
  describe("given a database with no projects and a configured key", () => {
    it("is named model-provider-migrate-credentials and runs to completion", async () => {
      const database = emptyDatabase();
      const cipher = modelProviderCredentialCipherFromEnv({ key: "aa".repeat(32) });
      const task = ModelProviderCredentialsMigrateTask.create({
        database: () => database,
        cipher: () => cipher,
      });
      expect(task.name).toBe("model-provider-migrate-credentials");

      const controller = new AbortController();
      await task.run({ args: [], signal: controller.signal });

      expect(database.project.findMany).toHaveBeenCalledOnce();
    });
  });

  describe("when no key is configured", () => {
    it("refuses to build a cipher", () => {
      expect(() => modelProviderCredentialCipherFromEnv({ key: undefined })).toThrow(
        /CREDENTIALS_SECRET/,
      );
    });
  });
});

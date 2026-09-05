import { describe, expect, it, vi } from "vitest";
import { ModelProviderCredentialCipherPort } from "../../ports/model-provider.port";
import { ModelProviderCredentialsMigrateTask } from "../model-provider-credentials-migrate.task";
import type { ModelProviderMigrationDatabase } from "../../rules/model-provider-migration.rules";

/** A cipher with the deployment's shape and none of its cryptography. */
class ReversingCipher extends ModelProviderCredentialCipherPort {
  encrypt(value: string): string {
    return `encrypted:${value}`;
  }

  decrypt(value: string): string {
    return value.replace(/^encrypted:/, "");
  }
}

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
      const cipher = new ReversingCipher();
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
});

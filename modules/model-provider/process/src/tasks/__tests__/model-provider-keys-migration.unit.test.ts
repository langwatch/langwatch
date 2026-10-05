import { describe, expect, it } from "vitest";

/**
 * @vitest-environment node
 * The one-off walk that encrypts model-provider keys still in the clear: it writes only rows
 * that need it, counts what it did, and never re-encrypts. The stand-in store seals through
 * the provider store's own credential codec.
 */
import type { ModelProviderCredentialCipher } from "../../repositories/model-provider.repository.ts";
import { PrismaModelProviderCredentialMapper } from "../../repositories/prisma/prisma.model-provider-credential.mapper.ts";
import type { ModelProviderMigrationDatabase } from "../../rules/model-provider-migration.rules.ts";
import { runModelProviderKeysMigration } from "../model-provider-credentials-migrate.task.ts";

/** A stand-in for AES-GCM with the same three-segment shape the column holds. */
function cipher(): ModelProviderCredentialCipher & { decrypted: string[] } {
  const decrypted: string[] = [];

  return {
    decrypted,
    encrypt(value: string): string {
      return `iv:${Buffer.from(value, "utf8").toString("hex")}:tag`;
    },
    decrypt(value: string): string {
      const payload = value.split(":")[1] ?? "";
      const plain = Buffer.from(payload, "hex").toString("utf8");
      decrypted.push(plain);
      return plain;
    },
  } as ModelProviderCredentialCipher & { decrypted: string[] };
}

function databaseOver(
  rows: { id: string; customKeys: unknown }[],
  secrets: ModelProviderCredentialCipher = cipher(),
) {
  const credentials = PrismaModelProviderCredentialMapper.create({ cipher: secrets });
  const writes: { id: string; customKeys: unknown }[] = [];
  const stored = rows.map((row) => ({ ...row }));

  const database: ModelProviderMigrationDatabase = {
    findProjectScopedLegacyColumns: async () =>
      stored.map((row) => ({
        ...row,
        provider: "openai",
        customModels: null,
        customEmbeddingsModels: null,
      })),
    updateLegacyColumns: async ({ id, customKeys }) => {
      const sealed = customKeys === undefined ? undefined : credentials.encode(customKeys);
      writes.push({ id, customKeys: sealed });
      const row = stored.find((candidate) => candidate.id === id);
      if (row) {
        row.customKeys = sealed;
      }
    },
  };

  return { database, writes, stored };
}

describe("runModelProviderKeysMigration()", () => {
  describe("given providers whose keys are still stored in the clear", () => {
    describe("when the migration runs", () => {
      /** @scenario "Migration encrypts existing plaintext keys" */
      it("encrypts every plaintext row and reports how many it updated", async () => {
        const secrets = cipher();
        const { database, writes, stored } = databaseOver(
          [
            { id: "mp_1", customKeys: { OPENAI_API_KEY: "sk-one" } },
            { id: "mp_2", customKeys: { ANTHROPIC_API_KEY: "sk-two" } },
          ],
          secrets,
        );

        const outcome = await runModelProviderKeysMigration({ database });

        expect(outcome).toEqual({ updated: 2, skipped: 0 });
        expect(writes).toHaveLength(2);
        for (const write of writes) {
          expect(typeof write.customKeys).toBe("string");
          expect((write.customKeys as string).split(":")).toHaveLength(3);
          expect(write.customKeys).not.toContain("sk-");
        }
        expect(JSON.parse(secrets.decrypt(stored[0]!.customKeys as string))).toEqual({
          OPENAI_API_KEY: "sk-one",
        });
      });

      /** @scenario "Migration encrypts existing plaintext keys" */
      it("leaves a row with no keys alone", async () => {
        const { database, writes } = databaseOver([{ id: "mp_1", customKeys: null }]);

        const outcome = await runModelProviderKeysMigration({ database });

        expect(outcome).toEqual({ updated: 0, skipped: 1 });
        expect(writes).toEqual([]);
      });
    });
  });

  describe("given providers whose keys are already encrypted", () => {
    describe("when the migration runs again", () => {
      /** @scenario "Migration is idempotent" */
      it("skips them, writes nothing, and leaves the rows decryptable", async () => {
        const secrets = cipher();
        const alreadyEncrypted = secrets.encrypt(JSON.stringify({ OPENAI_API_KEY: "sk-one" }));
        const { database, writes, stored } = databaseOver(
          [{ id: "mp_1", customKeys: alreadyEncrypted }],
          secrets,
        );

        const first = await runModelProviderKeysMigration({ database });
        const second = await runModelProviderKeysMigration({ database });

        expect(first).toEqual({ updated: 0, skipped: 1 });
        expect(second).toEqual({ updated: 0, skipped: 1 });
        expect(writes).toEqual([]);
        expect(JSON.parse(secrets.decrypt(stored[0]!.customKeys as string))).toEqual({
          OPENAI_API_KEY: "sk-one",
        });
      });

      /** @scenario "Migration is idempotent" */
      it("encrypts a plaintext row once, and no further on a second run", async () => {
        const { database, writes } = databaseOver([
          { id: "mp_1", customKeys: { OPENAI_API_KEY: "sk-one" } },
        ]);

        const first = await runModelProviderKeysMigration({ database });
        const second = await runModelProviderKeysMigration({ database });

        expect(first).toEqual({ updated: 1, skipped: 0 });
        expect(second).toEqual({ updated: 0, skipped: 1 });
        expect(writes).toHaveLength(1);
      });
    });
  });
});

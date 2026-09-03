/**
 * @vitest-environment node
 *
 * The one-off walk that encrypts model-provider keys already sitting in the
 * clear. The row conversion is the feature package's; what this suite drives is
 * the walk itself — that it writes only the rows that need it, counts what it
 * did, and can be run again without re-encrypting an encrypted row.
 */
import type { ModelProviderCredentialCipherPort } from "@langwatch/model-provider-server";
import { describe, expect, it } from "vitest";
import {
  type ModelProviderMigrationDatabase,
  runModelProviderKeysMigration,
} from "../model-provider-migrate.task";

/** A stand-in for AES-GCM with the same three-segment shape the column holds. */
function cipher(): ModelProviderCredentialCipherPort & { decrypted: string[] } {
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
  } as ModelProviderCredentialCipherPort & { decrypted: string[] };
}

function databaseOver(rows: Array<{ id: string; customKeys: unknown }>) {
  const writes: Array<{ id: string; customKeys: unknown }> = [];
  const stored = rows.map((row) => ({ ...row }));

  const database: ModelProviderMigrationDatabase = {
    project: {
      findMany: async () => [{ id: "project_1" }],
    },
    modelProvider: {
      findMany: async () => stored.map((row) => ({ ...row })),
      update: async ({ where, data }) => {
        writes.push({ id: where.id, customKeys: data.customKeys });
        const row = stored.find((candidate) => candidate.id === where.id);
        if (row) {
          row.customKeys = data.customKeys;
        }
        return undefined;
      },
    },
  };

  return { database, writes, stored };
}

describe("runModelProviderKeysMigration()", () => {
  describe("given providers whose keys are still stored in the clear", () => {
    describe("when the migration runs", () => {
      /** @scenario "Migration encrypts existing plaintext keys" */
      it("encrypts every plaintext row and reports how many it updated", async () => {
        const { database, writes, stored } = databaseOver([
          { id: "mp_1", customKeys: { OPENAI_API_KEY: "sk-one" } },
          { id: "mp_2", customKeys: { ANTHROPIC_API_KEY: "sk-two" } },
        ]);
        const secrets = cipher();

        const outcome = await runModelProviderKeysMigration({ database, cipher: secrets });

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

        const outcome = await runModelProviderKeysMigration({ database, cipher: cipher() });

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
        const { database, writes, stored } = databaseOver([
          { id: "mp_1", customKeys: alreadyEncrypted },
        ]);

        const first = await runModelProviderKeysMigration({ database, cipher: secrets });
        const second = await runModelProviderKeysMigration({ database, cipher: secrets });

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
        const secrets = cipher();

        const first = await runModelProviderKeysMigration({ database, cipher: secrets });
        const second = await runModelProviderKeysMigration({ database, cipher: secrets });

        expect(first).toEqual({ updated: 1, skipped: 0 });
        expect(second).toEqual({ updated: 0, skipped: 1 });
        expect(writes).toHaveLength(1);
      });
    });
  });
});

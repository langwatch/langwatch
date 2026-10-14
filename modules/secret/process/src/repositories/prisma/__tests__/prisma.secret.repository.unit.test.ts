/**
 * The project secret's Postgres row: the value rests sealed in `encryptedValue` and
 * reads back opened; a row the cipher refuses reads as unreadable, never as a value.
 * Spec: modules/secret/specs/secret.feature
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { ReversibleTestSecretEncryption } from "../../../app/__tests__/secret.fixture.ts";
import { PrismaSecretRepository } from "../prisma.secret.repository.ts";

const cipher = new ReversibleTestSecretEncryption();
const metadata = {
  id: "secret-1",
  projectId: "project-1",
  name: "LANGY_KEY",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  createdBy: { name: null },
  updatedBy: { name: null },
};

type Row = { name: string; encryptedValue: string };

function tableOf(rows: Row[]) {
  const database = prismaDouble({
    projectSecret: {
      findMany: () => Promise.resolve(rows),
      create: (args: { data: Row }) => {
        rows.push({ name: args.data.name, encryptedValue: args.data.encryptedValue });
        return Promise.resolve(metadata);
      },
    },
  });
  return PrismaSecretRepository.create({ prisma: database, cipher });
}

describe("PrismaSecretRepository", () => {
  describe("when a secret is stored", () => {
    /** @scenario "The feature that owns a reserved name stores its credential once" */
    it("keeps the value encrypted at rest and reads it back opened", async () => {
      const rows: Row[] = [];
      const repository = tableOf(rows);

      await repository.create({
        projectId: "project-1",
        name: "LANGY_KEY",
        value: "vk-first",
        actorId: "user-1",
      });

      expect(rows).toEqual([{ name: "LANGY_KEY", encryptedValue: cipher.encrypt("vk-first") }]);
      expect(rows[0]?.encryptedValue).not.toBe("vk-first");
      await expect(repository.findAllValues({ projectId: "project-1" })).resolves.toEqual([
        { name: "LANGY_KEY", readable: true, value: "vk-first" },
      ]);
    });
  });

  describe("when a stored value was sealed under another key", () => {
    it("reads that row as unreadable, naming why, and opens the rest", async () => {
      const refusing = {
        encrypt: (value: string) => cipher.encrypt(value),
        decrypt: (value: string) => {
          if (value === "corrupt") throw new Error("unable to authenticate data");
          return cipher.decrypt(value);
        },
      };
      const database = prismaDouble({
        projectSecret: {
          findMany: () =>
            Promise.resolve([
              { name: "OPENAI_API_KEY", encryptedValue: cipher.encrypt("openai") },
              { name: "BROKEN_KEY", encryptedValue: "corrupt" },
            ]),
        },
      });
      const repository = PrismaSecretRepository.create({ prisma: database, cipher: refusing });

      await expect(
        repository.findValuesByName({
          projectId: "project-1",
          names: ["OPENAI_API_KEY", "BROKEN_KEY"],
        }),
      ).resolves.toEqual([
        { name: "OPENAI_API_KEY", readable: true, value: "openai" },
        { name: "BROKEN_KEY", readable: false, reason: "unable to authenticate data" },
      ]);
    });
  });
});

/**
 * The trace export key's Postgres row: the token rests sealed in `encryptedToken`, the first
 * stored key wins, and both read back opened.
 * Spec: specs/ai-gateway/governance/vk-config-bundle.feature
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { PrismaGatewayTraceExportKeyRepository } from "../prisma.gateway-trace-export-key.repository.ts";

const cipher = {
  encrypt: (plaintext: string) => `sealed(${plaintext})`,
  decrypt: (ciphertext: string) => ciphertext.replace(/^sealed\((.*)\)$/, "$1"),
};

type Row = { projectId: string; apiKeyId: string; encryptedToken: string };

function keyTable() {
  const rows = new Map<string, Row>();
  const database = prismaDouble({
    gatewayTraceExportKey: {
      // One project per test, so a read answers every row.
      findMany: () => Promise.resolve([...rows.values()]),
      upsert: (args: { create: Row }) => {
        const kept = rows.get(args.create.projectId) ?? args.create;
        rows.set(kept.projectId, kept);
        return Promise.resolve(kept);
      },
    },
  });
  return {
    rows,
    repository: PrismaGatewayTraceExportKeyRepository.create({ prisma: database, cipher }),
  };
}

describe("PrismaGatewayTraceExportKeyRepository", () => {
  describe("when a project's first key is stored", () => {
    /** @scenario "The bundle exports spans with a trace-export key, never the project key" */
    it("rests the token encrypted and reads it back whole", async () => {
      const { rows, repository } = keyTable();

      const kept = await repository.saveFirst({
        projectId: "proj-1",
        apiKeyId: "key-1",
        token: "sk-lw-key-1",
      });

      expect(rows.get("proj-1")?.encryptedToken).toBe(cipher.encrypt("sk-lw-key-1"));
      expect(kept).toEqual({ projectId: "proj-1", apiKeyId: "key-1", token: "sk-lw-key-1" });
      expect(await repository.findForProject("proj-1")).toEqual([kept]);
    });
  });

  describe("when a second mint races the first", () => {
    it("answers the first stored key, opened", async () => {
      const { repository } = keyTable();
      await repository.saveFirst({ projectId: "proj-1", apiKeyId: "key-1", token: "sk-lw-first" });

      const kept = await repository.saveFirst({
        projectId: "proj-1",
        apiKeyId: "key-2",
        token: "sk-lw-second",
      });

      expect(kept).toEqual({ projectId: "proj-1", apiKeyId: "key-1", token: "sk-lw-first" });
    });
  });
});

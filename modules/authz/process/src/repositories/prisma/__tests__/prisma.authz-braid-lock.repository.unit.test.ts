/**
 * @vitest-environment node
 * @see modules/authz/specs/braids.feature
 * The reader lock as the statement it sends: Postgres takes it, so only its text, its key,
 * the transaction it runs in and that transaction's options can be stated without one.
 */
import { Prisma } from "@langwatch/prisma-client/generated";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaAuthzBraidLockRepository } from "../prisma.authz-braid-lock.repository.ts";

type RawQuery = TemplateStringsArray | Prisma.Sql;

/** A statement's text with each bound value as `?`. */
const textOf = (query?: RawQuery) =>
  (query instanceof Prisma.Sql ? query.strings : (query ?? [])).join("?").replace(/\s+/g, " ");

type TransactionOptions = { maxWait?: number; timeout?: number };

function harness() {
  const steps: string[] = [];
  const executeRaw = vi.fn(async (_query: RawQuery, ..._values: unknown[]) => {
    steps.push("lock");
    return 1;
  });
  const transactionClient = prismaDouble({ $executeRaw: executeRaw });
  const transaction = vi.fn(
    (run: (client: Prisma.TransactionClient) => Promise<unknown>, _options?: TransactionOptions) =>
      run(transactionClient),
  );
  const repository = PrismaAuthzBraidLockRepository.create({
    prisma: prismaDouble({ $transaction: transaction }),
  });
  const sql = (call = 0) => textOf(executeRaw.mock.calls[call]?.[0]);
  const values = (call = 0) => executeRaw.mock.calls[call]?.slice(1) ?? [];

  return { repository, executeRaw, transaction, steps, sql, values };
}

describe("PrismaAuthzBraidLockRepository", () => {
  describe("when a braid write into a reader runs", () => {
    it("takes a transaction-scoped advisory lock keyed by the reader before the write", async () => {
      const { repository, steps, sql, values } = harness();

      await repository.withReaderLock({
        readerProjectId: "project_orchestrator",
        write: async () => {
          steps.push("write");
        },
      });

      expect(sql()).toContain("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))");
      const [marker, key] = values();
      expect(marker instanceof Prisma.Sql && marker.sql).toContain("SKIP_TENANT_CHECK");
      expect(key).toBe("authz-braid-reader:project_orchestrator");
      expect(steps).toEqual(["lock", "write"]);
    });

    it("keys two readers apart and one reader the same each time", async () => {
      const { repository, values } = harness();
      const write = async () => undefined;

      await repository.withReaderLock({ readerProjectId: "project_a", write });
      await repository.withReaderLock({ readerProjectId: "project_b", write });
      await repository.withReaderLock({ readerProjectId: "project_a", write });

      expect(values(0)[1]).not.toBe(values(1)[1]);
      expect(values(2)[1]).toBe(values(0)[1]);
    });

    it("runs in one transaction held past Prisma's five-second default", async () => {
      const { repository, transaction } = harness();

      await repository.withReaderLock({ readerProjectId: "project_a", write: async () => 1 });

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(transaction.mock.calls[0]?.[1]).toEqual({ timeout: 60_000, maxWait: 10_000 });
    });

    it("answers what the write answered", async () => {
      const { repository } = harness();

      await expect(
        repository.withReaderLock({
          readerProjectId: "project_a",
          write: async () => ({ braidId: "braid_1" }),
        }),
      ).resolves.toEqual({ braidId: "braid_1" });
    });
  });

  describe("when the write fails", () => {
    it("rejects with the write's error, so the transaction rolls back", async () => {
      const { repository } = harness();
      const failure = new Error("a live braid is identical");

      await expect(
        repository.withReaderLock({
          readerProjectId: "project_a",
          write: async () => {
            throw failure;
          },
        }),
      ).rejects.toBe(failure);
    });
  });

  describe("when the lock cannot be taken", () => {
    it("rejects without running the write", async () => {
      const { repository, executeRaw, steps } = harness();
      executeRaw.mockRejectedValueOnce(new Error("lock timeout"));

      await expect(
        repository.withReaderLock({
          readerProjectId: "project_a",
          write: async () => {
            steps.push("write");
          },
        }),
      ).rejects.toThrow("lock timeout");
      expect(steps).toEqual([]);
    });
  });
});

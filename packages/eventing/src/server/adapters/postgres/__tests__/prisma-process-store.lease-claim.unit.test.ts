/** Spec: packages/eventing/specs/process-outbox-lease-hardening.feature */
import { describe, expect, it, vi } from "vitest";

import { PrismaProcessStore } from "../prisma-process-store";

/**
 * A stand-in that satisfies the store's structural client check and records
 * how the claim reaches Postgres.
 */
function fakePrismaClient() {
  const calls: string[] = [];
  const queryRaw = vi.fn(async () => {
    calls.push("$queryRaw");
    return [];
  });
  const transaction = vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
    calls.push("$transaction");
    return await run(client);
  });
  const client = {
    calls,
    $executeRaw: vi.fn(),
    $queryRaw: queryRaw,
    $transaction: transaction,
    processManagerInbox: {},
    processManagerInstance: {},
    processManagerOutbox: {},
    processManagerOutboxAttempt: {},
  };
  return client;
}

describe("given the process outbox is leased on a shared connection pool", () => {
  describe("when a worker claims its due messages", () => {
    /** @scenario "Claiming due messages does not hold an interactive transaction open" */
    it("claims them with one statement and never opens an interactive transaction", async () => {
      const client = fakePrismaClient();
      const store = PrismaProcessStore.create({ database: client as never });

      await store.leaseDueMessages({
        now: 1_700_000_000_000,
        limit: 10,
        leaseDurationMs: 30_000,
        processNames: ["triggerSettlement"],
      });

      expect(client.$transaction).not.toHaveBeenCalled();
      expect(client.$queryRaw).toHaveBeenCalledTimes(1);
      expect(client.calls).toEqual(["$queryRaw"]);
    });

    /** @scenario "Claiming due messages does not hold an interactive transaction open" */
    it("still claims atomically, locking its candidates and returning them in the same statement", async () => {
      const client = fakePrismaClient();
      const store = PrismaProcessStore.create({ database: client as never });

      await store.leaseDueMessages({
        now: 1_700_000_000_000,
        limit: 10,
        leaseDurationMs: 30_000,
      });

      const sql = client.$queryRaw.mock.calls[0]?.[0] as { strings?: string[] } | undefined;
      const text = (sql?.strings ?? []).join(" ");
      expect(text).toContain("FOR UPDATE SKIP LOCKED");
      expect(text).toContain("RETURNING");
    });
  });
});

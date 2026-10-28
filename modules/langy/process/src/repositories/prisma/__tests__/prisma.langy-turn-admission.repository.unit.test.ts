import { Prisma } from "@langwatch/prisma-client/generated";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaLangyTurnAdmissionRepository } from "../prisma.langy-turn-admission.repository.ts";

const CLAIM_INPUT = {
  projectId: "project-1",
  userId: "user-1",
  idempotencyKey: "key-1",
  conversationId: "conversation-1",
  turnId: "turn-1",
};

/** The driver adapter reports a lost serializable race without a Prisma `code`. */
function driverAdapterWriteConflict(): Error {
  const error = new Error("write conflict", {
    cause: { kind: "TransactionWriteConflict", originalCode: "40001" },
  });
  error.name = "DriverAdapterError";
  return error;
}

/** A transaction client for a fresh send: no receipt, no active turn; both rows are created. */
function emptyTransactionClient() {
  return prismaDouble({
    langyTurnRequest: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: "receipt-1",
        conversationId: CLAIM_INPUT.conversationId,
        turnId: CLAIM_INPUT.turnId,
      }),
    },
    langyActiveTurn: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
  });
}

/**
 * A fake database whose transactions fail with the given errors, then run the
 * admission body against an empty transaction client.
 */
function fakeDatabase(failures: unknown[]) {
  let calls = 0;
  const database = prismaDouble({
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      calls += 1;
      if (calls <= failures.length) throw failures[calls - 1];
      return callback(emptyTransactionClient());
    },
  });
  return { database, calls: () => calls };
}

const CLAIMED = {
  kind: "claimed",
  conversationId: CLAIM_INPUT.conversationId,
  turnId: CLAIM_INPUT.turnId,
};

/** A unique-key clash: two claims raced to create the same receipt row. */
function uniqueKeyClash(): Error {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

describe("PrismaLangyTurnAdmissionRepository.claim", () => {
  describe("given the first attempt hits a unique-key clash", () => {
    /** @scenario A racing send that created the receipt first does not fail my send */
    it("retries and returns the claim from the second attempt", async () => {
      const { database, calls } = fakeDatabase([uniqueKeyClash()]);
      const repository = PrismaLangyTurnAdmissionRepository.create(database);

      await expect(repository.claim(CLAIM_INPUT)).resolves.toMatchObject(CLAIMED);
      expect(calls()).toBe(2);
    });
  });

  describe("given the first serializable attempt loses a driver-adapter write conflict", () => {
    /** @scenario A send that races another send is still admitted */
    it("retries and returns the claim from the second attempt", async () => {
      const { database, calls } = fakeDatabase([driverAdapterWriteConflict()]);
      const repository = PrismaLangyTurnAdmissionRepository.create(database);

      await expect(repository.claim(CLAIM_INPUT)).resolves.toMatchObject(CLAIMED);
      expect(calls()).toBe(2);
    });
  });

  describe("given every attempt loses a write conflict", () => {
    /** @scenario A send that cannot get through a burst of sends is told Langy is unavailable */
    it("fails with LangyAgentUnavailableError after four attempts", async () => {
      const { database, calls } = fakeDatabase(
        Array.from({ length: 4 }, driverAdapterWriteConflict),
      );
      const repository = PrismaLangyTurnAdmissionRepository.create(database);

      await expect(repository.claim(CLAIM_INPUT)).rejects.toMatchObject({
        code: "langy_agent_unavailable",
      });
      expect(calls()).toBe(4);
    });
  });

  describe("given a non-conflict error", () => {
    /** @scenario A turn send that fails for another reason is surfaced without retry */
    it("does not retry and rethrows the error", async () => {
      const boom = new Error("connection refused");
      const { database, calls } = fakeDatabase([boom]);
      const repository = PrismaLangyTurnAdmissionRepository.create(database);

      await expect(repository.claim(CLAIM_INPUT)).rejects.toBe(boom);
      expect(calls()).toBe(1);
    });
  });
});

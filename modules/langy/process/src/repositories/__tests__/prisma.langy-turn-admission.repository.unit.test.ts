import { describe, expect, it } from "vitest";

import type { LangyDatabase } from "../prisma/langy-database.mapper.ts";
import { PrismaLangyTurnAdmissionRepository } from "../prisma/prisma.langy-turn-admission.repository.ts";

const CLAIM = { outcome: "claimed" } as never;
const CLAIM_INPUT = {
  projectId: "project-1",
  userId: "user-1",
  idempotencyKey: "key-1",
  conversationId: "conversation-1",
  turnId: "turn-1",
};

/** The driver adapter reports a lost serializable race without a Prisma `code`. */
function driverAdapterWriteConflict(): Error {
  const error = new Error("write conflict") as Error & { cause: unknown };
  error.name = "DriverAdapterError";
  error.cause = { kind: "TransactionWriteConflict", originalCode: "40001" };
  return error;
}

/** A fake database whose transactions fail with the given errors, then resolve. */
function fakeDatabase(failures: unknown[]): { database: LangyDatabase; calls: () => number } {
  let calls = 0;
  const database = {
    $transaction: async () => {
      calls += 1;
      if (calls <= failures.length) throw failures[calls - 1];
      return CLAIM;
    },
  } as unknown as LangyDatabase;
  return { database, calls: () => calls };
}

describe("PrismaLangyTurnAdmissionRepository.claim", () => {
  describe("given the first serializable attempt loses a driver-adapter write conflict", () => {
    it("retries and returns the claim from the second attempt", async () => {
      const { database, calls } = fakeDatabase([driverAdapterWriteConflict()]);
      const repository = PrismaLangyTurnAdmissionRepository.create(database);

      await expect(repository.claim(CLAIM_INPUT)).resolves.toBe(CLAIM);
      expect(calls()).toBe(2);
    });
  });

  describe("given a non-conflict error", () => {
    it("does not retry and rethrows the error", async () => {
      const boom = new Error("connection refused");
      const { database, calls } = fakeDatabase([boom]);
      const repository = PrismaLangyTurnAdmissionRepository.create(database);

      await expect(repository.claim(CLAIM_INPUT)).rejects.toBe(boom);
      expect(calls()).toBe(1);
    });
  });
});

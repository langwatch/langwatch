import { LangyAgentUnavailableError } from "@langwatch/langy-contract";
import type { SerializationRetryDeps } from "@langwatch/prisma-client";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { PrismaLangyTurnAdmissionRepository } from "../prisma/prisma.langy-turn-admission.repository.ts";

const CLAIM = {
  kind: "claimed",
  claimToken: "token-1",
  conversationId: "conversation-1",
  turnId: "turn-1",
};
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

/** Records each backoff instead of sleeping; a fixed draw of 0.5 keeps the waits exact. */
function fakeRetry(): { retry: SerializationRetryDeps; waits: number[] } {
  const waits: number[] = [];
  const retry = { wait: async (ms: number) => void waits.push(ms), random: () => 0.5 };
  return { retry, waits };
}

/** A fake database whose transactions fail with the given errors, then resolve. */
function fakeDatabase(failures: unknown[]) {
  let calls = 0;
  const database = prismaDouble({
    $transaction: async () => {
      calls += 1;
      if (calls <= failures.length) throw failures[calls - 1];
      return CLAIM;
    },
  });
  return { database, calls: () => calls };
}

describe("PrismaLangyTurnAdmissionRepository.claim", () => {
  describe("given the first serializable attempt loses a driver-adapter write conflict", () => {
    it("retries and returns the claim from the second attempt", async () => {
      const { database, calls } = fakeDatabase([driverAdapterWriteConflict()]);
      const { retry, waits } = fakeRetry();
      const repository = PrismaLangyTurnAdmissionRepository.create(database, retry);

      await expect(repository.claim(CLAIM_INPUT)).resolves.toBe(CLAIM);
      expect(calls()).toBe(2);
      expect(waits).toEqual([5]);
    });
  });

  describe("given every attempt loses a write conflict", () => {
    it("backs off between attempts and fails with LangyAgentUnavailableError", async () => {
      const { database, calls } = fakeDatabase(
        Array.from({ length: 4 }, driverAdapterWriteConflict),
      );
      const { retry, waits } = fakeRetry();
      const repository = PrismaLangyTurnAdmissionRepository.create(database, retry);

      await expect(repository.claim(CLAIM_INPUT)).rejects.toBeInstanceOf(
        LangyAgentUnavailableError,
      );
      expect(calls()).toBe(4);
      expect(waits).toEqual([5, 10, 20]);
    });
  });

  describe("given a non-conflict error", () => {
    it("does not retry and rethrows the error", async () => {
      const boom = new Error("connection refused");
      const { database, calls } = fakeDatabase([boom]);
      const { retry, waits } = fakeRetry();
      const repository = PrismaLangyTurnAdmissionRepository.create(database, retry);

      await expect(repository.claim(CLAIM_INPUT)).rejects.toBe(boom);
      expect(waits).toEqual([]);
      expect(calls()).toBe(1);
    });
  });
});

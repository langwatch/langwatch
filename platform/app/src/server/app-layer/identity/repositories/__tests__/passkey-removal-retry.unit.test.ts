import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "~/generated/prisma/client";
import { PrismaPasskeyRemovalRepository } from "../passkey-removal.prisma.repository";
import { serializationRetryDelayMs } from "../serializable-retry";

function driverConflict() {
  return Object.assign(new Error("TransactionWriteConflict"), {
    name: "DriverAdapterError",
    cause: { kind: "TransactionWriteConflict" },
  });
}

function repository() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: "postgresql://test:test@127.0.0.1:1/test",
    }),
  });
  const transaction = vi.spyOn(prisma, "$transaction");
  const removal = PrismaPasskeyRemovalRepository.create({
    prisma,
    routesToIdentity: async () => false,
  });
  return { removal, transaction };
}

describe("passkey removal serialization retries", () => {
  it.each([
    driverConflict(),
    new Prisma.PrismaClientKnownRequestError("serialization conflict", {
      code: "P2034",
      clientVersion: "7.9.1",
    }),
  ])("re-evaluates the full transaction after %s", async (conflict) => {
    const { removal, transaction } = repository();
    transaction.mockRejectedValueOnce(conflict);
    transaction.mockResolvedValueOnce("would_strand_user");

    await expect(
      removal.deleteIfAnotherWayInRemains({ passkeyId: "passkey_1" }),
    ).resolves.toBe("would_strand_user");
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it("propagates an exhausted conflict after five attempts", async () => {
    const { removal, transaction } = repository();
    const conflict = driverConflict();
    transaction.mockRejectedValue(conflict);

    await expect(
      removal.deleteIfAnotherWayInRemains({ passkeyId: "passkey_1" }),
    ).rejects.toBe(conflict);
    expect(transaction).toHaveBeenCalledTimes(5);
  });

  it("waits a random slice of a growing window between attempts", () => {
    // The loser is told before the winner commits, so the window has to be
    // long enough for that transaction to finish and random enough that two
    // requests told at the same moment do not come back together.
    for (const attempt of [0, 1, 2, 3]) {
      const ceiling = 50 * 2 ** attempt;
      const draws = Array.from({ length: 50 }, () =>
        serializationRetryDelayMs(attempt),
      );
      for (const delay of draws) {
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThan(ceiling);
      }
      expect(new Set(draws).size).toBeGreaterThan(1);
    }
  });

  it("does not retry unrelated driver failures", async () => {
    const { removal, transaction } = repository();
    const failure = Object.assign(new Error("ConnectionClosed"), {
      name: "DriverAdapterError",
      cause: { kind: "ConnectionClosed" },
    });
    transaction.mockRejectedValue(failure);

    await expect(
      removal.deleteIfAnotherWayInRemains({ passkeyId: "passkey_1" }),
    ).rejects.toBe(failure);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "~/generated/prisma/client";
import { PrismaPasskeyRemovalRepository } from "../passkey-removal.prisma.repository";

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

  it("propagates an exhausted conflict after four attempts", async () => {
    const { removal, transaction } = repository();
    const conflict = driverConflict();
    transaction.mockRejectedValue(conflict);

    await expect(
      removal.deleteIfAnotherWayInRemains({ passkeyId: "passkey_1" }),
    ).rejects.toBe(conflict);
    expect(transaction).toHaveBeenCalledTimes(4);
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

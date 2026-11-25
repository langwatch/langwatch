import { Prisma } from "@langwatch/prisma-client/generated";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaSeatRequestRepository } from "../prisma.seat-request.repository.ts";

function writeConflictError() {
  return new Prisma.PrismaClientKnownRequestError(
    "Transaction failed due to a write conflict or a deadlock. Please retry your transaction",
    { code: "P2034", clientVersion: "7.9.1" },
  );
}

describe("PrismaSeatRequestRepository.resolve", () => {
  it("claims an open request atomically with updateMany instead of a SERIALIZABLE transaction", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = vi.fn().mockRejectedValue(writeConflictError());
    const repository = PrismaSeatRequestRepository.create(
      prismaDouble({
        seatRequest: { updateMany },
        $transaction: transaction,
      }),
    );

    const resolved = await repository.resolve({
      organizationId: "org-1",
      id: "req-1",
      status: "APPROVED",
      resolvedByUserId: "admin-1",
      at: 10_000,
    });

    expect(resolved).toBe(true);
    expect(transaction).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "req-1", organizationId: "org-1", status: "OPEN" },
      data: {
        status: "APPROVED",
        resolvedAt: new Date(10_000),
        resolvedByUserId: "admin-1",
        seatPendingSince: new Date(10_000),
      },
    });
  });

  it("clears seatPendingSince when declining an open request", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = PrismaSeatRequestRepository.create(
      prismaDouble({
        seatRequest: { updateMany },
        $transaction: vi.fn(),
      }),
    );

    const resolved = await repository.resolve({
      organizationId: "org-1",
      id: "req-2",
      status: "DECLINED",
      resolvedByUserId: "admin-1",
      at: 20_000,
    });

    expect(resolved).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "req-2", organizationId: "org-1", status: "OPEN" },
      data: {
        status: "DECLINED",
        resolvedAt: new Date(20_000),
        resolvedByUserId: "admin-1",
        seatPendingSince: null,
      },
    });
  });

  it("returns false when no open request matches", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repository = PrismaSeatRequestRepository.create(
      prismaDouble({
        seatRequest: { updateMany },
        $transaction: vi.fn(),
      }),
    );

    const resolved = await repository.resolve({
      organizationId: "org-1",
      id: "req-3",
      status: "APPROVED",
      resolvedByUserId: "admin-1",
      at: 30_000,
    });

    expect(resolved).toBe(false);
  });
});

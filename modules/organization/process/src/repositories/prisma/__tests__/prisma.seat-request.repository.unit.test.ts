/**
 * Reopening a seat request reads then writes in a SERIALIZABLE transaction, so one that lost
 * a race runs again; resolving is one conditional write: a second answer matches nothing.
 * @see modules/organization/specs/seat-requests.feature
 */
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaSeatRequestRepository } from "../prisma.seat-request.repository.ts";

const OPENED_AT = new Date("2026-11-01T10:00:00Z");
const DECLINED_AT = new Date("2026-11-02T10:00:00Z");

function declinedRow() {
  return {
    id: "request-1",
    organizationId: "organization-1",
    email: "lite@acme.example",
    userId: "user-1",
    name: "Lite",
    status: "DECLINED",
    source: "lite",
    reason: null,
    idpRefused: false,
    idpKind: null,
    salesNotifiedAt: null,
    openedAt: OPENED_AT,
    resolvedAt: DECLINED_AT,
    resolvedByUserId: "admin-1",
    seatPendingSince: null,
  };
}

function writeConflict() {
  return new Prisma.PrismaClientKnownRequestError(
    "Transaction failed due to a write conflict or a deadlock. Please retry your transaction",
    { code: "P2034", clientVersion: "7.10.0" },
  );
}

function notFound() {
  return new Prisma.PrismaClientKnownRequestError("No record was found for an update.", {
    code: "P2025",
    clientVersion: "7.10.0",
  });
}

function database({ conflicts, missing = false }: { conflicts: number; missing?: boolean }) {
  let lost = 0;
  const seatRequest = {
    findUnique: vi.fn(async () => declinedRow()),
    findUniqueOrThrow: vi.fn(async () => declinedRow()),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (missing) throw notFound();
      if (lost < conflicts) {
        lost += 1;
        throw writeConflict();
      }
      return { ...declinedRow(), ...data };
    }),
  };
  const transactionClient = prismaDouble({ seatRequest });
  const $transaction = vi.fn(
    async (run: (transaction: PrismaClient) => Promise<unknown>, _options?: unknown) =>
      run(transactionClient),
  );
  const prisma = prismaDouble({ seatRequest, $transaction });
  return { prisma, seatRequest, $transaction };
}

describe("PrismaSeatRequestRepository", () => {
  describe("when reopening a declined request loses one write race", () => {
    it("runs the transaction again and reopens the request", async () => {
      const { prisma, $transaction } = database({ conflicts: 1 });
      const requests = PrismaSeatRequestRepository.create(prisma);

      const opened = await requests.open({
        id: "request-2",
        organizationId: "organization-1",
        email: "lite@acme.example",
        userId: "user-1",
        name: "Lite",
        source: "requested",
        idpRefused: false,
        idpKind: null,
        at: Date.parse("2026-11-03T10:00:00Z"),
      });

      expect(opened.outcome).toBe("reopened");
      expect(opened.request.status).toBe("OPEN");
      expect($transaction).toHaveBeenCalledTimes(2);
      expect($transaction.mock.calls.map(([, options]) => options)).toEqual([
        { isolationLevel: "Serializable" },
        { isolationLevel: "Serializable" },
      ]);
    });
  });

  describe("when an answer finds the request no longer open", () => {
    it("writes only where the request is still open and reports that nothing was resolved", async () => {
      const { prisma, seatRequest, $transaction } = database({ conflicts: 0, missing: true });
      const requests = PrismaSeatRequestRepository.create(prisma);

      const resolved = await requests.resolve({
        organizationId: "organization-1",
        id: "request-1",
        status: "APPROVED",
        resolvedByUserId: "admin-2",
        at: Date.parse("2026-11-03T10:00:00Z"),
        openedAt: OPENED_AT.getTime(),
      });

      expect(resolved).toBe(false);
      expect(seatRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "request-1",
            organizationId: "organization-1",
            status: "OPEN",
            openedAt: OPENED_AT,
          },
        }),
      );
      expect($transaction).not.toHaveBeenCalled();
    });
  });
});

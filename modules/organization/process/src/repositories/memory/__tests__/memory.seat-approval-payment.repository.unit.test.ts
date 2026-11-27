/**
 * The in-process twin of the seat approval payments keeps a payment for the same week as Redis.
 * @vitest-environment node
 * @see modules/organization/specs/seat-requests.feature
 */
import { describe, expect, it } from "vitest";

import { MemorySeatApprovalPaymentRepository } from "../memory.seat-approval-payment.repository.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const opening = { organizationId: "org_acme", seatRequestId: "seat-request-1", openedAt: 1_000 };
const payment = { kind: "invoice" as const, invoiceId: "in_seat", seats: 3 };

describe("MemorySeatApprovalPaymentRepository", () => {
  describe("when a saved payment is read back", () => {
    it("returns it within the week and nothing after it", async () => {
      let now = 0;
      const payments = MemorySeatApprovalPaymentRepository.create({ now: () => now });
      await payments.save({ ...opening, payment });

      now = 6 * DAY_MS;
      await expect(payments.find(opening)).resolves.toEqual([payment]);

      now = 7 * DAY_MS + 1;
      await expect(payments.find(opening)).resolves.toEqual([]);
    });

    it("keeps another opening of the same request apart", async () => {
      const payments = MemorySeatApprovalPaymentRepository.create();
      await payments.save({ ...opening, payment });

      await expect(payments.find({ ...opening, openedAt: 2_000 })).resolves.toEqual([]);
    });
  });
});

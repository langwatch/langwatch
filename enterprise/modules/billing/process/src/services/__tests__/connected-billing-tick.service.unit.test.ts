import { Temporal } from "@langwatch/time";
/** @see specs/self-hosting/connected-services/connected-billing.feature */
import { describe, expect, it } from "vitest";

import type {
  ConnectedBillingAccountRecord,
  PendingRenewal,
} from "../../repositories/connected-billing.repository.ts";
import { ConnectedBillingTickService } from "../connected-billing-tick.service.ts";

const pending: PendingRenewal = {
  commitUsdCents: 100_00,
  termStartsAt: "2027-10-01T00:00:00Z",
  termEndsAt: "2028-10-01T00:00:00Z",
  awaitingInvoicePeriodEnd: "2027-10-01T00:00:00Z",
};

function account(
  organizationId: string,
  pendingRenewal: PendingRenewal | null,
): ConnectedBillingAccountRecord {
  return {
    id: `account-${organizationId}`,
    organizationId,
    stripeCustomerId: `cus-${organizationId}`,
    usageSubscriptionId: null,
    usageSubscriptionItemId: null,
    termStartsAt: Temporal.Instant.from("2026-10-01T00:00:00Z"),
    termEndsAt: Temporal.Instant.from("2027-10-01T00:00:00Z"),
    commitUsdCents: 100_00,
    seatCurrency: "USD",
    seatRateCents: 50_00,
    seats: 10,
    bankTransferType: null,
    bankTransferCountry: null,
    billingEmail: "finance@acme.example",
    pendingRenewal,
  };
}

function tick({
  failSeats = false,
  withStatements = true,
}: { failSeats?: boolean; withStatements?: boolean } = {}) {
  const ran: string[] = [];
  const accounts = [account("org-renewing", pending), account("org-settled", null)];
  const service = ConnectedBillingTickService.create({
    seats: {
      completePendingSeatChanges: async () => {
        ran.push("seats");
        if (failSeats) throw new Error("payment provider unreachable");
        return { invoiced: 0, failed: 0 };
      },
    },
    statements: withStatements
      ? {
          run: async () => {
            ran.push("statements");
            return { sent: 0, alreadySent: 0, noUsage: 0, failed: 0 };
          },
        }
      : undefined,
    renewals: {
      completeRenewalIfDue: async ({ organizationId }) => {
        ran.push(`renewal:${organizationId}`);
        return "waiting";
      },
    },
    repository: {
      findAccountsForOrganizations: async (ids) =>
        accounts.filter((row) => ids.includes(row.organizationId)),
    },
    customers: {
      findConnectedCustomers: async () => [
        { organizationId: "org-renewing", organizationName: "Renewing" },
        { organizationId: "org-settled", organizationName: "Settled" },
      ],
    },
  });
  return { service, ran };
}

describe("ConnectedBillingTickService", () => {
  describe("given every job succeeds", () => {
    it("retries the seat invoices, runs the statements and each pending renewal", async () => {
      const { service, ran } = tick();

      await service.run();

      expect(ran).toEqual(["seats", "statements", "renewal:org-renewing"]);
    });
  });

  describe("given one job throws", () => {
    it("still runs the ones after it", async () => {
      const { service, ran } = tick({ failSeats: true });

      await expect(service.run()).resolves.toBeUndefined();
      expect(ran).toEqual(["seats", "statements", "renewal:org-renewing"]);
    });
  });

  describe("given no statement mail is composed", () => {
    it("sends no statement and records none, and still completes the renewals", async () => {
      const { service, ran } = tick({ withStatements: false });

      await service.run();

      expect(ran).toEqual(["seats", "renewal:org-renewing"]);
    });
  });
});

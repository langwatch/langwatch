import { describe, expect, it } from "vitest";
import {
  DuplicateSubscriptionsReportRepository,
  type SubscriptionReportRow,
} from "../../repositories/duplicate-subscriptions-report.repository";
import { reportDuplicateSubscriptions } from "../duplicate-subscriptions-report.task";

function row(overrides: Partial<SubscriptionReportRow>): SubscriptionReportRow {
  return {
    id: "sub-1",
    organizationId: "org-1",
    plan: "PRO",
    status: "ACTIVE",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    stripeSubscriptionId: null,
    ...overrides,
  };
}

function fakeRepository({
  active,
  pending,
}: {
  active: SubscriptionReportRow[];
  pending: SubscriptionReportRow[];
}): DuplicateSubscriptionsReportRepository {
  return new (class extends DuplicateSubscriptionsReportRepository {
    async findByStatus(status: string): Promise<SubscriptionReportRow[]> {
      return status === "ACTIVE" ? active : pending;
    }
  })();
}

describe("reportDuplicateSubscriptions", () => {
  describe("given an organization holding two active subscriptions", () => {
    /** @scenario "The duplicate-subscription report names the row plan resolution picks" */
    it("reports the duplicate and names the winner by the product's own ordering", async () => {
      const older = row({ id: "sub-old", createdAt: new Date("2026-01-01T00:00:00Z") });
      const newer = row({
        id: "sub-new",
        plan: "ENTERPRISE",
        createdAt: new Date("2026-06-01T00:00:00Z"),
      });
      const repository = fakeRepository({ active: [older, newer], pending: [] });

      const report = await reportDuplicateSubscriptions({ repository });

      expect(report.activeSubscriptions).toBe(2);
      expect(report.organizationsHoldingOne).toBe(1);
      expect(report.duplicates).toHaveLength(1);
      expect(report.duplicates[0]?.winnerId).toBe("sub-new");
      expect(report.duplicates[0]?.plans).toEqual(["PRO", "ENTERPRISE"]);
    });
  });

  describe("when abandoned checkouts have accumulated", () => {
    /** @scenario "The duplicate-subscription report censuses the pending backlog" */
    it("counts them by plan and names the oldest", async () => {
      const repository = fakeRepository({
        active: [],
        pending: [
          row({ id: "p1", plan: "PRO", createdAt: new Date("2025-02-01T00:00:00Z") }),
          row({ id: "p2", plan: "PRO", organizationId: "org-2" }),
          row({ id: "p3", plan: "LAUNCH", organizationId: "org-3" }),
        ],
      });

      const report = await reportDuplicateSubscriptions({ repository });

      expect(report.pendingSubscriptions).toBe(3);
      expect(report.organizationsWithPending).toBe(3);
      expect(report.pendingByPlan).toEqual([
        { plan: "PRO", count: 2 },
        { plan: "LAUNCH", count: 1 },
      ]);
      expect(report.oldestPending?.toISOString()).toBe("2025-02-01T00:00:00.000Z");
    });
  });
});

/**
 * The candidate query behind the scheduled billing meter sweep.
 *
 * An organization missing from this set is one the safety net cannot rescue,
 * so what is asserted here is the shape of the predicate, not just the plumbing.
 *
 * @see specs/licensing/billing-meter-dispatch.feature
 */

import { PricingModel } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { GROWTH_SEAT_PLAN_TYPES } from "../../../../../ee/billing/utils/growthSeatEvent";
import { PrismaBillingReportingCandidatesService } from "../billingReportingCandidates.service";

function makeService({
  organizations = [] as Array<{ id: string }>,
  checkpoints = [] as Array<{ organizationId: string }>,
} = {}) {
  const findManyOrganizations = vi.fn().mockResolvedValue(organizations);
  const findManyCheckpoints = vi.fn().mockResolvedValue(checkpoints);

  const service = new PrismaBillingReportingCandidatesService({
    organization: { findMany: findManyOrganizations },
    billingMeterCheckpoint: { findMany: findManyCheckpoints },
  } as never);

  return { service, findManyOrganizations, findManyCheckpoints };
}

describe("PrismaBillingReportingCandidatesService", () => {
  describe("given a month to sweep", () => {
    /** @scenario "The organizations to report are every one that could owe usage" */
    it("asks for exactly the organizations the usage report would act on", async () => {
      const { service, findManyOrganizations } = makeService();

      await service.listOrganizationsToReport({ billingMonth: "2026-02" });

      // Same predicate as `getOrganizationForBilling`, which is the gate the
      // report itself applies. Naming anyone else mints dispatches that can
      // only be skipped; naming fewer leaves usage unreported.
      expect(findManyOrganizations).toHaveBeenCalledWith({
        where: {
          pricingModel: PricingModel.SEAT_EVENT,
          stripeCustomerId: { not: null },
          subscriptions: {
            some: {
              status: "ACTIVE",
              plan: { in: [...GROWTH_SEAT_PLAN_TYPES] },
            },
          },
        },
        select: { id: true },
      });
    });

    /** @scenario "The organizations to report are every one that could owe usage" */
    it("also names the organizations already checkpointed for that month", async () => {
      const { service, findManyCheckpoints } = makeService({
        organizations: [{ id: "org-live" }],
        checkpoints: [{ organizationId: "org-already-reported" }],
      });

      const candidates = await service.listOrganizationsToReport({
        billingMonth: "2026-02",
      });

      expect(findManyCheckpoints).toHaveBeenCalledWith({
        where: { billingMonth: "2026-02" },
        select: { organizationId: true },
      });
      expect(candidates.sort()).toEqual(["org-already-reported", "org-live"]);
    });

    it("names an organization in both sources exactly once", async () => {
      const { service } = makeService({
        organizations: [{ id: "org-1" }, { id: "org-2" }],
        checkpoints: [{ organizationId: "org-1" }],
      });

      const candidates = await service.listOrganizationsToReport({
        billingMonth: "2026-02",
      });

      expect(candidates.sort()).toEqual(["org-1", "org-2"]);
    });

    it("reads the checkpoints of the month it was asked about", async () => {
      const { service, findManyCheckpoints } = makeService();

      await service.listOrganizationsToReport({ billingMonth: "2026-01" });

      expect(findManyCheckpoints).toHaveBeenCalledWith(
        expect.objectContaining({ where: { billingMonth: "2026-01" } }),
      );
    });
  });

  describe("given a build with no billable organizations at all", () => {
    it("names nobody rather than failing the sweep", async () => {
      const { service } = makeService();

      await expect(
        service.listOrganizationsToReport({ billingMonth: "2026-02" }),
      ).resolves.toEqual([]);
    });
  });

  describe("given the candidate store is unavailable", () => {
    it("propagates so the sweep tick is retried", async () => {
      const service = new PrismaBillingReportingCandidatesService({
        organization: {
          findMany: vi
            .fn()
            .mockRejectedValue(new Error("database unavailable")),
        },
        billingMeterCheckpoint: { findMany: vi.fn().mockResolvedValue([]) },
      } as never);

      await expect(
        service.listOrganizationsToReport({ billingMonth: "2026-02" }),
      ).rejects.toThrow("database unavailable");
    });
  });
});

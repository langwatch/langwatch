// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it, vi } from "vitest";
import {
  type BillingReportingDatabase,
  PostgresBillingReportingAdapter,
} from "../postgres.billing-reporting.adapter";

const ORGANIZATION = "organization_acme";

function recordingDatabase(organization: unknown = null) {
  const organizationFindFirst = vi.fn(async () => organization);
  const checkpointFindUnique = vi.fn(async () => null);
  const database = {
    organization: { findFirst: organizationFindFirst },
    billingMeterCheckpoint: {
      findUnique: checkpointFindUnique,
      upsert: vi.fn(async () => undefined),
    },
  } as unknown as BillingReportingDatabase;
  return { database, organizationFindFirst, checkpointFindUnique };
}

describe("PostgresBillingReportingAdapter", () => {
  describe("given a process holding one typed Prisma client", () => {
    /**
     * Frozen twin: the App answers the same question through
     * `PrismaOrganizationRepository.getOrganizationForBilling`, and both graphs
     * report into ONE Stripe meter. Every predicate is LITERAL here because
     * each one is part of the answer: a widened subscription filter reports an
     * organization whose subscription has ended, which is a Stripe invoice
     * nobody agreed to. `pricingModel` is SELECTED rather than filtered on, so
     * one query still tells an absent organization apart from one that simply
     * does not buy usage — the difference between a warning and a routine skip.
     */
    /** @scenario "The worker reads a billable organization the way the App reads it" */
    it("asks for exactly the billable organization the App asks for", async () => {
      const recording = recordingDatabase();

      await PostgresBillingReportingAdapter.create({ database: recording.database })
        .build()
        .organizations.getOrganizationForBilling(ORGANIZATION);

      expect(recording.organizationFindFirst).toHaveBeenCalledWith({
        where: { id: ORGANIZATION },
        select: {
          id: true,
          pricingModel: true,
          stripeCustomerId: true,
          subscriptions: {
            where: {
              status: "ACTIVE",
              plan: {
                in: [
                  "GROWTH_SEAT_EUR_MONTHLY",
                  "GROWTH_SEAT_EUR_ANNUAL",
                  "GROWTH_SEAT_USD_MONTHLY",
                  "GROWTH_SEAT_USD_ANNUAL",
                ],
              },
            },
            take: 1,
            select: { id: true },
            orderBy: { startDate: "desc" },
          },
        },
      });
    });

    /** @scenario "The worker reads a billable organization the way the App reads it" */
    it("names an absent organization apart from one that does not buy usage", async () => {
      const recording = recordingDatabase(null);

      expect(
        await PostgresBillingReportingAdapter.create({ database: recording.database })
          .build()
          .organizations.getOrganizationForBilling(ORGANIZATION),
      ).toEqual({ outcome: "not_found" });
    });

    /** @scenario "The worker reads a billable organization the way the App reads it" */
    it("reports an organization on another pricing model as nothing to report", async () => {
      const recording = recordingDatabase({
        id: ORGANIZATION,
        pricingModel: "FREE",
        stripeCustomerId: "cus_1",
        subscriptions: [],
      });

      expect(
        await PostgresBillingReportingAdapter.create({ database: recording.database })
          .build()
          .organizations.getOrganizationForBilling(ORGANIZATION),
      ).toEqual({ outcome: "not_usage_billed" });
    });

    /**
     * The checkpoint is the other half of the same graph, and it rides the
     * same client: the two-phase protocol writes its intent and its
     * confirmation against the rows the organization read is joined to.
     */
    /** @scenario "The worker builds the monthly roll-up from its own client" */
    it("reads the checkpoint through that same client", async () => {
      const recording = recordingDatabase();

      await PostgresBillingReportingAdapter.create({ database: recording.database })
        .build()
        .checkpoints.tryGetCheckpoint({ organizationId: ORGANIZATION, billingMonth: "2026-08" });

      expect(recording.checkpointFindUnique).toHaveBeenCalledWith({
        where: {
          organizationId_billingMonth: {
            organizationId: ORGANIZATION,
            billingMonth: "2026-08",
          },
        },
      });
    });
  });
});

import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
/**
 * @see enterprise/modules/billing/specs/stripe-webhook.feature
 */
import { describe, expect, it } from "vitest";

import { PrismaBillingWebhookOrganizationRepository } from "../prisma.billing-webhook-organization.repository.ts";

function organizationDouble(rows: Record<string, unknown>[] = []) {
  const updates: Record<string, unknown>[] = [];
  const database = prismaDouble({
    organization: {
      findFirst: async (args) => {
        const found = rows.find((row) => row.stripeCustomerId === args?.where?.stripeCustomerId);
        return found ? { id: found.id } : null;
      },
      findUnique: async (args) => {
        const found = rows.find((row) => row.id === args.where.id);
        return found ? { id: found.id, name: found.name } : null;
      },
      findUniqueOrThrow: async (args) => {
        const found = rows.find((row) => row.id === args.where.id);
        // Prisma's own "record not found" refusal carries code P2025.
        if (!found) throw Object.assign(new Error("No Organization found"), { code: "P2025" });
        return { pricingModel: found.pricingModel };
      },
      update: async (args) => {
        updates.push({ where: args.where, data: args.data });
        return {};
      },
    },
  });

  return {
    updates,
    adapter: PrismaBillingWebhookOrganizationRepository.create({ database }),
  };
}

describe("PrismaBillingWebhookOrganizationRepository", () => {
  describe("when a Stripe customer names an organization", () => {
    /** @scenario "The webhook resolves a Stripe customer to one organization, and to none where there is none" */
    it("answers the matching organization, and nothing for one it does not know", async () => {
      const { adapter } = organizationDouble([
        { id: "organization-1", name: "Acme", stripeCustomerId: "cus_1" },
      ]);

      await expect(adapter.findByStripeCustomerId("cus_1")).resolves.toEqual({
        id: "organization-1",
      });
      await expect(adapter.findByStripeCustomerId("cus_missing")).resolves.toBeNull();
    });
  });

  describe("when the webhook needs the organization's display name", () => {
    /** @scenario "The webhook resolves a Stripe customer to one organization, and to none where there is none" */
    it("answers the name, and nothing for an organization that is gone", async () => {
      const { adapter } = organizationDouble([{ id: "organization-1", name: "Acme" }]);

      await expect(adapter.findNameById("organization-1")).resolves.toEqual({
        id: "organization-1",
        name: "Acme",
      });
      await expect(adapter.findNameById("organization-2")).resolves.toBeNull();
    });
  });

  describe("when the webhook asks whether an organization is on seat pricing", () => {
    /** @scenario "An organization left on tiered pricing with no old plan is moved to seat pricing by its next Growth payment" */
    it("answers from the organization's pricing model, and refuses one that is gone", async () => {
      const { adapter } = organizationDouble([
        { id: "organization-seat", pricingModel: "SEAT_EVENT" },
        { id: "organization-tiered", pricingModel: "TIERED" },
      ]);

      await expect(
        adapter.isOnSeatEventPricing({ organizationId: "organization-seat" }),
      ).resolves.toBe(true);
      await expect(
        adapter.isOnSeatEventPricing({ organizationId: "organization-tiered" }),
      ).resolves.toBe(false);
      await expect(
        adapter.isOnSeatEventPricing({ organizationId: "organization-gone" }),
      ).rejects.toMatchObject({ code: "P2025" });
    });
  });
});

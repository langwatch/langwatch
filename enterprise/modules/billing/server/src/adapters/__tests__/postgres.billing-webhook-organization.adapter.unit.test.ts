/**
 * @see enterprise/modules/billing/specs/stripe-webhook.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { PostgresBillingWebhookOrganizationAdapter } from "../postgres.billing-webhook-organization.adapter.ts";

function organizationDouble(rows: Record<string, unknown>[] = []) {
  const updates: Record<string, unknown>[] = [];
  const database = {
    organization: {
      findFirst: vi.fn(({ where }: { where: { stripeCustomerId: string } }) => {
        const found = rows.find((row) => row.stripeCustomerId === where.stripeCustomerId);
        return Promise.resolve(found ? { id: found.id } : null);
      }),
      findUnique: vi.fn(({ where }: { where: { id: string } }) => {
        const found = rows.find((row) => row.id === where.id);
        return Promise.resolve(found ? { id: found.id, name: found.name } : null);
      }),
      update: vi.fn((args: Record<string, unknown>) => {
        updates.push(args);
        return Promise.resolve({});
      }),
    },
  } as unknown as Pick<PrismaClient, "organization">;

  return {
    updates,
    adapter: PostgresBillingWebhookOrganizationAdapter.create({ database }),
  };
}

describe("PostgresBillingWebhookOrganizationAdapter", () => {
  describe("when a Stripe customer names an organization", () => {
    /** @scenario "The webhook resolves a Stripe customer to one organization, and to none where there is none" */
    it("answers the matching organization, and nothing for one it does not know", async () => {
      const { adapter } = organizationDouble([
        { id: "organization-1", name: "Acme", stripeCustomerId: "cus_1" },
      ]);

      await expect(adapter.tryFindByStripeCustomerId("cus_1")).resolves.toEqual({
        id: "organization-1",
      });
      await expect(adapter.tryFindByStripeCustomerId("cus_missing")).resolves.toBeNull();
    });
  });

  describe("when the organization's invoicing currency changes", () => {
    /** @scenario "A checkout in a chosen currency writes that currency onto the organization" */
    it("writes the currency onto that organization alone", async () => {
      const { adapter, updates } = organizationDouble([{ id: "organization-1", name: "Acme" }]);

      await adapter.updateCurrency({ organizationId: "organization-1", currency: "USD" });

      expect(updates).toEqual([{ where: { id: "organization-1" }, data: { currency: "USD" } }]);
    });
  });

  describe("when a paid subscription retires a trial licence", () => {
    /** @scenario "A paid subscription retires the trial licence and both dates derived from it" */
    it("clears the key and both dates derived from it", async () => {
      const { adapter, updates } = organizationDouble([{ id: "organization-1", name: "Acme" }]);

      await adapter.clearTrialLicense("organization-1");

      expect(updates).toEqual([
        {
          where: { id: "organization-1" },
          data: { license: null, licenseExpiresAt: null, licenseLastValidatedAt: null },
        },
      ]);
    });
  });

  describe("when the webhook needs the organization's display name", () => {
    /** @scenario "The webhook resolves a Stripe customer to one organization, and to none where there is none" */
    it("answers the name, and nothing for an organization that is gone", async () => {
      const { adapter } = organizationDouble([{ id: "organization-1", name: "Acme" }]);

      await expect(adapter.tryFindNameById("organization-1")).resolves.toEqual({
        id: "organization-1",
        name: "Acme",
      });
      await expect(adapter.tryFindNameById("organization-2")).resolves.toBeNull();
    });
  });
});

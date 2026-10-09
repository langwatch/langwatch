import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStripeCustomersChannel } from "../channels/memory/memory.stripe-customers.channel.ts";
import { MemoryBillingOrganizationRepository } from "../repositories/memory/memory.billing-account-facts.repository.ts";
import { MemoryBillingStore } from "../repositories/memory/memory.billing.store.ts";
import { CustomerService } from "../services/customer.service.ts";

const createMockOrganizations = () => ({
  findBillingProfile: vi.fn(),
  claimStripeCustomerId: vi.fn(),
});

describe("customerService", () => {
  let customers: MemoryStripeCustomersChannel;
  let organizations: ReturnType<typeof createMockOrganizations>;
  let service: CustomerService;

  beforeEach(() => {
    customers = MemoryStripeCustomersChannel.create();
    organizations = createMockOrganizations();
    service = CustomerService.create({ customers, organizations });
  });

  describe("getOrCreateCustomerId()", () => {
    describe("when organization not found", () => {
      it("raises organization_not_found", async () => {
        organizations.findBillingProfile.mockRejectedValue(
          Object.assign(new Error("Organization not found"), {
            code: "organization_not_found",
          }),
        );

        await expect(
          service.getOrCreateCustomerId({
            user: { email: "test@example.com" },
            organizationId: "org_missing",
          }),
        ).rejects.toMatchObject({ code: "organization_not_found" });
      });
    });

    describe("when organization already has a Stripe customer", () => {
      it("returns existing customer ID", async () => {
        organizations.findBillingProfile.mockResolvedValue({
          name: "Acme",
          stripeCustomerId: "cus_existing",
        });

        const result = await service.getOrCreateCustomerId({
          user: { email: "test@example.com" },
          organizationId: "org_123",
        });

        expect(result).toBe("cus_existing");
        expect(customers.created).toEqual([]);
      });
    });

    describe("when user has no email", () => {
      it("raises billing_customer_email_required", async () => {
        organizations.findBillingProfile.mockResolvedValue({
          name: "Acme",
          stripeCustomerId: null,
        });

        await expect(
          service.getOrCreateCustomerId({
            user: { email: null },
            organizationId: "org_123",
          }),
        ).rejects.toMatchObject({ code: "billing_customer_email_required" });
      });
    });

    describe("when creating a new customer", () => {
      it("creates customer in Stripe and stores ID", async () => {
        organizations.findBillingProfile.mockResolvedValue({
          name: "Acme",
          stripeCustomerId: null,
        });
        organizations.claimStripeCustomerId.mockResolvedValue(true);

        const result = await service.getOrCreateCustomerId({
          user: { email: "test@example.com" },
          organizationId: "org_123",
        });

        expect(result).toBe("cus_memory_1");
        expect(customers.created).toEqual([{ email: "test@example.com", name: "Acme" }]);
        expect(organizations.claimStripeCustomerId).toHaveBeenCalledWith({
          organizationId: "org_123",
          stripeCustomerId: "cus_memory_1",
        });
        expect(customers.deleted).toEqual([]);
      });
    });

    describe("when a race condition occurs", () => {
      it("cleans up orphan and returns existing customer ID", async () => {
        organizations.findBillingProfile
          .mockResolvedValueOnce({ name: "Acme", stripeCustomerId: null })
          .mockResolvedValueOnce({ name: "Acme", stripeCustomerId: "cus_winner" });
        organizations.claimStripeCustomerId.mockResolvedValue(false);

        const result = await service.getOrCreateCustomerId({
          user: { email: "test@example.com" },
          organizationId: "org_123",
        });

        expect(result).toBe("cus_winner");
        expect(customers.deleted).toEqual(["cus_memory_1"]);
        await expect(customers.getCustomer({ customerId: "cus_memory_1" })).resolves.toMatchObject({
          deleted: true,
        });
      });

      it("handles orphan cleanup failure gracefully", async () => {
        organizations.findBillingProfile
          .mockResolvedValueOnce({ name: "Acme", stripeCustomerId: null })
          .mockResolvedValueOnce({ name: "Acme", stripeCustomerId: "cus_winner" });
        organizations.claimStripeCustomerId.mockResolvedValue(false);
        customers.refuse({ operation: "deleteCustomer", error: new Error("Stripe API error") });

        const result = await service.getOrCreateCustomerId({
          user: { email: "test@example.com" },
          organizationId: "org_123",
        });

        expect(result).toBe("cus_winner");
      });

      it("raises subscription_sync_failed when the refreshed org still has no customer id", async () => {
        organizations.findBillingProfile.mockResolvedValue({
          name: "Acme",
          stripeCustomerId: null,
        });
        organizations.claimStripeCustomerId.mockResolvedValue(false);

        await expect(
          service.getOrCreateCustomerId({
            user: { email: "test@example.com" },
            organizationId: "org_123",
          }),
        ).rejects.toMatchObject({ code: "subscription_sync_failed" });
      });
    });
  });

  describe("when two checkouts claim one organization's Stripe customer at once", () => {
    /** @scenario "The Stripe customer-id claim stays a synchronous compare-and-set" */
    it("lets exactly one claim win and gives the other the winner's id", async () => {
      const store = MemoryBillingStore.create();
      store.organizations.set("org_race", {
        id: "org_race",
        name: "Race",
        stripeCustomerId: null,
        pricingModel: "SEAT_EVENT",
        currency: null,
        license: null,
        selfHostedCustomer: false,
        teamIds: [],
        signupData: {},
      });
      const raceCustomers = MemoryStripeCustomersChannel.create();
      const racing = CustomerService.create({
        customers: raceCustomers,
        organizations: MemoryBillingOrganizationRepository.create(store),
      });
      const checkout = () =>
        racing.getOrCreateCustomerId({
          user: { email: "a@race.test" },
          organizationId: "org_race",
        });

      const [first, second] = await Promise.all([checkout(), checkout()]);

      expect(first).toBe(second);
      expect(store.organizations.get("org_race")?.stripeCustomerId).toBe(first);
      expect(raceCustomers.created).toHaveLength(2);
      expect(raceCustomers.deleted).toHaveLength(1);
      expect(raceCustomers.deleted).not.toContain(first);
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerService } from "../index";

const createMockStripe = () => ({
  customers: {
    create: vi.fn(),
    del: vi.fn(),
  },
});

const createMockOrganizations = () => ({
  getBillingProfile: vi.fn(),
  claimBillingCustomerId: vi.fn(),
});

describe("customerService", () => {
  let stripe: ReturnType<typeof createMockStripe>;
  let organizations: ReturnType<typeof createMockOrganizations>;
  let service: CustomerService;

  beforeEach(() => {
    stripe = createMockStripe();
    organizations = createMockOrganizations();
    service = CustomerService.create({
      stripe: stripe as any,
      organizations,
    });
  });

  describe("getOrCreateCustomerId()", () => {
    describe("when organization not found", () => {
      it("raises organization_not_found", async () => {
        organizations.getBillingProfile.mockRejectedValue(
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
        organizations.getBillingProfile.mockResolvedValue({
          id: "org_123",
          name: "Acme",
          billingCustomerId: "cus_existing",
        });

        const result = await service.getOrCreateCustomerId({
          user: { email: "test@example.com" },
          organizationId: "org_123",
        });

        expect(result).toBe("cus_existing");
        expect(stripe.customers.create).not.toHaveBeenCalled();
      });
    });

    describe("when user has no email", () => {
      it("raises billing_customer_email_required", async () => {
        organizations.getBillingProfile.mockResolvedValue({
          id: "org_123",
          name: "Acme",
          billingCustomerId: null,
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
        organizations.getBillingProfile.mockResolvedValue({
          id: "org_123",
          name: "Acme",
          billingCustomerId: null,
        });
        stripe.customers.create.mockResolvedValue({ id: "cus_new" });
        organizations.claimBillingCustomerId.mockResolvedValue(true);

        const result = await service.getOrCreateCustomerId({
          user: { email: "test@example.com" },
          organizationId: "org_123",
        });

        expect(result).toBe("cus_new");
        expect(stripe.customers.create).toHaveBeenCalledWith({
          email: "test@example.com",
          name: "Acme",
        });
        expect(organizations.claimBillingCustomerId).toHaveBeenCalledWith({
          organizationId: "org_123",
          billingCustomerId: "cus_new",
        });
      });
    });

    describe("when a race condition occurs", () => {
      it("cleans up orphan and returns existing customer ID", async () => {
        organizations.getBillingProfile
          .mockResolvedValueOnce({
            id: "org_123",
            name: "Acme",
            billingCustomerId: null,
          })
          .mockResolvedValueOnce({
            id: "org_123",
            name: "Acme",
            billingCustomerId: "cus_winner",
          });
        stripe.customers.create.mockResolvedValue({ id: "cus_orphan" });
        organizations.claimBillingCustomerId.mockResolvedValue(false);
        stripe.customers.del.mockResolvedValue({ deleted: true });

        const result = await service.getOrCreateCustomerId({
          user: { email: "test@example.com" },
          organizationId: "org_123",
        });

        expect(result).toBe("cus_winner");
        expect(stripe.customers.del).toHaveBeenCalledWith("cus_orphan");
      });

      it("handles orphan cleanup failure gracefully", async () => {
        organizations.getBillingProfile
          .mockResolvedValueOnce({
            id: "org_123",
            name: "Acme",
            billingCustomerId: null,
          })
          .mockResolvedValueOnce({
            id: "org_123",
            name: "Acme",
            billingCustomerId: "cus_winner",
          });
        stripe.customers.create.mockResolvedValue({ id: "cus_orphan" });
        organizations.claimBillingCustomerId.mockResolvedValue(false);
        stripe.customers.del.mockRejectedValue(new Error("Stripe API error"));

        const result = await service.getOrCreateCustomerId({
          user: { email: "test@example.com" },
          organizationId: "org_123",
        });

        expect(result).toBe("cus_winner");
      });

      it("raises subscription_sync_failed when the refreshed org still has no customer id", async () => {
        organizations.getBillingProfile.mockResolvedValue({
          id: "org_123",
          name: "Acme",
          billingCustomerId: null,
        });
        stripe.customers.create.mockResolvedValue({ id: "cus_orphan" });
        organizations.claimBillingCustomerId.mockResolvedValue(false);
        stripe.customers.del.mockResolvedValue({ deleted: true });

        await expect(
          service.getOrCreateCustomerId({
            user: { email: "test@example.com" },
            organizationId: "org_123",
          }),
        ).rejects.toMatchObject({ code: "subscription_sync_failed" });
      });
    });
  });
});

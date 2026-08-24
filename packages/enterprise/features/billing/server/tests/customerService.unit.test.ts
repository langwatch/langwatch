import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerService } from "../src/index";
import { PrismaBillingOrganizationRepository } from "../src/repositories/prisma/prisma.billing-organization.repository";

const createMockStripe = () => ({
  customers: {
    create: vi.fn(),
    del: vi.fn(),
  },
});

const createMockDb = () => ({
  organization: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    updateMany: vi.fn(),
  },
});

describe("customerService", () => {
  let stripe: ReturnType<typeof createMockStripe>;
  let db: ReturnType<typeof createMockDb>;
  let service: CustomerService;

  beforeEach(() => {
    stripe = createMockStripe();
    db = createMockDb();
    service = CustomerService.create({
      stripe: stripe as any,
      organizations: PrismaBillingOrganizationRepository.create(db as any),
    });
  });

  describe("getOrCreateCustomerId()", () => {
    describe("when organization not found", () => {
      it("raises organization_not_found", async () => {
        db.organization.findUnique.mockResolvedValue(null);

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
        db.organization.findUnique.mockResolvedValue({
          id: "org_123",
          name: "Acme",
          stripeCustomerId: "cus_existing",
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
        db.organization.findUnique.mockResolvedValue({
          id: "org_123",
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
        db.organization.findUnique.mockResolvedValue({
          id: "org_123",
          name: "Acme",
          stripeCustomerId: null,
        });
        stripe.customers.create.mockResolvedValue({ id: "cus_new" });
        db.organization.updateMany.mockResolvedValue({ count: 1 });

        const result = await service.getOrCreateCustomerId({
          user: { email: "test@example.com" },
          organizationId: "org_123",
        });

        expect(result).toBe("cus_new");
        expect(stripe.customers.create).toHaveBeenCalledWith({
          email: "test@example.com",
          name: "Acme",
        });
        expect(db.organization.updateMany).toHaveBeenCalledWith({
          where: { id: "org_123", stripeCustomerId: null },
          data: { stripeCustomerId: "cus_new" },
        });
      });
    });

    describe("when a race condition occurs", () => {
      it("cleans up orphan and returns existing customer ID", async () => {
        db.organization.findUnique.mockResolvedValue({
          id: "org_123",
          name: "Acme",
          stripeCustomerId: null,
        });
        stripe.customers.create.mockResolvedValue({ id: "cus_orphan" });
        db.organization.updateMany.mockResolvedValue({ count: 0 });
        stripe.customers.del.mockResolvedValue({ deleted: true });
        db.organization.findUniqueOrThrow.mockResolvedValue({
          id: "org_123",
          stripeCustomerId: "cus_winner",
        });

        const result = await service.getOrCreateCustomerId({
          user: { email: "test@example.com" },
          organizationId: "org_123",
        });

        expect(result).toBe("cus_winner");
        expect(stripe.customers.del).toHaveBeenCalledWith("cus_orphan");
      });

      it("handles orphan cleanup failure gracefully", async () => {
        db.organization.findUnique.mockResolvedValue({
          id: "org_123",
          name: "Acme",
          stripeCustomerId: null,
        });
        stripe.customers.create.mockResolvedValue({ id: "cus_orphan" });
        db.organization.updateMany.mockResolvedValue({ count: 0 });
        stripe.customers.del.mockRejectedValue(new Error("Stripe API error"));
        db.organization.findUniqueOrThrow.mockResolvedValue({
          id: "org_123",
          stripeCustomerId: "cus_winner",
        });

        const result = await service.getOrCreateCustomerId({
          user: { email: "test@example.com" },
          organizationId: "org_123",
        });

        expect(result).toBe("cus_winner");
      });

      it("raises subscription_sync_failed when the refreshed org still has no customer id", async () => {
        db.organization.findUnique.mockResolvedValue({
          id: "org_123",
          name: "Acme",
          stripeCustomerId: null,
        });
        stripe.customers.create.mockResolvedValue({ id: "cus_orphan" });
        db.organization.updateMany.mockResolvedValue({ count: 0 });
        stripe.customers.del.mockResolvedValue({ deleted: true });
        db.organization.findUniqueOrThrow.mockResolvedValue({
          id: "org_123",
          stripeCustomerId: null,
        });

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

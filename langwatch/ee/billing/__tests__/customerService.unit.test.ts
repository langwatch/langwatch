import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCustomerService } from "../services/customerService";
import {
  CustomerCreationRaceError,
  OrganizationNotFoundError,
  UserEmailRequiredError,
} from "../errors";

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
  let service: ReturnType<typeof createCustomerService>;

  beforeEach(() => {
    stripe = createMockStripe();
    db = createMockDb();
    service = createCustomerService({
      stripe: stripe as any,
      db: db as any,
    });
  });

  describe("getOrCreateCustomerId()", () => {
    describe("when organization not found", () => {
      it("throws OrganizationNotFoundError", async () => {
        db.organization.findUnique.mockResolvedValue(null);

        await expect(
          service.getOrCreateCustomerId({
            user: { email: "test@example.com" },
            organizationId: "org_missing",
          }),
        ).rejects.toThrow(OrganizationNotFoundError);
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
      it("throws UserEmailRequiredError", async () => {
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
        ).rejects.toThrow(UserEmailRequiredError);
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

      it("throws CustomerCreationRaceError when refreshed org has no customer ID", async () => {
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
        ).rejects.toThrow(CustomerCreationRaceError);
      });
    });
  });
});

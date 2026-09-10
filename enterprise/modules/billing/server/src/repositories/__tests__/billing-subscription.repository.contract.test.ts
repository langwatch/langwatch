/**
 * @vitest-environment node
 * The subscription and checkpoint contract, stated once and run against every
 * backend the package can reach. The memory twin runs always; a Postgres
 * backend joins it when this package declares a datastore in its vitest config.
 */
import { describe, expect, it } from "vitest";
import type { BillingRepositories } from "../billing.repositories.ts";
import { MemoryBillingRepositories } from "../memory/memory.billing.repositories.ts";

const backends: ReadonlyArray<{ name: string; create: () => BillingRepositories }> = [
  { name: "memory", create: () => MemoryBillingRepositories.create() },
];

describe.each(backends)("given the $name billing repositories", ({ create }) => {
  describe("when a subscription is opened for an organization", () => {
    it("reads it back as the last non-cancelled one, and not as active", async () => {
      const repositories = create();

      const pending = await repositories.subscriptions.createPending({
        organizationId: "org-1",
        plan: "GROWTH",
      });

      expect(pending.status).toBe("PENDING");
      await expect(repositories.subscriptions.tryFindActive("org-1")).resolves.toBeNull();
      await expect(
        repositories.subscriptions.tryFindLastNonCancelled("org-1"),
      ).resolves.toMatchObject({ id: pending.id });
    });
  });

  describe("when a subscription is linked to Stripe and cancelled", () => {
    it("stops answering as the last non-cancelled one", async () => {
      const repositories = create();
      const pending = await repositories.subscriptions.createPending({
        organizationId: "org-1",
        plan: "GROWTH",
      });

      await expect(
        repositories.subscriptions.linkStripeId({
          id: pending.id,
          stripeSubscriptionId: "sub_stripe_1",
        }),
      ).resolves.toEqual({ count: 1 });
      await expect(
        repositories.subscriptions.tryFindByStripeId("sub_stripe_1"),
      ).resolves.toMatchObject({ id: pending.id });

      await repositories.subscriptions.cancel({ id: pending.id });

      await expect(
        repositories.subscriptions.tryFindLastNonCancelled("org-1"),
      ).resolves.toBeNull();
    });
  });

  describe("when a Stripe subscription id names nothing", () => {
    it("answers null rather than another organization's row", async () => {
      const repositories = create();

      await expect(repositories.subscriptions.tryFindByStripeId("sub_absent")).resolves.toBeNull();
    });
  });

  describe("when no month has been reported yet", () => {
    it("answers no checkpoint at all", async () => {
      const repositories = create();

      await expect(
        repositories.checkpoints.tryGetCheckpoint({
          organizationId: "org-1",
          billingMonth: "2026-09",
        }),
      ).resolves.toBeNull();
    });
  });

  describe("when the roll-up writes an intent and then confirms it", () => {
    it("promotes the pending total and clears the failure count", async () => {
      const repositories = create();
      const month = { organizationId: "org-1", billingMonth: "2026-09" };

      await repositories.checkpoints.writeIntent({
        ...month,
        lastReportedTotal: 0,
        pendingReportedTotal: 120,
      });

      await expect(repositories.checkpoints.tryGetCheckpoint(month)).resolves.toEqual({
        lastReportedTotal: 0,
        pendingReportedTotal: 120,
        consecutiveFailures: 0,
      });

      await repositories.checkpoints.confirm({ ...month, lastReportedTotal: 120 });

      await expect(repositories.checkpoints.tryGetCheckpoint(month)).resolves.toEqual({
        lastReportedTotal: 120,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
    });
  });

  describe("when the report is asked for an organization it has never seen", () => {
    it("says the organization was not found", async () => {
      const repositories = create();

      await expect(
        repositories.reportOrganizations.getOrganizationForBilling("org-absent"),
      ).resolves.toEqual({ outcome: "not_found" });
    });
  });

  describe("when a tenant has never been attributed", () => {
    it("answers null rather than a neighbouring organization", async () => {
      const repositories = create();

      await expect(
        repositories.tenantOrganizations.tryFindOrganizationForTenant("project-1"),
      ).resolves.toBeNull();
    });
  });
  describe("when the webhook names a subscription that is not there", () => {
    it("answers null rather than raising, on every nullable write", async () => {
      const repositories = create();

      await expect(
        repositories.webhookSubscriptions.tryUpdateStatus({ id: "sub-absent", status: "ACTIVE" }),
      ).resolves.toBeNull();
      await expect(
        repositories.webhookSubscriptions.tryUpdatePlan({ id: "sub-absent", plan: "GROWTH" }),
      ).resolves.toBeNull();
      await expect(
        repositories.webhookSubscriptions.tryActivate({
          id: "sub-absent",
          previousStatus: "PENDING",
        }),
      ).resolves.toBeNull();
    });
  });

  describe("when the webhook resolves a Stripe customer nothing was billed to", () => {
    it("answers null rather than the first organization it holds", async () => {
      const repositories = create();

      await expect(
        repositories.webhookOrganizations.tryFindByStripeCustomerId("cus_absent"),
      ).resolves.toBeNull();
      await expect(repositories.webhookOrganizations.tryFindNameById("org-absent")).resolves.toBeNull();
    });
  });
});

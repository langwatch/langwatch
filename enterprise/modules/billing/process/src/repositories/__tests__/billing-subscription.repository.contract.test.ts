/**
 * @vitest-environment node
 * The subscription and checkpoint contract, stated once and run against every
 * backend the package can reach. The memory twin runs always; a Postgres
 * backend joins it when this package declares a datastore in its vitest config.
 */
import { Temporal } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BillingRepositories } from "../billing.repositories.ts";
import { MemoryBillingRepositories } from "../memory/memory.billing.repositories.ts";

const backends: readonly { name: string; create: () => BillingRepositories }[] = [
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
      await expect(repositories.subscriptions.findActive("org-1")).resolves.toBeNull();
      await expect(repositories.subscriptions.findLastNonCancelled("org-1")).resolves.toMatchObject(
        { id: pending.id },
      );
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
        repositories.subscriptions.findByStripeId("sub_stripe_1"),
      ).resolves.toMatchObject({ id: pending.id });

      await repositories.subscriptions.cancel({ id: pending.id });

      await expect(repositories.subscriptions.findLastNonCancelled("org-1")).resolves.toBeNull();
    });
  });

  describe("when a Stripe subscription id names nothing", () => {
    it("answers null rather than another organization's row", async () => {
      const repositories = create();

      await expect(repositories.subscriptions.findByStripeId("sub_absent")).resolves.toBeNull();
    });
  });

  describe("when no month has been reported yet", () => {
    it("answers no checkpoint at all", async () => {
      const repositories = create();

      await expect(
        repositories.checkpoints.findCheckpoint({
          organizationId: "org-1",
          billingMonth: "2026-09",
          meter: "langwatch_billable_events",
        }),
      ).resolves.toBeNull();
    });
  });

  describe("when the roll-up writes an intent and then confirms it", () => {
    it("promotes the pending total and clears the failure count", async () => {
      const repositories = create();
      const month = {
        organizationId: "org-1",
        billingMonth: "2026-09",
        meter: "langwatch_billable_events",
      };

      await repositories.checkpoints.writeIntent({
        ...month,
        lastReportedTotal: 0,
        pendingReportedTotal: 120,
      });

      await expect(repositories.checkpoints.findCheckpoint(month)).resolves.toEqual({
        lastReportedTotal: 0,
        pendingReportedTotal: 120,
        consecutiveFailures: 0,
        lastCountedEventId: null,
      });

      await repositories.checkpoints.confirm({ ...month, lastReportedTotal: 120 });

      await expect(repositories.checkpoints.findCheckpoint(month)).resolves.toEqual({
        lastReportedTotal: 120,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
        lastCountedEventId: null,
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

  describe("when the webhook names a subscription that is not there", () => {
    it("reports a missing subscription rather than raising, on every write", async () => {
      const repositories = create();

      await expect(
        repositories.webhookSubscriptions.updateStatus({ id: "sub-absent", status: "ACTIVE" }),
      ).resolves.toEqual({ outcome: "missing_subscription" });
      await expect(
        repositories.webhookSubscriptions.updatePlan({ id: "sub-absent", plan: "GROWTH" }),
      ).resolves.toEqual({ outcome: "missing_subscription" });
      await expect(
        repositories.webhookSubscriptions.activate({
          id: "sub-absent",
          previousStatus: "PENDING",
        }),
      ).resolves.toEqual({ outcome: "missing_subscription" });
    });
  });

  describe("when the webhook resolves a Stripe customer nothing was billed to", () => {
    it("answers null rather than the first organization it holds", async () => {
      const repositories = create();

      await expect(
        repositories.webhookOrganizations.findByStripeCustomerId("cus_absent"),
      ).resolves.toBeNull();
      await expect(
        repositories.webhookOrganizations.findNameById("org-absent"),
      ).resolves.toBeNull();
    });
  });

  describe("when the subscription rows the ops functions read are asked for", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function subscriptionAt({
      repositories,
      organizationId,
      status,
      at,
    }: {
      repositories: BillingRepositories;
      organizationId: string;
      status: "ACTIVE" | "CANCELLED" | "PENDING";
      at: string;
    }): Promise<string> {
      vi.setSystemTime(new Date(at));
      const created = await repositories.subscriptions.createPending({
        organizationId,
        plan: "GROWTH_SEAT_EUR_MONTHLY",
      });
      if (status !== "PENDING") {
        await repositories.subscriptions.updateStatus({ id: created.id, status });
      }
      return created.id;
    }

    async function twoOrganizationsAcrossTwoMonths(repositories: BillingRepositories) {
      return {
        acmeOld: await subscriptionAt({
          repositories,
          organizationId: "org-acme",
          status: "CANCELLED",
          at: "2026-10-05T00:00:00Z",
        }),
        acmeNew: await subscriptionAt({
          repositories,
          organizationId: "org-acme",
          status: "ACTIVE",
          at: "2026-11-03T00:00:00Z",
        }),
        globex: await subscriptionAt({
          repositories,
          organizationId: "org-globex",
          status: "PENDING",
          at: "2026-11-04T00:00:00Z",
        }),
      };
    }

    it("answers one organization's rows, cancelled included, newest first", async () => {
      const repositories = create();
      const ids = await twoOrganizationsAcrossTwoMonths(repositories);

      const rows = await repositories.subscriptions.findForOrganization("org-acme");

      expect(rows.map(({ id, status }) => [id, status])).toEqual([
        [ids.acmeNew, "ACTIVE"],
        [ids.acmeOld, "CANCELLED"],
      ]);
    });

    it("answers no rows for an organization with none", async () => {
      const repositories = create();
      await twoOrganizationsAcrossTwoMonths(repositories);

      await expect(repositories.subscriptions.findForOrganization("org-empty")).resolves.toEqual(
        [],
      );
    });

    it("answers November's rows across organizations, oldest first, and not October's", async () => {
      const repositories = create();
      const ids = await twoOrganizationsAcrossTwoMonths(repositories);

      const rows = await repositories.subscriptions.findCreatedBetween({
        since: Temporal.Instant.from("2026-11-01T00:00:00Z"),
        until: Temporal.Instant.from("2026-12-01T00:00:00Z"),
      });

      expect(rows.map(({ id, organizationId }) => [id, organizationId])).toEqual([
        [ids.acmeNew, "org-acme"],
        [ids.globex, "org-globex"],
      ]);
    });

    it("takes a row created exactly at since and leaves out one created exactly at until", async () => {
      const repositories = create();
      const beforeSince = await subscriptionAt({
        repositories,
        organizationId: "org-acme",
        status: "CANCELLED",
        at: "2026-10-31T23:59:59.999Z",
      });
      const atSince = await subscriptionAt({
        repositories,
        organizationId: "org-acme",
        status: "ACTIVE",
        at: "2026-11-01T00:00:00Z",
      });
      const beforeUntil = await subscriptionAt({
        repositories,
        organizationId: "org-globex",
        status: "PENDING",
        at: "2026-11-30T23:59:59.999Z",
      });
      const atUntil = await subscriptionAt({
        repositories,
        organizationId: "org-globex",
        status: "ACTIVE",
        at: "2026-12-01T00:00:00Z",
      });

      const rows = await repositories.subscriptions.findCreatedBetween({
        since: Temporal.Instant.from("2026-11-01T00:00:00Z"),
        until: Temporal.Instant.from("2026-12-01T00:00:00Z"),
      });

      expect(rows.map(({ id }) => id)).toEqual([atSince, beforeUntil]);
      expect([beforeSince, atUntil].some((id) => rows.some((row) => row.id === id))).toBe(false);
    });
  });
});

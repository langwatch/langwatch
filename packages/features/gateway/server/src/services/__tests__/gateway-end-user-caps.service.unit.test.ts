/**
 * What one end user's spending allowances look like.
 *
 * This is the figure a customer sees next to their own name, so it is read
 * from two stores that must agree: the allowance and its period boundary come
 * from Postgres, the amount spent from the ledger. The join between them is
 * the bucket scope id, and getting it wrong shows somebody else's spend — or,
 * more quietly, zero.
 */

import { describe, expect, it } from "vitest";
import { GatewayEndUserCapsService } from "../gateway-end-user-caps.service";

const NOW_ISH = new Date("2026-06-01T00:00:00.000Z");

function template(over: Record<string, unknown> = {}) {
  return {
    id: "budget-1",
    scopeType: "ATTRIBUTED_USER",
    scopeId: "vk-1",
    providerKey: null,
    window: "MONTH",
    onBreach: "BLOCK",
    limitUsd: "100",
    currentPeriodStartedAt: NOW_ISH,
    resetsAt: new Date("2026-07-01T00:00:00.000Z"),
    lastResetAt: null,
    cycleAnchorAt: null,
    ...over,
  };
}

function capsWith(options: {
  templates?: Array<ReturnType<typeof template>>;
  boundaries?: Array<{ budgetId: string; bucketScopeId: string; periodStartedAt: Date | null }>;
  spends?: Array<{ budgetId: string; spentUsd: string }>;
}) {
  const asked: Array<Record<string, unknown>> = [];
  const service = GatewayEndUserCapsService.create({
    budgets: {
      findAttributedUserTemplates: async (input: Record<string, unknown>) => {
        asked.push({ method: "templates", ...input });
        return options.templates ?? [];
      },
      findBucketBoundaries: async (input: Record<string, unknown>) => {
        asked.push({ method: "boundaries", ...input });
        return options.boundaries ?? [];
      },
    },
    spend: {
      getSpendForTargetsAcrossTenants: async (
        tenantIds: string[],
        targets: Array<Record<string, unknown>>,
      ) => {
        asked.push({ method: "spend", tenantIds, targets });
        return options.spends ?? [];
      },
    },
  } as never);

  return { asked, service };
}

/** The bucket targets the ledger was asked about. */
function spendTargets(asked: Array<Record<string, unknown>>): Array<{ scopeId: string }> {
  const call = asked.find((entry) => entry.method === "spend");
  return (call?.targets ?? []) as Array<{ scopeId: string }>;
}

const forEndUser = (service: GatewayEndUserCapsService, over: Record<string, unknown> = {}) =>
  service.forEndUser({
    organizationId: "organization-1",
    endUserId: "end-user-1",
    tenantIds: ["project-1"],
    ...over,
  });

describe("GatewayEndUserCapsService.forEndUser", () => {
  describe("given the organization has no attributed-user allowances", () => {
    it("answers with none, and never asks the ledger", async () => {
      const { service, asked } = capsWith({ templates: [] });

      await expect(forEndUser(service)).resolves.toEqual([]);
      expect(asked.some((call) => call.method === "spend")).toBe(false);
    });
  });

  describe("given the caller named no tenants to read spend from", () => {
    it("answers with none rather than a cap with a made-up figure", async () => {
      const { service, asked } = capsWith({ templates: [template()] });

      await expect(forEndUser(service, { tenantIds: [] })).resolves.toEqual([]);
      expect(asked.some((call) => call.method === "spend")).toBe(false);
    });
  });

  describe("given one allowance and its spend", () => {
    it("reports the limit and what has been spent against it", async () => {
      const { service } = capsWith({
        templates: [template()],
        spends: [{ budgetId: "budget-1", spentUsd: "12.5" }],
      });

      await expect(forEndUser(service)).resolves.toMatchObject([
        { budget_id: "budget-1", anchor_id: "vk-1", limit_usd: "100", spent_usd: "12.5" },
      ]);
    });

    it("reports zero spent when the ledger knows nothing of it", async () => {
      // Not absent, and not the limit: a budget nobody has spent against is
      // at zero, and saying anything else misstates a customer's usage.
      const { service } = capsWith({ templates: [template()], spends: [] });

      await expect(forEndUser(service)).resolves.toMatchObject([{ spent_usd: "0" }]);
    });

    it("does not credit one allowance with another's spend", async () => {
      const { service } = capsWith({
        templates: [template(), template({ id: "budget-2", scopeId: "vk-2" })],
        spends: [{ budgetId: "budget-2", spentUsd: "9" }],
      });

      await expect(forEndUser(service)).resolves.toMatchObject([
        { budget_id: "budget-1", spent_usd: "0" },
        { budget_id: "budget-2", spent_usd: "9" },
      ]);
    });
  });

  describe("the ledger read", () => {
    it("asks about this end user's own bucket, not the whole virtual key", async () => {
      // The allowance is per attributed user, so the scope id it charges
      // against has to carry the end user. Asking for the key's bucket would
      // report everyone's spend as this person's.
      const { service, asked } = capsWith({ templates: [template()] });

      await forEndUser(service);

      expect(spendTargets(asked)[0]?.scopeId).toContain("end-user-1");
    });

    it("separates a provider-filtered allowance into its own bucket", async () => {
      // Two allowances on one key that differ only by provider must accrue
      // apart, so the provider has to be in the bucket key.
      const { service, asked } = capsWith({
        templates: [template({ providerKey: "openai" })],
      });

      await forEndUser(service);

      expect(spendTargets(asked)[0]?.scopeId).toContain("openai");
    });

    it("only reads the tenants it was given", async () => {
      const { service, asked } = capsWith({ templates: [template()] });

      await forEndUser(service, { tenantIds: ["project-1", "project-2"] });

      expect(asked.find((call) => call.method === "spend")?.tenantIds).toEqual([
        "project-1",
        "project-2",
      ]);
    });
  });

  describe("the budget read", () => {
    it("is scoped to the organization", async () => {
      const { service, asked } = capsWith({ templates: [template()] });

      await forEndUser(service);

      expect(asked[0]).toMatchObject({ organizationId: "organization-1" });
    });

    it("narrows to one virtual key when the caller named one", async () => {
      const { service, asked } = capsWith({ templates: [template()] });

      await forEndUser(service, { virtualKeyId: "vk-9" });

      expect(asked[0]).toMatchObject({ virtualKeyId: "vk-9" });
    });

    it("asks for boundaries only for the budgets it found", async () => {
      const { service, asked } = capsWith({
        templates: [template(), template({ id: "budget-2" })],
      });

      await forEndUser(service);

      expect(asked.find((call) => call.method === "boundaries")).toMatchObject({
        budgetIds: ["budget-1", "budget-2"],
      });
    });
  });

  describe("given a bucket that has rolled over", () => {
    it("dates the period from the boundary rather than the template", async () => {
      const rolled = new Date("2026-06-15T00:00:00.000Z");
      const { service, asked } = capsWith({ templates: [template()] });
      await forEndUser(service);
      const bucketScopeId = spendTargets(asked)[0]!.scopeId;

      const rolledOver = capsWith({
        templates: [template()],
        boundaries: [{ budgetId: "budget-1", bucketScopeId, periodStartedAt: rolled }],
      });

      await expect(forEndUser(rolledOver.service)).resolves.toMatchObject([
        { period_started_at: rolled.toISOString() },
      ]);
    });
  });
});

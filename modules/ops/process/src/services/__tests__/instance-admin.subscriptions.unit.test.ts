/**
 * An organization holds one live Stripe-backed plan; Cloud admin asks billing before it writes one.
 * @see ../../../../specs/admin.feature
 */
import type { AdminOperationInput } from "@langwatch/ops-contract";
import { describe, expect, it } from "vitest";

import { MemoryInstanceAdminRepository } from "../../repositories/memory/memory.instance-admin.repository.ts";
import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import { InstanceAdminService } from "../instance-admin.service.ts";
import { AuditStub, noOperators } from "./support/admin-doubles.ts";
import { billingLivePlanRule, planSlotOf } from "./support/billing-live-plan-rule.ts";
import { TestUserApi } from "./support/test-user-api.ts";

function subscriptionWrite(
  method: "create" | "update" | "updateMany",
  params: AdminOperationInput["params"],
): AdminOperationInput {
  return { resource: "subscription", method, params, actorId: "olive", req: { headers: {} } };
}

const linked = (id: string, status: string, plan = "GROWTH_SEAT_EUR_MONTHLY") => ({
  id,
  organizationId: "org_acme",
  status,
  plan,
  stripeSubscriptionId: `${id}_stripe`,
});

type Seed = (data: Record<string, unknown>) => Promise<unknown>;

async function cloudAdmin({
  landsAfterCheck,
}: { landsAfterCheck?: (seed: Seed) => Promise<void> } = {}) {
  const store = MemoryOpsStore.create();
  const repository = MemoryInstanceAdminRepository.create({ store });
  const seed: Seed = (data) => repository.execute(subscriptionWrite("create", { data }));
  const audit = new AuditStub();
  const service = InstanceAdminService.create({
    operators: noOperators,
    repository,
    users: new TestUserApi(),
    accounts: {
      deactivateUser: () => Promise.reject(new Error("unreached")),
      changeUserEmail: () => Promise.reject(new Error("unreached")),
    },
    billing: billingLivePlanRule({
      rows: async () => [...(store.adminRows.get("subscription")?.values() ?? [])].map(planSlotOf),
      ...(landsAfterCheck ? { landsAfterCheck: () => landsAfterCheck(seed) } : {}),
    }),
    audit,
  });
  await seed(linked("sub_live", "ACTIVE"));
  await seed(linked("sub_tiered", "ACTIVE", "LAUNCH"));
  await seed(linked("sub_old", "CANCELLED"));
  await seed(linked("sub_pending", "PENDING"));
  const rowOf = async (id: string) =>
    (await repository.execute(subscriptionWrite("update", { id, data: {} }))).data as {
      status: string;
      maxMembers?: number;
    };
  return { service, audit, rowOf, store };
}

describe("given an organization with a live seat plan linked to Stripe", () => {
  describe("when an operator creates another linked one for it as active", () => {
    /** @scenario "Cloud admin refuses a second live Stripe-backed plan for an organization" */
    it("refuses with ops_subscription_already_active naming the live one and writes nothing", async () => {
      const { service, audit } = await cloudAdmin();

      await expect(
        service.execute(
          subscriptionWrite("create", {
            data: {
              organizationId: "org_acme",
              status: "ACTIVE",
              plan: "ENTERPRISE",
              stripeSubscriptionId: "sub_new_stripe",
            },
          }),
        ),
      ).rejects.toMatchObject({
        code: "ops_subscription_already_active",
        meta: { organizationId: "org_acme", activeSubscriptionIds: ["sub_live"] },
      });
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe("when an operator reactivates the cancelled one or activates the pending one", () => {
    /** @scenario "Cloud admin refuses a second live Stripe-backed plan for an organization" */
    it.each(["sub_old", "sub_pending"])("refuses %s and leaves it as it was", async (id) => {
      const { service, rowOf } = await cloudAdmin();
      const before = (await rowOf(id)).status;

      await expect(
        service.execute(subscriptionWrite("update", { id, data: { status: "ACTIVE" } })),
      ).rejects.toMatchObject({
        code: "ops_subscription_already_active",
        meta: { organizationId: "org_acme", activeSubscriptionIds: ["sub_live"] },
      });
      expect((await rowOf(id)).status).toBe(before);
    });

    /** @scenario "Cloud admin refuses a second live Stripe-backed plan for an organization" */
    it("refuses a bulk activation too", async () => {
      const { service } = await cloudAdmin();

      await expect(
        service.execute(
          subscriptionWrite("updateMany", { ids: ["sub_pending"], data: { status: "ACTIVE" } }),
        ),
      ).rejects.toMatchObject({ code: "ops_subscription_already_active" });
    });
  });

  describe("when an operator writes a field the check reads as an operator object", () => {
    /** @scenario "Cloud admin refuses a second live Stripe-backed plan for an organization" */
    it.each([
      { id: "sub_live", data: { organizationId: "org_other", status: { set: "ACTIVE" } } },
      { id: "sub_pending", data: { organizationId: { set: "org_acme" }, status: "ACTIVE" } },
      { id: "sub_tiered", data: { plan: { set: "ENTERPRISE" } } },
      { id: "sub_pending", data: { stripeSubscriptionId: { set: "sub_x" } } },
    ])("refuses %o with validation_error and writes nothing", async ({ id, data }) => {
      const { service, rowOf } = await cloudAdmin();
      const before = await rowOf(id);

      await expect(
        service.execute(subscriptionWrite("update", { id, data })),
      ).rejects.toMatchObject({ code: "validation_error" });
      expect(await rowOf(id)).toEqual(before);
    });
  });

  describe("when an operator sends a bulk edit without explicit ids", () => {
    /** @scenario "A bulk subscription edit that names no rows is refused" */
    it.each([{}, { ids: [] }, { ids: "sub_pending" }, { where: { organizationId: "org_acme" } }])(
      "refuses %o as malformed and writes nothing",
      async (selector) => {
        const { service, rowOf } = await cloudAdmin();

        await expect(
          service.execute(
            subscriptionWrite("updateMany", { ...selector, data: { status: "ACTIVE" } }),
          ),
        ).rejects.toMatchObject({ code: "malformed_request", meta: { field: "ids" } });
        expect((await rowOf("sub_pending")).status).toBe("PENDING");
      },
    );
  });

  describe("when an operator edits the live one's limits", () => {
    /** @scenario "Cloud admin still edits an organization's live plan" */
    it("saves the edit", async () => {
      const { service } = await cloudAdmin();

      const { data } = await service.execute(
        subscriptionWrite("update", {
          id: "sub_live",
          data: { organizationId: "org_acme", status: "ACTIVE", maxMembers: 12 },
        }),
      );

      expect(data).toMatchObject({ id: "sub_live", status: "ACTIVE", maxMembers: 12 });
    });
  });

  describe("when an operator cancels the live one, then activates the pending one", () => {
    /** @scenario "Cloud admin still edits an organization's live plan" */
    it("saves both", async () => {
      const { service, rowOf } = await cloudAdmin();

      await service.execute(
        subscriptionWrite("update", { id: "sub_live", data: { status: "CANCELLED" } }),
      );
      await service.execute(
        subscriptionWrite("update", { id: "sub_pending", data: { status: "ACTIVE" } }),
      );

      expect((await rowOf("sub_pending")).status).toBe("ACTIVE");
      expect((await rowOf("sub_live")).status).toBe("CANCELLED");
    });
  });

  describe("when an operator edits the active tiered plan the seat plan replaces", () => {
    /** @scenario "Cloud admin edits the tiered plan while the seat plan replacing it is live" */
    it("saves the edit, as billing and the index allow both live", async () => {
      const { service, rowOf } = await cloudAdmin();

      await service.execute(
        subscriptionWrite("update", {
          id: "sub_tiered",
          data: { organizationId: "org_acme", status: "ACTIVE", maxMembers: 4 },
        }),
      );

      expect(await rowOf("sub_tiered")).toMatchObject({ status: "ACTIVE", maxMembers: 4 });
    });
  });
});

describe("given an organization whose linked plan lands between the check and the write", () => {
  describe("when an operator creates a second linked active plan for it", () => {
    /** @scenario "The database refuses a second linked live plan the Cloud admin check missed" */
    it("refuses with ops_subscription_already_active naming the plan that landed", async () => {
      const world = await cloudAdmin({
        landsAfterCheck: async (seed) => {
          await seed({ ...linked("sub_raced", "ACTIVE"), organizationId: "org_other" });
        },
      });

      await expect(
        world.service.execute(
          subscriptionWrite("create", {
            data: { ...linked("sub_second", "ACTIVE"), organizationId: "org_other" },
          }),
        ),
      ).rejects.toMatchObject({
        code: "ops_subscription_already_active",
        meta: { organizationId: "org_other", activeSubscriptionIds: ["sub_raced"] },
      });
      expect(world.store.adminRows.get("subscription")?.has("sub_second")).toBe(false);
    });
  });
});

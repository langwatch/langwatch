/**
 * An organization holds one active subscription; the Back office cannot write a second one.
 * @see ../../../../specs/admin.feature
 */
import type { AdminOperationInput } from "@langwatch/ops-contract";
import { describe, expect, it } from "vitest";

import { MemoryInstanceAdminRepository } from "../../repositories/memory/memory.instance-admin.repository.ts";
import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import { InstanceAdminService } from "../instance-admin.service.ts";
import { AuditStub, noOperators } from "./support/admin-doubles.ts";
import { TestUserApi } from "./support/test-user-api.ts";

function subscriptionWrite(
  method: "create" | "update" | "updateMany",
  params: AdminOperationInput["params"],
): AdminOperationInput {
  return { resource: "subscription", method, params, actorId: "olive", req: { headers: {} } };
}

async function instanceAdmin() {
  const repository = MemoryInstanceAdminRepository.create({ store: MemoryOpsStore.create() });
  const audit = new AuditStub();
  const service = InstanceAdminService.create({
    operators: noOperators,
    repository,
    users: new TestUserApi(),
    accounts: {
      deactivateUser: () => Promise.reject(new Error("unreached")),
      changeUserEmail: () => Promise.reject(new Error("unreached")),
    },
    audit,
  });
  const seed = (data: Record<string, unknown>) =>
    repository.execute(subscriptionWrite("create", { data }));
  await seed({
    id: "sub_live",
    organizationId: "org_acme",
    status: "ACTIVE",
    plan: "GROWTH_SEAT_EUR_MONTHLY",
  });
  await seed({ id: "sub_old", organizationId: "org_acme", status: "CANCELLED", plan: "LAUNCH" });
  await seed({
    id: "sub_pending",
    organizationId: "org_acme",
    status: "PENDING",
    plan: "GROWTH_SEAT_EUR_MONTHLY",
  });
  const statusOf = async (id: string) =>
    (
      (await repository.execute(subscriptionWrite("update", { id, data: {} }))).data as {
        status: string;
      }
    ).status;
  return { service, audit, statusOf };
}

describe("given an organization with an active subscription", () => {
  describe("when an operator creates another one for it as active", () => {
    /** @scenario "The Back office refuses a second active subscription for an organization" */
    it("refuses with ops_subscription_already_active naming the live one and writes nothing", async () => {
      const { service, audit } = await instanceAdmin();

      await expect(
        service.execute(
          subscriptionWrite("create", {
            data: { organizationId: "org_acme", status: "ACTIVE", plan: "ENTERPRISE" },
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
    /** @scenario "The Back office refuses a second active subscription for an organization" */
    it.each(["sub_old", "sub_pending"])("refuses %s and leaves it as it was", async (id) => {
      const { service, statusOf } = await instanceAdmin();
      const before = await statusOf(id);

      await expect(
        service.execute(subscriptionWrite("update", { id, data: { status: "ACTIVE" } })),
      ).rejects.toMatchObject({ code: "ops_subscription_already_active" });
      expect(await statusOf(id)).toBe(before);
    });

    /** @scenario "The Back office refuses a second active subscription for an organization" */
    it("refuses a bulk activation too", async () => {
      const { service } = await instanceAdmin();

      await expect(
        service.execute(
          subscriptionWrite("updateMany", { ids: ["sub_pending"], data: { status: "ACTIVE" } }),
        ),
      ).rejects.toMatchObject({ code: "ops_subscription_already_active" });
    });
  });

  describe("when an operator writes status or organization as an operator object", () => {
    /** @scenario "The Back office refuses a second active subscription for an organization" */
    it.each([
      { id: "sub_live", data: { organizationId: "org_other", status: { set: "ACTIVE" } } },
      { id: "sub_pending", data: { organizationId: { set: "org_acme" }, status: "ACTIVE" } },
    ])("refuses %o with validation_error and writes nothing", async ({ id, data }) => {
      const { service, statusOf } = await instanceAdmin();
      const before = await statusOf(id);

      await expect(
        service.execute(subscriptionWrite("update", { id, data })),
      ).rejects.toMatchObject({ code: "validation_error" });
      expect(await statusOf(id)).toBe(before);
    });
  });

  describe("when an operator sends a bulk edit without explicit ids", () => {
    /** @scenario "A bulk subscription edit that names no rows is refused" */
    it.each([{}, { ids: [] }, { ids: "sub_pending" }, { where: { organizationId: "org_acme" } }])(
      "refuses %o as malformed and writes nothing",
      async (selector) => {
        const { service, statusOf } = await instanceAdmin();

        await expect(
          service.execute(
            subscriptionWrite("updateMany", { ...selector, data: { status: "ACTIVE" } }),
          ),
        ).rejects.toMatchObject({ code: "malformed_request", meta: { field: "ids" } });
        expect(await statusOf("sub_pending")).toBe("PENDING");
      },
    );
  });

  describe("when an operator edits the active one's limits", () => {
    /** @scenario "The Back office still edits an organization's one active subscription" */
    it("saves the edit", async () => {
      const { service } = await instanceAdmin();

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
    /** @scenario "The Back office still edits an organization's one active subscription" */
    it("saves both", async () => {
      const { service, statusOf } = await instanceAdmin();

      await service.execute(
        subscriptionWrite("update", { id: "sub_live", data: { status: "CANCELLED" } }),
      );
      await service.execute(
        subscriptionWrite("update", { id: "sub_pending", data: { status: "ACTIVE" } }),
      );

      expect(await statusOf("sub_pending")).toBe("ACTIVE");
      expect(await statusOf("sub_live")).toBe("CANCELLED");
    });
  });
});

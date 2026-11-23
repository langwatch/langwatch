/**
 * @vitest-environment node
 * Who may create, open, edit, reset and archive a member's budget, off the real control plane.
 * @see modules/gateway/specs/gateway-budget-service.feature
 */
import { describe, expect, it } from "vitest";

import {
  BUDGET_ID,
  BUDGET_NOT_FOUND,
  budgetScopedTo,
  gatewayFor,
  type PersonalScope,
  refusalOf,
} from "./support/gateway-budget-visibility.fixture.ts";

describe("gatewayBudgets get, update, archive and reset, a budget scoped to one member", () => {
  const personalBudgets = [
    ["one member", budgetScopedTo({ scopeType: "PRINCIPAL", scopeId: "usr_owner" })],
    ["a personal key", budgetScopedTo({ scopeType: "VIRTUAL_KEY", scopeId: "vk_personal" })],
  ] as const;

  for (const [label, budget] of personalBudgets) {
    describe(`given a budget scoped to ${label}`, () => {
      /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
      it("opens for its owner", async () => {
        const opened = await (await gatewayFor({ caller: "usr_owner", budget })).open();

        expect(opened.id).toBe(BUDGET_ID);
      });

      /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
      it("opens for an organization admin", async () => {
        const opened = await (await gatewayFor({ caller: "usr_admin", budget })).open();

        expect(opened.id).toBe(BUDGET_ID);
      });

      /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
      it("answers a viewer exactly as for a budget that does not exist", async () => {
        const gateway = await gatewayFor({ caller: "usr_viewer", budget });

        const refused = await refusalOf(gateway.open());

        expect(refused).toMatchObject(BUDGET_NOT_FOUND);
        expect(refused).toEqual(await refusalOf(gateway.open("bdg_unknown")));
      });

      /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
      it("answers a viewer's edit and archive exactly as for a budget that does not exist", async () => {
        const gateway = await gatewayFor({ caller: "usr_viewer", budget });

        const renamed = await refusalOf(gateway.rename());
        const archived = await refusalOf(gateway.archive());

        expect(renamed).toMatchObject(BUDGET_NOT_FOUND);
        expect(archived).toMatchObject(BUDGET_NOT_FOUND);
        expect(renamed).toEqual(await refusalOf(gateway.rename("bdg_unknown")));
        expect(archived).toEqual(await refusalOf(gateway.archive("bdg_unknown")));
      });

      /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
      it("lets its owner edit and archive it", async () => {
        const gateway = await gatewayFor({ caller: "usr_owner", budget });

        expect(await gateway.rename()).toMatchObject({ id: BUDGET_ID, name: "renamed" });
        expect((await gateway.archive()).archivedAt).not.toBeNull();
      });

      /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
      it("answers a viewer's reset exactly as for a budget that does not exist", async () => {
        const gateway = await gatewayFor({ caller: "usr_viewer", budget });

        const reset = await refusalOf(gateway.reset());

        expect(reset).toMatchObject(BUDGET_NOT_FOUND);
        expect(reset).toEqual(await refusalOf(gateway.reset("bdg_unknown")));
      });

      /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
      it("lets its owner reset it", async () => {
        const gateway = await gatewayFor({ caller: "usr_owner", budget });

        const reset = await gateway.reset();

        expect(reset.id).toBe(BUDGET_ID);
        expect(reset.lastResetAt).not.toBeNull();
      });
    });
  }

  describe("given a budget scoped to a shared key", () => {
    /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
    it("opens for a viewer", async () => {
      const budget = budgetScopedTo({ scopeType: "VIRTUAL_KEY", scopeId: "vk_shared" });
      const opened = await (await gatewayFor({ caller: "usr_viewer", budget })).open();

      expect(opened.id).toBe(BUDGET_ID);
    });
  });

  describe("given a budget capping each end user of a shared key", () => {
    /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
    it("opens for a viewer, since a key's end users are not members", async () => {
      const budget = budgetScopedTo({ scopeType: "ATTRIBUTED_USER", scopeId: "vk_shared" });
      const opened = await (await gatewayFor({ caller: "usr_viewer", budget })).open();

      expect(opened.id).toBe(BUDGET_ID);
    });
  });
});

describe("gatewayBudgets create, on one member or on a personal key", () => {
  const personalScopes: readonly (readonly [string, PersonalScope, PersonalScope, string])[] = [
    [
      "one member",
      { kind: "PRINCIPAL", principalUserId: "usr_owner" },
      { kind: "PRINCIPAL", principalUserId: "usr_unknown" },
      "gateway_scope_org_mismatch",
    ],
    [
      "a personal key",
      { kind: "VIRTUAL_KEY", virtualKeyId: "vk_personal" },
      { kind: "VIRTUAL_KEY", virtualKeyId: "vk_unknown" },
      "virtual_key_not_found",
    ],
  ];

  for (const [label, scope, absent, code] of personalScopes) {
    describe(`given a budget scoped to ${label}`, () => {
      /** @scenario "A budget on one person or on a personal key is created only by that person and those allowed to see other members' personal keys" */
      it("creates it for its owner", async () => {
        const created = await (await gatewayFor({ caller: "usr_owner" })).create(scope);

        expect(created.scopeType).toBe(scope.kind);
      });

      /** @scenario "A budget on one person or on a personal key is created only by that person and those allowed to see other members' personal keys" */
      it("creates it for an organization admin", async () => {
        const created = await (await gatewayFor({ caller: "usr_admin" })).create(scope);

        expect(created.scopeType).toBe(scope.kind);
      });

      /** @scenario "A budget on one person or on a personal key is created only by that person and those allowed to see other members' personal keys" */
      it("refuses another member exactly as an admin is refused a target that does not exist", async () => {
        const refused = await refusalOf(
          (await gatewayFor({ caller: "usr_member" })).create(scope),
        );
        const absentForAdmin = await refusalOf(
          (await gatewayFor({ caller: "usr_admin" })).create(absent),
        );

        expect(refused).toMatchObject({ data: { error: { code } } });
        expect(refused).toEqual(absentForAdmin);
      });
    });
  }

  describe("given a budget scoped to a shared key", () => {
    /** @scenario "A budget on one person or on a personal key is created only by that person and those allowed to see other members' personal keys" */
    it("creates it for any member allowed to create budgets", async () => {
      const gateway = await gatewayFor({ caller: "usr_member" });

      const created = await gateway.create({ kind: "VIRTUAL_KEY", virtualKeyId: "vk_shared" });

      expect(created.scopeId).toBe("vk_shared");
    });
  });
});

/**
 * @vitest-environment node
 * Who may open, edit and archive a budget scoped to one member, off the real control plane.
 * @see modules/gateway/specs/gateway-budget-service.feature
 */
import { describe, expect, it } from "vitest";

import {
  BUDGET_ID,
  BUDGET_NOT_FOUND,
  budgetScopedTo,
  gatewayFor,
  refusalOf,
} from "./support/gateway-budget-visibility.fixture.ts";

describe("gatewayBudgets get, update and archive, a budget scoped to one member", () => {
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

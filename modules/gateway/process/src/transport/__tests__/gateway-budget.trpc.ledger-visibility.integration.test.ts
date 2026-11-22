/**
 * @vitest-environment node
 * What a budget's detail shows each caller, off the real control plane.
 * @see modules/gateway/specs/gateway-budget-service.feature
 */
import { describe, expect, it } from "vitest";

import {
  BUDGET_NOT_FOUND,
  debitsThrough,
  detailFor,
  gatewayFor,
  refusalOf,
} from "./support/gateway-budget-visibility.fixture.ts";

describe("gatewayBudgets.get, the recent ledger of a budget", () => {
  describe("given a row through a shared key and one through a member's personal key", () => {
    const keys = ["vk_shared", "vk_personal"] as const;

    /** @scenario "Personal-key usage on a budget's detail is visible only to its owner and to those allowed to see other members' personal keys" */
    it("shows the key's owner both rows", async () => {
      const { shown } = await detailFor({ caller: "usr_owner", keys });

      expect(shown).toEqual(["vk_personal", "vk_shared"]);
    });

    /** @scenario "Personal-key usage on a budget's detail is visible only to its owner and to those allowed to see other members' personal keys" */
    it("shows an organization admin both rows, without looking up any creator's account", async () => {
      const { shown, asked, lookedUp } = await detailFor({ caller: "usr_admin", keys });

      expect(shown).toEqual(["vk_personal", "vk_shared"]);
      expect(asked).toEqual(["virtualKeys:viewOtherPersonal"]);
      expect(lookedUp).toEqual([]);
    });

    /** @scenario "Personal-key usage on a budget's detail is visible only to its owner and to those allowed to see other members' personal keys" */
    it("shows another member only the shared key's row", async () => {
      const { shown } = await detailFor({ caller: "usr_member", keys });

      expect(shown).toEqual(["vk_shared"]);
    });

    /** @scenario "Personal-key usage on a budget's detail is visible only to its owner and to those allowed to see other members' personal keys" */
    it("shows a viewer only the shared key's row", async () => {
      const { shown } = await detailFor({ caller: "usr_viewer", keys });

      expect(shown).toEqual(["vk_shared"]);
    });
  });

  describe("given a row through a key whose record is gone", () => {
    /** @scenario "Personal-key usage on a budget's detail is visible only to its owner and to those allowed to see other members' personal keys" */
    it("shows it only to those allowed to see other members' personal keys", async () => {
      const keys = ["vk_shared", "vk_deleted"] as const;

      expect((await detailFor({ caller: "usr_member", keys })).shown).toEqual(["vk_shared"]);
      expect((await detailFor({ caller: "usr_admin", keys })).shown).toEqual([
        "vk_deleted",
        "vk_shared",
      ]);
    });
  });

  describe("given the newest rows all ran through another member's personal key", () => {
    const debits = [
      ...debitsThrough({ key: "vk_personal", count: 25 }),
      ...debitsThrough({ key: "vk_shared", count: 3, minutesAgo: 30 }),
    ];

    /** @scenario "Personal-key usage on a budget's detail is visible only to its owner and to those allowed to see other members' personal keys" */
    it("shows a member the older shared rows instead of an empty list", async () => {
      const { recentLedger } = await (await gatewayFor({ caller: "usr_member", debits })).open();

      expect(recentLedger.map((row) => row.id)).toEqual([
        "req_vk_shared_0",
        "req_vk_shared_1",
        "req_vk_shared_2",
      ]);
    });

    /** @scenario "Personal-key usage on a budget's detail is visible only to its owner and to those allowed to see other members' personal keys" */
    it("still lists no more than the newest 20 rows to a caller who sees them all", async () => {
      const { recentLedger } = await (await gatewayFor({ caller: "usr_admin", debits })).open();

      expect(recentLedger).toHaveLength(20);
      expect(recentLedger.every((row) => row.virtualKeyId === "vk_personal")).toBe(true);
    });
  });

  describe("given a row through a key with no principal whose creator's account is gone", () => {
    const keys = ["vk_shared", "vk_orphaned"] as const;

    /** @scenario "A key with no owner whose creator's account is gone counts as personal on a budget's detail" */
    it("hides it from a member", async () => {
      const { shown, lookedUp } = await detailFor({ caller: "usr_member", keys });

      expect(shown).toEqual(["vk_shared"]);
      expect(lookedUp).toEqual(["usr_admin", "usr_erased"]);
    });

    /** @scenario "A key with no owner whose creator's account is gone counts as personal on a budget's detail" */
    it("still shows it to an organization admin", async () => {
      const { shown } = await detailFor({ caller: "usr_admin", keys });

      expect(shown).toEqual(["vk_orphaned", "vk_shared"]);
    });
  });

  describe("given the account lookup for a key's creator fails", () => {
    /** @scenario "A key with no owner whose creator's account is gone counts as personal on a budget's detail" */
    it("fails the read rather than counting the account as gone", async () => {
      const outage = new Error("the user module did not answer");
      const gateway = await gatewayFor({
        caller: "usr_member",
        debits: debitsThrough({ key: "vk_orphaned" }),
        lookupOutage: outage,
      });

      const refused = await refusalOf(gateway.open());
      const unknown = await refusalOf(gateway.open("bdg_unknown"));

      expect(refused).not.toBeNull();
      expect(unknown).toMatchObject(BUDGET_NOT_FOUND);
      expect(refused).not.toEqual(unknown);
      expect(gateway.lookedUp()).toEqual(["usr_erased"]);
    });
  });

  describe("given a row through a key a project credential created", () => {
    /** @scenario "A key a machine created never counts as personal on a budget's detail" */
    it("shows it to a member without looking up an account for its creator", async () => {
      const { shown, lookedUp } = await detailFor({ caller: "usr_member", keys: ["vk_machine"] });

      expect(shown).toEqual(["vk_machine"]);
      expect(lookedUp).toEqual([]);
    });
  });
});

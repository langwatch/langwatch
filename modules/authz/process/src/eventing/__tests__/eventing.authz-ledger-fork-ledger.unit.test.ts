/**
 * Filtered revocation reads only live grants before enforcing their removal;
 * the grant head is the one every organization writes and decides from.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ACTOR, harness, ORG_ID } from "./support/eventing.authz-ledger-fork.harness.ts";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("given a filtered revoke", () => {
  describe("when it names a principal with Grant-head rows the compat head does not carry", () => {
    /** @scenario "A filtered revoke reaches Grant-head rows with no compat binding" */
    it("revokes live Grant ids without consulting the legacy table", async () => {
      const { writer, db } = harness({});
      db.roleBinding.findMany.mockRejectedValue(new Error("Legacy runtime read"));
      db.grant.findMany.mockResolvedValue([{ id: "grant_compat" }, { id: "grant_no_compat" }]);

      const count = await writer.revokeBindingsWhere({
        organizationId: ORG_ID,
        where: { apiKeyId: "key_1" },
        actor: ACTOR,
        reason: "api key grants replaced",
      });

      expect(db.grant.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_ID,
          principalType: "API_KEY",
          principalId: "key_1",
          revokedAt: null,
        },
        select: { id: true },
      });
      // The synchronous deny (decision 7): a tenant-scoped mark of the
      // authoritative rows, carrying the caller's authored reason.
      expect(count).toBe(2);
      expect(db.grant.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_ID,
          id: { in: ["grant_compat", "grant_no_compat"] },
          revokedAt: null,
        },
        data: expect.objectContaining({
          revokedReason: "api key grants replaced",
        }),
      });
    });
  });

  describe("when it names a principal at one scope", () => {
    /** The invite-replacement and team-removal shape: the scope narrows the
     *  Grant predicate, so a replaced role leaves no live Grant-only row.
     *  @scenario "A filtered revoke reaches Grant-head rows with no compat binding" */
    it("translates the scope onto the Grant predicate and reaches Grant-only rows", async () => {
      const { writer, db } = harness({});
      db.grant.findMany.mockResolvedValue([{ id: "grant_no_compat" }]);

      const count = await writer.revokeBindingsWhere({
        organizationId: ORG_ID,
        where: { userId: "user_1", scopeType: "TEAM", scopeId: "team_1" },
        actor: ACTOR,
        reason: "team role replaced",
      });

      expect(db.grant.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_ID,
          principalType: "USER",
          principalId: "user_1",
          scopeType: "TEAM",
          scopeId: "team_1",
          revokedAt: null,
        },
        select: { id: true },
      });
      expect(count).toBe(1);
    });
  });

  describe("when replacing a key's selected custom roles", () => {
    /** @scenario "A filtered revoke preserves excluded grant ids" */
    it("restricts the revoke to that key, its selected roles, and non-retained ids", async () => {
      const { writer, db } = harness({});
      db.grant.findMany.mockResolvedValue([{ id: "grant_retired" }]);

      const count = await writer.revokeBindingsWhere({
        organizationId: ORG_ID,
        where: {
          apiKeyId: "key_1",
          customRoleId: { in: ["role_1", "role_2"] },
          id: { notIn: ["grant_kept"] },
        },
        actor: ACTOR,
      });

      expect(db.grant.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_ID,
          principalType: "API_KEY",
          principalId: "key_1",
          roleKey: { in: ["custom:role_1", "custom:role_2"] },
          id: { notIn: ["grant_kept"] },
          revokedAt: null,
        },
        select: { id: true },
      });
      expect(count).toBe(1);
      expect(db.grant.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_ID,
          id: { in: ["grant_retired"] },
          revokedAt: null,
        },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      });
    });
  });
});

describe("given a caller that only needs the role retired", () => {
  describe("when the role is deleted without waiting", () => {
    /** @scenario "Retiring the old key's private role does not hold the answer" */
    it("appends the deletion without polling for the row's disappearance", async () => {
      const { writer, db, sent, epoch } = harness({});

      await writer.deleteRole({
        organizationId: ORG_ID,
        roleId: "role_1",
        actor: ACTOR,
        awaitProjection: false,
      });

      expect(sent.map((command) => command.verb)).toEqual(["deleteRole"]);
      expect(db.role.findFirst).not.toHaveBeenCalled();
      expect(epoch.bump).toHaveBeenCalledWith({ organizationId: ORG_ID });
    });
  });
});

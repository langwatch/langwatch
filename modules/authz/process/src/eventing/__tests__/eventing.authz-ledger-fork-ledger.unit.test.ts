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
          scopeType: { not: "PLATFORM" },
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
          scopeType: { not: "PLATFORM" },
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

describe("given an organization's filtered revoke", () => {
  describe("when the filter names no scope tier", () => {
    /** @scenario An organization's filtered revoke never reaches a platform grant */
    it("pins the Grant predicate away from the PLATFORM tier", async () => {
      const { writer, db } = harness({});
      db.grant.findMany.mockResolvedValue([]);

      await writer.revokeBindingsWhere({
        organizationId: ORG_ID,
        where: { userId: "user_1" },
        actor: ACTOR,
      });

      expect(db.grant.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ scopeType: { not: "PLATFORM" } }),
        select: { id: true },
      });
    });
  });

  describe("when it names the platform tenant as its organization", () => {
    /** @scenario An organization's filtered revoke never reaches a platform grant */
    it("is refused before any read", async () => {
      const { writer, db } = harness({});

      await expect(
        writer.revokeBindingsWhere({
          organizationId: "platform",
          where: { userId: "user_1" },
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({
        code: "grant_validation_failed",
        meta: { organizationId: "platform" },
      });
      expect(db.grant.findMany).not.toHaveBeenCalled();
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

describe("given a custom role definition", () => {
  describe("when it adds a platform permission", () => {
    /** @scenario A custom role cannot gain ops permissions */
    it("is refused with platform_permission_not_assignable naming what it added", async () => {
      const { writer, db, sent } = harness({});
      db.role.findFirst.mockResolvedValue({
        name: "Ops",
        description: null,
        permissions: ["project:view"],
      });

      await expect(
        writer.defineRole({
          organizationId: ORG_ID,
          roleId: "role_ops",
          name: "Ops",
          permissions: ["project:view", "ops:view"],
          kind: "custom",
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({
        code: "platform_permission_not_assignable",
        meta: { permissions: ["ops:view"] },
      });
      expect(sent).toEqual([]);
    });
  });

  describe("when a legacy role that already lists ops is renamed", () => {
    /** @scenario A legacy custom role listing ops permissions can still be renamed */
    it("writes the definition, keeping the inert ops entries", async () => {
      const { writer, db, sent } = harness({});
      db.role.findFirst.mockResolvedValue({
        name: "Ops renamed",
        description: null,
        permissions: ["project:view", "ops:view"],
      });

      await writer.defineRole({
        organizationId: ORG_ID,
        roleId: "role_ops",
        name: "Ops renamed",
        permissions: ["project:view", "ops:view"],
        kind: "custom",
        actor: ACTOR,
      });

      expect(sent).toHaveLength(1);
    });
  });

  describe("when an API key's private role lists a platform permission", () => {
    /** @scenario A custom role cannot gain ops permissions */
    it("is written, since the fence leaves it inert", async () => {
      const { writer, db, sent } = harness({});
      db.role.findFirst.mockResolvedValue({
        name: "apikey:key_1",
        description: null,
        permissions: ["ops:view"],
      });

      await writer.defineRole({
        organizationId: ORG_ID,
        roleId: "apikey:key_1",
        name: "apikey:key_1",
        permissions: ["ops:view"],
        kind: "system_api_key",
        actor: ACTOR,
      });

      expect(sent).toHaveLength(1);
    });
  });
});

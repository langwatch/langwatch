/**
 * The grant writer's per-organization fork (ADR-092 decision 4), ledger side.
 *
 * An organization past the genesis import writes through the ledger: a
 * filtered revoke resolves the ids to revoke and hands them to the fold. The
 * legacy side lives in `ledger-write-fork.legacy.unit.test.ts`.
 *
 * @see specs/rbac/authz-grants.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTOR,
  harness,
  ORG_ID,
} from "../support/eventing.authz-ledger-fork.harness";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("given an organization past the genesis import", () => {
  describe("when a filtered revoke names a principal with Grant-head rows the compat head does not carry", () => {
    /** @scenario "A filtered revoke reaches Grant-head rows with no compat binding" */
    it("revokes the union of the compat ids and the translated Grant ids", async () => {
      const { writer, db } = harness({ onLedger: true });
      // The compat head carries one binding; the Grant head carries a second
      // row for the same api key that has no compat binding (a roleKey-only
      // import).
      db.roleBinding.findMany.mockResolvedValue([{ id: "grant_compat" }]);
      db.grant.findMany.mockResolvedValue([
        { id: "grant_compat" },
        { id: "grant_no_compat" },
      ]);

      const count = await writer.revokeBindingsWhere({
        organizationId: ORG_ID,
        where: { apiKeyId: "key_1" },
        actor: ACTOR,
        reason: "api key grants replaced",
      });

      // The Grant head is queried with the translated principal predicate.
      expect(db.grant.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_ID,
          principalType: "API_KEY",
          principalId: "key_1",
        },
        select: { id: true },
      });
      // Both ids are revoked, the shared one only once, via the synchronous
      // deny (decision 7): a tenant-scoped mark of the authoritative rows,
      // carrying the caller's authored reason — the queued write's
      // `revokedAt: null` guard makes this mark the durable audit record.
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

  describe("when a filtered revoke names a principal at one scope", () => {
    /** The invite-replacement and team-removal shape: without the scope
     *  translation these callers revoked only the compat ids, and a migrated
     *  organization kept a live Grant-only row after the role was replaced.
     *  @scenario "A filtered revoke reaches Grant-head rows with no compat binding" */
    it("translates the scope onto the Grant predicate and reaches Grant-only rows", async () => {
      const { writer, db } = harness({ onLedger: true });
      db.roleBinding.findMany.mockResolvedValue([]);
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
        },
        select: { id: true },
      });
      expect(count).toBe(1);
    });
  });

  describe("when the filter shape is outside the translatable vocabulary", () => {
    /** @scenario "A filter the vocabulary cannot translate falls back to the compat ids" */
    it("does not query the Grant head and revokes only the compat ids", async () => {
      const { writer, db } = harness({ onLedger: true });
      db.roleBinding.findMany.mockResolvedValue([{ id: "grant_compat" }]);

      const count = await writer.revokeBindingsWhere({
        organizationId: ORG_ID,
        // `role` is not in the translatable key set: a role filter has no
        // single Grant-head predicate (roleKey vs legacyRole), so the
        // translation bails rather than guessing one.
        where: { role: "ADMIN" },
        actor: ACTOR,
        reason: "role-filtered revoke",
      });

      expect(db.grant.findMany).not.toHaveBeenCalled();
      expect(count).toBe(1);
    });
  });

  describe("when a caller only needs the role retired", () => {
    /** @scenario "Retiring the old key's private role does not hold the answer" */
    it("appends the deletion without polling for the row's disappearance", async () => {
      const { writer, db, sent, epoch } = harness({ onLedger: true });

      await writer.deleteRole({
        organizationId: ORG_ID,
        roleId: "role_1",
        actor: ACTOR,
        awaitProjection: false,
      });

      expect(sent.map((command) => command.verb)).toEqual(["deleteRole"]);
      expect(db.customRole.count).not.toHaveBeenCalled();
      expect(epoch.bump).toHaveBeenCalledWith({ organizationId: ORG_ID });
    });
  });
});

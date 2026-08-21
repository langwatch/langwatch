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

vi.mock("../epoch", () => ({
  bumpAuthzEpoch: vi.fn().mockResolvedValue(undefined),
}));

import { ACTOR, harness, ORG_ID } from "./ledger-write-fork.harness";

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
      // deny (decision 7): a tenant-scoped mark of the authoritative rows.
      expect(count).toBe(2);
      expect(db.grant.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_ID,
          id: { in: ["grant_compat", "grant_no_compat"] },
          revokedAt: null,
        },
        data: expect.objectContaining({ revokedReason: "revocation" }),
      });
    });
  });

  describe("when the filter shape is outside the translatable vocabulary", () => {
    /** @scenario "A filter the vocabulary cannot translate falls back to the compat ids" */
    it("does not query the Grant head and revokes only the compat ids", async () => {
      const { writer, db } = harness({ onLedger: true });
      db.roleBinding.findMany.mockResolvedValue([{ id: "grant_compat" }]);

      const count = await writer.revokeBindingsWhere({
        organizationId: ORG_ID,
        // `scopeType` is not in the translatable key set.
        where: { scopeType: "PROJECT" },
        actor: ACTOR,
        reason: "scoped revoke",
      });

      expect(db.grant.findMany).not.toHaveBeenCalled();
      expect(count).toBe(1);
    });
  });
});

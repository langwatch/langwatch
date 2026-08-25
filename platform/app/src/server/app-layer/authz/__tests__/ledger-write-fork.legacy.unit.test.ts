/**
 * The grant writer's per-organization fork (ADR-092 decision 4), legacy side.
 *
 * An organization whose genesis import has not landed keeps the imperative
 * writes this module replaced — including the audit rows the call sites used
 * to write — and emits nothing, so the deploy is inert until the flip. The
 * ledger side lives in `ledger-write-fork.ledger.unit.test.ts`.
 *
 * @see specs/migration/authz-grants-rollout.feature
 */
import {
  BindingMissingError,
  DuplicateBindingError,
} from "@langwatch/authz-server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoleBindingScopeType, TeamUserRole } from "~/generated/prisma/client";

vi.mock("../epoch", () => ({
  bumpAuthzEpoch: vi.fn().mockResolvedValue(undefined),
}));

import { bumpAuthzEpoch } from "../epoch";
import {
  ACTOR,
  auditRows,
  binding,
  harness,
  legacyRow,
  ORG_ID,
  uniqueViolation,
} from "./ledger-write-fork.harness";

beforeEach(() => {
  vi.mocked(bumpAuthzEpoch).mockClear();
});

describe("given an organization the genesis import has not reached", () => {
  // The legacy table has no column for the date access ends. Writing the row
  // anyway would produce a grant an admin believes ends on Friday and which
  // never ends, so the writer refuses instead of dropping the term.
  describe("when the attached binding carries a date its access ends", () => {
    /** @scenario "An end date is refused where it could not be stored" */
    it("refuses with grant_expiry_not_supported and writes nothing", async () => {
      const { writer, db, sent } = harness({ onLedger: false });

      await expect(
        writer.attachBindings({
          organizationId: ORG_ID,
          bindings: [{ ...binding, expiresAtMs: 1_800_000_000_000 }],
          actor: ACTOR,
          onDuplicate: "reject",
        }),
      ).rejects.toMatchObject({ code: "grant_expiry_not_supported" });

      expect(db.roleBinding.create).not.toHaveBeenCalled();
      expect(db.roleBinding.createMany).not.toHaveBeenCalled();
      expect(db.auditLog.createMany).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
      expect(bumpAuthzEpoch).not.toHaveBeenCalled();
    });

    it("still writes a binding in the same batch that carries no end date", async () => {
      const { writer, db } = harness({ onLedger: false });

      await writer.attachBindings({
        organizationId: ORG_ID,
        bindings: [binding],
        actor: ACTOR,
        onDuplicate: "reject",
      });

      expect(db.roleBinding.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a binding is attached rejecting duplicates", () => {
    /** @scenario "An organization that has not completed the genesis import keeps writing legacy rows imperatively" */
    it("writes the row itself and emits no command", async () => {
      const { writer, db, sent } = harness({ onLedger: false });

      const outcome = await writer.attachBindings({
        organizationId: ORG_ID,
        bindings: [binding],
        actor: ACTOR,
        onDuplicate: "reject",
      });

      expect(sent).toEqual([]);
      expect(db.roleBinding.create).toHaveBeenCalledTimes(1);
      expect(db.roleBinding.create.mock.calls[0]![0].data).toEqual({
        id: "rb_1",
        organizationId: ORG_ID,
        userId: "user_sam",
        groupId: null,
        apiKeyId: null,
        role: TeamUserRole.MEMBER,
        customRoleId: null,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: "team_support",
      });
      expect(outcome).toEqual({ attached: ["rb_1"], duplicates: [] });
      expect(bumpAuthzEpoch).toHaveBeenCalledWith({
        organizationId: ORG_ID,
      });
    });

    /** @scenario "A write on the legacy path still records its audit row" */
    it("records the same audit row the ledger's subscriber would have", async () => {
      const { writer, db } = harness({ onLedger: false });

      await writer.attachBindings({
        organizationId: ORG_ID,
        bindings: [binding],
        actor: ACTOR,
        onDuplicate: "reject",
      });

      expect(auditRows(db)).toEqual([
        {
          createdAt: new Date(1_700_000_000_000),
          userId: "user_admin",
          organizationId: ORG_ID,
          action: "authz.grants.attach",
          metadata: {
            grantId: "rb_1",
            principal: { type: "user", id: "user_sam" },
            roleKey: "member",
            scope: { type: RoleBindingScopeType.TEAM, id: "team_support" },
            source: "grants-service",
          },
        },
      ]);
    });

    it("keeps the duplicate surface the REST contract froze", async () => {
      const { writer, db } = harness({ onLedger: false });
      db.roleBinding.create.mockRejectedValueOnce(uniqueViolation());

      await expect(
        writer.attachBindings({
          organizationId: ORG_ID,
          bindings: [binding],
          actor: ACTOR,
          onDuplicate: "reject",
        }),
      ).rejects.toBeInstanceOf(DuplicateBindingError);
    });

    it("records no audit row for a write that never landed", async () => {
      const { writer, db } = harness({ onLedger: false });
      db.roleBinding.create.mockRejectedValueOnce(uniqueViolation());

      await expect(
        writer.attachBindings({
          organizationId: ORG_ID,
          bindings: [binding],
          actor: ACTOR,
          onDuplicate: "reject",
        }),
      ).rejects.toBeInstanceOf(DuplicateBindingError);
      expect(db.auditLog.createMany).not.toHaveBeenCalled();
    });
  });

  describe("when a batch is attached skipping duplicates", () => {
    /** @scenario "An organization that has not completed the genesis import keeps writing legacy rows imperatively" */
    it("takes createMany's own skipDuplicates, as the batch surfaces always did", async () => {
      const { writer, db, sent } = harness({ onLedger: false });

      await writer.attachBindings({
        organizationId: ORG_ID,
        bindings: [binding],
        actor: ACTOR,
        onDuplicate: "skip",
      });

      expect(sent).toEqual([]);
      expect(db.roleBinding.create).not.toHaveBeenCalled();
      expect(db.roleBinding.createMany).toHaveBeenCalledTimes(1);
      expect(db.roleBinding.createMany.mock.calls[0]![0].skipDuplicates).toBe(
        true,
      );
    });

    it("still answers the duplicates the identity pre-check found", async () => {
      const { writer, db } = harness({ onLedger: false });
      db.roleBinding.findMany.mockResolvedValueOnce([
        { ...legacyRow({ id: "rb_existing" }) },
      ]);

      const outcome = await writer.attachBindings({
        organizationId: ORG_ID,
        bindings: [binding],
        actor: ACTOR,
        onDuplicate: "skip",
      });

      expect(outcome).toEqual({ attached: [], duplicates: ["rb_existing"] });
      expect(db.roleBinding.createMany).not.toHaveBeenCalled();
    });
  });

  describe("when a binding's role changes", () => {
    /** @scenario "An organization that has not completed the genesis import keeps writing legacy rows imperatively" */
    it("updates the row itself and emits no command", async () => {
      const { writer, db, sent } = harness({ onLedger: false });
      db.roleBinding.findFirst
        .mockResolvedValueOnce(legacyRow({ id: "rb_1" }))
        .mockResolvedValueOnce(null);

      await writer.changeBindingRole({
        organizationId: ORG_ID,
        bindingId: "rb_1",
        role: TeamUserRole.ADMIN,
        customRoleId: null,
        actor: ACTOR,
      });

      expect(sent).toEqual([]);
      expect(db.roleBinding.updateMany).toHaveBeenCalledWith({
        where: { id: "rb_1", organizationId: ORG_ID },
        data: { role: TeamUserRole.ADMIN, customRoleId: null },
      });
      expect(auditRows(db)).toMatchObject([
        {
          action: "authz.grants.role_change",
          metadata: { grantId: "rb_1", from: "member", to: "admin" },
        },
      ]);
    });

    it("keeps the duplicate-role refusal", async () => {
      const { writer, db } = harness({ onLedger: false });
      db.roleBinding.findFirst
        .mockResolvedValueOnce(legacyRow({ id: "rb_1" }))
        .mockResolvedValueOnce(null);
      db.roleBinding.updateMany.mockRejectedValueOnce(uniqueViolation());

      await expect(
        writer.changeBindingRole({
          organizationId: ORG_ID,
          bindingId: "rb_1",
          role: TeamUserRole.ADMIN,
          customRoleId: null,
          actor: ACTOR,
        }),
      ).rejects.toBeInstanceOf(DuplicateBindingError);
    });

    /** `updateMany` never throws Prisma's not-found the way a singular
     *  `update` does — a row gone between the pre-read and here now shows up
     *  as a zero-match count instead. */
    it("keeps the missing-binding refusal when the row is gone by the time of the write", async () => {
      const { writer, db } = harness({ onLedger: false });
      db.roleBinding.findFirst
        .mockResolvedValueOnce(legacyRow({ id: "rb_1" }))
        .mockResolvedValueOnce(null);
      db.roleBinding.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        writer.changeBindingRole({
          organizationId: ORG_ID,
          bindingId: "rb_1",
          role: TeamUserRole.ADMIN,
          customRoleId: null,
          actor: ACTOR,
        }),
      ).rejects.toBeInstanceOf(BindingMissingError);
    });
  });

  describe("when bindings are revoked", () => {
    /** @scenario "An organization that has not completed the genesis import keeps writing legacy rows imperatively" */
    it("deletes the rows itself, which IS the instant enforcement", async () => {
      const { writer, db, sent } = harness({ onLedger: false });

      await writer.revokeBindings({
        organizationId: ORG_ID,
        bindingIds: ["rb_1", "rb_2"],
        actor: ACTOR,
        reason: "seat removed",
      });

      expect(sent).toEqual([]);
      expect(db.grant.deleteMany).not.toHaveBeenCalled();
      expect(db.roleBinding.deleteMany).toHaveBeenCalledWith({
        where: { organizationId: ORG_ID, id: { in: ["rb_1", "rb_2"] } },
      });
      expect(auditRows(db)).toMatchObject([
        {
          action: "authz.grants.revoke",
          metadata: { grantId: "rb_1", reason: "seat removed" },
        },
        {
          action: "authz.grants.revoke",
          metadata: { grantId: "rb_2", reason: "seat removed" },
        },
      ]);
    });

    /**
     * ONE statement, not a read then a delete-by-ids: there is no fold on
     * this fork to sweep a row that lands in the gap between the two, so the
     * single `deleteMany(where)` is what has to catch it.
     */
    it("revokes a filtered set through the same fork", async () => {
      const { writer, db, sent } = harness({ onLedger: false });
      db.roleBinding.deleteMany.mockResolvedValueOnce({ count: 2 });

      const count = await writer.revokeBindingsWhere({
        organizationId: ORG_ID,
        where: { apiKeyId: "key_1" },
        actor: ACTOR,
      });

      expect(count).toBe(2);
      expect(sent).toEqual([]);
      expect(db.roleBinding.findMany).not.toHaveBeenCalled();
      expect(db.roleBinding.deleteMany).toHaveBeenCalledWith({
        where: { apiKeyId: "key_1", organizationId: ORG_ID },
      });
    });

    it("records no audit row when the filter matched nothing", async () => {
      const { writer, db } = harness({ onLedger: false });

      await writer.revokeBindingsWhere({
        organizationId: ORG_ID,
        where: { apiKeyId: "key_1" },
        actor: ACTOR,
      });

      expect(db.auditLog.createMany).not.toHaveBeenCalled();
    });
  });

  describe("when a RESOURCE grant is revoked", () => {
    /**
     * The one revocation verb that ignores this fork entirely. Were the
     * gate's `false` honored here, the "revocation" would delete only the
     * `RoleBinding` row: no fact appended, the `Grant` head still holding a
     * live grant, and the share link still resolving. Revocation must never
     * come undone, so the fact appends and enforcement runs whichever way
     * the gate answers.
     */
    it("appends the fact even when the write gate answers legacy", async () => {
      const { writer, db, sent } = harness({ onLedger: false });

      await writer.revokeResourceGrants({
        organizationId: ORG_ID,
        grantIds: ["share_1"],
        actor: ACTOR,
      });

      expect(sent).toHaveLength(1);
      expect(sent[0]!.verb).toBe("revokeGrant");
      expect(sent[0]!.data).toMatchObject({ grantId: "share_1" });
      // Enforcement, not the legacy imperative branch: the row is MARKED
      // (the legacy branch never touches the Grant head at all), and no
      // legacy audit row is written - the fact IS the audit trail here.
      expect(db.grant.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_ID,
          id: { in: ["share_1"] },
          revokedAt: null,
        },
        // null, not a placeholder: the caller gave no reason and the mark
        // writes only authored facts — the bypass label lives in telemetry.
        data: { revokedAt: expect.any(Date), revokedReason: null },
      });
      expect(db.auditLog.createMany).not.toHaveBeenCalled();
    });
  });

  describe("when a member is offboarded", () => {
    /** @scenario "An organization that has not completed the genesis import keeps writing legacy rows imperatively" */
    it("deletes the member's grant rows and leaves membership to the caller", async () => {
      const { writer, db, sent } = harness({ onLedger: false });

      await writer.offboardMember({
        organizationId: ORG_ID,
        userId: "user_sam",
        revokedGrantIds: ["rb_1"],
        actor: ACTOR,
      });

      expect(sent).toEqual([]);
      expect(db.roleBinding.deleteMany).toHaveBeenCalledWith({
        where: { organizationId: ORG_ID, id: { in: ["rb_1"] } },
      });
      // `revoke`, not an `offboard` verb of its own: offboarding is N
      // revocations sharing one reason on both heads (ADR-110), so a verb
      // only the legacy side wrote would make the two heads' audit trails
      // disagree about the same operation. The departing user is still named
      // in the metadata, which is what an operator searches on.
      expect(auditRows(db)).toMatchObject([
        {
          action: "authz.grants.revoke",
          metadata: { userId: "user_sam", revokedGrantIds: ["rb_1"] },
        },
      ]);
    });
  });

  describe("when a role is defined", () => {
    /** @scenario "An organization that has not completed the genesis import keeps writing legacy rows imperatively" */
    it("upserts the role row, keeping the editor's create and update semantics", async () => {
      const { writer, db, sent } = harness({ onLedger: false });

      await writer.defineRole({
        organizationId: ORG_ID,
        roleId: "role_1",
        name: "Auditor",
        permissions: ["traces:read"],
        kind: "custom",
        actor: ACTOR,
      });

      expect(sent).toEqual([]);
      expect(db.customRole.upsert).toHaveBeenCalledWith({
        where: { id: "role_1", organizationId: ORG_ID },
        create: {
          id: "role_1",
          organizationId: ORG_ID,
          name: "Auditor",
          description: null,
          permissions: ["traces:read"],
          kind: "custom",
        },
        update: {
          name: "Auditor",
          description: null,
          permissions: ["traces:read"],
          kind: "custom",
        },
      });
      expect(auditRows(db)).toMatchObject([
        {
          action: "authz.grants.role_defined",
          metadata: {
            roleId: "role_1",
            name: "Auditor",
            permissions: ["traces:read"],
            kind: "custom",
          },
        },
      ]);
    });

    /**
     * The service layer's `assertNameFree` is advisory (a read ahead of the
     * append, not inside it), so two concurrent renames can both pass it and
     * race for the same `(organizationId, name)` unique index here. The
     * loser must still get the deterministic conflict, not a raw Prisma
     * error degrading to an unknown 500.
     */
    it("maps a concurrent name collision onto the deterministic conflict", async () => {
      const { writer, db } = harness({ onLedger: false });
      db.customRole.upsert.mockRejectedValueOnce(uniqueViolation());

      await expect(
        writer.defineRole({
          organizationId: ORG_ID,
          roleId: "role_1",
          name: "Auditor",
          permissions: ["traces:read"],
          kind: "custom",
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ code: "custom_role_name_taken" });
      expect(db.auditLog.createMany).not.toHaveBeenCalled();
    });
  });

  describe("when a role is deleted", () => {
    /** @scenario "An organization that has not completed the genesis import keeps writing legacy rows imperatively" */
    it("deletes it scoped to the organization and emits no command", async () => {
      const { writer, db, sent } = harness({ onLedger: false });

      await writer.deleteRole({
        organizationId: ORG_ID,
        roleId: "role_1",
        actor: ACTOR,
      });

      expect(sent).toEqual([]);
      expect(db.customRole.deleteMany).toHaveBeenCalledWith({
        where: { id: "role_1", organizationId: ORG_ID },
      });
      expect(auditRows(db)).toMatchObject([
        {
          action: "authz.grants.role_deleted",
          metadata: { roleId: "role_1" },
        },
      ]);
    });
  });

  describe("when the audit insert fails", () => {
    it("leaves the grant write successful, as the separate audit write always was", async () => {
      const { writer, db } = harness({ onLedger: false });
      db.auditLog.createMany.mockRejectedValueOnce(new Error("audit is down"));

      await expect(
        writer.attachBindings({
          organizationId: ORG_ID,
          bindings: [binding],
          actor: ACTOR,
          onDuplicate: "reject",
        }),
      ).resolves.toEqual({ attached: ["rb_1"], duplicates: [] });
      expect(bumpAuthzEpoch).toHaveBeenCalled();
    });
  });

  describe("when the write is a read-through mint", () => {
    it("writes no audit row, the same guard the subscriber applies", async () => {
      const { writer, db } = harness({ onLedger: false });

      await writer.attachBindings({
        organizationId: ORG_ID,
        bindings: [binding],
        actor: { type: "system", id: "system:read-through-mint" },
        source: "read-through-mint",
        onDuplicate: "skip",
      });

      expect(db.auditLog.createMany).not.toHaveBeenCalled();
    });
  });
});

describe("given a batch of bindings to attach", () => {
  describe("when the identity pre-check runs", () => {
    it("asks storage once for the whole batch, not once per binding", async () => {
      const { writer, db } = harness({ onLedger: false });

      await writer.attachBindings({
        organizationId: ORG_ID,
        bindings: [
          binding,
          { ...binding, bindingId: "rb_2", scopeId: "team_billing" },
          { ...binding, bindingId: "rb_3", scopeId: "team_ops" },
        ],
        actor: ACTOR,
        onDuplicate: "skip",
      });

      expect(db.roleBinding.findMany).toHaveBeenCalledTimes(1);
      expect(db.roleBinding.findFirst).not.toHaveBeenCalled();
    });

    it("matches each answer back to the binding that owns its identity", async () => {
      const { writer, db } = harness({ onLedger: false });
      db.roleBinding.findMany.mockResolvedValueOnce([
        { ...legacyRow({ id: "rb_existing" }), scopeId: "team_billing" },
      ]);

      const outcome = await writer.attachBindings({
        organizationId: ORG_ID,
        bindings: [
          binding,
          { ...binding, bindingId: "rb_2", scopeId: "team_billing" },
        ],
        actor: ACTOR,
        onDuplicate: "skip",
      });

      expect(outcome).toEqual({
        attached: ["rb_1"],
        duplicates: ["rb_existing"],
      });
    });

    it("counts a repeat inside the same batch as a duplicate of itself", async () => {
      const { writer } = harness({ onLedger: false });

      const outcome = await writer.attachBindings({
        organizationId: ORG_ID,
        bindings: [binding, { ...binding, bindingId: "rb_2" }],
        actor: ACTOR,
        onDuplicate: "skip",
      });

      expect(outcome).toEqual({ attached: ["rb_1"], duplicates: ["rb_2"] });
    });
  });
});

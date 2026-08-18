/**
 * The grant writer's per-organization fork (ADR-092 decision 4), ledger side.
 *
 * An organization past its genesis import emits commands and writes no grant
 * table itself; the flip back is an ops action rather than a release. The
 * legacy side lives in `ledger-write-fork.legacy.unit.test.ts`.
 *
 * @see specs/rbac/in-place-authz-migration.feature
 */
import { describe, expect, it, vi } from "vitest";
import { RoleBindingScopeType, TeamUserRole } from "~/generated/prisma/client";

vi.mock("../epoch", () => ({
  bumpAuthzEpoch: vi.fn().mockResolvedValue(undefined),
}));

import { bumpAuthzEpoch } from "../epoch";
import {
  ACTOR,
  binding,
  harness,
  legacyRow,
  ORG_ID,
} from "./ledger-write-fork.harness";

describe("given a revocation named by filter", () => {
  describe("when the filter names no organization", () => {
    it("refuses rather than running across tenants", async () => {
      const { writer } = harness({ onLedger: true });

      await expect(
        writer.revokeBindingsWhere({
          organizationId: "",
          where: { apiKeyId: "key_1" },
          actor: ACTOR,
        }),
      ).rejects.toThrow(/no organization/);
    });
  });

  describe("when the filter names a principal at one scope", () => {
    /** @scenario "Completing the genesis import moves an organization's writes onto the ledger" */
    it("carries the identity onto the event, so the fold sweeps what the projection had not seen", async () => {
      const { writer, db, sent } = harness({ onLedger: true });
      db.roleBinding.findMany.mockResolvedValueOnce([{ id: "rb_7" }]);

      await writer.revokeBindingsWhere({
        organizationId: ORG_ID,
        where: {
          userId: "user_sam",
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: "team_support",
        },
        actor: ACTOR,
      });

      expect(sent).toHaveLength(1);
      expect((sent[0]!.data as { revocations: unknown[] }).revocations).toEqual(
        [
          {
            grantId: "rb_7",
            selector: {
              principal: { type: "user", id: "user_sam" },
              scope: { type: "TEAM", id: "team_support" },
            },
          },
        ],
      );
    });

    it("still appends when the lagging projection matched nothing at all", async () => {
      const { writer, sent } = harness({ onLedger: true });

      const revoked = await writer.revokeBindingsWhere({
        organizationId: ORG_ID,
        where: { apiKeyId: "key_1" },
        actor: ACTOR,
      });

      expect(revoked).toBe(0);
      expect((sent[0]!.data as { revocations: unknown[] }).revocations).toEqual(
        [{ selector: { principal: { type: "api_key", id: "key_1" } } }],
      );
    });
  });

  describe("when the filter is one no selector can express", () => {
    it("revokes the ids alone, exactly as it did before", async () => {
      const { writer, db, sent } = harness({ onLedger: true });
      db.roleBinding.findMany.mockResolvedValueOnce([{ id: "rb_7" }]);

      await writer.revokeBindingsWhere({
        organizationId: ORG_ID,
        where: { customRoleId: "role_1" },
        actor: ACTOR,
      });

      expect((sent[0]!.data as { revocations: unknown[] }).revocations).toEqual(
        [{ grantId: "rb_7" }],
      );
    });

    it("appends nothing when such a filter matched nothing", async () => {
      const { writer, sent } = harness({ onLedger: true });

      await writer.revokeBindingsWhere({
        organizationId: ORG_ID,
        where: { customRoleId: "role_1" },
        actor: ACTOR,
      });

      expect(sent).toEqual([]);
    });
  });
});

describe("given an organization whose genesis import has landed", () => {
  /** The fold writes the compat row `CustomRole`; `Role` is the future head
   *  and lands in the same `store()`, so polling it would return before the
   *  row every consumer actually reads exists. */
  it("waits for the compat role row before returning from a role definition", async () => {
    const { writer, db } = harness({ onLedger: true });
    db.customRole.findFirst.mockResolvedValue({
      name: "Auditor",
      permissions: ["traces:read"],
    });

    await writer.defineRole({
      organizationId: ORG_ID,
      roleId: "role_1",
      name: "Auditor",
      permissions: ["traces:read"],
      kind: "custom",
      actor: ACTOR,
    });

    expect(db.customRole.findFirst).toHaveBeenCalledWith({
      where: { id: "role_1", organizationId: ORG_ID },
      select: { name: true, permissions: true },
    });
    expect(db.role.findFirst).not.toHaveBeenCalled();
  });

  /** @scenario "Completing the genesis import moves an organization's writes onto the ledger" */
  it("emits the attach command and writes no binding row of its own", async () => {
    const { writer, db, sent } = harness({ onLedger: true });

    await writer.attachBindings({
      organizationId: ORG_ID,
      bindings: [binding],
      actor: ACTOR,
      onDuplicate: "reject",
      awaitProjection: false,
    });

    expect(sent.map((command) => command.verb)).toEqual(["attachGrants"]);
    expect(db.roleBinding.create).not.toHaveBeenCalled();
    expect(db.roleBinding.createMany).not.toHaveBeenCalled();
    expect(db.auditLog.createMany).not.toHaveBeenCalled();
    // The epoch bump is what invalidates cached permission decisions; the
    // ledger path must bump it just as the legacy path does.
    expect(bumpAuthzEpoch).toHaveBeenCalledWith({ organizationId: ORG_ID });
  });

  /** @scenario "Completing the genesis import moves an organization's writes onto the ledger" */
  it("emits the role change carrying both role keys and the grant's own identity", async () => {
    const { writer, db, sent } = harness({ onLedger: true });
    db.roleBinding.findFirst
      // The binding being changed...
      .mockResolvedValueOnce(legacyRow({ id: "rb_1" }))
      // ...no sibling already holding the target role at that scope...
      .mockResolvedValueOnce(null)
      // ...and the compat row the fold landed, which is what the
      // read-your-writes poll is looking for.
      .mockResolvedValueOnce({
        role: TeamUserRole.ADMIN,
        customRoleId: null,
      });

    await writer.changeBindingRole({
      organizationId: ORG_ID,
      bindingId: "rb_1",
      role: TeamUserRole.ADMIN,
      customRoleId: null,
      actor: ACTOR,
    });

    expect(sent.map((command) => command.verb)).toEqual(["changeGrantRole"]);
    expect(sent[0]!.data).toEqual({
      tenantId: ORG_ID,
      organizationId: ORG_ID,
      commandId: expect.any(String),
      grantId: "rb_1",
      from: "member",
      to: "admin",
      actor: ACTOR,
      occurredAtMs: 1_700_000_000_000,
    });
    expect(db.roleBinding.update).not.toHaveBeenCalled();
    expect(db.auditLog.createMany).not.toHaveBeenCalled();
  });

  /** A change onto a custom role speaks the `custom:<id>` key, which is the
   *  only vocabulary the ledger has for one. */
  it("names a custom role by its id rather than by the enum it replaces", async () => {
    const { writer, db, sent } = harness({ onLedger: true });
    db.roleBinding.findFirst
      .mockResolvedValueOnce(legacyRow({ id: "rb_1" }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        role: TeamUserRole.CUSTOM,
        customRoleId: "role_auditor",
      });

    await writer.changeBindingRole({
      organizationId: ORG_ID,
      bindingId: "rb_1",
      role: TeamUserRole.CUSTOM,
      customRoleId: "role_auditor",
      actor: ACTOR,
    });

    expect(sent[0]!.data).toMatchObject({
      grantId: "rb_1",
      from: "member",
      to: "custom:role_auditor",
    });
  });

  /** @scenario "Completing the genesis import moves an organization's writes onto the ledger" */
  it("emits the revoke command and enforces through the projection repository", async () => {
    const { writer, db, sent } = harness({ onLedger: true });

    await writer.revokeBindings({
      organizationId: ORG_ID,
      bindingIds: ["rb_1"],
      actor: ACTOR,
    });

    expect(sent.map((command) => command.verb)).toEqual(["revokeGrants"]);
    expect(db.grant.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.auditLog.createMany).not.toHaveBeenCalled();
  });

  /** @scenario "Completing the genesis import moves an organization's writes onto the ledger" */
  it("emits the role verbs and writes neither role table row itself", async () => {
    const { writer, db, sent } = harness({ onLedger: true });

    await writer.defineRole({
      organizationId: ORG_ID,
      roleId: "role_1",
      name: "Auditor",
      permissions: ["traces:read"],
      kind: "custom",
      actor: ACTOR,
    });
    await writer.deleteRole({
      organizationId: ORG_ID,
      roleId: "role_1",
      actor: ACTOR,
    });

    expect(sent.map((command) => command.verb)).toEqual([
      "defineRoles",
      "deleteRole",
    ]);
    expect(db.customRole.upsert).not.toHaveBeenCalled();
    expect(db.customRole.deleteMany).not.toHaveBeenCalled();
    expect(db.auditLog.createMany).not.toHaveBeenCalled();
  });

  /** @scenario "Completing the genesis import moves an organization's writes onto the ledger" */
  it("emits the offboard command and deletes no binding row itself", async () => {
    const { writer, db, sent } = harness({ onLedger: true });

    await writer.offboardMember({
      organizationId: ORG_ID,
      userId: "user_sam",
      revokedGrantIds: ["rb_1"],
      actor: ACTOR,
    });

    expect(sent.map((command) => command.verb)).toEqual(["offboardMember"]);
    // The row deletes here are decision 7's synchronous enforcement, through
    // the projection repository - not the writer authoring a grant table.
    expect(db.grant.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.auditLog.createMany).not.toHaveBeenCalled();
  });
});

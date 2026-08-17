/**
 * The grant writer's per-organization fork (ADR-092 decision 4).
 *
 * One organization at a time, never all at once: an organization whose
 * genesis import has not landed keeps the imperative writes this module
 * replaced — including the audit rows the call sites used to write — and
 * emits nothing; an organization past its import emits commands and writes no
 * grant table itself. The deploy is inert until the flip, and the flip back
 * is an ops action rather than a release.
 *
 * @see specs/rbac/in-place-authz-migration.feature
 */
import {
  BindingMissingError,
  DuplicateBindingError,
} from "@langwatch/authz-server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Prisma,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import {
  type AuthzGrantsCommandSenders,
  GrantsLedgerWriter,
  type LedgerActor,
} from "../ledger";

vi.mock("../epoch", () => ({
  bumpAuthzEpoch: vi.fn().mockResolvedValue(undefined),
}));

import { bumpAuthzEpoch } from "../epoch";

const ORG_ID = "org_fork";
const ACTOR: LedgerActor = { type: "user", id: "user_admin" };

const COMMAND_VERBS = [
  "attachGrants",
  "changeGrantRole",
  "revokeGrants",
  "defineRoles",
  "deleteRole",
  "offboardMember",
  "proveMigrationParity",
  "completeCutover",
  "rollBackCutover",
  "recordMigrationTenantState",
] as const;

function uniqueViolation(): Error {
  return new Prisma.PrismaClientKnownRequestError("duplicate", {
    code: "P2002",
    clientVersion: "test",
  });
}

function recordNotFound(): Error {
  return new Prisma.PrismaClientKnownRequestError("missing", {
    code: "P2025",
    clientVersion: "test",
  });
}

function harness({ onLedger }: { onLedger: boolean }) {
  const sent: Array<{ verb: string; data: unknown }> = [];
  const db = {
    roleBinding: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue(undefined),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    customRole: {
      upsert: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
    role: { findFirst: vi.fn().mockResolvedValue(null) },
    grant: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const writer = new GrantsLedgerWriter(db as unknown as PrismaClient, {
    onLedgerWrites: async () => onLedger,
    now: () => 1_700_000_000_000,
    poll: { intervalMs: 0, timeoutMs: 0 },
    commands: async () => ({
      commands: Object.fromEntries(
        COMMAND_VERBS.map((verb) => [
          verb,
          {
            send: async (data: unknown) => {
              sent.push({ verb, data });
            },
          },
        ]),
      ) as unknown as AuthzGrantsCommandSenders,
    }),
  });
  return { writer, db, sent };
}

const binding = {
  bindingId: "rb_1",
  principal: { userId: "user_sam" },
  role: TeamUserRole.MEMBER,
  customRoleId: null,
  scopeType: RoleBindingScopeType.TEAM,
  scopeId: "team_support",
};

/** The audit rows one call produced, as the row-building vocabulary shapes them. */
function auditRows(
  db: ReturnType<typeof harness>["db"],
): Record<string, unknown>[] {
  return db.auditLog.createMany.mock.calls[0]![0].data;
}

beforeEach(() => {
  vi.mocked(bumpAuthzEpoch).mockClear();
});

describe("given an organization the genesis import has not reached", () => {
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
      db.roleBinding.findFirst.mockResolvedValueOnce({ id: "rb_existing" });

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
        .mockResolvedValueOnce({
          id: "rb_1",
          organizationId: ORG_ID,
          userId: "user_sam",
          groupId: null,
          apiKeyId: null,
          role: TeamUserRole.MEMBER,
          customRoleId: null,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: "team_support",
        })
        .mockResolvedValueOnce(null);

      await writer.changeBindingRole({
        organizationId: ORG_ID,
        bindingId: "rb_1",
        role: TeamUserRole.ADMIN,
        customRoleId: null,
        actor: ACTOR,
      });

      expect(sent).toEqual([]);
      expect(db.roleBinding.update).toHaveBeenCalledWith({
        where: { id: "rb_1" },
        data: { role: TeamUserRole.ADMIN, customRoleId: null },
      });
      expect(auditRows(db)).toMatchObject([
        {
          action: "authz.grants.role_change",
          metadata: { grantId: "rb_1", from: "member", to: "admin" },
        },
      ]);
    });

    it("keeps both knowable database refusals", async () => {
      for (const [error, expected] of [
        [uniqueViolation(), DuplicateBindingError],
        [recordNotFound(), BindingMissingError],
      ] as const) {
        const { writer, db } = harness({ onLedger: false });
        db.roleBinding.findFirst
          .mockResolvedValueOnce({
            id: "rb_1",
            organizationId: ORG_ID,
            userId: "user_sam",
            groupId: null,
            apiKeyId: null,
            role: TeamUserRole.MEMBER,
            customRoleId: null,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: "team_support",
          })
          .mockResolvedValueOnce(null);
        db.roleBinding.update.mockRejectedValueOnce(error);

        await expect(
          writer.changeBindingRole({
            organizationId: ORG_ID,
            bindingId: "rb_1",
            role: TeamUserRole.ADMIN,
            customRoleId: null,
            actor: ACTOR,
          }),
        ).rejects.toBeInstanceOf(expected);
      }
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

    it("revokes a filtered set through the same fork", async () => {
      const { writer, db, sent } = harness({ onLedger: false });
      db.roleBinding.findMany.mockResolvedValueOnce([
        { id: "rb_7" },
        { id: "rb_8" },
      ]);

      const count = await writer.revokeBindingsWhere({
        organizationId: ORG_ID,
        where: { apiKeyId: "key_1" },
        actor: ACTOR,
      });

      expect(count).toBe(2);
      expect(sent).toEqual([]);
      expect(db.roleBinding.deleteMany).toHaveBeenCalledWith({
        where: { organizationId: ORG_ID, id: { in: ["rb_7", "rb_8"] } },
      });
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
      expect(auditRows(db)).toMatchObject([
        {
          action: "authz.grants.offboard",
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

describe("given an organization whose genesis import has landed", () => {
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

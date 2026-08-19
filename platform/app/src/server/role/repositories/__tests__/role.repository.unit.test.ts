/**
 * The role name pre-check (ADR-092 §13).
 *
 * A role definition is a ledger command now, so the `(organizationId, name)`
 * unique index can no longer be what refuses a duplicate: the fold, not the
 * caller, writes the row, and a constraint failure there parks the
 * organization's projection lane instead of answering the person who typed
 * the name. `assertNameFree` is the read that moved that refusal back in
 * front of the append, and these are its semantics.
 */
import type { LedgerActor } from "@langwatch/authz-server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import type { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import { RoleRepository } from "../role.repository";

const ORG_ID = "org_acme";
const ACTOR: LedgerActor = { type: "user", id: "user_admin" };

function harness() {
  const db = {
    customRole: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  };
  const writer = {
    defineRole: vi.fn().mockResolvedValue(undefined),
    deleteRole: vi.fn().mockResolvedValue(undefined),
  };
  const repository = new RoleRepository(
    db as unknown as PrismaClient,
    writer as unknown as GrantsLedgerWriter,
  );
  return { db, writer, repository };
}

/** The row `update()` reads back before restating the whole fact. */
function storedRole(overrides: Record<string, unknown> = {}) {
  return {
    id: "role_1",
    organizationId: ORG_ID,
    name: "Auditor",
    description: null,
    permissions: ["traces:read"],
    kind: "custom",
    createdAt: new Date(1_700_000_000_000),
    updatedAt: new Date(1_700_000_000_000),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("given a role being created", () => {
  describe("when no role in the organization holds the name", () => {
    it("emits the definition", async () => {
      const { repository, writer } = harness();

      const created = await repository.create(
        {
          organizationId: ORG_ID,
          name: "Auditor",
          permissions: ["traces:read"],
        },
        { actor: ACTOR },
      );

      expect(writer.defineRole).toHaveBeenCalledTimes(1);
      expect(writer.defineRole.mock.calls[0]![0]).toMatchObject({
        organizationId: ORG_ID,
        roleId: created.id,
        name: "Auditor",
        permissions: ["traces:read"],
        kind: "custom",
      });
    });

    it("asks the organization's own natural key, with the name exactly as written", async () => {
      const { repository, db } = harness();

      await repository.create(
        {
          organizationId: ORG_ID,
          name: "Data Auditor",
          permissions: ["traces:read"],
        },
        { actor: ACTOR },
      );

      // Scoped and unnormalized: the lookup is the compound unique itself, so
      // another organization's identically named role is never consulted, and
      // a name differing only in case is a different name — the same answer
      // the index would have given.
      expect(db.customRole.findUnique).toHaveBeenCalledWith({
        where: {
          organizationId_name: {
            organizationId: ORG_ID,
            name: "Data Auditor",
          },
        },
        select: { id: true },
      });
    });
  });

  describe("when another role already holds the name", () => {
    it("refuses before the append, naming the conflict", async () => {
      const { repository, db, writer } = harness();
      db.customRole.findUnique.mockResolvedValue({ id: "role_existing" });

      await expect(
        repository.create(
          {
            organizationId: ORG_ID,
            name: "Auditor",
            permissions: ["traces:read"],
          },
          { actor: ACTOR },
        ),
      ).rejects.toMatchObject({ code: "custom_role_name_taken" });

      expect(writer.defineRole).not.toHaveBeenCalled();
    });
  });
});

describe("given a role being redefined", () => {
  describe("when the name is left as it was", () => {
    it("does not look for a collision at all, so a role never blocks itself", async () => {
      const { repository, db, writer } = harness();
      db.customRole.findUnique.mockResolvedValueOnce(storedRole());

      await repository.update(
        "role_1",
        { permissions: ["traces:read", "traces:write"] },
        { actor: ACTOR },
      );

      // One read only: the role itself. The natural-key lookup never ran.
      expect(db.customRole.findUnique).toHaveBeenCalledTimes(1);
      expect(writer.defineRole).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the renamed-to name is held by a different role", () => {
    it("refuses before the append, naming the conflict", async () => {
      const { repository, db, writer } = harness();
      db.customRole.findUnique
        .mockResolvedValueOnce(storedRole())
        .mockResolvedValueOnce({ id: "role_other" });

      await expect(
        repository.update("role_1", { name: "Reviewer" }, { actor: ACTOR }),
      ).rejects.toMatchObject({ code: "custom_role_name_taken" });

      expect(writer.defineRole).not.toHaveBeenCalled();
    });
  });

  describe("when the only holder of the name is the role being renamed", () => {
    it("lets it through", async () => {
      const { repository, db, writer } = harness();
      db.customRole.findUnique
        .mockResolvedValueOnce(storedRole())
        // A row still carrying the old name under this id — what a re-run of
        // the same rename reads back. It is the role's own id, so it is not a
        // collision.
        .mockResolvedValueOnce({ id: "role_1" });

      await repository.update("role_1", { name: "Reviewer" }, { actor: ACTOR });

      expect(writer.defineRole).toHaveBeenCalledWith(
        expect.objectContaining({ roleId: "role_1", name: "Reviewer" }),
      );
    });
  });

  describe("when the role is gone", () => {
    it("says so rather than defining a role that no longer exists", async () => {
      const { repository, db, writer } = harness();
      db.customRole.findUnique.mockResolvedValueOnce(null);

      await expect(
        repository.update("role_1", { name: "Reviewer" }, { actor: ACTOR }),
      ).rejects.toMatchObject({ code: "custom_role_not_found" });

      expect(writer.defineRole).not.toHaveBeenCalled();
    });
  });
});

describe("given an api key's exclusive roles being retired", () => {
  function retireHarness() {
    const db = {
      customRole: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      roleBinding: {
        count: vi.fn().mockResolvedValue(0),
      },
      teamUser: {
        count: vi.fn().mockResolvedValue(0),
      },
    };
    const writer = {
      defineRole: vi.fn().mockResolvedValue(undefined),
      deleteRole: vi.fn().mockResolvedValue(undefined),
      revokeBindingsWhere: vi.fn().mockResolvedValue(0),
    };
    const repository = new RoleRepository(
      db as unknown as PrismaClient,
      writer as unknown as GrantsLedgerWriter,
    );
    return { db, writer, repository };
  }

  describe("when the role is exclusive to the retired key", () => {
    it("revokes the key's grants first, then deletes the role", async () => {
      const { db, writer, repository } = retireHarness();

      await repository.deleteExclusiveToApiKey({
        roleIds: ["role_1"],
        apiKeyId: "key_1",
        organizationId: ORG_ID,
        actor: ACTOR,
      });

      expect(writer.revokeBindingsWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          where: { apiKeyId: "key_1", customRoleId: { in: ["role_1"] } },
        }),
      );
      // The exclusivity count must satisfy the tenancy guard: a RoleBinding
      // query whose only api-key predicate is `{ not: ... }` is refused
      // without an organizationId, and that refusal 500s the key retirement.
      expect(db.roleBinding.count).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_ID,
          customRoleId: "role_1",
          apiKeyId: { not: "key_1" },
        },
      });
      expect(writer.deleteRole).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG_ID, roleId: "role_1" }),
      );
    });
  });

  describe("when another key still holds the role", () => {
    it("keeps the shared role", async () => {
      const { db, writer, repository } = retireHarness();
      db.roleBinding.count.mockResolvedValueOnce(1);

      await repository.deleteExclusiveToApiKey({
        roleIds: ["role_1"],
        apiKeyId: "key_1",
        organizationId: ORG_ID,
        actor: ACTOR,
      });

      expect(writer.deleteRole).not.toHaveBeenCalled();
    });
  });
});

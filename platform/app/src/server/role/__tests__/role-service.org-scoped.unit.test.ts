/**
 * Unit tests for the organization-scoped RoleService variants. The tRPC
 * router loads a role blind and re-checks the caller's permission on its
 * organization afterwards; the REST surface authenticates as one
 * organization up front, so these lookups must never return or affect
 * another organization's role.
 */

import { grantFactToRow } from "@langwatch/authz-server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { RoleService } from "../role.service";

// A role definition is a ledger fact since ADR-092 delivery-plan PR 2:
// `role_defined` carries the whole role and `role_deleted` retires it, so the
// writer is the seam these cases observe.
const ledger = vi.hoisted(() => ({
  attachBindings: vi.fn(),
  revokeBindings: vi.fn(),
  revokeBindingsWhere: vi.fn(),
  defineRole: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock("~/server/app-layer/authz/ledger", () => ({
  grantsLedgerWriter: () => ledger,
}));

function buildMockPrisma() {
  return {
    // deleteIfUnused reads the cross-organization binding count in raw
    // SQL (the tenancy guard refuses the model client for that question).
    $queryRaw: vi.fn().mockResolvedValue([{ count: 0n }]),
    role: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    grant: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    team: {
      findUnique: vi.fn(),
    },
  };
}

const storedRole = {
  id: "cr_1",
  organizationId: "org_1",
  name: "editors",
  description: null,
  kind: "custom",
  permissions: ["traces:view"],
};

function customRoleGrant(id: string) {
  return {
    ...grantFactToRow({
      organizationId: "org_1",
      grant: {
        grantId: id,
        principal: { type: "user", id: "user_1" },
        roleKey: "custom:cr_1",
        legacyRole: "MEMBER",
        scope: { type: "TEAM", id: "team_1" },
        source: "grants-service",
        occurredAtMs: 0,
      },
    }),
    updatedAt: new Date(0),
  };
}

describe("RoleService org-scoped variants", () => {
  let prisma: ReturnType<typeof buildMockPrisma>;
  let service: RoleService;

  beforeEach(() => {
    vi.clearAllMocks();
    ledger.defineRole.mockResolvedValue(undefined);
    ledger.deleteRole.mockResolvedValue(undefined);
    prisma = buildMockPrisma();
    service = new RoleService(prisma as unknown as PrismaClient);
  });

  describe("when reading a role by organization", () => {
    it("scopes the lookup to the organization and the custom kind", async () => {
      prisma.role.findFirst.mockResolvedValue(storedRole);

      const role = await service.getRoleForOrg({
        roleId: "cr_1",
        organizationId: "org_1",
      });

      expect(prisma.role.findFirst).toHaveBeenCalledWith({
        where: {
          id: "cr_1",
          organizationId: "org_1",
          kind: "custom",
          deletedAt: null,
        },
      });
      expect(role.permissions).toEqual(["traces:view"]);
    });

    it("answers not found for another organization's role", async () => {
      prisma.role.findFirst.mockResolvedValue(null);

      await expect(
        service.getRoleForOrg({ roleId: "cr_1", organizationId: "org_2" }),
      ).rejects.toMatchObject({ code: "custom_role_not_found" });
    });
  });

  describe("when updating a role by organization", () => {
    it("answers not found before writing when the role is foreign", async () => {
      prisma.role.findFirst.mockResolvedValue(null);

      await expect(
        service.updateRoleForOrg({
          roleId: "cr_1",
          organizationId: "org_2",
          params: { name: "renamed" },
          actor: { type: "user", id: "actor_1" },
        }),
      ).rejects.toMatchObject({ code: "custom_role_not_found" });

      expect(ledger.defineRole).not.toHaveBeenCalled();
    });

    it("refuses a rename onto an existing role name", async () => {
      prisma.role.findFirst
        .mockResolvedValueOnce(storedRole)
        .mockResolvedValueOnce({ id: "cr_other" });

      await expect(
        service.updateRoleForOrg({
          roleId: "cr_1",
          organizationId: "org_1",
          params: { name: "taken-name" },
          actor: { type: "user", id: "actor_1" },
        }),
      ).rejects.toMatchObject({ code: "custom_role_name_taken" });

      expect(ledger.defineRole).not.toHaveBeenCalled();
    });

    it("refuses the reserved API key namespace", async () => {
      await expect(
        service.updateRoleForOrg({
          roleId: "cr_1",
          organizationId: "org_1",
          params: { name: "apikey:sneaky" },
          actor: { type: "user", id: "actor_1" },
        }),
      ).rejects.toMatchObject({ code: "custom_role_name_reserved" });
    });

    it("updates a role of its own organization", async () => {
      // The natural-key check asks by (organizationId, name) and finds it
      // free; the redefine asks by id and finds the role it rewrites.
      prisma.role.findFirst
        .mockResolvedValueOnce(storedRole)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(storedRole);

      const updated = await service.updateRoleForOrg({
        roleId: "cr_1",
        organizationId: "org_1",
        params: { name: "renamed" },
        actor: { type: "user", id: "actor_1" },
      });

      expect(updated.name).toBe("renamed");
    });
  });

  describe("when deleting a role by organization", () => {
    it("answers not found for another organization's role", async () => {
      prisma.role.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteRoleForOrg({
          roleId: "cr_1",
          organizationId: "org_2",
          actor: { type: "user", id: "actor_1" },
        }),
      ).rejects.toMatchObject({ code: "custom_role_not_found" });

      expect(ledger.deleteRole).not.toHaveBeenCalled();
    });

    it("refuses to delete a role that grants still reference", async () => {
      prisma.role.findFirst.mockResolvedValue(storedRole);
      prisma.grant.findMany.mockResolvedValue([
        customRoleGrant("grant_1"),
        customRoleGrant("grant_2"),
      ]);

      await expect(
        service.deleteRoleForOrg({
          roleId: "cr_1",
          organizationId: "org_1",
          actor: { type: "user", id: "actor_1" },
        }),
      ).rejects.toMatchObject({
        code: "custom_role_in_use",
        meta: expect.objectContaining({ bindingCount: 2 }),
      });

      expect(ledger.deleteRole).not.toHaveBeenCalled();
    });

    it("deletes an unreferenced role", async () => {
      prisma.role.findFirst.mockResolvedValue(storedRole);

      const result = await service.deleteRoleForOrg({
        roleId: "cr_1",
        organizationId: "org_1",
        actor: { type: "user", id: "actor_1" },
      });

      expect(result).toEqual({ success: true });
      expect(ledger.deleteRole).toHaveBeenCalledWith(
        expect.objectContaining({ roleId: "cr_1", organizationId: "org_1" }),
      );
    });

    describe("when a binding is written between the check and the delete", () => {
      it("leaves the role standing and refuses with the fresh counts", async () => {
        prisma.role.findFirst.mockResolvedValue(storedRole);
        // The pre-check sees nothing; the cross-org read inside the delete
        // and the re-read after it find the binding that arrived in between.
        prisma.grant.findMany
          .mockResolvedValueOnce([])
          .mockResolvedValue([customRoleGrant("grant_1")]);
        prisma.$queryRaw.mockResolvedValue([{ count: 1n }]);

        await expect(
          service.deleteRoleForOrg({
            roleId: "cr_1",
            organizationId: "org_1",
            actor: { type: "user", id: "actor_1" },
          }),
        ).rejects.toMatchObject({
          code: "custom_role_in_use",
          meta: expect.objectContaining({ bindingCount: 1 }),
        });
      });
    });

    describe("when another caller deleted the same role first", () => {
      it("answers not found rather than an in-use refusal naming nothing", async () => {
        // The lookup finds the role; the re-read after the failed delete
        // finds it gone, which is what says another caller removed it in
        // between. A 409 here would list zero users and zero bindings for a
        // role that no longer exists.
        prisma.role.findFirst
          .mockResolvedValueOnce(storedRole)
          .mockResolvedValueOnce(null);

        await expect(
          service.deleteRoleForOrg({
            roleId: "cr_1",
            organizationId: "org_1",
            actor: { type: "user", id: "actor_1" },
          }),
        ).rejects.toMatchObject({ code: "custom_role_not_found" });
      });
    });
  });
});

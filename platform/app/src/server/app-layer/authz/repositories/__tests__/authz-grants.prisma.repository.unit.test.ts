import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { PrismaAuthzGrantsRepository } from "../authz-grants.prisma.repository";

/**
 * The tenancy lookups every write path validates with - the Prisma queries
 * this repository owns. The writes themselves live in
 * LedgerAuthzGrantsRepository, tested in authz-grants.ledger.repository.unit.test.ts.
 */

describe("PrismaAuthzGrantsRepository", () => {
  describe("findCustomRole", () => {
    it("reads the tenancy and the vocabulary in one query", async () => {
      const findUnique = vi
        .fn()
        .mockResolvedValue({ organizationId: "org-1", permissions: ["a:b"] });
      const prisma = {
        customRole: { findUnique },
      } as unknown as PrismaClient;

      const role = await new PrismaAuthzGrantsRepository(prisma).findCustomRole(
        { customRoleId: "role-1" },
      );

      expect(findUnique).toHaveBeenCalledWith({
        where: { id: "role-1" },
        select: { organizationId: true, permissions: true },
      });
      expect(role).toEqual({ organizationId: "org-1", permissions: ["a:b"] });
    });
  });

  describe("findTeamOrganization", () => {
    it("reads the owning organization for a team", async () => {
      const findUnique = vi.fn().mockResolvedValue({ organizationId: "org-1" });
      const prisma = { team: { findUnique } } as unknown as PrismaClient;

      const result = await new PrismaAuthzGrantsRepository(
        prisma,
      ).findTeamOrganization({ teamId: "team-1" });

      expect(findUnique).toHaveBeenCalledWith({
        where: { id: "team-1" },
        select: { organizationId: true },
      });
      expect(result).toEqual({ organizationId: "org-1" });
    });
  });

  describe("findProjectLineage", () => {
    describe("when the project has no team", () => {
      it("returns null rather than a half-filled lineage", async () => {
        const findUnique = vi.fn().mockResolvedValue({ team: null });
        const prisma = { project: { findUnique } } as unknown as PrismaClient;

        const result = await new PrismaAuthzGrantsRepository(
          prisma,
        ).findProjectLineage({ projectId: "project-1" });

        expect(result).toBeNull();
      });
    });

    it("reads the team and organization the project belongs to", async () => {
      const findUnique = vi.fn().mockResolvedValue({
        team: { id: "team-1", organizationId: "org-1" },
      });
      const prisma = { project: { findUnique } } as unknown as PrismaClient;

      const result = await new PrismaAuthzGrantsRepository(
        prisma,
      ).findProjectLineage({ projectId: "project-1" });

      expect(result).toEqual({ teamId: "team-1", organizationId: "org-1" });
    });
  });
});

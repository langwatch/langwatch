import { describe, expect, it, vi } from "vitest";
import { PrismaAuthzGrantRepository } from "../prisma.authz-grant.repository";

/**
 * The tenancy lookups every write path validates with - the Prisma queries
 * this repository owns. The writes themselves live in
 * LedgerAuthzGrantsRepository, tested in authz-grants.ledger.repository.unit.test.ts.
 */

describe("PrismaAuthzGrantRepository", () => {
  describe("tryFindCustomRole", () => {
    it("reads the tenancy and the vocabulary in one query", async () => {
      const findUnique = vi
        .fn()
        .mockResolvedValue({ organizationId: "org-1", permissions: ["a:b"] });
      const prisma = {
        customRole: { findUnique },
      } as never;

      const role = await PrismaAuthzGrantRepository.create(prisma).tryFindCustomRole({
        customRoleId: "role-1",
      });

      expect(findUnique).toHaveBeenCalledWith({
        where: { id: "role-1" },
        select: { organizationId: true, permissions: true },
      });
      expect(role).toEqual({ organizationId: "org-1", permissions: ["a:b"] });
    });
  });

  describe("tryFindTeamOrganization", () => {
    it("reads the owning organization for a team", async () => {
      const findUnique = vi.fn().mockResolvedValue({ organizationId: "org-1" });
      const prisma = { team: { findUnique } } as never;

      const result = await PrismaAuthzGrantRepository.create(
        prisma,
      ).tryFindTeamOrganization({ teamId: "team-1" });

      expect(findUnique).toHaveBeenCalledWith({
        where: { id: "team-1" },
        select: { organizationId: true },
      });
      expect(result).toEqual({ organizationId: "org-1" });
    });
  });

  describe("tryFindProjectLineage", () => {
    describe("when the project has no team", () => {
      it("returns null rather than a half-filled lineage", async () => {
        const findUnique = vi.fn().mockResolvedValue({ team: null });
        const prisma = { project: { findUnique } } as never;

        const result = await PrismaAuthzGrantRepository.create(
          prisma,
        ).tryFindProjectLineage({ projectId: "project-1" });

        expect(result).toBeNull();
      });
    });

    describe("when the project has a team", () => {
      it("reads the team and organization the project belongs to", async () => {
        const findUnique = vi.fn().mockResolvedValue({
          team: { id: "team-1", organizationId: "org-1" },
        });
        const prisma = { project: { findUnique } } as never;

        const result = await PrismaAuthzGrantRepository.create(
          prisma,
        ).tryFindProjectLineage({ projectId: "project-1" });

        expect(result).toEqual({ teamId: "team-1", organizationId: "org-1" });
      });
    });
  });
});

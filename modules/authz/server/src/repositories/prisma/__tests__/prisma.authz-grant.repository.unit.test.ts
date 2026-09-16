import { describe, expect, it, vi } from "vitest";
import { PrismaAuthzGrantRepository } from "../prisma.authz-grant.repository.ts";

/**
 * Tenancy lookups this repository owns. Writes in EventingAuthzGrantRepository.
 * Provenance covered elsewhere (TESTING_PHILOSOPHY.md).
 */

describe("PrismaAuthzGrantRepository", () => {
  describe("when finding the custom role", () => {
    it("reads the tenancy and the vocabulary in one query", async () => {
      const findUnique = vi
        .fn()
        .mockResolvedValue({ organizationId: "org-1", permissions: ["a:b"] });
      const prisma = {
        customRole: { findUnique },
      } as never;

      const role = await PrismaAuthzGrantRepository.create(prisma).findCustomRole({
        customRoleId: "role-1",
      });

      expect(findUnique).toHaveBeenCalledWith({
        where: { id: "role-1" },
        select: { organizationId: true, permissions: true },
      });
      expect(role).toEqual({ organizationId: "org-1", permissions: ["a:b"] });
    });
  });

  describe("when finding the team's organization", () => {
    it("reads the owning organization for a team", async () => {
      const findUnique = vi.fn().mockResolvedValue({ organizationId: "org-1" });
      const prisma = { team: { findUnique } } as never;

      const result = await PrismaAuthzGrantRepository.create(prisma).findTeamOrganization({
        teamId: "team-1",
      });

      expect(findUnique).toHaveBeenCalledWith({
        where: { id: "team-1" },
        select: { organizationId: true },
      });
      expect(result).toEqual({ organizationId: "org-1" });
    });
  });

  describe("when finding the project lineage", () => {
    describe("when the project has no team", () => {
      it("returns null rather than a half-filled lineage", async () => {
        const findUnique = vi.fn().mockResolvedValue({ team: null });
        const prisma = { project: { findUnique } } as never;

        const result = await PrismaAuthzGrantRepository.create(prisma).findProjectLineage({
          projectId: "project-1",
        });

        expect(result).toBeNull();
      });
    });

    describe("when the project has a team", () => {
      it("reads the team and organization the project belongs to", async () => {
        const findUnique = vi.fn().mockResolvedValue({
          team: { id: "team-1", organizationId: "org-1" },
        });
        const prisma = { project: { findUnique } } as never;

        const result = await PrismaAuthzGrantRepository.create(prisma).findProjectLineage({
          projectId: "project-1",
        });

        expect(result).toEqual({ teamId: "team-1", organizationId: "org-1" });
      });
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import { PrismaDataPrivacyResolutionAdapter } from "../prisma.data-privacy-resolution.adapter";
import type { DataPrivacyResolutionDatabase } from "../prisma.data-privacy-resolution.adapter";

/**
 * Spec: packages/features/data-privacy/specs/data-privacy-resolution-seam.feature
 *
 * The policy the ingestion paths resolve. `DataPrivacyService` requires an
 * `OrganizationService` because `setForScope` has to decide which organization
 * a team scope belongs to; resolving a project's policy asks nothing of it —
 * the project's own row already carries the organization, team and department
 * the inheritance chain is built from.
 */

function projectWithTeam() {
  return {
    id: "project-1",
    teamId: "team-1",
    departmentId: null,
    isPersonal: false,
    team: { organizationId: "organization-1" },
  };
}

function resolution(options: { rows?: unknown[] } = {}) {
  const findMany = vi.fn(async () => options.rows ?? []);
  const getWithTeam = vi.fn(async () => projectWithTeam());

  return {
    findMany,
    getWithTeam,
    built: PrismaDataPrivacyResolutionAdapter.create({
      prisma: {
        dataPrivacyPolicy: { findMany },
      } as unknown as DataPrivacyResolutionDatabase,
      projects: { getWithTeam } as never,
    }),
  };
}

describe("PrismaDataPrivacyResolutionAdapter", () => {
  describe("given a Prisma client and one project read", () => {
    describe("when a project's policy is resolved", () => {
      /** @scenario "The policy resolution composes from a database and one project read" */
      it("reads the chain from the project's own organization", async () => {
        const { built, findMany } = resolution();

        await expect(
          built.getResolvedForProject({ projectId: "project-1" }),
        ).resolves.toMatchObject({ categories: expect.any(Object) });
        expect(findMany).toHaveBeenCalledWith({
          where: {
            organizationId: "organization-1",
            OR: expect.arrayContaining([{ scopeType: "PROJECT", scopeId: "project-1" }]),
          },
        });
      });

      /** @scenario "A stored drop rule reaches the resolved policy" */
      it("carries a project-scoped rule into the resolution", async () => {
        const { built } = resolution({
          rows: [
            {
              scopeType: "PROJECT",
              scopeId: "project-1",
              personalOnly: false,
              config: { categories: { input: { disposition: "drop" } } },
            },
          ],
        });

        const resolved = await built.getResolvedForProject({ projectId: "project-1" });

        expect(resolved.categories.input.disposition).toBe("drop");
      });

      /** @scenario "A second resolution inside the window reuses the first" */
      it("reads the policy rows once per project inside the cache window", async () => {
        const { built, findMany } = resolution();

        await built.getResolvedForProject({ projectId: "project-1" });
        await built.getResolvedForProject({ projectId: "project-1" });

        expect(findMany).toHaveBeenCalledTimes(1);
      });
    });
  });
});

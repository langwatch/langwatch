/**
 * @vitest-environment node
 *
 * The organization admin resolution reads the onboarding variant next to the
 * admin, so a milestone tracked against the admin can be split by variant.
 *
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { PrismaProjectRepository } from "../project.prisma.repository";

function repositoryWith(project: unknown) {
  const findUnique = vi.fn().mockResolvedValue(project);
  const prisma = { project: { findUnique } } as unknown as PrismaClient;
  return {
    repository: new PrismaProjectRepository(prisma, {
      recordGrant: vi.fn(),
    } as never),
    findUnique,
  };
}

describe("PrismaProjectRepository.getWithOrgAdmin()", () => {
  describe("when the organization recorded the classic variant", () => {
    /** @scenario "the organization admin resolution reads the onboarding variant next to the admin" */
    it("carries onboardingVariant classic next to the admin", async () => {
      const { repository, findUnique } = repositoryWith({
        firstMessage: false,
        team: {
          organization: {
            id: "org_1",
            signupData: {
              companyType: "company",
              onboardingVariant: "classic",
            },
            members: [{ userId: "admin_1" }],
          },
        },
      });

      const result = await repository.getWithOrgAdmin("project_1");

      expect(result).toEqual({
        firstMessage: false,
        organizationId: "org_1",
        adminUserId: "admin_1",
        onboardingVariant: "classic",
      });
      expect(
        findUnique.mock.calls[0]![0].select.team.select.organization.select,
      ).toMatchObject({ signupData: true });
    });
  });

  describe("when the organization predates the experiment", () => {
    it("carries a null onboardingVariant", async () => {
      const { repository } = repositoryWith({
        firstMessage: true,
        team: {
          organization: {
            id: "org_1",
            signupData: { companyType: "company" },
            members: [],
          },
        },
      });

      const result = await repository.getWithOrgAdmin("project_1");

      expect(result).toEqual({
        firstMessage: true,
        organizationId: "org_1",
        adminUserId: null,
        onboardingVariant: null,
      });
    });
  });

  describe("when the project does not exist", () => {
    it("answers null", async () => {
      const { repository } = repositoryWith(null);

      await expect(repository.getWithOrgAdmin("missing")).resolves.toBeNull();
    });
  });
});

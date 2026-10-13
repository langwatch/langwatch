import { describe, expect, it, vi } from "vitest";

import {
  PrismaMigrationMembershipRepository,
  type PrismaMigrationMembershipDatabase,
} from "../prisma.migration-membership.repository.ts";

function repositoryOver(memberships: string[] | null) {
  const findUnique = vi.fn<PrismaMigrationMembershipDatabase["user"]["findUnique"]>(async () =>
    memberships === null
      ? null
      : { orgMemberships: memberships.map((organizationId) => ({ organizationId })) },
  );

  return {
    repository: PrismaMigrationMembershipRepository.create({ prisma: { user: { findUnique } } }),
    findUnique,
  };
}

describe("the user cohort's membership probe", () => {
  describe("when thousands of organizations are enrolled", () => {
    it("reads the user's own memberships, never the enrolled set as a query parameter", async () => {
      const enrolled = Array.from({ length: 5_000 }, (_, index) => `org_${index}`);
      const { repository, findUnique } = repositoryOver(["org_elsewhere", "org_4999"]);

      await expect(
        repository.isMemberOfAny({ userId: "user_1", organizationIds: enrolled }),
      ).resolves.toBe(true);
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: "user_1" },
        select: { orgMemberships: { select: { organizationId: true } } },
      });
    });
  });

  describe("when the user belongs to no enrolled organization", () => {
    it("leaves them out of the cohort", async () => {
      const { repository } = repositoryOver(["org_elsewhere"]);

      await expect(
        repository.isMemberOfAny({ userId: "user_1", organizationIds: ["org_1"] }),
      ).resolves.toBe(false);
    });
  });

  describe("when nothing is enrolled or the user is gone", () => {
    it("answers no, reading nothing for an empty enrolled set", async () => {
      const empty = repositoryOver(["org_1"]);
      const gone = repositoryOver(null);

      await expect(
        empty.repository.isMemberOfAny({ userId: "user_1", organizationIds: [] }),
      ).resolves.toBe(false);
      expect(empty.findUnique).not.toHaveBeenCalled();
      await expect(
        gone.repository.isMemberOfAny({ userId: "user_1", organizationIds: ["org_1"] }),
      ).resolves.toBe(false);
    });
  });
});

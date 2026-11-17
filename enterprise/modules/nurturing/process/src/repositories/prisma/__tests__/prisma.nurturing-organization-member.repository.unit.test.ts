// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @unit
 * The read by users bounds each IN list, over a stub client.
 */
import { describe, expect, it } from "vitest";

import { PrismaNurturingOrganizationMemberRepository } from "../prisma.nurturing-organization-member.repository.ts";

type Database = Parameters<
  typeof PrismaNurturingOrganizationMemberRepository.create
>[0]["prisma"];

function repositoryOverStub() {
  const reads: string[][] = [];
  const database = {
    nurturingOrganizationMember: {
      findMany: async ({ where }: { where: { userId: { in: string[] } } }) => {
        reads.push(where.userId.in);
        return where.userId.in.map((userId) => ({
          organizationId: "org-2",
          userId,
          joinedAt: new Date(1_000),
          leftAt: null,
          returnedAt: null,
        }));
      },
    },
  };
  const members = PrismaNurturingOrganizationMemberRepository.create({
    prisma: database as unknown as Database,
  });
  return { members, reads };
}

describe("PrismaNurturingOrganizationMemberRepository.findMembershipsOfUsers", () => {
  describe("when 2,001 users are named", () => {
    it("reads them 1,000 at a time and returns every membership", async () => {
      const { members, reads } = repositoryOverStub();
      const userIds = Array.from({ length: 2_001 }, (_, index) => `user-${index}`);

      const read = await members.findMembershipsOfUsers({ userIds });

      expect(reads.map((list) => list.length)).toEqual([1_000, 1_000, 1]);
      expect(read).toHaveLength(2_001);
      expect(read[0]).toEqual({
        organizationId: "org-2",
        userId: "user-0",
        joinedAt: 1_000,
        leftAt: null,
        returnedAt: null,
      });
    });
  });

  describe("when no user is named", () => {
    it("makes no query and returns nothing", async () => {
      const { members, reads } = repositoryOverStub();

      expect(await members.findMembershipsOfUsers({ userIds: [] })).toEqual([]);
      expect(reads).toEqual([]);
    });
  });
});

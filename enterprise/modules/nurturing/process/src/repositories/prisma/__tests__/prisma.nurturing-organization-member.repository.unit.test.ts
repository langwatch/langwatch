// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @unit
 * The read by users bounds each IN list, over a Prisma double.
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaNurturingOrganizationMemberRepository } from "../prisma.nurturing-organization-member.repository.ts";

const row = {
  organizationId: "org-2",
  userId: "user-0",
  joinedAt: new Date(1_000),
  leftAt: null,
  returnedAt: null,
};

function repositoryOverDouble() {
  const findMany = vi.fn(async (_args: unknown) => [row]);
  const members = PrismaNurturingOrganizationMemberRepository.create({
    prisma: prismaDouble({ nurturingOrganizationMember: { findMany } }),
  });
  return { members, findMany };
}

describe("PrismaNurturingOrganizationMemberRepository.findMembershipsOfUsers", () => {
  describe("when 2,001 users are named", () => {
    it("reads them 1,000 at a time and maps every row", async () => {
      const { members, findMany } = repositoryOverDouble();
      const userIds = Array.from({ length: 2_001 }, (_, index) => `user-${index}`);

      const read = await members.findMembershipsOfUsers({ userIds });

      expect(findMany.mock.calls.map(([args]) => args)).toEqual([
        { where: { userId: { in: userIds.slice(0, 1_000) } } },
        { where: { userId: { in: userIds.slice(1_000, 2_000) } } },
        { where: { userId: { in: ["user-2000"] } } },
      ]);
      expect(read).toHaveLength(3);
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
      const { members, findMany } = repositoryOverDouble();

      expect(await members.findMembershipsOfUsers({ userIds: [] })).toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
    });
  });
});

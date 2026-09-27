// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaScimRepository } from "../prisma.scim.repository.ts";

describe("reading the directory back from Postgres", () => {
  describe("when a provider asks for a page of people", () => {
    /** @scenario "The order a page is cut from is fixed rather than whatever the store offers" */
    it("cuts both halves of the page from a settled order, the same on every request", async () => {
      const claimed = { count: vi.fn(async () => 3), findMany: vi.fn(async () => []) };
      const unclaimed = { count: vi.fn(async () => 20), findMany: vi.fn(async () => []) };
      const repository = PrismaScimRepository.create(
        prismaDouble({ scimUserResource: claimed, organizationUser: unclaimed }),
      );
      const page = { organizationId: "org-1", startIndex: 1, count: 10 };

      await repository.findOrganizationUsers(page);
      await repository.findOrganizationUsers(page);

      expect(claimed.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { userId: "asc" } }),
      );
      expect(unclaimed.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { userId: "asc" } }),
      );
      expect(claimed.findMany.mock.calls[1]).toEqual(claimed.findMany.mock.calls[0]);
      expect(unclaimed.findMany.mock.calls[1]).toEqual(unclaimed.findMany.mock.calls[0]);
    });
  });

  describe("when a provider walks the directory's groups", () => {
    /** @scenario "Groups are paged from a settled order too" */
    it("breaks a tie on creation time with the id, so no two pages overlap", async () => {
      const group = { count: vi.fn(async () => 150), findMany: vi.fn(async () => []) };
      const repository = PrismaScimRepository.create(prismaDouble({ group }));

      await repository.listGroups({ organizationId: "org-1", startIndex: 101, count: 100 });

      expect(group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          skip: 100,
          take: 100,
        }),
      );
    });
  });
});

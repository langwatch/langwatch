/**
 * @vitest-environment node
 * ADR-175: the project the home page lands on when nobody chose one is the
 * member's oldest live project that is neither an aggregate, which an admin
 * opens on purpose, nor the governance project, which no one sees.
 */
import { NEVER_LANDED_ON_PROJECT_KINDS } from "@langwatch/project-contract";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { PrismaUserOrganizationDirectoryRepository } from "../prisma.user-organization-directory.repository.ts";

describe("PrismaUserOrganizationDirectoryRepository.findFirstProjectSlug", () => {
  describe("given a member whose oldest projects are an aggregate and the governance project", () => {
    describe("when the home page picks the project to land on", () => {
      /** @scenario "Neither an aggregate nor the governance project is ever the project the app lands on" */
      it("asks for the oldest live project of the member's teams of any other kind", async () => {
        const queries: unknown[] = [];
        const repository = PrismaUserOrganizationDirectoryRepository.create({
          prisma: prismaDouble({
            project: {
              findFirst: async (args: unknown) => {
                queries.push(args);
                return { slug: "ordinary" };
              },
            },
          }),
        });

        await expect(
          repository.findFirstProjectSlug({ organizationId: "org-1", userId: "user-1" }),
        ).resolves.toBe("ordinary");
        expect(queries).toEqual([
          {
            where: {
              team: { organizationId: "org-1", members: { some: { userId: "user-1" } } },
              archivedAt: null,
              kind: { notIn: [...NEVER_LANDED_ON_PROJECT_KINDS] },
            },
            orderBy: { createdAt: "asc" },
            select: { slug: true },
          },
        ]);
      });
    });
  });
});

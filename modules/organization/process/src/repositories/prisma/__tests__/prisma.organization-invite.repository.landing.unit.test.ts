/**
 * @vitest-environment node
 *
 * ADR-175: the slugs an accepted invitation may land on leave out an aggregate
 * and the governance project, in both of the queries the landing pick reads.
 */
import { NEVER_LANDED_ON_PROJECT_KINDS } from "@langwatch/project-contract";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { PrismaOrganizationInviteRepository } from "../prisma.organization-invite.repository.ts";

function repositoryRecordingQueries() {
  const queries: unknown[] = [];
  const repository = PrismaOrganizationInviteRepository.create({
    database: prismaDouble({
      project: {
        findMany: async (args: unknown) => {
          queries.push(args);
          return [{ slug: "ordinary" }];
        },
      },
    }),
  });

  return { repository, queries };
}

const NOT_LANDED_ON = { notIn: [...NEVER_LANDED_ON_PROJECT_KINDS] };

describe("PrismaOrganizationInviteRepository landing slugs", () => {
  describe("when the invited teams' projects are read", () => {
    it("asks for live projects that are neither an aggregate nor the governance project", async () => {
      const { repository, queries } = repositoryRecordingQueries();

      await expect(repository.findProjectSlugsForTeams({ teamIds: ["team-1"] })).resolves.toEqual([
        "ordinary",
      ]);
      expect(queries).toEqual([
        {
          where: { teamId: { in: ["team-1"] }, archivedAt: null, kind: NOT_LANDED_ON },
          select: { slug: true },
        },
      ]);
    });
  });

  describe("when the organisation-wide fallback is read", () => {
    it("asks for live projects that are neither an aggregate nor the governance project", async () => {
      const { repository, queries } = repositoryRecordingQueries();

      await repository.findProjectSlugsInOrganization({ organizationId: "org-1" });

      expect(queries).toEqual([
        {
          where: {
            team: { organizationId: "org-1", archivedAt: null },
            archivedAt: null,
            kind: NOT_LANDED_ON,
          },
          select: { slug: true },
        },
      ]);
    });
  });
});

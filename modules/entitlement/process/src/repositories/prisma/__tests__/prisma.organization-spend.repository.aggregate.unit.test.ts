/**
 * @vitest-environment node
 * ADR-175 decision 5: the cost view lists an aggregate to an organisation admin
 * and to nobody else, so only the administrator branch of the project read lets
 * one through. The governance project is never a row of its own here.
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { PrismaOrganizationSpendRepository } from "../prisma.organization-spend.repository.ts";

describe("PrismaOrganizationSpendRepository.findSpendRollups", () => {
  describe("when the projects whose spend the caller may read are looked up", () => {
    it("lets an aggregate through only where the caller administers the organisation", async () => {
      const queries: unknown[] = [];
      const repository = PrismaOrganizationSpendRepository.create(
        prismaDouble({
          project: {
            findMany: async (args: unknown) => {
              queries.push(args);
              return [];
            },
          },
          cost: { groupBy: async () => [] },
        }),
      );

      await repository.findSpendRollups({
        organizationId: "org-1",
        userId: "user-1",
        startDate: 0,
        endDate: 1,
      });

      expect(queries).toEqual([
        {
          where: {
            OR: [
              {
                kind: { notIn: ["internal_governance", "aggregate"] },
                team: { organizationId: "org-1", members: { some: { userId: "user-1" } } },
              },
              {
                kind: { notIn: ["internal_governance"] },
                team: {
                  organizationId: "org-1",
                  organization: { members: { some: { userId: "user-1", role: "ADMIN" } } },
                },
              },
            ],
          },
          select: { id: true, name: true, slug: true, teamId: true },
        },
      ]);
    });
  });
});

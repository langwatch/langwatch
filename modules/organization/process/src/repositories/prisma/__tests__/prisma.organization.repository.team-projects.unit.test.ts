/**
 * @vitest-environment node
 * ADR-175 decision 5: the team pages' project read leaves out the governance
 * project for everyone and an aggregate for anyone but an organisation admin.
 */
import { aesEncryption } from "@langwatch/process-stores";
import { PROJECT_KIND } from "@langwatch/project-contract";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { NO_ORGANIZATION_ROLE } from "../../../rules/organization-admin.rules.ts";
import { PrismaOrganizationRepository } from "../prisma.organization.repository.ts";

const cipher = aesEncryption(new Uint8Array(32));

async function kindFilterFor(callerOrganizationRole: string) {
  const queries: unknown[] = [];
  const repository = PrismaOrganizationRepository.create({
    database: prismaDouble({
      project: {
        findMany: async (args: unknown) => {
          queries.push(args);
          return [];
        },
      },
    }),
    cipher,
  });

  await repository.findProjects({
    organizationId: "org-1",
    teamId: "team-1",
    callerOrganizationRole,
  });

  return (queries[0] as { where: { kind: unknown } } | undefined)?.where.kind;
}

describe("PrismaOrganizationRepository.findProjects", () => {
  describe("when the caller is an organisation admin", () => {
    it("leaves out only the governance project", async () => {
      await expect(kindFilterFor("ADMIN")).resolves.toEqual({
        notIn: [PROJECT_KIND.INTERNAL_GOVERNANCE],
      });
    });
  });

  describe.each([
    ["a member", "MEMBER"],
    ["someone who holds no role", NO_ORGANIZATION_ROLE],
  ])("when the caller is %s", (_label, role) => {
    it("leaves out the governance project and every aggregate", async () => {
      await expect(kindFilterFor(role)).resolves.toEqual({
        notIn: [PROJECT_KIND.INTERNAL_GOVERNANCE, PROJECT_KIND.AGGREGATE],
      });
    });
  });
});

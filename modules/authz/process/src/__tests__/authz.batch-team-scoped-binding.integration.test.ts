/**
 * @vitest-environment node
 * The batched check answers exactly what the per-project check answers, for a
 * member whose only access is a TEAM-scoped binding and who holds no team
 * membership row at all.
 * @see specs/rbac/scoped-role-bindings.feature
 */
import { randomUUID } from "node:crypto";

import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EventingAuthzListingRepository } from "../repositories/eventing/eventing.authz-listing.repository.ts";
import { EventingAuthzReadRepository } from "../repositories/eventing/eventing.authz-read.repository.ts";
import { PrismaAuthzBindingRepository } from "../repositories/prisma/prisma.authz-binding.repository.ts";
import { AuthzService } from "../services/authz.service.ts";

const DB_URL = process.env.DATABASE_URL ?? process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("given a member whose project access is a team-scoped binding", () => {
  const prisma = new PrismaClient({
    adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
  });
  const database = prisma;
  const authz = AuthzService.create({
    repository: EventingAuthzReadRepository.create(database),
    listing: EventingAuthzListingRepository.create(database),
    bindings: PrismaAuthzBindingRepository.create({
      database: prisma,
    }),
    isOnEngine: async () => true,
  });

  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  let organizationId: string;
  let userId: string;
  let clientTeamId: string;
  let otherTeamId: string;
  let devProjectId: string;
  let prodProjectId: string;
  let otherProjectId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: "Konrad", email: `konrad-${suffix}@example.com` },
    });
    userId = user.id;

    const organization = await prisma.organization.create({
      data: { name: `Acme ${suffix}`, slug: `--test-org-${suffix}` },
    });
    organizationId = organization.id;
    await prisma.organizationUser.create({
      data: { userId, organizationId, role: "MEMBER" },
    });

    const clientTeam = await prisma.team.create({
      data: { name: "Client A", slug: `--test-team-a-${suffix}`, organizationId },
    });
    clientTeamId = clientTeam.id;
    const otherTeam = await prisma.team.create({
      data: { name: "Client B", slug: `--test-team-b-${suffix}`, organizationId },
    });
    otherTeamId = otherTeam.id;

    const project = async (name: string, teamId: string) =>
      (
        await prisma.project.create({
          data: {
            name,
            slug: `--test-project-${name}-${suffix}`,
            teamId,
            language: "en",
            framework: "other",
            apiKey: `test-key-${name}-${suffix}`,
          },
        })
      ).id;

    devProjectId = await project("clienta-dev", clientTeamId);
    prodProjectId = await project("clienta-prod", clientTeamId);
    otherProjectId = await project("clientb-dev", otherTeamId);

    // The grant, and nothing else: no TeamUser row anywhere, which is what
    // makes this a binding-only reader rather than a member with legacy rows.
    await prisma.grant.create({
      data: {
        id: `grant-team-${suffix}`,
        organizationId,
        principalType: "USER",
        principalId: userId,
        roleKey: "member",
        source: "grants-service",
        scopeType: "TEAM",
        scopeId: clientTeamId,
        occurredAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["grant", { organizationId }],
      ["project", { team: { organizationId } }],
      ["team", { organizationId }],
      ["organizationUser", { organizationId }],
      ["organization", { id: organizationId }],
      ["user", { id: userId }],
    ]);
    await prisma.$disconnect();
  });

  const batch = () =>
    authz.canBatchByIds({
      principal: { type: "user", id: userId },
      permission: "project:view",
      organizationId,
      teams: [],
      projects: [
        { projectId: devProjectId, teamId: clientTeamId },
        { projectId: prodProjectId, teamId: clientTeamId },
        { projectId: otherProjectId, teamId: otherTeamId },
      ],
    });

  describe("when the platform batch-checks the whole organization at once", () => {
    /** @scenario Batch project check honours a team-scoped binding */
    it("grants both of the team's projects, agreeing with the per-project check", async () => {
      const result = await batch();

      expect(result.projects.get(devProjectId)).toBe(true);
      expect(result.projects.get(prodProjectId)).toBe(true);
      await expect(
        authz.hasPermission({ userId, permission: "project:view", projectId: devProjectId }),
      ).resolves.toBe(true);
    });

    /** @scenario Batch project check still denies projects of other teams */
    it("denies the project of a team no binding covers", async () => {
      const result = await batch();

      expect(result.projects.get(otherProjectId)).toBe(false);
      await expect(
        authz.hasPermission({ userId, permission: "project:view", projectId: otherProjectId }),
      ).resolves.toBe(false);
    });
  });
});

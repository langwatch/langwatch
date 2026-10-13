/**
 * @vitest-environment node
 * The membership-lifetime fence on the real Grant table: what a projected
 * USER fact does against a live, a rejoined and a disabled membership.
 * @see specs/rbac/authz-grants.feature
 * @see specs/migration/authz-grants-rollout.feature
 */
import { randomUUID } from "node:crypto";

import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { Temporal } from "@langwatch/time";
import { afterAll, describe, expect, it } from "vitest";

import { AuthzService } from "../../../services/authz.service.ts";
import { EventingAuthzListingRepository } from "../../eventing/eventing.authz-listing.repository.ts";
import { EventingAuthzReadRepository } from "../../eventing/eventing.authz-read.repository.ts";
import { PrismaAuthzManagedGrantRepository } from "../prisma.authz-managed-grant.repository.ts";
import { PrismaAuthzProjectionRepository } from "../prisma.authz-projection.repository.ts";

const DB_URL = process.env.DATABASE_URL ?? process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("given the grants projection over a real database", () => {
  const prisma = new PrismaClient({
    adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
  });
  const projection = PrismaAuthzProjectionRepository.create(prisma);
  const authz = AuthzService.create({
    repository: EventingAuthzReadRepository.create(prisma),
    listing: EventingAuthzListingRepository.create(prisma),
    bindings: PrismaAuthzManagedGrantRepository.create({ database: prisma }),
    isOnEngine: async () => true,
  });

  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const created: { organizationId: string; userId: string }[] = [];

  /** An organization with one member, one team and one project, and nothing else. */
  async function seedOrganization({ tag }: { tag: string }) {
    const user = await prisma.user.create({
      data: { name: `Member ${tag}`, email: `member-${tag}-${suffix}@example.com` },
    });
    const organization = await prisma.organization.create({
      data: { name: `Org ${tag} ${suffix}`, slug: `--test-org-${tag}-${suffix}` },
    });
    const team = await prisma.team.create({
      data: {
        name: `Team ${tag}`,
        slug: `--test-team-${tag}-${suffix}`,
        organizationId: organization.id,
      },
    });
    const project = await prisma.project.create({
      data: {
        name: `project-${tag}`,
        slug: `--test-project-${tag}-${suffix}`,
        teamId: team.id,
        language: "en",
        framework: "other",
        apiKey: `test-key-${tag}-${suffix}`,
      },
    });
    created.push({ organizationId: organization.id, userId: user.id });
    return {
      userId: user.id,
      organizationId: organization.id,
      teamId: team.id,
      projectId: project.id,
    };
  }

  async function joinOrganization({
    userId,
    organizationId,
    disabledAt,
  }: {
    userId: string;
    organizationId: string;
    disabledAt?: Date;
  }): Promise<string> {
    const membership = await prisma.organizationUser.create({
      data: { userId, organizationId, role: "MEMBER", disabledAt },
    });
    return membership.membershipStamp;
  }

  function teamGrantRow({
    id,
    userId,
    organizationId,
    teamId,
    source,
  }: {
    id: string;
    userId: string;
    organizationId: string;
    teamId: string;
    source: string;
  }) {
    return {
      id,
      organizationId,
      principalType: "USER" as const,
      principalId: userId,
      roleKey: "member",
      legacyRole: null,
      source,
      scopeType: "TEAM" as const,
      scopeId: teamId,
      token: null,
      permission: null,
      resourceKind: null,
      projectId: null,
      createdByUserId: null,
      expiresAt: null,
      maxViews: null,
      occurredAt: Temporal.Now.instant(),
    };
  }

  afterAll(async () => {
    for (const { organizationId, userId } of created) {
      await cleanupTestRows(prisma, [
        ["grant", { organizationId }],
        ["roleBinding", { organizationId }],
        ["project", { team: { organizationId } }],
        ["team", { organizationId }],
        ["organizationUser", { organizationId }],
        ["organization", { id: organizationId }],
        ["user", { id: userId }],
      ]);
    }
    await prisma.$disconnect();
  });

  describe("when a live attach arrives after its member left and rejoined", () => {
    /** @scenario "A delayed live attach is rejected after offboarding" */
    it("rejects the old attach by the lifetime fence and leaves no legacy binding", async () => {
      const seeded = await seedOrganization({ tag: "rejoin" });
      const oldStamp = await joinOrganization(seeded);
      await prisma.organizationUser.deleteMany({
        where: { userId: seeded.userId, organizationId: seeded.organizationId },
      });
      const newStamp = await joinOrganization(seeded);
      expect(newStamp).not.toBe(oldStamp);
      const oldAttach = teamGrantRow({
        id: `grant-old-${suffix}`,
        source: "grants-service",
        ...seeded,
      });

      await projection.append({
        kind: "grant.upsert",
        row: oldAttach,
        membershipStamp: oldStamp,
      });

      await expect(prisma.grant.findUnique({ where: { id: oldAttach.id } })).resolves.toBeNull();
      await expect(
        prisma.roleBinding.findFirst({ where: { id: oldAttach.id } }),
      ).resolves.toBeNull();
      await expect(
        authz.hasPermission({
          userId: seeded.userId,
          permission: "project:view",
          projectId: seeded.projectId,
        }),
      ).resolves.toBe(false);

      const currentAttach = { ...oldAttach, id: `grant-new-${suffix}` };
      await projection.append({
        kind: "grant.upsert",
        row: currentAttach,
        membershipStamp: newStamp,
      });

      await expect(
        prisma.grant.findUnique({ where: { id: currentAttach.id } }),
      ).resolves.toMatchObject({ principalId: seeded.userId, revokedAt: null });
    });
  });

  describe("when a migration fact is projected for a disabled member", () => {
    /** @scenario "A disabled membership keeps its migration lifetime" */
    it("retains the grant for replay while runtime access stays denied", async () => {
      const seeded = await seedOrganization({ tag: "disabled" });
      const stamp = await joinOrganization({ ...seeded, disabledAt: new Date() });
      const fact = teamGrantRow({
        id: `grant-migration-${suffix}`,
        source: "migration",
        ...seeded,
      });

      await projection.append({ kind: "grant.upsert", row: fact, membershipStamp: stamp });

      await expect(prisma.grant.findUnique({ where: { id: fact.id } })).resolves.toMatchObject({
        source: "migration",
        principalId: seeded.userId,
        revokedAt: null,
      });
      const check = {
        userId: seeded.userId,
        permission: "project:view" as const,
        projectId: seeded.projectId,
      };
      await expect(authz.hasPermission(check)).resolves.toBe(false);

      await prisma.organizationUser.updateMany({
        where: { userId: seeded.userId, organizationId: seeded.organizationId },
        data: { disabledAt: null },
      });
      await expect(authz.hasPermission(check)).resolves.toBe(true);
    });
  });
});

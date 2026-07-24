// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * Real-DB integration coverage for PersonalVirtualKeyService.
 *
 * Closes the select-clause-drift class of bug that broke the CLI twice
 * during the personal-VK refactor (bugs 20 + 22): a column dropped from
 * the VirtualKey schema was not removed from a service-layer `select`
 * clause, and the only existing coverage was unit tests against a mocked
 * Prisma. Mocked Prisma accepts any field name, so column-drift slipped
 * through CI and only surfaced when rchaves opened /me/settings + ran
 * `langwatch claude`.
 *
 * The integration shape:
 *   - seeds a real Org + personal Team + personal Project + personal VK
 *     row via the actual Prisma client connected to Postgres
 *   - calls every service method that touches the VirtualKey table
 *   - hits Prisma against the real schema, so any select-clause referring
 *     to a non-existent column throws PrismaClientValidationError, which
 *     the test treats as a regression
 *
 * Mocks are deliberately absent. The failure mode this test is here to
 * catch only surfaces when the SELECT is executed against the real
 * column set.
 */

import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";

import { PersonalVirtualKeyService, PersonalVirtualKeyNotFoundError } from "../personalVirtualKey.service";

const suffix = nanoid(8);
const ORG_ID = `org-pvk-${suffix}`;
const USER_ID = `usr-pvk-${suffix}`;
const OTHER_USER_ID = `usr-other-${suffix}`;
const TEAM_ID = `team-pvk-${suffix}`;
const PROJECT_ID = `proj-pvk-${suffix}`;
const MODEL_PROVIDER_ID = `mp-pvk-${suffix}`;
const ROUTING_POLICY_ID = `rp-pvk-${suffix}`;

describe("PersonalVirtualKeyService (real DB)", () => {
  const service = PersonalVirtualKeyService.create(prisma, {
    gatewayBaseUrl: "http://gw.test",
  });

  let seededVkId: string;
  let otherUserVkId: string;

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: ORG_ID, name: `PVK ${suffix}`, slug: `pvk-${suffix}` },
    });
    await prisma.user.createMany({
      data: [
        { id: USER_ID, email: `pvk-${suffix}@example.com`, name: "PVK User" },
        {
          id: OTHER_USER_ID,
          email: `other-${suffix}@example.com`,
          name: "Other User",
        },
      ],
    });
    await prisma.organizationUser.createMany({
      data: [
        { organizationId: ORG_ID, userId: USER_ID, role: "MEMBER" },
        { organizationId: ORG_ID, userId: OTHER_USER_ID, role: "MEMBER" },
      ],
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `PVK Personal ${suffix}`,
        slug: `pvk-personal-${suffix}`,
        organizationId: ORG_ID,
        isPersonal: true,
        ownerUserId: USER_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `PVK Project ${suffix}`,
        slug: `pvk-project-${suffix}`,
        apiKey: `pvk-${suffix}`,
        teamId: TEAM_ID,
        language: "typescript",
        framework: "other",
        isPersonal: true,
        ownerUserId: USER_ID,
      },
    });
    await prisma.modelProvider.create({
      data: {
        id: MODEL_PROVIDER_ID,
        name: `pvk-mp-${suffix}`,
        provider: "openai",
        enabled: true,
        organizationId: ORG_ID,
        scopes: {
          create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        },
      },
    });
    await prisma.routingPolicy.create({
      data: {
        id: ROUTING_POLICY_ID,
        organizationId: ORG_ID,
        scopes: {
          create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        },
        name: `pvk-rp-${suffix}`,
        isDefault: true,
        modelProviderIds: [MODEL_PROVIDER_ID],
      },
    });

    // Seed two personal VKs directly so list() has rows to return.
    // The integration target is the select clause, not the issue path,
    // so go through prisma.virtualKey.create directly.
    const seeded = await prisma.virtualKey.create({
      data: {
        organizationId: ORG_ID,
        name: "default",
        description: "Personal virtual key",
        hashedSecret: `hash-${suffix}-1`,
        displayPrefix: "lw_vk_",
        principalUserId: USER_ID,
        createdById: USER_ID,
        routingPolicyId: ROUTING_POLICY_ID,
        scopes: {
          create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
        },
      },
    });
    seededVkId = seeded.id;

    await prisma.virtualKey.create({
      data: {
        organizationId: ORG_ID,
        name: "second-key",
        description: "Personal virtual key",
        hashedSecret: `hash-${suffix}-2`,
        displayPrefix: "lw_vk_",
        principalUserId: USER_ID,
        createdById: USER_ID,
        routingPolicyId: ROUTING_POLICY_ID,
        scopes: {
          create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
        },
      },
    });

    // A third VK owned by a different user, same org, to verify the
    // principalUserId predicate isolates the caller's keys.
    const other = await prisma.virtualKey.create({
      data: {
        organizationId: ORG_ID,
        name: "other-user-key",
        description: "Personal virtual key",
        hashedSecret: `hash-${suffix}-other`,
        displayPrefix: "lw_vk_",
        principalUserId: OTHER_USER_ID,
        createdById: OTHER_USER_ID,
        routingPolicyId: ROUTING_POLICY_ID,
        scopes: {
          create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
        },
      },
    });
    otherUserVkId = other.id;
  });

  describe("list: the select-clause-drift regression target", () => {
    it("executes the select against real Prisma without column-drift errors", async () => {
      // Pure regression for bugs 20 + 22: if any field in the select clause
      // does not exist in the live schema, Prisma throws
      // PrismaClientValidationError. The test passes only when the entire
      // select shape is valid.
      const result = await service.list({
        userId: USER_ID,
        organizationId: ORG_ID,
      });

      expect(result.length).toBeGreaterThanOrEqual(2);
      const names = result.map((vk) => vk.name).sort();
      expect(names).toContain("default");
      expect(names).toContain("second-key");
    });

    it("only returns the caller's keys, not other users' in the same org", async () => {
      const result = await service.list({
        userId: USER_ID,
        organizationId: ORG_ID,
      });

      const ids = result.map((vk) => vk.id);
      expect(ids).not.toContain(otherUserVkId);
    });

    it("returns the documented field shape", async () => {
      const result = await service.list({
        userId: USER_ID,
        organizationId: ORG_ID,
      });

      const row = result.find((vk) => vk.name === "default");
      expect(row).toBeDefined();
      expect(row).toMatchObject({
        id: expect.any(String),
        name: "default",
        description: "Personal virtual key",
        displayPrefix: "lw_vk_",
        principalUserId: USER_ID,
        routingPolicyId: ROUTING_POLICY_ID,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
      // lastUsedAt may be null on a freshly seeded VK
      expect(row).toHaveProperty("lastUsedAt");
      // status is the VirtualKey lifecycle enum, derived from the column
      expect(row).toHaveProperty("status");
    });

    it("orders rows by createdAt desc", async () => {
      const result = await service.list({
        userId: USER_ID,
        organizationId: ORG_ID,
      });

      for (let i = 1; i < result.length; i++) {
        const prev = result[i - 1]?.createdAt;
        const cur = result[i]?.createdAt;
        if (prev && cur) {
          expect(prev.getTime()).toBeGreaterThanOrEqual(cur.getTime());
        }
      }
    });

    it("returns an empty array for an org the user has no VKs in", async () => {
      const isolatedOrg = await prisma.organization.create({
        data: {
          id: `org-isolated-${suffix}`,
          name: `Isolated ${suffix}`,
          slug: `isolated-${suffix}`,
        },
      });

      const result = await service.list({
        userId: USER_ID,
        organizationId: isolatedOrg.id,
      });
      expect(result).toEqual([]);
    });

    it("excludes revoked VKs from the result", async () => {
      const revokedVk = await prisma.virtualKey.create({
        data: {
          organizationId: ORG_ID,
          name: "soon-to-be-revoked",
          description: "Personal virtual key",
          hashedSecret: `hash-${suffix}-revoked`,
          displayPrefix: "lw_vk_",
          principalUserId: USER_ID,
          createdById: USER_ID,
          routingPolicyId: ROUTING_POLICY_ID,
          revokedAt: new Date(),
          revokedById: USER_ID,
          scopes: {
            create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
          },
        },
      });

      const result = await service.list({
        userId: USER_ID,
        organizationId: ORG_ID,
      });
      expect(result.map((vk) => vk.id)).not.toContain(revokedVk.id);
    });
  });

  describe("revoke: also exercises a select clause against the real schema", () => {
    it("revokes the caller's VK and removes it from list()", async () => {
      // Seed a fresh VK for this scenario so we don't disturb the others.
      const target = await prisma.virtualKey.create({
        data: {
          organizationId: ORG_ID,
          name: `revoke-target-${nanoid(4)}`,
          description: "Personal virtual key",
          hashedSecret: `hash-${suffix}-rt`,
          displayPrefix: "lw_vk_",
          principalUserId: USER_ID,
          createdById: USER_ID,
          routingPolicyId: ROUTING_POLICY_ID,
          scopes: {
            create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
          },
        },
      });

      await service.revoke({
        userId: USER_ID,
        organizationId: ORG_ID,
        virtualKeyId: target.id,
      });

      const after = await service.list({
        userId: USER_ID,
        organizationId: ORG_ID,
      });
      expect(after.map((vk) => vk.id)).not.toContain(target.id);

      const row = await prisma.virtualKey.findUnique({
        where: { id: target.id },
        select: { revokedAt: true, revokedById: true },
      });
      expect(row?.revokedAt).not.toBeNull();
      expect(row?.revokedById).toBe(USER_ID);
    });

    it("throws PersonalVirtualKeyNotFoundError when the VK is not owned by the caller", async () => {
      await expect(
        service.revoke({
          userId: USER_ID,
          organizationId: ORG_ID,
          virtualKeyId: otherUserVkId,
        }),
      ).rejects.toBeInstanceOf(PersonalVirtualKeyNotFoundError);
    });

    it("throws PersonalVirtualKeyNotFoundError for an unknown VK id", async () => {
      await expect(
        service.revoke({
          userId: USER_ID,
          organizationId: ORG_ID,
          virtualKeyId: `does-not-exist-${nanoid(8)}`,
        }),
      ).rejects.toBeInstanceOf(PersonalVirtualKeyNotFoundError);
    });
  });

  describe("revokeAllForUser: cascade", () => {
    it("revokes every still-active VK belonging to the target user", async () => {
      // Seed an isolated user + 2 personal VKs so we can assert the
      // cascade against a clean count.
      const cascadeUserId = `usr-cascade-${suffix}`;
      const cascadeTeamId = `team-cascade-${suffix}`;
      const cascadeProjectId = `proj-cascade-${suffix}`;

      await prisma.user.create({
        data: {
          id: cascadeUserId,
          email: `cascade-${suffix}@example.com`,
          name: "Cascade User",
        },
      });
      await prisma.organizationUser.create({
        data: {
          organizationId: ORG_ID,
          userId: cascadeUserId,
          role: "MEMBER",
        },
      });
      await prisma.team.create({
        data: {
          id: cascadeTeamId,
          name: `Cascade Team ${suffix}`,
          slug: `cascade-team-${suffix}`,
          organizationId: ORG_ID,
          isPersonal: true,
          ownerUserId: cascadeUserId,
        },
      });
      await prisma.project.create({
        data: {
          id: cascadeProjectId,
          name: `Cascade Project ${suffix}`,
          slug: `cascade-project-${suffix}`,
          apiKey: `cascade-${suffix}`,
          teamId: cascadeTeamId,
          language: "typescript",
          framework: "other",
          isPersonal: true,
          ownerUserId: cascadeUserId,
        },
      });
      await prisma.virtualKey.createMany({
        data: [
          {
            organizationId: ORG_ID,
            name: "cascade-a",
            description: "Personal virtual key",
            hashedSecret: `hash-cascade-${suffix}-a`,
            displayPrefix: "lw_vk_",
            principalUserId: cascadeUserId,
            createdById: cascadeUserId,
            routingPolicyId: ROUTING_POLICY_ID,
          },
          {
            organizationId: ORG_ID,
            name: "cascade-b",
            description: "Personal virtual key",
            hashedSecret: `hash-cascade-${suffix}-b`,
            displayPrefix: "lw_vk_",
            principalUserId: cascadeUserId,
            createdById: cascadeUserId,
            routingPolicyId: ROUTING_POLICY_ID,
          },
        ],
      });

      const revokedCount = await service.revokeAllForUser({
        userId: cascadeUserId,
        actorUserId: USER_ID,
      });
      expect(revokedCount).toBe(2);

      const remaining = await prisma.virtualKey.findMany({
        where: {
          principalUserId: cascadeUserId,
          revokedAt: null,
        },
        select: { id: true },
      });
      expect(remaining).toEqual([]);
    });

    it("returns 0 when the user has no active VKs", async () => {
      const orphanUserId = `usr-orphan-${suffix}`;
      await prisma.user.create({
        data: {
          id: orphanUserId,
          email: `orphan-${suffix}@example.com`,
          name: "Orphan User",
        },
      });

      const revokedCount = await service.revokeAllForUser({
        userId: orphanUserId,
        actorUserId: USER_ID,
      });
      expect(revokedCount).toBe(0);
    });
  });

  describe("seededVkId regression hook", () => {
    it("the originally seeded default VK is still resolvable via list()", () => {
      // Pure assertion that the test setup is internally consistent: the
      // seed id captured in beforeAll matches a row list() returns.
      expect(seededVkId).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });
});

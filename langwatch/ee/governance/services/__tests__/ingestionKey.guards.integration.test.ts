/**
 * @vitest-environment node
 *
 * Ownership + list-visibility coverage for ingestion keys: the leak the
 * exhaustive review pass found on the unified-ApiKey foundation, invisible to
 * typecheck because it only bites at query time:
 *
 *   Personal ingestion keys were persisted as org service keys (userId null),
 *   so `ApiKeyRepository.findAllByUser` returned every one of them to every
 *   non-admin org member, leaking their source / activity metadata through the
 *   Settings > API Keys list. They are now user-owned, so the list scopes them
 *   to their owner; org-owned keys (userId null) are excluded from the
 *   non-admin list and reached only by org admins.
 *
 * The first case doubles as a regression guard: a personal key is now created
 * with userId set, which subjects the mint to the owner's permission ceiling.
 * A personal-workspace owner holds TEAM-scoped ADMIN, so the test proves that
 * ceiling still cascades to traces:create on a project in the team.
 *
 * Spec: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { ApiKeyRepository } from "~/server/api-key/api-key.repository";
import { ApiKeyService } from "~/server/api-key/api-key.service";

import { IngestionKeyService } from "../ingestionKey.service";

const suffix = nanoid(8);
const ORG_ID = `org-ikg-${suffix}`;
const USER_A = `usrA-ikg-${suffix}`;
const USER_B = `usrB-ikg-${suffix}`;
const TEAM_ID = `team-ikg-${suffix}`;
const PROJECT_ID = `proj-ikg-${suffix}`;

/** A user with TEAM-scoped ADMIN, mirroring a personal-workspace owner. */
async function seedTeamAdmin(userId: string): Promise<void> {
  await prisma.user.create({
    data: { id: userId, email: `${userId}@example.com`, name: userId },
  });
  await prisma.organizationUser.create({
    data: { organizationId: ORG_ID, userId, role: "ADMIN" },
  });
  // TEAM-scoped ADMIN (not org-scoped) so the test proves the personal-team
  // ceiling actually cascades down to traces:create on a project in the team.
  await prisma.roleBinding.create({
    data: {
      organizationId: ORG_ID,
      userId,
      role: "ADMIN",
      scopeType: "TEAM",
      scopeId: TEAM_ID,
    },
  });
}

describe("IngestionKey ownership + list visibility", () => {
  const ingestKeys = IngestionKeyService.create(prisma);
  const apiKeyRepo = ApiKeyRepository.create(prisma);

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: ORG_ID, name: `IKG ${ORG_ID}`, slug: ORG_ID },
    });
    await prisma.team.create({
      data: { id: TEAM_ID, organizationId: ORG_ID, name: `team ${suffix}`, slug: `team-${suffix}` },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        teamId: TEAM_ID,
        name: `proj ${suffix}`,
        slug: `proj-${suffix}`,
        apiKey: `proj-key-${suffix}`,
        language: "other",
        framework: "other",
      },
    });
    await seedTeamAdmin(USER_A);
    await seedTeamAdmin(USER_B);
  });

  afterAll(async () => {
    await prisma.roleBinding.deleteMany({ where: { organizationId: ORG_ID } }).catch(() => undefined);
    await prisma.apiKey.deleteMany({ where: { organizationId: ORG_ID } }).catch(() => undefined);
    await prisma.customRole.deleteMany({ where: { organizationId: ORG_ID } }).catch(() => undefined);
    await prisma.project.deleteMany({ where: { teamId: TEAM_ID } }).catch(() => undefined);
    await prisma.team.deleteMany({ where: { organizationId: ORG_ID } }).catch(() => undefined);
    await prisma.organizationUser.deleteMany({ where: { organizationId: ORG_ID } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: [USER_A, USER_B] } } }).catch(() => undefined);
    await prisma.organization.deleteMany({ where: { id: ORG_ID } }).catch(() => undefined);
  });

  describe("when a team-admin mints a personal-project ingest key", () => {
    it("mints (team-admin ceiling covers project traces:create) and owns the key", async () => {
      const issued = await ingestKeys.ensureForProject({
        callerUserId: USER_A,
        ownerUserId: USER_A,
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        sourceType: "claude_code",
      });
      expect(issued.token).toMatch(/^ik-lw-/);

      const row = await apiKeyRepo.findById({ id: issued.apiKeyId });
      expect(row?.userId).toBe(USER_A);
      expect(row?.ingestSourceType).toBe("claude_code");
    });
  });

  describe("given user A and user B each own a personal ingest key plus an org-owned and a regular service key", () => {
    describe("when user A lists API keys (non-admin list path)", () => {
      /** @scenario Personal ingestion keys are not listed to other organization members */
      it("returns A's own ingest key and the regular service key, but not B's ingest key or the org-owned ingest key", async () => {
        const aKey = await ingestKeys.ensureForProject({
          callerUserId: USER_A,
          ownerUserId: USER_A,
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          sourceType: "gemini",
        });
        const bKey = await ingestKeys.ensureForProject({
          callerUserId: USER_B,
          ownerUserId: USER_B,
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          sourceType: "opencode",
        });
        const orgOwned = await ingestKeys.ensureForProject({
          callerUserId: USER_A,
          ownerUserId: null,
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          sourceType: "org_service_cw",
        });
        // A genuine org service key: userId null, no ingestSourceType, must
        // stay visible to all members exactly as before.
        const { apiKey: serviceKey } = await ApiKeyService.create(prisma).create({
          name: `service ${suffix}`,
          userId: null,
          createdByUserId: USER_A,
          organizationId: ORG_ID,
          permissionMode: "restricted",
          permissions: ["traces:create"],
          bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: PROJECT_ID }],
        });

        const visibleToA = await apiKeyRepo.findAllByUser({
          userId: USER_A,
          organizationId: ORG_ID,
        });
        const ids = new Set(visibleToA.map((k) => k.id));

        expect(ids.has(aKey.apiKeyId)).toBe(true);
        expect(ids.has(serviceKey.id)).toBe(true);
        expect(ids.has(bKey.apiKeyId)).toBe(false);
        expect(ids.has(orgOwned.apiKeyId)).toBe(false);
      });
    });
  });
});

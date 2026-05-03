/**
 * @vitest-environment node
 *
 * Integration coverage for PersonalVirtualKeyService — hits real PG
 * (testcontainers), no mocks. Validates the end-to-end personal-VK
 * lifecycle the CLI device-flow + /me/settings UI both depend on.
 *
 *   1. `ensureDefault` provisions a personal workspace (via
 *      PersonalWorkspaceService) AND issues exactly one default
 *      personal VK on the workspace's project. Calling it a second
 *      time throws PersonalVirtualKeyAlreadyExistsError so the device-
 *      flow approval handler knows to fall through to a device-
 *      labelled key.
 *   2. `issue` creates a new VK on the existing personal project with
 *      a custom label; principalUserId is stamped to the caller; the
 *      VK lives under a Project where isPersonal=true.
 *   3. `list` returns only the caller's personal VKs in the org
 *      (cross-org and cross-user contamination tests).
 *   4. `revoke` flips status + sets revokedAt + bumps revision; only
 *      the caller's own personal VKs are revokable.
 *   5. `revokeAllForUser` cascades correctly on user deactivation.
 *
 * Spec: specs/ai-gateway/governance/personal-keys.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

import {
  PersonalVirtualKeyAlreadyExistsError,
  PersonalVirtualKeyNotFoundError,
  PersonalVirtualKeyService,
} from "../personalVirtualKey.service";
import { PersonalWorkspaceService } from "../personalWorkspace.service";

const suffix = nanoid(8);
const ORG_ID = `org-pvk-${suffix}`;
const OTHER_ORG_ID = `org-pvk-other-${suffix}`;
const USER_ID = `usr-pvk-${suffix}`;
const OTHER_USER_ID = `usr-pvk-other-${suffix}`;
// Admin-side seed in ORG_ID: a shared project + a credential + an
// org-scoped default RoutingPolicy. PersonalVirtualKeyService.issue
// resolves this policy via resolveDefaultForUser and binds it on the
// freshly-issued VK; without it, VirtualKeyService.create takes the
// no-policy + empty-chain branch and rejects (the dispatcher would
// otherwise have no chain to consult). OTHER_ORG_ID intentionally has
// no policy so cross-org tests still observe the bare-issuance error.
const SHARED_PROJECT_ID = `proj-pvk-shared-${suffix}`;
const SHARED_TEAM_ID = `team-pvk-shared-${suffix}`;
const SHARED_MP_ID = `mp-pvk-shared-${suffix}`;
const SHARED_CRED_ID = `cred-pvk-shared-${suffix}`;
const DEFAULT_POLICY_ID = `rp-pvk-default-${suffix}`;

describe("PersonalVirtualKeyService", () => {
  const service = PersonalVirtualKeyService.create(prisma);
  const workspaceService = new PersonalWorkspaceService(prisma);

  beforeAll(async () => {
    await startTestContainers();

    await prisma.organization.createMany({
      data: [
        { id: ORG_ID, name: `PVK Org ${suffix}`, slug: `pvk-${suffix}` },
        {
          id: OTHER_ORG_ID,
          name: `PVK Other ${suffix}`,
          slug: `pvk-other-${suffix}`,
        },
      ],
    });
    await prisma.user.createMany({
      data: [
        { id: USER_ID, email: `pvk-${suffix}@example.com`, name: "Owner" },
        {
          id: OTHER_USER_ID,
          email: `pvk-o-${suffix}@example.com`,
          name: "Other",
        },
      ],
    });
    await prisma.organizationUser.createMany({
      data: [
        { organizationId: ORG_ID, userId: USER_ID, role: "MEMBER" },
        { organizationId: ORG_ID, userId: OTHER_USER_ID, role: "MEMBER" },
        { organizationId: OTHER_ORG_ID, userId: USER_ID, role: "MEMBER" },
      ],
    });

    // Admin-side seed: shared team + shared project (where the
    // GatewayProviderCredential lives) + an org-scoped default
    // RoutingPolicy referencing it. PersonalVirtualKeyService.issue
    // calls resolveDefaultForUser → finds this policy → VK is created
    // through the policy-bound branch. Mirrors the real production
    // path where the org admin configures a default policy before
    // members issue personal keys.
    await prisma.team.create({
      data: {
        id: SHARED_TEAM_ID,
        name: "Shared",
        slug: `pvk-shared-${suffix}`,
        organizationId: ORG_ID,
        isPersonal: false,
      },
    });
    await prisma.project.create({
      data: {
        id: SHARED_PROJECT_ID,
        name: "Shared",
        slug: `pvk-shared-${suffix}`,
        apiKey: `pvk-shared-apikey-${suffix}`,
        teamId: SHARED_TEAM_ID,
        language: "typescript",
        framework: "other",
      },
    });
    await prisma.modelProvider.create({
      data: {
        id: SHARED_MP_ID,
        projectId: SHARED_PROJECT_ID,
        name: "OpenAI",
        provider: "openai",
        enabled: true,
      },
    });
    await prisma.gatewayProviderCredential.create({
      data: {
        id: SHARED_CRED_ID,
        projectId: SHARED_PROJECT_ID,
        modelProviderId: SHARED_MP_ID,
        slot: "primary",
      },
    });
    await prisma.routingPolicy.create({
      data: {
        id: DEFAULT_POLICY_ID,
        organizationId: ORG_ID,
        scope: "organization",
        scopeId: ORG_ID,
        name: "default",
        providerCredentialIds: [SHARED_CRED_ID],
        strategy: "priority",
        isDefault: true,
        createdById: USER_ID,
        updatedById: USER_ID,
      },
    });
  }, 60_000);

  afterAll(async () => {
    const orgIds = [ORG_ID, OTHER_ORG_ID];
    // dbMultiTenancyProtection demands projectId in the WHERE for
    // VirtualKey / GatewayProviderCredential / ModelProvider — resolve
    // project ids explicitly before deleteMany so we satisfy the
    // guard while still scoping to exactly this test's seeded rows.
    const projects = await prisma.project.findMany({
      where: { team: { organizationId: { in: orgIds } } },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);
    if (projectIds.length > 0) {
      await prisma.virtualKey.deleteMany({
        where: { projectId: { in: projectIds } },
      });
    }
    await prisma.roleBinding.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.teamUser.deleteMany({
      where: { team: { organizationId: { in: orgIds } } },
    });
    await prisma.routingPolicy.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    if (projectIds.length > 0) {
      await prisma.gatewayProviderCredential.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await prisma.modelProvider.deleteMany({
        where: { projectId: { in: projectIds } },
      });
    }
    await prisma.project.deleteMany({
      where: { team: { organizationId: { in: orgIds } } },
    });
    await prisma.team.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [USER_ID, OTHER_USER_ID] } },
    });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await stopTestContainers();
  }, 60_000);

  describe("ensureDefault", () => {
    it("provisions personal workspace + issues a default-labelled VK on first call", async () => {
      const issued = await service.ensureDefault({
        userId: USER_ID,
        organizationId: ORG_ID,
        displayEmail: `pvk-${suffix}@example.com`,
      });

      expect(issued.virtualKey.id).toBeDefined();
      expect(issued.virtualKey.name).toBe("default");
      expect(issued.secret).toMatch(/^lw_vk_(live|test)_/);
      expect(issued.baseUrl).toContain("gateway");

      const project = await prisma.project.findUnique({
        where: { id: issued.virtualKey.projectId },
      });
      expect(project?.isPersonal).toBe(true);
      expect(project?.ownerUserId).toBe(USER_ID);

      const vk = await prisma.virtualKey.findUnique({
        where: { id: issued.virtualKey.id },
        include: { project: { include: { team: true } } },
      });
      expect(vk?.principalUserId).toBe(USER_ID);
      expect(vk?.project.team.isPersonal).toBe(true);
      expect(vk?.project.team.ownerUserId).toBe(USER_ID);
    });

    it("throws AlreadyExistsError on second call so caller can fall through to device-key path", async () => {
      await expect(
        service.ensureDefault({
          userId: USER_ID,
          organizationId: ORG_ID,
        }),
      ).rejects.toBeInstanceOf(PersonalVirtualKeyAlreadyExistsError);
    });
  });

  describe("issue (custom-label personal VK)", () => {
    it("creates an additional VK under the same personal project", async () => {
      const workspace = await workspaceService.findExisting({
        userId: USER_ID,
        organizationId: ORG_ID,
      });
      expect(workspace).not.toBeNull();

      const issued = await service.issue({
        userId: USER_ID,
        organizationId: ORG_ID,
        personalProjectId: workspace!.project.id,
        personalTeamId: workspace!.team.id,
        label: "jane-laptop",
      });

      expect(issued.virtualKey.name).toBe("jane-laptop");
      expect(issued.virtualKey.projectId).toBe(workspace!.project.id);
      expect(issued.secret).toBeDefined();
      expect(issued.virtualKey.principalUserId).toBe(USER_ID);
    });
  });

  describe("list", () => {
    it("returns only the caller's personal VKs in the given org", async () => {
      const ownList = await service.list({
        userId: USER_ID,
        organizationId: ORG_ID,
      });
      expect(ownList.length).toBeGreaterThanOrEqual(2);
      expect(ownList.every((k) => k.principalUserId === USER_ID)).toBe(true);

      // Other user with no personal workspace → empty.
      const otherUserList = await service.list({
        userId: OTHER_USER_ID,
        organizationId: ORG_ID,
      });
      expect(otherUserList).toHaveLength(0);

      // Same user but a different org → empty.
      const otherOrgList = await service.list({
        userId: USER_ID,
        organizationId: OTHER_ORG_ID,
      });
      expect(otherOrgList).toHaveLength(0);

      // Critical: never returns the secret.
      for (const k of ownList) {
        expect((k as Record<string, unknown>).hashedSecret).toBeUndefined();
        expect((k as Record<string, unknown>).previousHashedSecret).toBeUndefined();
      }
    });
  });

  describe("revoke", () => {
    it("revokes the caller's own VK; flips status + sets revokedAt", async () => {
      const list = await service.list({ userId: USER_ID, organizationId: ORG_ID });
      const target = list.find((k) => k.name === "jane-laptop");
      expect(target).toBeDefined();

      await service.revoke({
        userId: USER_ID,
        organizationId: ORG_ID,
        virtualKeyId: target!.id,
      });

      const after = await prisma.virtualKey.findUnique({
        where: { id: target!.id },
      });
      expect(after?.status).toBe("REVOKED");
      expect(after?.revokedAt).not.toBeNull();
    });

    it("rejects revoke against a VK owned by another user", async () => {
      // Build a personal VK under OTHER_USER_ID, then try to revoke it as USER_ID.
      const otherIssued = await service.ensureDefault({
        userId: OTHER_USER_ID,
        organizationId: ORG_ID,
        displayEmail: `pvk-o-${suffix}@example.com`,
      });

      await expect(
        service.revoke({
          userId: USER_ID, // wrong owner
          organizationId: ORG_ID,
          virtualKeyId: otherIssued.virtualKey.id,
        }),
      ).rejects.toBeInstanceOf(PersonalVirtualKeyNotFoundError);

      // VK should still be active.
      const stillActive = await prisma.virtualKey.findUnique({
        where: { id: otherIssued.virtualKey.id },
      });
      expect(stillActive?.status).toBe("ACTIVE");
    });
  });

  describe("revokeAllForUser", () => {
    it("cascades a revoke across all personal VKs the user owns", async () => {
      // OTHER_USER_ID currently has 1 active personal VK (the one
      // ensureDefault created above). Add a second.
      const workspace = await workspaceService.findExisting({
        userId: OTHER_USER_ID,
        organizationId: ORG_ID,
      });
      await service.issue({
        userId: OTHER_USER_ID,
        organizationId: ORG_ID,
        personalProjectId: workspace!.project.id,
        personalTeamId: workspace!.team.id,
        label: "extra-key",
      });

      // dbMultiTenancyProtection requires projectId in the WHERE on
      // VirtualKey — resolve the personal projects first.
      const personalProjects = await prisma.project.findMany({
        where: { isPersonal: true, ownerUserId: OTHER_USER_ID },
        select: { id: true },
      });
      const personalProjectIds = personalProjects.map((p) => p.id);

      const beforeCount = await prisma.virtualKey.count({
        where: {
          projectId: { in: personalProjectIds },
          principalUserId: OTHER_USER_ID,
          revokedAt: null,
        },
      });
      expect(beforeCount).toBeGreaterThanOrEqual(2);

      const revokedCount = await service.revokeAllForUser({
        userId: OTHER_USER_ID,
        actorUserId: OTHER_USER_ID,
      });
      expect(revokedCount).toBe(beforeCount);

      const afterActive = await prisma.virtualKey.count({
        where: {
          projectId: { in: personalProjectIds },
          principalUserId: OTHER_USER_ID,
          revokedAt: null,
        },
      });
      expect(afterActive).toBe(0);
    });
  });
});

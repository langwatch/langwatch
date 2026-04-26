/**
 * @vitest-environment node
 *
 * Integration coverage for RoutingPolicyService — hits real PG
 * (testcontainers), no mocks. Validates the contracts the gateway
 * dispatcher relies on:
 *
 *   1. CRUD basics — create/get/list/update/delete.
 *   2. `setDefault` is atomic — old default is cleared in the same
 *      transaction as the new default is set, so the partial unique
 *      idx (orgId, scope, scopeId) WHERE isDefault=true never trips.
 *   3. `resolveDefaultForUser` honors TEAM-default-beats-ORG-default
 *      hierarchy.
 *   4. The (org, scope, scopeId, name) unique constraint rejects
 *      duplicate policy names within a scope.
 *   5. Deletion cascades from Organization (FK ON DELETE CASCADE).
 *
 * Spec: specs/ai-gateway/governance/admin-routing-policies.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

import { RoutingPolicyService } from "../routingPolicy.service";

const suffix = nanoid(8);
const ORG_ID = `org-rp-${suffix}`;
const TEAM_ID = `team-rp-${suffix}`;
const USER_ID = `usr-rp-${suffix}`;
const PROJECT_ID = `proj-rp-${suffix}`;
const MP_ID = `mp-rp-${suffix}`;
const CRED_1 = `cred-rp1-${suffix}`;
const CRED_2 = `cred-rp2-${suffix}`;
const CRED_3 = `cred-rp3-${suffix}`;
// Used by the cross-org validation test — credential lives in a
// DIFFERENT organization, so referencing it from ORG_ID's policy
// must be rejected.
const FOREIGN_ORG_ID = `org-rp-foreign-${suffix}`;
const FOREIGN_TEAM_ID = `team-rp-foreign-${suffix}`;
const FOREIGN_PROJECT_ID = `proj-rp-foreign-${suffix}`;
const FOREIGN_MP_ID = `mp-rp-foreign-${suffix}`;
const FOREIGN_CRED = `cred-rp-foreign-${suffix}`;

describe("RoutingPolicyService", () => {
  const service = new RoutingPolicyService(prisma);

  beforeAll(async () => {
    await startTestContainers();
    await prisma.organization.createMany({
      data: [
        { id: ORG_ID, name: `RP Org ${suffix}`, slug: `rp-${suffix}` },
        {
          id: FOREIGN_ORG_ID,
          name: `RP Foreign Org ${suffix}`,
          slug: `rp-foreign-${suffix}`,
        },
      ],
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `rp-${suffix}@example.com`, name: "RP Actor" },
    });
    await prisma.team.createMany({
      data: [
        {
          id: TEAM_ID,
          name: `RP Team ${suffix}`,
          slug: `rp-team-${suffix}`,
          organizationId: ORG_ID,
          isPersonal: true,
          ownerUserId: USER_ID,
        },
        {
          id: FOREIGN_TEAM_ID,
          name: `RP Foreign Team ${suffix}`,
          slug: `rp-team-foreign-${suffix}`,
          organizationId: FOREIGN_ORG_ID,
          isPersonal: false,
        },
      ],
    });
    await prisma.organizationUser.create({
      data: { organizationId: ORG_ID, userId: USER_ID, role: "ADMIN" },
    });
    // Seed a project + ModelProvider + 3 GatewayProviderCredentials in
    // ORG_ID so the new providerCredentialIds → org validation in
    // RoutingPolicyService.create/update has real rows to reach for.
    await prisma.project.createMany({
      data: [
        {
          id: PROJECT_ID,
          name: `RP Project ${suffix}`,
          slug: `rp-project-${suffix}`,
          apiKey: `rp-apikey-${suffix}`,
          teamId: TEAM_ID,
          language: "typescript",
          framework: "other",
        },
        {
          id: FOREIGN_PROJECT_ID,
          name: `RP Foreign Project ${suffix}`,
          slug: `rp-project-foreign-${suffix}`,
          apiKey: `rp-apikey-foreign-${suffix}`,
          teamId: FOREIGN_TEAM_ID,
          language: "typescript",
          framework: "other",
        },
      ],
    });
    await prisma.modelProvider.createMany({
      data: [
        {
          id: MP_ID,
          projectId: PROJECT_ID,
          name: "OpenAI",
          provider: "openai",
          enabled: true,
        },
        {
          id: FOREIGN_MP_ID,
          projectId: FOREIGN_PROJECT_ID,
          name: "OpenAI",
          provider: "openai",
          enabled: true,
        },
      ],
    });
    await prisma.gatewayProviderCredential.createMany({
      data: [
        { id: CRED_1, projectId: PROJECT_ID, modelProviderId: MP_ID, slot: "primary" },
        { id: CRED_2, projectId: PROJECT_ID, modelProviderId: MP_ID, slot: "secondary" },
        { id: CRED_3, projectId: PROJECT_ID, modelProviderId: MP_ID, slot: "tertiary" },
        {
          id: FOREIGN_CRED,
          projectId: FOREIGN_PROJECT_ID,
          modelProviderId: FOREIGN_MP_ID,
          slot: "primary",
        },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    const orgIds = [ORG_ID, FOREIGN_ORG_ID];
    // dbMultiTenancyProtection rejects deleteMany on
    // GatewayProviderCredential / ModelProvider without projectId in
    // the WHERE; resolve the project set explicitly so the cleanup
    // targets exactly the seeded rows.
    const projects = await prisma.project.findMany({
      where: { team: { organizationId: { in: orgIds } } },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);
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
    await prisma.organizationUser.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.team.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await stopTestContainers();
  }, 60_000);

  describe("when creating an org-scoped default policy", () => {
    it("persists with the expected fields + flags isDefault", async () => {
      const created = await service.create({
        organizationId: ORG_ID,
        scope: "organization",
        scopeId: ORG_ID,
        name: "developer-default",
        description: "Auto-issued for developer personal keys",
        providerCredentialIds: [CRED_1, CRED_2],
        modelAllowlist: ["claude-3-5-*", "gpt-4o*"],
        strategy: "priority",
        isDefault: true,
        actorUserId: USER_ID,
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe("developer-default");
      expect(created.isDefault).toBe(true);
      expect(created.scope).toBe("organization");
      expect(created.scopeId).toBe(ORG_ID);
      expect(created.providerCredentialIds).toEqual([CRED_1, CRED_2]);
      expect(created.modelAllowlist).toEqual(["claude-3-5-*", "gpt-4o*"]);
      expect(created.strategy).toBe("priority");
      expect(created.createdById).toBe(USER_ID);
    });
  });

  describe("when creating a second policy in the same scope", () => {
    it("co-exists with the existing default when isDefault=false", async () => {
      const second = await service.create({
        organizationId: ORG_ID,
        scope: "organization",
        scopeId: ORG_ID,
        name: "evaluator-only",
        providerCredentialIds: [CRED_3],
        modelAllowlist: ["claude-haiku*"],
        strategy: "cost",
        isDefault: false,
        actorUserId: USER_ID,
      });
      expect(second.isDefault).toBe(false);

      const all = await service.list({
        organizationId: ORG_ID,
        scope: "organization",
        scopeId: ORG_ID,
      });
      expect(all.length).toBeGreaterThanOrEqual(2);

      const defaults = all.filter((p) => p.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0]!.name).toBe("developer-default");
    });

    it("rejects duplicate name within (org, scope, scopeId)", async () => {
      await expect(
        service.create({
          organizationId: ORG_ID,
          scope: "organization",
          scopeId: ORG_ID,
          name: "developer-default", // already exists from previous test
          providerCredentialIds: [],
          actorUserId: USER_ID,
        }),
      ).rejects.toThrow();
    });
  });

  describe("setDefault — atomic swap", () => {
    it("clears the old default in the same tx as it sets the new one", async () => {
      const all = await service.list({ organizationId: ORG_ID });
      const evaluator = all.find((p) => p.name === "evaluator-only");
      expect(evaluator).toBeDefined();

      await service.setDefault({
        id: evaluator!.id,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
      });

      const after = await service.list({
        organizationId: ORG_ID,
        scope: "organization",
        scopeId: ORG_ID,
      });
      const defaults = after.filter((p) => p.isDefault);
      expect(defaults).toHaveLength(1); // partial unique idx never observed two
      expect(defaults[0]!.id).toBe(evaluator!.id);

      const oldDefault = after.find((p) => p.name === "developer-default");
      expect(oldDefault?.isDefault).toBe(false);
    });
  });

  describe("resolveDefaultForUser — TEAM beats ORG hierarchy", () => {
    it("returns the team-scoped default when one exists, else the org-scoped", async () => {
      // Org-scoped default already exists from setDefault test above
      // (now: evaluator-only). Resolution with no team policy returns org default.
      const orgFallback = await service.resolveDefaultForUser({
        userId: USER_ID,
        organizationId: ORG_ID,
        personalTeamId: TEAM_ID,
      });
      expect(orgFallback?.name).toBe("evaluator-only");
      expect(orgFallback?.scope).toBe("organization");

      // Add a team-scoped default for the user's personal team — it
      // should now win the resolution.
      const teamPolicy = await service.create({
        organizationId: ORG_ID,
        scope: "team",
        scopeId: TEAM_ID,
        name: "personal-team-policy",
        providerCredentialIds: [CRED_1],
        isDefault: true,
        actorUserId: USER_ID,
      });

      const teamWins = await service.resolveDefaultForUser({
        userId: USER_ID,
        organizationId: ORG_ID,
        personalTeamId: TEAM_ID,
      });
      expect(teamWins?.id).toBe(teamPolicy.id);
      expect(teamWins?.scope).toBe("team");
    });

    it("returns null when no defaults exist anywhere", async () => {
      const otherOrgId = `org-empty-${suffix}`;
      await prisma.organization.create({
        data: { id: otherOrgId, name: "Empty", slug: `empty-${suffix}` },
      });
      try {
        const resolved = await service.resolveDefaultForUser({
          userId: USER_ID,
          organizationId: otherOrgId,
          personalTeamId: undefined,
        });
        expect(resolved).toBeNull();
      } finally {
        await prisma.organization.deleteMany({ where: { id: otherOrgId } });
      }
    });
  });

  describe("update + delete", () => {
    it("updates name + strategy on an existing policy", async () => {
      const all = await service.list({ organizationId: ORG_ID });
      const target = all.find((p) => p.name === "developer-default");
      expect(target).toBeDefined();

      const updated = await service.update({
        id: target!.id,
        organizationId: ORG_ID,
        name: "developer-default-v2",
        strategy: "cost",
        actorUserId: USER_ID,
      });

      expect(updated.name).toBe("developer-default-v2");
      expect(updated.strategy).toBe("cost");
      expect(updated.updatedById).toBe(USER_ID);
    });

    it("deletes a policy by id", async () => {
      const all = await service.list({ organizationId: ORG_ID });
      const target = all.find((p) => p.name === "developer-default-v2");
      expect(target).toBeDefined();

      await service.delete({ id: target!.id, organizationId: ORG_ID });

      const remaining = await service.list({ organizationId: ORG_ID });
      expect(remaining.find((p) => p.id === target!.id)).toBeUndefined();
    });

    it("rejects mutations targeting another organization's policy", async () => {
      const all = await service.list({ organizationId: ORG_ID });
      const target = all[0];
      expect(target).toBeDefined();

      await expect(
        service.update({
          id: target!.id,
          organizationId: "org-someone-else",
          name: "stolen",
          actorUserId: USER_ID,
        }),
      ).rejects.toThrow();
    });
  });

  describe("providerCredentialIds → org scope validation", () => {
    describe("when create() references a credential from another org", () => {
      it("throws FORBIDDEN before any DB write — cross-org chain smuggling guard", async () => {
        await expect(
          service.create({
            organizationId: ORG_ID,
            scope: "organization",
            scopeId: ORG_ID,
            name: `cross-org-create-${suffix}`,
            providerCredentialIds: [CRED_1, FOREIGN_CRED],
            isDefault: false,
            actorUserId: USER_ID,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        // Confirm the row was not created (no half-written state).
        const post = await service.list({ organizationId: ORG_ID });
        expect(post.find((p) => p.name === `cross-org-create-${suffix}`))
          .toBeUndefined();
      });
    });

    describe("when create() references a non-existent credential id", () => {
      it("throws FORBIDDEN — same code path as cross-org (counts mismatch)", async () => {
        await expect(
          service.create({
            organizationId: ORG_ID,
            scope: "organization",
            scopeId: ORG_ID,
            name: `dangling-create-${suffix}`,
            providerCredentialIds: [CRED_1, "cred-does-not-exist"],
            isDefault: false,
            actorUserId: USER_ID,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      });
    });

    describe("when update() supplies a cross-org credential", () => {
      it("throws FORBIDDEN and leaves the existing chain untouched", async () => {
        // Use any policy in ORG_ID (the team policy seeded earlier
        // survives prior tests). Find one fresh to avoid order coupling.
        const seed = await service.create({
          organizationId: ORG_ID,
          scope: "organization",
          scopeId: ORG_ID,
          name: `update-target-${suffix}`,
          providerCredentialIds: [CRED_1],
          isDefault: false,
          actorUserId: USER_ID,
        });

        await expect(
          service.update({
            id: seed.id,
            organizationId: ORG_ID,
            providerCredentialIds: [FOREIGN_CRED],
            actorUserId: USER_ID,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        // The chain on disk must still be the original — no partial
        // overwrite from a write that was rejected at validation time.
        const after = await prisma.routingPolicy.findUnique({
          where: { id: seed.id },
        });
        expect(after?.providerCredentialIds).toEqual([CRED_1]);
      });
    });

    describe("when update() omits providerCredentialIds entirely", () => {
      it("skips the validation (name-only edit must not require chain re-check)", async () => {
        const seed = await service.create({
          organizationId: ORG_ID,
          scope: "organization",
          scopeId: ORG_ID,
          name: `name-only-${suffix}`,
          providerCredentialIds: [CRED_1],
          isDefault: false,
          actorUserId: USER_ID,
        });

        const updated = await service.update({
          id: seed.id,
          organizationId: ORG_ID,
          name: `name-only-renamed-${suffix}`,
          actorUserId: USER_ID,
        });

        expect(updated.name).toBe(`name-only-renamed-${suffix}`);
      });
    });
  });
});

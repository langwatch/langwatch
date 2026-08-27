/** @vitest-environment node */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { getApp } from "~/server/app-layer";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { cleanupTestRows } from "../../../test-utils/cleanupTestRows";
import { prisma } from "../../db";

wireDefaultTestApp();

const hasCredentialsSecret = Boolean(process.env.CREDENTIALS_SECRET);

describe.skipIf(!hasCredentialsSecret)(
  "model provider scope authorization (real DB)",
  () => {
    const namespace = `model-provider-authz-${nanoid(8)}`;

    let organizationId: string;
    let teamAId: string;
    let teamBId: string;
    let projectAId: string;
    let projectBId: string;
    let orgAdminId: string;
    let teamAAdminId: string;
    let teamAMemberId: string;
    let teamBAdminId: string;

    const service = () => getApp().modelProviders;

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: {
          name: `Model Provider Authz ${namespace}`,
          slug: `--${namespace}`,
        },
      });
      organizationId = organization.id;

      const [teamA, teamB] = await Promise.all([
        prisma.team.create({
          data: {
            name: `Model Provider Team A ${namespace}`,
            slug: `--${namespace}-a`,
            organizationId,
          },
        }),
        prisma.team.create({
          data: {
            name: `Model Provider Team B ${namespace}`,
            slug: `--${namespace}-b`,
            organizationId,
          },
        }),
      ]);
      teamAId = teamA.id;
      teamBId = teamB.id;

      const [projectA, projectB] = await Promise.all([
        prisma.project.create({
          data: {
            name: `Model Provider Project A ${namespace}`,
            slug: `--${namespace}-a`,
            teamId: teamAId,
            language: "typescript",
            framework: "other",
            apiKey: `model-provider-authz-a-${namespace}`,
          },
        }),
        prisma.project.create({
          data: {
            name: `Model Provider Project B ${namespace}`,
            slug: `--${namespace}-b`,
            teamId: teamBId,
            language: "typescript",
            framework: "other",
            apiKey: `model-provider-authz-b-${namespace}`,
          },
        }),
      ]);
      projectAId = projectA.id;
      projectBId = projectB.id;

      const [orgAdmin, teamAAdmin, teamAMember, teamBAdmin] = await Promise.all([
        prisma.user.create({
          data: {
            name: "Model Provider Org Admin",
            email: `model-provider-org-admin-${namespace}@example.com`,
          },
        }),
        prisma.user.create({
          data: {
            name: "Model Provider Team A Admin",
            email: `model-provider-team-a-admin-${namespace}@example.com`,
          },
        }),
        prisma.user.create({
          data: {
            name: "Model Provider Team A Member",
            email: `model-provider-team-a-member-${namespace}@example.com`,
          },
        }),
        prisma.user.create({
          data: {
            name: "Model Provider Team B Admin",
            email: `model-provider-team-b-admin-${namespace}@example.com`,
          },
        }),
      ]);
      orgAdminId = orgAdmin.id;
      teamAAdminId = teamAAdmin.id;
      teamAMemberId = teamAMember.id;
      teamBAdminId = teamBAdmin.id;

      await prisma.organizationUser.createMany({
        data: [
          { userId: orgAdminId, organizationId, role: OrganizationUserRole.ADMIN },
          { userId: teamAAdminId, organizationId, role: OrganizationUserRole.MEMBER },
          { userId: teamAMemberId, organizationId, role: OrganizationUserRole.MEMBER },
          { userId: teamBAdminId, organizationId, role: OrganizationUserRole.MEMBER },
        ],
      });
      await prisma.roleBinding.create({
        data: {
          organizationId,
          userId: orgAdminId,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
      });
      await prisma.teamUser.createMany({
        data: [
          { userId: teamAAdminId, teamId: teamAId, role: TeamUserRole.ADMIN },
          { userId: teamAMemberId, teamId: teamAId, role: TeamUserRole.MEMBER },
          { userId: teamBAdminId, teamId: teamBId, role: TeamUserRole.ADMIN },
        ],
      });
    });

    afterAll(async () => {
      await cleanupTestRows(prisma, [
        ["modelProvider", { organizationId }],
        ["roleBinding", { organizationId }],
        ["teamUser", { userId: { in: [teamAAdminId, teamAMemberId, teamBAdminId] } }],
        ["organizationUser", { organizationId }],
        [
          "project",
          {
            id: { in: [projectAId, projectBId] },
          },
        ],
        ["team", { id: { in: [teamAId, teamBId] } }],
        ["organization", { id: organizationId }],
        [
          "user",
          {
            id: { in: [orgAdminId, teamAAdminId, teamAMemberId, teamBAdminId] },
          },
        ],
      ]);
    });

    it("allows an organization admin to create an organization-scoped provider", async () => {
      const provider = await service().upsert({
        projectId: projectAId,
        actorId: orgAdminId,
        provider: "openai",
        enabled: true,
        customKeys: { OPENAI_API_KEY: `sk-org-${namespace}` },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
      });

      const scopes = await prisma.modelProviderScope.findMany({
        where: { modelProviderId: provider.id },
      });
      expect(scopes).toEqual([
        expect.objectContaining({
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
        }),
      ]);
    });

    it("rejects an organization scope for team admins and members before persistence", async () => {
      const before = await prisma.modelProvider.count({
        where: { organizationId, provider: "anthropic" },
      });

      for (const actorId of [teamAAdminId, teamAMemberId]) {
        await expect(
          service().upsert({
            projectId: projectAId,
            actorId,
            provider: "anthropic",
            enabled: true,
            customKeys: { ANTHROPIC_API_KEY: `sk-anthropic-${namespace}` },
            scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
          }),
        ).rejects.toMatchObject({ code: "model_provider_scope_forbidden" });
      }

      await expect(
        prisma.modelProvider.count({ where: { organizationId, provider: "anthropic" } }),
      ).resolves.toBe(before);
    });

    it("allows a team admin to write its own team scope and rejects another team's scope", async () => {
      await expect(
        service().upsert({
          projectId: projectAId,
          actorId: teamAAdminId,
          provider: "groq",
          enabled: true,
          customKeys: { GROQ_API_KEY: `sk-groq-${namespace}` },
          scopes: [{ scopeType: "TEAM", scopeId: teamAId }],
        }),
      ).resolves.toMatchObject({ provider: "groq" });

      await expect(
        service().upsert({
          projectId: projectBId,
          actorId: teamAAdminId,
          provider: "xai",
          enabled: true,
          customKeys: { XAI_API_KEY: `sk-xai-${namespace}` },
          scopes: [{ scopeType: "TEAM", scopeId: teamBId }],
        }),
      ).rejects.toMatchObject({ code: "model_provider_scope_forbidden" });
    });

    it("rejects a mixed authorized and unauthorized scope set without creating a row", async () => {
      const before = await prisma.modelProvider.count({
        where: { organizationId, provider: "deepseek" },
      });

      await expect(
        service().upsert({
          projectId: projectAId,
          actorId: teamAAdminId,
          provider: "deepseek",
          enabled: true,
          customKeys: { DEEPSEEK_API_KEY: `sk-deepseek-${namespace}` },
          scopes: [
            { scopeType: "TEAM", scopeId: teamAId },
            { scopeType: "ORGANIZATION", scopeId: organizationId },
          ],
        }),
      ).rejects.toMatchObject({ code: "model_provider_scope_forbidden" });

      await expect(
        prisma.modelProvider.count({ where: { organizationId, provider: "deepseek" } }),
      ).resolves.toBe(before);
    });

    it("persists every scope an organization admin is allowed to manage", async () => {
      const provider = await service().upsert({
        projectId: projectAId,
        actorId: orgAdminId,
        provider: "cerebras",
        enabled: true,
        customKeys: { CEREBRAS_API_KEY: `sk-cerebras-${namespace}` },
        scopes: [
          { scopeType: "ORGANIZATION", scopeId: organizationId },
          { scopeType: "TEAM", scopeId: teamAId },
          { scopeType: "PROJECT", scopeId: projectAId },
        ],
      });

      const scopes = await prisma.modelProviderScope.findMany({
        where: { modelProviderId: provider.id },
      });
      expect(scopes.map((scope) => scope.scopeType).sort()).toEqual([
        "ORGANIZATION",
        "PROJECT",
        "TEAM",
      ]);
    });

    it("authorizes old and new scopes before replacing the scope set", async () => {
      const provider = await service().upsert({
        projectId: projectAId,
        actorId: orgAdminId,
        provider: "groq",
        enabled: true,
        customKeys: { GROQ_API_KEY: `sk-groq-replace-${namespace}` },
        scopes: [
          { scopeType: "ORGANIZATION", scopeId: organizationId },
          { scopeType: "TEAM", scopeId: teamAId },
        ],
      });

      await service().upsert({
        id: provider.id,
        projectId: projectAId,
        actorId: orgAdminId,
        provider: "groq",
        enabled: true,
        scopes: [{ scopeType: "PROJECT", scopeId: projectAId }],
      });

      const scopes = await prisma.modelProviderScope.findMany({
        where: { modelProviderId: provider.id },
      });
      expect(scopes).toEqual([
        expect.objectContaining({ scopeType: "PROJECT", scopeId: projectAId }),
      ]);
    });

    it("rejects an advanced update when the actor cannot manage the existing scope", async () => {
      const provider = await service().upsert({
        projectId: projectAId,
        actorId: orgAdminId,
        provider: "xai",
        enabled: true,
        customKeys: { XAI_API_KEY: `sk-xai-advanced-${namespace}` },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
      });

      await expect(
        service().upsert({
          id: provider.id,
          projectId: projectAId,
          actorId: teamAAdminId,
          provider: "xai",
          enabled: true,
          rateLimitRpm: 600,
        }),
      ).rejects.toMatchObject({ code: "model_provider_scope_forbidden" });

      await expect(
        prisma.modelProvider.findUnique({
          where: { id: provider.id },
          select: { rateLimitRpm: true },
        }),
      ).resolves.toMatchObject({ rateLimitRpm: null });
    });

    it("allows an organization admin to persist an advanced update", async () => {
      const provider = await service().upsert({
        projectId: projectAId,
        actorId: orgAdminId,
        provider: "cerebras",
        enabled: true,
        customKeys: { CEREBRAS_API_KEY: `sk-cerebras-advanced-${namespace}` },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
      });

      await service().upsert({
        id: provider.id,
        projectId: projectAId,
        actorId: orgAdminId,
        provider: "cerebras",
        enabled: true,
        rateLimitRpm: 900,
      });

      await expect(
        prisma.modelProvider.findUnique({
          where: { id: provider.id },
          select: { rateLimitRpm: true },
        }),
      ).resolves.toMatchObject({ rateLimitRpm: 900 });
    });

    it("does not turn a missing id into a new provider", async () => {
      const before = await prisma.modelProvider.count({
        where: { organizationId, provider: "groq" },
      });

      await expect(
        service().upsert({
          id: `missing-${namespace}`,
          projectId: projectAId,
          actorId: orgAdminId,
          provider: "groq",
          enabled: true,
          customKeys: { GROQ_API_KEY: `sk-groq-missing-${namespace}` },
        }),
      ).rejects.toMatchObject({ code: "model_provider_not_found" });

      await expect(
        prisma.modelProvider.count({
          where: { organizationId, provider: "groq" },
        }),
      ).resolves.toBe(before);
    });

    it("allows a team admin to delete a provider in its own team", async () => {
      const provider = await service().upsert({
        projectId: projectAId,
        actorId: teamAAdminId,
        provider: "custom",
        enabled: true,
        customKeys: { CUSTOM_BASE_URL: `https://${namespace}.example.test/v1` },
        scopes: [{ scopeType: "TEAM", scopeId: teamAId }],
      });

      await service().delete({
        id: provider.id,
        projectId: projectAId,
        actorId: teamAAdminId,
        provider: "custom",
      });

      await expect(
        prisma.modelProvider.findUnique({ where: { id: provider.id } }),
      ).resolves.toBeNull();
    });

    it("rejects deletion from a different team and leaves the provider in place", async () => {
      const provider = await service().upsert({
        projectId: projectAId,
        actorId: teamAAdminId,
        provider: "azure_safety",
        enabled: true,
        customKeys: {
          AZURE_CONTENT_SAFETY_ENDPOINT: `https://${namespace}.example.test`,
          AZURE_CONTENT_SAFETY_KEY: `key-${namespace}`,
        },
        scopes: [{ scopeType: "TEAM", scopeId: teamAId }],
      });

      await expect(
        service().delete({
          id: provider.id,
          projectId: projectAId,
          actorId: teamBAdminId,
          provider: "azure_safety",
        }),
      ).rejects.toMatchObject({ code: "model_provider_scope_forbidden" });

      await expect(
        prisma.modelProvider.findUnique({ where: { id: provider.id } }),
      ).resolves.not.toBeNull();
    });
  },
);

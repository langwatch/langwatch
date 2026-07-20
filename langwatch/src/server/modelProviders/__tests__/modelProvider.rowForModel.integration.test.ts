/**
 * @vitest-environment node
 *
 * Real-Postgres integration coverage for runtime provider-row selection
 * following the model (specs/model-providers/scope-and-multi-instance
 * .feature, "Runtime provider-row selection follows the model").
 *
 * Customer shape that motivated it: an ORGANIZATION-scoped Azure row
 * carries the current model catalog (gpt-5.4-mini) and working
 * credentials, while a stale PROJECT-scoped Azure row only lists the
 * old gpt-4o models. The scope collapse hands runtime callers the
 * PROJECT row, so the org-catalog default executed against the stale
 * row's Azure resource and 404'd ("Resource not found") — breaking
 * translate, Ask AI, and topic clustering for the whole project.
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prepareLitellmParams } from "../../api/routers/modelProviders.utils";
import { prisma } from "../../db";
import { ModelProviderService } from "../modelProvider.service";

describe("Runtime provider-row selection follows the model (real DB)", () => {
  const ns = `mp-row-${nanoid(8)}`;

  let organizationId: string;
  let teamId: string;
  let projectId: string;
  let orgAdminUserId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `Row For Model Org ${ns}`, slug: `--test-${ns}` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: { name: `Team ${ns}`, slug: `--team-${ns}`, organizationId },
    });
    teamId = team.id;

    const project = await prisma.project.create({
      data: {
        name: `Project ${ns}`,
        slug: `--proj-${ns}`,
        teamId: team.id,
        language: "typescript",
        framework: "other",
        apiKey: `test-key-${ns}`,
      },
    });
    projectId = project.id;

    const orgAdmin = await prisma.user.create({
      data: { name: "Org Admin", email: `org-admin-${ns}@example.com` },
    });
    orgAdminUserId = orgAdmin.id;
    await prisma.organizationUser.create({
      data: {
        userId: orgAdmin.id,
        organizationId,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.roleBinding.create({
      data: {
        organizationId,
        userId: orgAdmin.id,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    });
  });

  afterAll(async () => {
    await prisma.modelProvider.deleteMany({
      where: {
        OR: [
          { scopes: { some: { scopeType: "PROJECT", scopeId: projectId } } },
          {
            scopes: {
              some: { scopeType: "ORGANIZATION", scopeId: organizationId },
            },
          },
        ],
      },
    });
    await prisma.roleBinding.deleteMany({ where: { organizationId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.user.deleteMany({ where: { id: orgAdminUserId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  });

  function service() {
    return ModelProviderService.create(prisma);
  }

  function ctx() {
    return {
      prisma,
      session: {
        user: {
          id: orgAdminUserId,
          email: `org-admin-${ns}@example.com`,
          name: "Org Admin",
        },
        expires: "2099-01-01T00:00:00.000Z",
      } as any,
    };
  }

  describe("when the collapse winner does not serve the resolved model", () => {
    beforeAll(async () => {
      // The org row carries the current catalog + working credentials.
      await service().updateModelProvider(
        {
          projectId,
          provider: "azure",
          enabled: true,
          customKeys: {
            AZURE_OPENAI_API_KEY: `sk-org-${ns}`,
            AZURE_OPENAI_ENDPOINT: "https://org-resource.openai.azure.com",
          },
          customModels: [
            {
              modelId: "gpt-5.4-mini",
              displayName: "gpt-5.4-mini",
              mode: "chat",
            },
          ],
          customEmbeddingsModels: [
            {
              modelId: "text-embedding-3-small",
              displayName: "text-embedding-3-small",
              mode: "embedding",
            },
          ],
          scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
        },
        ctx(),
      );

      // The stale project row only knows the old models.
      await service().updateModelProvider(
        {
          projectId,
          provider: "azure",
          enabled: true,
          customKeys: {
            AZURE_OPENAI_API_KEY: `sk-project-${ns}`,
            AZURE_OPENAI_ENDPOINT: "https://old-resource.openai.azure.com",
          },
          customModels: [
            { modelId: "gpt-4o", displayName: "gpt-4o", mode: "chat" },
          ],
          scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
        },
        ctx(),
      );
    });

    it("collapses to the project row for the provider key (unchanged semantics)", async () => {
      const providers = await service().getProjectModelProviders(projectId);
      expect(providers.azure?.scopeType).toBe("PROJECT");
    });

    /** @scenario Model served only by a wider-scope row uses that row's credentials */
    it("prepares the call with the org row's credentials for the org-catalog model", async () => {
      const providers = await service().getProjectModelProviders(projectId);
      const params = await prepareLitellmParams({
        model: "azure/gpt-5.4-mini",
        modelProvider: providers.azure!,
        projectId,
      });
      expect(params.api_key).toBe(`sk-org-${ns}`);
      expect(params.api_base).toBe("https://org-resource.openai.azure.com");
    });

    /** @scenario Model served by several rows uses the narrowest scope */
    it("keeps the project row's credentials for a model its catalog lists", async () => {
      const providers = await service().getProjectModelProviders(projectId);
      const params = await prepareLitellmParams({
        model: "azure/gpt-4o",
        modelProvider: providers.azure!,
        projectId,
      });
      expect(params.api_key).toBe(`sk-project-${ns}`);
      expect(params.api_base).toBe("https://old-resource.openai.azure.com");
    });

    /** @scenario Embeddings models follow the same row-selection rule */
    it("routes embeddings models to the row whose embeddings catalog lists them", async () => {
      const providers = await service().getProjectModelProviders(projectId);
      const params = await prepareLitellmParams({
        model: "azure/text-embedding-3-small",
        modelProvider: providers.azure!,
        projectId,
      });
      expect(params.api_key).toBe(`sk-org-${ns}`);
    });

    /** @scenario Disabled rows never serve a model even when their catalog lists it */
    it("never swaps to a disabled row even when its catalog lists the model", async () => {
      // Disable the org row; the project row (collapse winner) stays.
      const providers = await service().getProjectModelProviders(projectId);
      const orgRowId = (
        await prisma.modelProvider.findMany({
          where: {
            provider: "azure",
            scopes: {
              some: { scopeType: "ORGANIZATION", scopeId: organizationId },
            },
          },
          select: { id: true },
        })
      )[0]!.id;
      await prisma.modelProvider.update({
        where: { id: orgRowId },
        data: { enabled: false },
      });
      try {
        const params = await prepareLitellmParams({
          model: "azure/gpt-5.4-mini",
          modelProvider: providers.azure!,
          projectId,
        });
        expect(params.api_key).toBe(`sk-project-${ns}`);
      } finally {
        await prisma.modelProvider.update({
          where: { id: orgRowId },
          data: { enabled: true },
        });
      }
    });
  });

  describe("when a shared row also carries another project's scope", () => {
    let otherProjectId: string;

    beforeAll(async () => {
      const otherProject = await prisma.project.create({
        data: {
          name: `Other Project ${ns}`,
          slug: `--proj-other-${ns}`,
          teamId,
          language: "typescript",
          framework: "other",
          apiKey: `test-key-other-${ns}`,
        },
      });
      otherProjectId = otherProject.id;

      // Shared row: ORGANIZATION scope + the OTHER project's scope. For
      // the project under test it only applies at ORGANIZATION tier —
      // the foreign PROJECT attachment must not inflate its rank.
      await service().updateModelProvider(
        {
          projectId,
          provider: "gemini",
          enabled: true,
          customKeys: { GEMINI_API_KEY: `sk-gem-shared-${ns}` },
          customModels: [
            {
              modelId: "gemini-pro-x",
              displayName: "gemini-pro-x",
              mode: "chat",
            },
          ],
          scopes: [
            { scopeType: "ORGANIZATION", scopeId: organizationId },
            { scopeType: "PROJECT", scopeId: otherProjectId },
          ],
        },
        ctx(),
      );

      // Team row for the project under test's team — TEAM tier beats the
      // shared row's ORGANIZATION tier here.
      await service().updateModelProvider(
        {
          projectId,
          provider: "gemini",
          enabled: true,
          customKeys: { GEMINI_API_KEY: `sk-gem-team-${ns}` },
          customModels: [
            {
              modelId: "gemini-pro-x",
              displayName: "gemini-pro-x",
              mode: "chat",
            },
          ],
          scopes: [{ scopeType: "TEAM", scopeId: teamId }],
        },
        ctx(),
      );
    });

    afterAll(async () => {
      await prisma.project.deleteMany({ where: { id: otherProjectId } });
    });

    /** @scenario A row's unrelated project scope does not inflate its specificity */
    it("ranks the shared row by the scope that grants THIS project access", async () => {
      const row = await service().findRowServingModel({
        projectId,
        provider: "gemini",
        bareModel: "gemini-pro-x",
      });
      expect(row?.customKeys).toMatchObject({
        GEMINI_API_KEY: `sk-gem-team-${ns}`,
      });
    });
  });

  describe("when no row lists the model (registry-model providers)", () => {
    beforeAll(async () => {
      await service().updateModelProvider(
        {
          projectId,
          provider: "openai",
          enabled: true,
          customKeys: { OPENAI_API_KEY: `sk-openai-org-${ns}` },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
        },
        ctx(),
      );
      await service().updateModelProvider(
        {
          projectId,
          provider: "openai",
          enabled: true,
          customKeys: { OPENAI_API_KEY: `sk-openai-project-${ns}` },
          scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
        },
        ctx(),
      );
    });

    /** @scenario Model served by no row keeps the collapse winner */
    it("keeps the collapse winner (narrowest enabled row)", async () => {
      const providers = await service().getProjectModelProviders(projectId);
      const params = await prepareLitellmParams({
        model: "openai/gpt-5-mini",
        modelProvider: providers.openai!,
        projectId,
      });
      expect(params.api_key).toBe(`sk-openai-project-${ns}`);
    });
  });
});

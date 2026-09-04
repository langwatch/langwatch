/**
 * @vitest-environment node
 *
 * @see specs/model-providers/model-default-config-cascade.feature
 *
 * Real-Postgres coverage for the one-config-per-scope invariant on
 * ModelDefaultConfig writes, and the handled errors the write path raises
 * instead of leaking plain 500s. Customer report: "+ Add config" at
 * organization scope stacked a second org row instead of replacing the
 * first, and saving an all-inherit new config surfaced a raw "unknown
 * error" 500.
 *
 * Requires LANGWATCH_TEST_DATABASE_URL. Skips cleanly without it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AuthzService } from "@langwatch/authz-contract";
import { ModelProviderDefaultsWriteService } from "../model-provider-defaults-write.service";
import { ModelProviderResolutionService } from "../model-provider-resolution.service";
import { ModelProviderAuthorizationService } from "../model-provider-authorization.service";
import { ModelProviderWriteAuthorizationService } from "../model-provider-write-authorization.service";
import { ModelProviderScopeService } from "../model-provider-scope.service";
import { PrismaModelDefaultRepository } from "../../repositories/prisma/prisma.model-default.repository";
import {
  DB_URL,
  PrismaProjects,
  TestModelProviderCatalog,
  cleanupTenancyFixture,
  createTenancyFixture,
  createTestPrismaClient,
  idService,
  testNamespace,
  type TenancyFixture,
} from "./support/model-provider-integration.support";

function roleComputingAuthz(admins: Set<string>): AuthzService {
  return {
    getDecision: async (input: { userId: string }) => ({ permitted: admins.has(input.userId) }),
  } as unknown as AuthzService;
}

describe.skipIf(!DB_URL)("ModelProviderDefaultsWriteService scope exclusivity (real Postgres)", () => {
  const prisma: PrismaClient = createTestPrismaClient();
  const defaults = PrismaModelDefaultRepository.create(prisma);
  const scopes = ModelProviderScopeService.create({
    projects: new PrismaProjects(prisma),
    organizations: {
      getBillingProfile: async (input: { organizationId: string }) => ({ id: input.organizationId }),
      getTeamById: async (input: { teamId: string }) => {
        const team = await prisma.team.findUniqueOrThrow({ where: { id: input.teamId } });
        return { id: team.id, organizationId: team.organizationId };
      },
    } as never,
  });
  const catalog = new TestModelProviderCatalog();

  const ns = testNamespace("mdcfg-excl");
  let fixture: TenancyFixture;
  let apiProjectId: string;

  function writerFor(admins: Set<string>) {
    return ModelProviderDefaultsWriteService.create({
      defaults,
      catalog,
      writeAuthorization: ModelProviderWriteAuthorizationService.create(
        ModelProviderAuthorizationService.create(roleComputingAuthz(admins)),
      ),
      ids: idService,
      scopes,
    });
  }
  const writer = writerFor(new Set([]));

  const attachmentsAt = (scopeType: "ORGANIZATION" | "TEAM" | "PROJECT", scopeId: string) =>
    prisma.modelDefaultConfigScope.findMany({ where: { scopeType, scopeId }, select: { configId: true } });

  beforeAll(async () => {
    fixture = await createTenancyFixture(prisma, ns);
    const apiProject = await prisma.project.create({
      data: {
        name: `API Project ${ns}`,
        slug: `--proj-api-${ns}`,
        teamId: fixture.teamId,
        language: "en",
        framework: "test",
        apiKey: `test-key-api-${ns}`,
      },
    });
    apiProjectId = apiProject.id;
  });

  afterEach(async () => {
    await prisma.modelDefaultConfig.deleteMany({ where: { organizationId: fixture.organizationId } });
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: apiProjectId } });
    await cleanupTenancyFixture(prisma, fixture);
    await prisma.$disconnect();
  });

  describe("when a new config is created at a scope that already has one", () => {
    /** @scenario Creating a config at a scope that already has one replaces that scope's config */
    it("claims the scope and deletes the emptied previous config", async () => {
      const old = await writer.save({
        config: { DEFAULT: "openai/gpt-5.5" },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: fixture.organizationId }],
        authorId: null,
      } as never);
      const replacement = await writer.save({
        config: { DEFAULT: "gemini/gemini-2.5-pro" },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: fixture.organizationId }],
        authorId: null,
      } as never);

      expect(await attachmentsAt("ORGANIZATION", fixture.organizationId)).toEqual([
        { configId: replacement.id },
      ]);
      expect(await prisma.modelDefaultConfig.findUnique({ where: { id: old.id } })).toBeNull();

      const resolution = ModelProviderResolutionService.create({ defaults, catalog, scopes });
      const resolved = await resolution.resolve({
        projectId: fixture.projectId,
        featureKey: "prompt.create_default",
      });
      expect(resolved.model).toBe("gemini/gemini-2.5-pro");
    });
  });

  describe("when the previous holder is attached to other scopes too", () => {
    /** @scenario Claiming a scope held by a multi-scope config detaches only that scope */
    it("keeps the multi-scope config alive with its remaining scopes", async () => {
      const multi = await writer.save({
        config: { DEFAULT: "openai/gpt-5.5" },
        scopes: [
          { scopeType: "PROJECT", scopeId: fixture.projectId },
          { scopeType: "PROJECT", scopeId: apiProjectId },
        ],
        authorId: null,
      } as never);
      const claimer = await writer.save({
        config: { DEFAULT: "gemini/gemini-2.5-pro" },
        scopes: [{ scopeType: "PROJECT", scopeId: fixture.projectId }],
        authorId: null,
      } as never);

      expect(await attachmentsAt("PROJECT", fixture.projectId)).toEqual([{ configId: claimer.id }]);

      const survivor = await prisma.modelDefaultConfig.findUnique({
        where: { id: multi.id },
        select: { config: true, scopes: { select: { scopeId: true } } },
      });
      expect(survivor?.config).toEqual({ DEFAULT: "openai/gpt-5.5" });
      expect(survivor?.scopes).toEqual([{ scopeId: apiProjectId }]);
    });
  });

  describe("when an update attaches a scope another config holds", () => {
    /** @scenario Adding a scope to an existing config claims it from its previous config */
    it("claims the scope for the updated config and deletes the emptied holder", async () => {
      const projectConfig = await writer.save({
        config: { DEFAULT: "openai/gpt-5.4-mini" },
        scopes: [{ scopeType: "PROJECT", scopeId: apiProjectId }],
        authorId: null,
      } as never);
      const orgConfig = await writer.save({
        config: { DEFAULT: "openai/gpt-5.5" },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: fixture.organizationId }],
        authorId: null,
      } as never);

      await writer.save({
        id: orgConfig.id,
        scopes: [
          { scopeType: "ORGANIZATION", scopeId: fixture.organizationId },
          { scopeType: "PROJECT", scopeId: apiProjectId },
        ],
      } as never);

      expect(await attachmentsAt("PROJECT", apiProjectId)).toEqual([{ configId: orgConfig.id }]);
      expect(await prisma.modelDefaultConfig.findUnique({ where: { id: projectConfig.id } })).toBeNull();
    });
  });

  describe("when a brand-new config carries no keys at all", () => {
    /** @scenario Saving a brand-new config with every key on Inherit is refused with a handled error */
    it("refuses with a handled validation_error instead of a plain 500", async () => {
      await expect(
        writer.save({
          config: {},
          scopes: [{ scopeType: "TEAM", scopeId: fixture.teamId }],
          authorId: null,
        } as never),
      ).rejects.toMatchObject({ code: "validation_error" });

      expect(await attachmentsAt("TEAM", fixture.teamId)).toEqual([]);
    });
  });

  describe("when an existing config is edited down to no keys", () => {
    /** @scenario Editing an existing config to all-Inherit deletes it */
    it("deletes the config and its scope attachments", async () => {
      const config = await writer.save({
        config: { FAST: "openai/gpt-5.4-mini" },
        scopes: [{ scopeType: "TEAM", scopeId: fixture.teamId }],
        authorId: null,
      } as never);

      await writer.save({ id: config.id, config: {} } as never);

      expect(await prisma.modelDefaultConfig.findUnique({ where: { id: config.id } })).toBeNull();
      expect(await attachmentsAt("TEAM", fixture.teamId)).toEqual([]);
    });
  });

  describe("when the caller cannot manage the target scope", () => {
    /** @scenario Saving into a scope the caller cannot manage is refused with a handled error */
    it("raises model_default_scope_forbidden with a 403 and writes nothing", async () => {
      const memberWriter = writerFor(new Set([]));

      await expect(
        memberWriter.save({
          config: { DEFAULT: "openai/gpt-5.5" },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: fixture.organizationId }],
          authorId: null,
          actorId: "member-user",
        } as never),
      ).rejects.toMatchObject({ code: "model_default_scope_forbidden", httpStatus: 403 });

      expect(await attachmentsAt("ORGANIZATION", fixture.organizationId)).toEqual([]);
      expect(
        await prisma.modelDefaultConfig.count({ where: { organizationId: fixture.organizationId } }),
      ).toBe(0);
    });
  });
});

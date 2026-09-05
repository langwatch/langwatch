/**
 * Real-Postgres coverage for `ModelProviderCommandService.delete`'s scope-aware lookup: a model-provider list shows credentials granted at the organization, a team, or a sibling project, so the delete has to resolve those same rows rather than filtering by the caller's project alone. `model-provider-command.delete.unit.test.ts` pins this against mocked collaborators; only real Postgres proves the repository's own tenancy filter actually matches across scopes and refuses across organizations.
 * @vitest-environment node
 * @see specs/model-providers/provider-deletion.feature
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AuthzService } from "@langwatch/authz-contract";
import { ModelProviderCommandService } from "../services/model-provider-command.service";
import { ModelProviderAuthorizationService } from "../services/model-provider-authorization.service";
import { ModelProviderWriteAuthorizationService } from "../services/model-provider-write-authorization.service";
import { ModelProviderScopeService } from "../services/model-provider-scope.service";
import { PrismaModelProviderRepository } from "../repositories/prisma/prisma.model-provider.repository";
import {
  DB_URL,
  IdentityModelProviderCredentialCodec,
  PrismaProjects,
  buildModelProvider,
  cleanupTenancyFixture,
  createTenancyFixture,
  createTestPrismaClient,
  testNamespace,
  type TenancyFixture,
} from "./support/model-provider-integration.support";

const alwaysPermitAuthz = {
  getDecision: async () => ({ permitted: true }),
} as unknown as AuthzService;

describe.skipIf(!DB_URL)("ModelProviderCommandService.delete (real Postgres)", () => {
  const prisma: PrismaClient = createTestPrismaClient();
  const repository = PrismaModelProviderRepository.create(
    prisma,
    new IdentityModelProviderCredentialCodec(),
  );
  const scopes = ModelProviderScopeService.create({
    projects: new PrismaProjects(prisma),
    organizations: {} as never,
  });
  const writeAuthorization = ModelProviderWriteAuthorizationService.create(
    ModelProviderAuthorizationService.create(alwaysPermitAuthz),
  );
  const command = ModelProviderCommandService.create({
    repository,
    scopes,
    writeAuthorization,
  } as never);

  const ns = testNamespace("mp-del");
  let fixture: TenancyFixture;
  let siblingProjectId: string;
  let otherFixture: TenancyFixture;

  beforeAll(async () => {
    fixture = await createTenancyFixture(prisma, ns);
    const sibling = await prisma.project.create({
      data: {
        name: `Sibling Project ${ns}`,
        slug: `--test-proj-sib-${ns}`,
        apiKey: `sk-lw-test-sib-${ns}`,
        teamId: fixture.teamId,
        language: "en",
        framework: "test",
      },
    });
    siblingProjectId = sibling.id;
    otherFixture = await createTenancyFixture(prisma, `${ns}-other`);
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: siblingProjectId } });
    await cleanupTenancyFixture(prisma, fixture);
    await cleanupTenancyFixture(prisma, otherFixture);
    await prisma.$disconnect();
  });

  describe("given an ORGANIZATION-scoped provider viewed from a project in that org", () => {
    /** @scenario Delete an organization-scoped provider from a project settings view */
    it("removes the row and its scope grants instead of 404ing", async () => {
      const created = await repository.create(
        buildModelProvider({
          name: `OpenAI Org ${ns}`,
          provider: "openai",
          organizationId: fixture.organizationId,
          customKeys: { OPENAI_API_KEY: `sk-org-${ns}` },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: fixture.organizationId }],
        }),
      );

      await command.delete({
        id: created.id,
        projectId: fixture.projectId,
        provider: "openai",
        actorId: fixture.adminUserId,
      } as never);

      const row = await prisma.modelProvider.findUnique({ where: { id: created.id } });
      expect(row).toBeNull();
      const scopeRows = await prisma.modelProviderScope.findMany({
        where: { modelProviderId: created.id },
      });
      expect(scopeRows).toHaveLength(0);
    });
  });

  describe("given a provider scoped only to a sibling project in the same org", () => {
    /** @scenario Delete a provider scoped only to a sibling project in the same org */
    it("removes the row when deleted from a different project's view", async () => {
      const created = await repository.create(
        buildModelProvider({
          name: `Anthropic Sibling ${ns}`,
          provider: "anthropic",
          organizationId: fixture.organizationId,
          customKeys: { ANTHROPIC_API_KEY: `sk-sib-${ns}` },
          scopes: [{ scopeType: "PROJECT", scopeId: siblingProjectId }],
        }),
      );

      await command.delete({
        id: created.id,
        projectId: fixture.projectId,
        provider: "anthropic",
        actorId: fixture.adminUserId,
      } as never);

      const row = await prisma.modelProvider.findUnique({ where: { id: created.id } });
      expect(row).toBeNull();
    });
  });

  describe("given a provider that belongs to a different organization", () => {
    /** @scenario Deleting a provider from a different organization is not found */
    it("rejects as not-found and leaves the row intact", async () => {
      const created = await repository.create(
        buildModelProvider({
          name: `OpenAI Other Org ${ns}`,
          provider: "openai",
          organizationId: otherFixture.organizationId,
          customKeys: { OPENAI_API_KEY: `sk-other-${ns}` },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: otherFixture.organizationId }],
        }),
      );

      await expect(
        command.delete({
          id: created.id,
          projectId: fixture.projectId,
          provider: "openai",
          actorId: fixture.adminUserId,
        } as never),
      ).rejects.toMatchObject({ code: "model_provider_not_found" });

      const row = await prisma.modelProvider.findUnique({ where: { id: created.id } });
      expect(row).not.toBeNull();

      await prisma.modelProviderScope.deleteMany({ where: { modelProviderId: created.id } });
      await prisma.modelProvider.delete({ where: { id: created.id } });
    });
  });

  describe("given a provider with stored API keys", () => {
    /** @scenario Deleting a provider removes its stored credentials */
    it("leaves no row carrying those credentials", async () => {
      const created = await repository.create(
        buildModelProvider({
          name: `Groq Keyed ${ns}`,
          provider: "groq",
          organizationId: fixture.organizationId,
          customKeys: { GROQ_API_KEY: `sk-groq-${ns}` },
          scopes: [{ scopeType: "PROJECT", scopeId: fixture.projectId }],
        }),
      );

      await command.delete({
        id: created.id,
        projectId: fixture.projectId,
        provider: "groq",
        actorId: fixture.adminUserId,
      } as never);

      const row = await prisma.modelProvider.findUnique({ where: { id: created.id } });
      expect(row).toBeNull();
    });
  });
});

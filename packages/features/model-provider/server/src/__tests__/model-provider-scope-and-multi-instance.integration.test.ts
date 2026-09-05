/**
 * Real-Postgres coverage for multi-instance provider rows: creating a second row of the same provider type at a different scope instead of silently overwriting an existing one, the atomic multi-scope write gate, cross-tenant read refusal, and runtime provider-ROW selection following the specific MODEL rather than the collapsed provider winner (a stale project-scoped Azure row must not shadow an organization row whose catalog actually lists the requested model).
 * @vitest-environment node
 * @see specs/model-providers/scope-and-multi-instance.feature
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AuthzService } from "@langwatch/authz-contract";
import { ModelProviderCommandService } from "../services/model-provider-command.service";
import { ModelProviderAuthorizationService } from "../services/model-provider-authorization.service";
import { ModelProviderWriteAuthorizationService } from "../services/model-provider-write-authorization.service";
import { ModelProviderScopeService } from "../services/model-provider-scope.service";
import { ModelProviderKeysService } from "../services/model-provider-keys.service";
import { ModelProviderQueryService } from "../services/model-provider-query.service";
import { ModelProviderExecutionService } from "../services/model-provider-execution.service";
import { PrismaModelProviderRepository } from "../repositories/prisma/prisma.model-provider.repository";
import {
  DB_URL,
  IdentityModelProviderCredentialCodec,
  PrismaProjects,
  TestModelProviderCatalog,
  cleanupTenancyFixture,
  createTenancyFixture,
  createTestPrismaClient,
  idService,
  noopConnectionRateLimiter,
  noopOnboardingDefaults,
  testNamespace,
  type TenancyFixture,
} from "./support/model-provider-integration.support";

describe.skipIf(!DB_URL)(
  "Multi-instance provider rows and runtime row selection (real Postgres)",
  () => {
    const prisma: PrismaClient = createTestPrismaClient();
    const repository = PrismaModelProviderRepository.create(
      prisma,
      new IdentityModelProviderCredentialCodec(),
    );
    const scopes = ModelProviderScopeService.create({
      projects: new PrismaProjects(prisma),
      organizations: {
        getBillingProfile: async (input: { organizationId: string }) => ({
          id: input.organizationId,
        }),
        getTeamById: async (input: { teamId: string }) => {
          const team = await prisma.team.findUniqueOrThrow({ where: { id: input.teamId } });
          return { id: team.id, organizationId: team.organizationId };
        },
      } as never,
    });
    const catalog = new TestModelProviderCatalog();
    const query = ModelProviderQueryService.create({
      repository,
      scopes,
      credentialPolicy: ModelProviderKeysService.create(),
      catalog,
    });
    const execution = ModelProviderExecutionService.create({ query, catalog });

    const ns = testNamespace("mp-scope-multi");
    let fixture: TenancyFixture;
    let teamAdminUserId: string;
    let otherTeamId: string;

    function commandWith(admins: Set<string>) {
      const authz = {
        getDecision: async (input: { userId: string }) => ({ permitted: admins.has(input.userId) }),
      } as unknown as AuthzService;
      return ModelProviderCommandService.create({
        repository,
        scopes,
        writeAuthorization: ModelProviderWriteAuthorizationService.create(
          ModelProviderAuthorizationService.create(authz),
        ),
        credentialPolicy: ModelProviderKeysService.create(),
        catalog,
        connectionRateLimiter: noopConnectionRateLimiter,
        onboardingDefaults: noopOnboardingDefaults,
        ids: idService,
        defaults: {} as never,
      } as never);
    }
    beforeAll(async () => {
      fixture = await createTenancyFixture(prisma, ns);
      const otherTeam = await prisma.team.create({
        data: {
          name: `Other Team ${ns}`,
          slug: `--team-b-${ns}`,
          organizationId: fixture.organizationId,
        },
      });
      otherTeamId = otherTeam.id;
      teamAdminUserId = `team-a-admin-${ns}`;
    });

    afterAll(async () => {
      await prisma.team.deleteMany({ where: { id: otherTeamId } });
      await cleanupTenancyFixture(prisma, fixture);
      await prisma.$disconnect();
    });

    describe("given a provider already exists at one scope", () => {
      /** @scenario Create a second OpenAI row under a different scope */
      it("creates a second row at a different scope instead of overwriting", async () => {
        const command = commandWith(new Set());
        const first = await command.upsert({
          projectId: fixture.projectId,
          provider: "openai",
          enabled: true,
          customKeys: { OPENAI_API_KEY: `sk-project-${ns}` },
          scopes: [{ scopeType: "PROJECT", scopeId: fixture.projectId }],
        } as never);
        const second = await command.upsert({
          projectId: fixture.projectId,
          provider: "openai",
          enabled: true,
          customKeys: { OPENAI_API_KEY: `sk-org-${ns}` },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: fixture.organizationId }],
        } as never);

        expect(second.id).not.toBe(first.id);
        const rows = await prisma.modelProvider.findMany({
          where: { organizationId: fixture.organizationId, provider: "openai" },
          include: { scopes: true },
        });
        expect(rows).toHaveLength(2);
      });
    });

    describe("given a write naming multiple scopes", () => {
      /** @scenario Save a provider with multiple scopes */
      it("saves a single row with multiple ModelProviderScope entries", async () => {
        const command = commandWith(new Set());
        const result = await command.upsert({
          projectId: fixture.projectId,
          provider: "anthropic",
          name: "Anthropic Production",
          enabled: true,
          customKeys: { ANTHROPIC_API_KEY: `sk-ant-${ns}` },
          scopes: [
            { scopeType: "ORGANIZATION", scopeId: fixture.organizationId },
            { scopeType: "TEAM", scopeId: fixture.teamId },
          ],
        } as never);

        const stored = await prisma.modelProvider.findFirst({
          where: { id: result.id },
          include: { scopes: true },
        });
        expect(stored?.name).toBe("Anthropic Production");
        const storedScopes = (stored?.scopes ?? [])
          .map((s) => `${s.scopeType}:${s.scopeId}`)
          .sort();
        expect(storedScopes).toEqual(
          [`ORGANIZATION:${fixture.organizationId}`, `TEAM:${fixture.teamId}`].sort(),
        );
      });
    });

    describe("given a caller who manages only a different team", () => {
      /** @scenario Assigning a provider to an unmanageable team is denied */
      it("rejects with model_provider_scope_forbidden", async () => {
        // Nobody is an admin in this fixture, so every write is refused.
        const command = commandWith(new Set());

        await expect(
          command.upsert({
            projectId: fixture.projectId,
            actorId: teamAdminUserId,
            provider: "xai",
            enabled: true,
            customKeys: { XAI_API_KEY: `sk-xai-${ns}` },
            scopes: [{ scopeType: "TEAM", scopeId: otherTeamId }],
          } as never),
        ).rejects.toMatchObject({ code: "model_provider_scope_forbidden" });
      });
    });

    describe("given an organization-scoped provider the caller cannot see", () => {
      /** @scenario Reading a provider outside my access scope returns not found */
      it("surfaces not-found rather than leaking the row across the tenancy boundary", async () => {
        const otherFixture = await createTenancyFixture(prisma, `${ns}-other`);
        try {
          const command = commandWith(new Set([fixture.adminUserId]));
          const mp = await command.upsert({
            organizationId: fixture.organizationId,
            actorId: fixture.adminUserId,
            provider: "bedrock",
            enabled: true,
            customKeys: { AWS_ACCESS_KEY_ID: `ak-${ns}` },
            scopes: [{ scopeType: "ORGANIZATION", scopeId: fixture.organizationId }],
          } as never);

          // An unrelated caller anchored to a DIFFERENT organization: the row
          // lookup is scoped to the resolved anchor's organization, so a
          // cross-tenant id resolves to nothing rather than FORBIDDEN — the
          // same "not found, not forbidden" shape id enumeration must see.
          await expect(
            command.testConnection({
              organizationId: otherFixture.organizationId,
              actorId: otherFixture.adminUserId,
              modelProviderId: mp.id,
            } as never),
          ).rejects.toMatchObject({ code: "model_provider_not_found" });
        } finally {
          await cleanupTenancyFixture(prisma, otherFixture);
        }
      });
    });

    describe("when the collapse winner does not serve the resolved model", () => {
      beforeAll(async () => {
        const command = commandWith(new Set());
        await command.upsert({
          projectId: fixture.projectId,
          provider: "azure",
          enabled: true,
          customKeys: {
            AZURE_OPENAI_API_KEY: `sk-org-azure-${ns}`,
            AZURE_OPENAI_ENDPOINT: "https://org-resource.openai.azure.com",
          },
          customModels: [{ id: "gpt-5.4-mini", label: "gpt-5.4-mini", type: "chat" }],
          customEmbeddingsModels: [
            { id: "text-embedding-3-small", label: "text-embedding-3-small", type: "embedding" },
          ],
          scopes: [{ scopeType: "ORGANIZATION", scopeId: fixture.organizationId }],
        } as never);
        await command.upsert({
          projectId: fixture.projectId,
          provider: "azure",
          enabled: true,
          customKeys: {
            AZURE_OPENAI_API_KEY: `sk-project-azure-${ns}`,
            AZURE_OPENAI_ENDPOINT: "https://old-resource.openai.azure.com",
          },
          customModels: [{ id: "gpt-4o", label: "gpt-4o", type: "chat" }],
          scopes: [{ scopeType: "PROJECT", scopeId: fixture.projectId }],
        } as never);
      });

      /** @scenario Model served only by a wider-scope row uses that row's credentials */
      it("prepares the call with the org row's credentials for the org-catalog model", async () => {
        const params = await execution.prepare({
          model: "azure/gpt-5.4-mini",
          projectId: fixture.projectId,
        });
        expect(params.api_key).toBe(`sk-org-azure-${ns}`);
        expect(params.api_base).toBe("https://org-resource.openai.azure.com");
      });

      /** @scenario Embeddings models follow the same row-selection rule */
      it("routes embeddings models to the row whose embeddings catalog lists them", async () => {
        const params = await execution.prepare({
          model: "azure/text-embedding-3-small",
          projectId: fixture.projectId,
        });
        expect(params.api_key).toBe(`sk-org-azure-${ns}`);
      });
    });

    describe("when a shared row also carries another project's scope", () => {
      let otherProjectId: string;

      beforeAll(async () => {
        const otherProject = await prisma.project.create({
          data: {
            name: `Other Project ${ns}`,
            slug: `--proj-other-${ns}`,
            teamId: fixture.teamId,
            language: "en",
            framework: "test",
            apiKey: `test-key-other-${ns}`,
          },
        });
        otherProjectId = otherProject.id;

        const command = commandWith(new Set());
        await command.upsert({
          projectId: fixture.projectId,
          provider: "gemini",
          enabled: true,
          customKeys: { GEMINI_API_KEY: `sk-gem-shared-${ns}` },
          customModels: [{ id: "gemini-pro-x", label: "gemini-pro-x", type: "chat" }],
          scopes: [
            { scopeType: "ORGANIZATION", scopeId: fixture.organizationId },
            { scopeType: "PROJECT", scopeId: otherProjectId },
          ],
        } as never);
        await command.upsert({
          projectId: fixture.projectId,
          provider: "gemini",
          enabled: true,
          customKeys: { GEMINI_API_KEY: `sk-gem-team-${ns}` },
          customModels: [{ id: "gemini-pro-x", label: "gemini-pro-x", type: "chat" }],
          scopes: [{ scopeType: "TEAM", scopeId: fixture.teamId }],
        } as never);
      });

      afterAll(async () => {
        await prisma.project.deleteMany({ where: { id: otherProjectId } });
      });

      /** @scenario A row's unrelated project scope does not inflate its specificity */
      it("ranks the shared row by the scope that grants THIS project access", async () => {
        const row = await query.tryFindRowServingModel({
          projectId: fixture.projectId,
          provider: "gemini",
          model: "gemini-pro-x",
        });
        expect(row?.customKeys).toMatchObject({ GEMINI_API_KEY: `sk-gem-team-${ns}` });
      });
    });

    describe("when the resolved model is a registry model", () => {
      beforeAll(async () => {
        const command = commandWith(new Set());
        await command.upsert({
          projectId: fixture.projectId,
          provider: "groq",
          enabled: true,
          customKeys: { GROQ_API_KEY: `sk-groq-org-${ns}` },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: fixture.organizationId }],
        } as never);
        await command.upsert({
          projectId: fixture.projectId,
          provider: "groq",
          enabled: true,
          customKeys: { GROQ_API_KEY: `sk-groq-project-${ns}` },
          scopes: [{ scopeType: "PROJECT", scopeId: fixture.projectId }],
        } as never);
      });

      /** @scenario Model served by no row keeps the collapse winner */
      it("keeps the collapse winner (narrowest enabled row)", async () => {
        const providers = await query.getExecutionProviders({ projectId: fixture.projectId });
        const registryModel = providers.groq!.models![0]!;

        const params = await execution.prepare({
          model: `groq/${registryModel}`,
          projectId: fixture.projectId,
        });
        expect(params.api_key).toBe(`sk-groq-project-${ns}`);
      });

      /** @scenario A wider row listing a registry model custom does not steal it */
      it("keeps the winner's credentials when a wider row lists the model in its custom catalog", async () => {
        const providers = await query.getExecutionProviders({ projectId: fixture.projectId });
        const registryModel = providers.groq!.models![0]!;
        // An admin pinning a registry model in the org row's custom catalog
        // (e.g. for a display name) must not reroute the project's calls:
        // every row of a provider serves its registry models, so the
        // collapse winner already holds the right credentials.
        const orgRow = await prisma.modelProvider.findFirst({
          where: {
            provider: "groq",
            scopes: { some: { scopeType: "ORGANIZATION", scopeId: fixture.organizationId } },
          },
        });
        await prisma.modelProvider.update({
          where: { id: orgRow!.id },
          data: {
            customModels: [{ id: registryModel, label: registryModel, type: "chat" }],
          },
        });
        try {
          const params = await execution.prepare({
            model: `groq/${registryModel}`,
            projectId: fixture.projectId,
          });
          expect(params.api_key).toBe(`sk-groq-project-${ns}`);
        } finally {
          await prisma.modelProvider.update({
            where: { id: orgRow!.id },
            data: { customModels: [] },
          });
        }
      });
    });

    describe("when a model is served only by a wider-scope row", () => {
      beforeAll(async () => {
        const command = commandWith(new Set());
        // Winner: project row with its own key and no custom catalog.
        await command.upsert({
          projectId: fixture.projectId,
          provider: "gemini",
          enabled: true,
          customKeys: { GEMINI_API_KEY: `sk-gemini-project-${ns}` },
          scopes: [{ scopeType: "PROJECT", scopeId: fixture.projectId }],
        } as never);
        // The custom model lives only in the org row's catalog.
        await command.upsert({
          projectId: fixture.projectId,
          provider: "gemini",
          enabled: true,
          customKeys: { GEMINI_API_KEY: `sk-gemini-org-${ns}` },
          customModels: [{ id: `eval-custom-${ns}`, label: `eval-custom-${ns}`, type: "chat" }],
          scopes: [{ scopeType: "ORGANIZATION", scopeId: fixture.organizationId }],
        } as never);
      });

      /** @scenario Evaluations accept a model served only by a wider-scope row */
      it("builds the execution parameters from the serving row's credentials instead of rejecting", async () => {
        const params = await execution.prepare({
          model: `gemini/eval-custom-${ns}`,
          projectId: fixture.projectId,
        });
        expect(params.api_key).toBe(`sk-gemini-org-${ns}`);
      });
    });
  },
);

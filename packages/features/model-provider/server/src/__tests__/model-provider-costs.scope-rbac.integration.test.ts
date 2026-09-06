/**
 * Who may write a cost row, against real Postgres: the guard reads the scope
 * the row is anchored to, not the projectId the caller supplied, so a caller
 * from another organization cannot re-anchor a row by naming its id.
 * @vitest-environment node
 * @see specs/model-providers/model-cost-scoping.feature
 */
import type { AuthzService } from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaModelCostRepository } from "../repositories/prisma/prisma.model-cost.repository";
import { ModelProviderAuthorizationService } from "../services/model-provider-authorization.service";
import { ModelProviderCostsService } from "../services/model-provider-costs.service";
import { ModelProviderScopeService } from "../services/model-provider-scope.service";
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

/** Permits every scope the named actors manage, and nothing else. */
function authzFor(managers: Set<string>): AuthzService {
  return {
    getDecision: async (input: { userId: string }) => ({ permitted: managers.has(input.userId) }),
  } as unknown as AuthzService;
}

describe.skipIf(!DB_URL)("model cost writes across scopes (real Postgres)", () => {
  const prisma: PrismaClient = createTestPrismaClient();
  const costs = PrismaModelCostRepository.create(prisma);
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

  function serviceFor(managers: Set<string>): ModelProviderCostsService {
    return ModelProviderCostsService.create({
      costs,
      catalog: new TestModelProviderCatalog(),
      authorization: ModelProviderAuthorizationService.create(authzFor(managers)),
      ids: idService,
      scopes,
    });
  }

  const ownerNamespace = testNamespace("cost-rbac-own");
  const strangerNamespace = testNamespace("cost-rbac-other");
  let owner: TenancyFixture;
  let stranger: TenancyFixture;

  beforeAll(async () => {
    owner = await createTenancyFixture(prisma, ownerNamespace);
    stranger = await createTenancyFixture(prisma, strangerNamespace);
  });

  afterAll(async () => {
    await prisma.customLLMModelCost.deleteMany({
      where: { organizationId: { in: [owner.organizationId, stranger.organizationId] } },
    });
    await cleanupTenancyFixture(prisma, owner);
    await cleanupTenancyFixture(prisma, stranger);
    await prisma.$disconnect();
  });

  describe("given an existing project-level cost row in the caller's organization", () => {
    describe("when the caller who manages that project writes it again", () => {
      /** @scenario createOrUpdate updates a cost row when the caller manages its current scope */
      it("accepts the write", async () => {
        const service = serviceFor(new Set([owner.adminUserId]));
        const created = await service.upsert({
          projectId: owner.projectId,
          scopeType: "PROJECT",
          scopeId: owner.projectId,
          model: "openai/gpt-5-mini",
          regex: "^openai\\/gpt-5-mini$",
          inputCostPerToken: 0.000001,
          outputCostPerToken: 0.000002,
          actorId: owner.adminUserId,
        });

        const updated = await service.upsert({
          id: created.id,
          projectId: owner.projectId,
          scopeType: "PROJECT",
          scopeId: owner.projectId,
          model: "openai/gpt-5-mini",
          regex: "^openai\\/gpt-5-mini$",
          inputCostPerToken: 0.000009,
          outputCostPerToken: 0.000002,
          actorId: owner.adminUserId,
        });

        expect(updated.id).toBe(created.id);
        expect(updated.inputCostPerToken).toBe(0.000009);
      });
    });
  });

  describe("given a caller who manages a project in a different organization", () => {
    describe("when they call the write with that row's id and their own scope", () => {
      /** @scenario createOrUpdate rejects re-anchoring a cost row the caller does not own */
      it("refuses, and the row keeps its organization, scope and model", async () => {
        const owned = await serviceFor(new Set([owner.adminUserId])).upsert({
          projectId: owner.projectId,
          scopeType: "PROJECT",
          scopeId: owner.projectId,
          model: "anthropic/claude-sonnet-4-6",
          regex: "^anthropic\\/claude-sonnet-4-6$",
          inputCostPerToken: 0.000003,
          outputCostPerToken: 0.000004,
          actorId: owner.adminUserId,
        });

        await expect(
          serviceFor(new Set([stranger.adminUserId])).upsert({
            id: owned.id,
            projectId: stranger.projectId,
            scopeType: "PROJECT",
            scopeId: stranger.projectId,
            model: "anthropic/claude-sonnet-4-6",
            regex: "^anthropic\\/claude-sonnet-4-6$",
            inputCostPerToken: 0.1,
            outputCostPerToken: 0.2,
            actorId: stranger.adminUserId,
          }),
        ).rejects.toThrow();

        const stored = await prisma.customLLMModelCost.findUniqueOrThrow({
          where: { id: owned.id },
        });
        expect(stored.organizationId).toBe(owner.organizationId);
        expect(stored.scopeId).toBe(owner.projectId);
        expect(stored.model).toBe("anthropic/claude-sonnet-4-6");
        expect(stored.inputCostPerToken).toBe(0.000003);
      });
    });
  });
});

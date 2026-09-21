import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GrantPrincipalType, GrantScopeType } from "~/generated/prisma/client";
import { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import { PrismaAuthzAuditTrailRepository } from "~/server/app-layer/authz/repositories/authz-audit-trail.prisma.repository";
import { PrismaAuthzGrantsWriteRepository } from "~/server/app-layer/authz/repositories/authz-grants-write.prisma.repository";
import { prisma } from "~/server/db";
import {
  cleanupTestData,
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { EventSourcing } from "~/server/event-sourcing/eventSourcing";
import { createAuthzGrantsPipeline } from "~/server/event-sourcing/pipelines/authz-grants/pipeline";
import { PrismaOrganizationRepository } from "../repositories/organization.prisma.repository";

/**
 * ADR-038 I4/I5: `createAndAssign` persists the declared primary intent on
 * the Organization row inside the same create (atomic by construction — no
 * separate write that can fail on its own), produces an identical result
 * shape regardless of intent, and persists NULL when no intent is given
 * (legacy default).
 *
 * The repository assertion is paired with the router-level onboarding
 * integration, which exercises the same writer through initializeOrganization.
 *
 * Pairs with: specs/features/onboarding/intent-fork.feature
 */
describe("PrismaOrganizationRepository.createAndAssign — primaryIntent", () => {
  let repository: PrismaOrganizationRepository;
  let eventSourcing: EventSourcing;
  const testNamespace = `intent-${nanoid(8)}`;
  const createdOrgIds: string[] = [];
  const createdUserIds: string[] = [];

  async function createUser() {
    const user = await prisma.user.create({
      data: {
        email: `${nanoid(8)}@${testNamespace}.test`,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function createOrg(params: {
    primaryIntent?: "AGENT_GOVERNANCE" | "LLM_OPS" | null;
  }) {
    const user = await createUser();
    const suffix = nanoid(6).toLowerCase();
    const result = await repository.createAndAssign({
      userId: user.id,
      orgId: `org_${testNamespace}_${suffix}`,
      orgName: `Org ${suffix}`,
      orgSlug: `org-${testNamespace}-${suffix}`,
      teamId: `team_${testNamespace}_${suffix}`,
      teamSlug: `team-${testNamespace}-${suffix}`,
      primaryIntent: params.primaryIntent,
      pricingModel: "SEAT_EVENT",
    });
    createdOrgIds.push(result.organization.id);
    return result;
  }

  afterAll(async () => {
    await prisma.grantUsage.deleteMany({
      where: { organizationId: { in: createdOrgIds } },
    });
    await prisma.grant.deleteMany({
      where: { organizationId: { in: createdOrgIds } },
    });
    await prisma.role.deleteMany({
      where: { organizationId: { in: createdOrgIds } },
    });
    await prisma.teamUser.deleteMany({
      where: { team: { organizationId: { in: createdOrgIds } } },
    });
    await prisma.team.deleteMany({
      where: { organizationId: { in: createdOrgIds } },
    });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: { in: createdOrgIds } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: createdOrgIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await eventSourcing.close();
    for (const organizationId of createdOrgIds) {
      await cleanupTestData(organizationId);
    }
    await stopTestContainers();
  });

  beforeAll(async () => {
    const { clickHouseClient, redisConnection } = await startTestContainers();
    eventSourcing = new EventSourcing({
      clickhouse: async () => clickHouseClient,
      redis: redisConnection,
      enabled: true,
      processRole: "all",
    });
    const pipeline = eventSourcing.register(
      createAuthzGrantsPipeline({
        authzGrantsWriteStore: new PrismaAuthzGrantsWriteRepository(prisma),
        authzAuditTrailStore: new PrismaAuthzAuditTrailRepository(prisma),
      }),
    );
    repository = new PrismaOrganizationRepository(
      prisma,
      new GrantsLedgerWriter(prisma, {
        commands: async () => ({ commands: pipeline.commands }),
      }),
    );
  });

  describe("when the governance intent is declared", () => {
    /** @scenario "Governance signup records the organization's primary intent" */
    it("persists the intent on the organization row within the create", async () => {
      const result = await createOrg({ primaryIntent: "AGENT_GOVERNANCE" });

      const organization = await prisma.organization.findUnique({
        where: { id: result.organization.id },
        select: { primaryIntent: true },
      });
      expect(organization?.primaryIntent).toBe("AGENT_GOVERNANCE");
    });
  });

  describe("when no intent is declared (legacy callers)", () => {
    it("persists NULL", async () => {
      const result = await createOrg({});

      const organization = await prisma.organization.findUnique({
        where: { id: result.organization.id },
        select: { primaryIntent: true },
      });
      expect(organization?.primaryIntent).toBeNull();
    });
  });

  describe("when a new organization is assigned to its creator", () => {
    it("waits for the canonical organization and team ADMIN grants", async () => {
      const result = await createOrg({ primaryIntent: "LLM_OPS" });
      const userId = createdUserIds.at(-1);

      expect(userId).toBeDefined();
      const grants = await prisma.grant.findMany({
        where: {
          organizationId: result.organization.id,
          principalType: GrantPrincipalType.USER,
          principalId: userId,
          roleKey: "admin",
          revokedAt: null,
        },
        orderBy: { scopeType: "asc" },
        select: {
          organizationId: true,
          principalId: true,
          roleKey: true,
          scopeType: true,
          scopeId: true,
          source: true,
        },
      });

      expect(grants).toEqual([
        {
          organizationId: result.organization.id,
          principalId: userId,
          roleKey: "admin",
          scopeType: GrantScopeType.ORGANIZATION,
          scopeId: result.organization.id,
          source: "grants-service",
        },
        {
          organizationId: result.organization.id,
          principalId: userId,
          roleKey: "admin",
          scopeType: GrantScopeType.TEAM,
          scopeId: result.team.id,
          source: "grants-service",
        },
      ]);
    });
  });

  describe("when the Primary use setting is edited (ADR-038 org setting)", () => {
    it("sets, clears, and leaves the intent untouched per the update contract", async () => {
      const result = await createOrg({ primaryIntent: "AGENT_GOVERNANCE" });
      const orgId = result.organization.id;
      const readIntent = async () =>
        (
          await prisma.organization.findUnique({
            where: { id: orgId },
            select: { primaryIntent: true },
          })
        )?.primaryIntent;

      // undefined leaves the current value untouched
      await repository.updateSettings({
        organizationId: orgId,
        name: "Renamed",
      });
      expect(await readIntent()).toBe("AGENT_GOVERNANCE");

      await repository.updateSettings({
        organizationId: orgId,
        name: "Renamed",
        primaryIntent: "LLM_OPS",
      });
      expect(await readIntent()).toBe("LLM_OPS");

      // null clears back to legacy behavior
      await repository.updateSettings({
        organizationId: orgId,
        name: "Renamed",
        primaryIntent: null,
      });
      expect(await readIntent()).toBeNull();
    });
  });

  describe("result shape parity across intents (I4)", () => {
    it("returns the same shape regardless of declared intent", async () => {
      const governance = await createOrg({
        primaryIntent: "AGENT_GOVERNANCE",
      });
      const llmops = await createOrg({ primaryIntent: "LLM_OPS" });
      const legacy = await createOrg({});

      for (const result of [governance, llmops, legacy]) {
        expect(Object.keys(result).sort()).toEqual(
          Object.keys(governance).sort(),
        );
        expect(result.organization).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            name: expect.any(String),
          }),
        );
        expect(result.team).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            slug: expect.any(String),
          }),
        );
      }
    });
  });
});

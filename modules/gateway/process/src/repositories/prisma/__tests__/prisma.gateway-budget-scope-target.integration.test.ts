/**
 * A budget scope names its target by id; the display lookup only ever reads
 * names inside the caller's organization, so a foreign id resolves to nothing.
 * @vitest-environment node
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaGatewayBudgetScopeTargetRepository } from "../prisma.gateway-budget-scope-target.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("gateway budget scope targets", () => {
  const namespace = `gateway-scope-targets-${nanoid(8)}`;
  const ownOrganizationId = `${namespace}-own`;
  const foreignOrganizationId = `${namespace}-foreign`;
  const ownTeamId = `${namespace}-own-team`;
  const foreignTeamId = `${namespace}-foreign-team`;

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:gateway:test:scope-targets"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;

  beforeAll(async () => {
    for (const [organizationId, teamId] of [
      [ownOrganizationId, ownTeamId],
      [foreignOrganizationId, foreignTeamId],
    ] as const) {
      await prisma.organization.create({
        data: { id: organizationId, name: organizationId, slug: organizationId },
      });
      await prisma.team.create({
        data: { id: teamId, name: teamId, slug: teamId, organizationId },
      });
    }
  });

  afterAll(async () => {
    await prisma.team.deleteMany({ where: { id: { in: [ownTeamId, foreignTeamId] } } });
    await prisma.organization.deleteMany({
      where: { id: { in: [ownOrganizationId, foreignOrganizationId] } },
    });
    await connection.closeOnce();
  });

  const resolve = (organizationId: string | null) =>
    PrismaGatewayBudgetScopeTargetRepository.create().resolveScopeTargetsBatch({
      prisma,
      budgets: [
        { scopeType: "ORGANIZATION", scopeId: ownOrganizationId },
        { scopeType: "ORGANIZATION", scopeId: foreignOrganizationId },
        { scopeType: "TEAM", scopeId: ownTeamId },
        { scopeType: "TEAM", scopeId: foreignTeamId },
      ],
      organizationId,
      projects: [],
      virtualKeyProjectScopes: [],
    });

  describe("when budgets name organizations and teams on both sides of the tenant line", () => {
    it("names only the caller's own organization and team", async () => {
      const targets = await resolve(ownOrganizationId);

      expect([...targets.values()].map(({ kind, id }) => `${kind}:${id}`).toSorted()).toEqual(
        [`ORGANIZATION:${ownOrganizationId}`, `TEAM:${ownTeamId}`].toSorted(),
      );
    });
  });

  describe("when the caller has no organization", () => {
    it("names nothing", async () => {
      const targets = await resolve(null);

      expect(targets.size).toBe(0);
    });
  });
});

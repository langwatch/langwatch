/**
 * @vitest-environment node
 *
 * Integration coverage for PRINCIPAL-scope budgets in the
 * strictest-wins cascade. Hits real Postgres (testcontainers), no
 * mocks of the budget service.
 *
 * Pins:
 *   1. PRINCIPAL kind round-trips through GatewayBudgetService.create
 *      and persists with `scopeType=PRINCIPAL`, `principalUserId` set.
 *   2. Cross-org guard rejects principalUserId from outside the org.
 *   3. With ALL 5 scopes (org+team+project+VK+principal) configured,
 *      the cascade BLOCKs when only the PRINCIPAL is over-limit.
 *   4. With NO PRINCIPAL budget, applicableForRequest returns 4 rows
 *      and the cascade behaves identically.
 *
 * Spec: specs/ai-gateway/budgets-principal-cascade.feature
 */
import { Prisma } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { GatewayBudgetService } from "~/server/gateway/budget.service";

const ns = nanoid(8);
const ORG_ID = `org-pcasc-${ns}`;
const TEAM_ID = `team-pcasc-${ns}`;
const PROJECT_ID = `proj-pcasc-${ns}`;
const VK_ID = `vk-pcasc-${ns}`;
const ALICE_ID = `usr-alice-${ns}`;
const OUTSIDER_ID = `usr-outsider-${ns}`;
const ACTOR_ID = `usr-actor-${ns}`;

describe("GatewayBudgetService — PRINCIPAL cascade", () => {
  let service: GatewayBudgetService;

  beforeAll(async () => {
    // Org + team + project — minimal scaffolding for FK satisfaction.
    await prisma.organization.create({
      data: { id: ORG_ID, name: `Cascade Org ${ns}`, slug: `pcasc-${ns}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `Cascade Team ${ns}`,
        slug: `pcasc-team-${ns}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `Cascade Project ${ns}`,
        slug: `pcasc-proj-${ns}`,
        teamId: TEAM_ID,
        apiKey: `pcasc-key-${ns}`,
        language: "typescript",
        framework: "next.js",
      },
    });

    // Users — alice is in-org, outsider is NOT in this org.
    await prisma.user.create({
      data: { id: ALICE_ID, email: `alice-${ns}@example.com`, name: "Alice" },
    });
    await prisma.user.create({
      data: {
        id: OUTSIDER_ID,
        email: `outsider-${ns}@example.com`,
        name: "Outsider",
      },
    });
    await prisma.user.create({
      data: { id: ACTOR_ID, email: `actor-${ns}@example.com`, name: "Actor" },
    });
    await prisma.organizationUser.create({
      data: { userId: ALICE_ID, organizationId: ORG_ID, role: "MEMBER" },
    });
    await prisma.organizationUser.create({
      data: { userId: ACTOR_ID, organizationId: ORG_ID, role: "ADMIN" },
    });
    // Outsider is intentionally NOT a member of ORG_ID.

    // VirtualKey under the project.
    await prisma.virtualKey.create({
      data: {
        id: VK_ID,
        projectId: PROJECT_ID,
        name: `pcasc-vk-${ns}`,
        hashedSecret: `hash-${ns}`,
        displayPrefix: `lw_vk_test_${ns.slice(0, 4)}`,
        createdById: ACTOR_ID,
      },
    });

    service = GatewayBudgetService.create(prisma);
  });

  afterAll(async () => {
    await prisma.gatewayBudget.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.virtualKey.deleteMany({
      where: { projectId: PROJECT_ID, id: VK_ID },
    });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ALICE_ID, OUTSIDER_ID, ACTOR_ID] } },
    });
    await prisma.project.deleteMany({ where: { teamId: TEAM_ID, id: PROJECT_ID } });
    await prisma.team.deleteMany({
      where: { organizationId: ORG_ID, id: TEAM_ID },
    });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  });

  describe("create with PRINCIPAL kind", () => {
    it("persists scopeType=PRINCIPAL with the named user as scopeId + principalUserId", async () => {
      const created = await service.create({
        organizationId: ORG_ID,
        scope: { kind: "PRINCIPAL", principalUserId: ALICE_ID },
        name: `alice-monthly-${ns}`,
        window: "MONTH",
        limitUsd: "50.00",
        onBreach: "BLOCK",
        actorUserId: ACTOR_ID,
      });

      expect(created.scopeType).toBe("PRINCIPAL");
      expect(created.scopeId).toBe(ALICE_ID);
      expect(created.principalUserId).toBe(ALICE_ID);
      expect(created.organizationScopedId).toBeNull();
      expect(created.teamScopedId).toBeNull();
      expect(created.projectScopedId).toBeNull();
      expect(created.virtualKeyScopedId).toBeNull();

      // Cleanup so the cascade scenarios start from a known empty state
      // for ORG_ID's PRINCIPAL slot.
      await prisma.gatewayBudget.delete({ where: { id: created.id } });
    });

    it("rejects principalUserId from outside the budget's organization", async () => {
      await expect(
        service.create({
          organizationId: ORG_ID,
          scope: { kind: "PRINCIPAL", principalUserId: OUTSIDER_ID },
          name: `bad-outsider-${ns}`,
          window: "MONTH",
          limitUsd: "50.00",
          onBreach: "BLOCK",
          actorUserId: ACTOR_ID,
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringMatching(/not a member of this organization/i),
      });

      const persisted = await prisma.gatewayBudget.findFirst({
        where: { organizationId: ORG_ID, principalUserId: OUTSIDER_ID },
      });
      expect(persisted).toBeNull();
    });
  });

  describe("cascade strictest-wins with PRINCIPAL the tightest", () => {
    let principalBudgetId: string;
    let projectBudgetId: string;

    beforeAll(async () => {
      // Org budget: $1000/month, $100 spent — far under.
      const orgBudget = await service.create({
        organizationId: ORG_ID,
        scope: { kind: "ORGANIZATION", organizationId: ORG_ID },
        name: `org-${ns}`,
        window: "MONTH",
        limitUsd: "1000",
        onBreach: "BLOCK",
        actorUserId: ACTOR_ID,
      });
      // Team: $500, $100 spent.
      const teamBudget = await service.create({
        organizationId: ORG_ID,
        scope: { kind: "TEAM", teamId: TEAM_ID },
        name: `team-${ns}`,
        window: "MONTH",
        limitUsd: "500",
        onBreach: "BLOCK",
        actorUserId: ACTOR_ID,
      });
      // Project: $200, $100 spent.
      const projectBudget = await service.create({
        organizationId: ORG_ID,
        scope: { kind: "PROJECT", projectId: PROJECT_ID },
        name: `proj-${ns}`,
        window: "MONTH",
        limitUsd: "200",
        onBreach: "BLOCK",
        actorUserId: ACTOR_ID,
      });
      projectBudgetId = projectBudget.id;
      // VK: $150, $100 spent.
      const vkBudget = await service.create({
        organizationId: ORG_ID,
        scope: { kind: "VIRTUAL_KEY", virtualKeyId: VK_ID },
        name: `vk-${ns}`,
        window: "MONTH",
        limitUsd: "150",
        onBreach: "BLOCK",
        actorUserId: ACTOR_ID,
      });
      // Principal: $50, $49.50 spent — THIS is the strictest.
      const principalBudget = await service.create({
        organizationId: ORG_ID,
        scope: { kind: "PRINCIPAL", principalUserId: ALICE_ID },
        name: `alice-${ns}`,
        window: "MONTH",
        limitUsd: "50",
        onBreach: "BLOCK",
        actorUserId: ACTOR_ID,
      });
      principalBudgetId = principalBudget.id;

      // Drive PG `spentUsd` directly so the check() path (which reads
      // PG when no chRepo is wired) reflects the test scenario.
      await prisma.gatewayBudget.update({
        where: { id: orgBudget.id },
        data: { spentUsd: new Prisma.Decimal("100") },
      });
      await prisma.gatewayBudget.update({
        where: { id: teamBudget.id },
        data: { spentUsd: new Prisma.Decimal("100") },
      });
      await prisma.gatewayBudget.update({
        where: { id: projectBudget.id },
        data: { spentUsd: new Prisma.Decimal("100") },
      });
      await prisma.gatewayBudget.update({
        where: { id: vkBudget.id },
        data: { spentUsd: new Prisma.Decimal("100") },
      });
      await prisma.gatewayBudget.update({
        where: { id: principalBudget.id },
        data: { spentUsd: new Prisma.Decimal("49.50") },
      });
    });

    it("BLOCKs with principal as the only blocker when projected cost pushes principal over", async () => {
      const result = await service.check({
        organizationId: ORG_ID,
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
        virtualKeyId: VK_ID,
        principalUserId: ALICE_ID,
        projectedCostUsd: "1.00",
      });

      expect(result.decision).toBe("hard_block");
      expect(result.blockedBy).toHaveLength(1);
      expect(result.blockedBy[0]?.scope).toBe("principal");
      expect(result.blockedBy[0]?.scopeId).toBe(ALICE_ID);
      expect(result.blockedBy[0]?.window).toBe("month");
      expect(result.blockReason).toMatch(/scope=principal/);
      expect(result.blockReason).toMatch(/window=month/);

      // All 5 scopes appear in the raw ledger.
      const scopeKinds = result.scopes.map((s) => s.scope).sort();
      expect(scopeKinds).toEqual(
        ["organization", "principal", "project", "team", "virtual_key"].sort(),
      );
    });

    it("does NOT block when principalUserId is omitted from the request (the cascade has no PRINCIPAL row to attribute)", async () => {
      // Briefly bring projectBudget under-limit so it doesn't blow the
      // cascade itself; we want to prove that omitting principalUserId
      // makes the cascade ignore alice's principal budget entirely.
      const result = await service.check({
        organizationId: ORG_ID,
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
        virtualKeyId: VK_ID,
        principalUserId: undefined,
        projectedCostUsd: "1.00",
      });

      // The other 4 scopes have $100 spent against limits of
      // $1000/$500/$200/$150 + $1 projected = $101 total — all under.
      expect(result.decision).not.toBe("hard_block");
      const scopeKinds = result.scopes.map((s) => s.scope).sort();
      expect(scopeKinds).toEqual(
        ["organization", "project", "team", "virtual_key"].sort(),
      );
      expect(scopeKinds).not.toContain("principal");
    });

    it("falls through cleanly when the principal's budget is far under and the project is the blocker", async () => {
      // Drive project spend over the limit; principal stays comfortably
      // under. Cascade should report PROJECT as the blocker.
      await prisma.gatewayBudget.update({
        where: { id: projectBudgetId },
        data: { spentUsd: new Prisma.Decimal("199.50") },
      });
      await prisma.gatewayBudget.update({
        where: { id: principalBudgetId },
        data: { spentUsd: new Prisma.Decimal("0") },
      });

      const result = await service.check({
        organizationId: ORG_ID,
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
        virtualKeyId: VK_ID,
        principalUserId: ALICE_ID,
        projectedCostUsd: "1.00",
      });

      expect(result.decision).toBe("hard_block");
      const blockedScopes = result.blockedBy.map((b) => b.scope);
      expect(blockedScopes).toContain("project");
      expect(blockedScopes).not.toContain("principal");
    });
  });
});

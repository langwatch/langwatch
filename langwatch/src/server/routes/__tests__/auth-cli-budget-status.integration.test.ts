/**
 * @vitest-environment node
 *
 * Integration coverage for GET /api/auth/cli/budget/status — the
 * pre-flight budget probe the CLI calls before exec'ing a wrapped
 * tool. Hits real Postgres + Redis (testcontainers), no mocks of the
 * auth or budget code paths.
 *
 *   1. 401 without a Bearer access token (missing / malformed).
 *   2. 401 with an unknown access token.
 *   3. 200 with a valid token but no personal VK provisioned yet.
 *   4. 200 with a valid token + personal VK + no budget exhausted.
 *
 * The 402 (budget_exceeded) case requires a ClickHouse-backed budget
 * ledger entry showing actual spend; that lives in the existing
 * gatewayBudgetSync.reactor integration test which exercises the
 * same `GatewayBudgetService.check()` code path.
 *
 * Spec: specs/ai-gateway/governance/budget-exceeded.feature
 *       docs/ai-gateway/governance/cli-reference.mdx
 *         "Budget pre-check (graceful degradation)"
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { connection as redisConnection } from "~/server/redis";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

import { app } from "../auth-cli";

const suffix = nanoid(8);
const ORG_ID = `org-budget-status-${suffix}`;
const USER_ID = `usr-budget-status-${suffix}`;
const TEAM_ID = `team-budget-status-${suffix}`;
const PROJECT_ID = `proj-budget-status-${suffix}`;

const VALID_TOKEN = `lw_at_${"v".repeat(43)}-valid-${suffix}`;
const ACCESS_TOKEN_KEY = `lwcli:access:${VALID_TOKEN}`;

async function callBudgetStatus(authHeader: string | null) {
  const headers: Record<string, string> = {};
  if (authHeader !== null) headers.Authorization = authHeader;
  return await app.request("/api/auth/cli/budget/status", {
    method: "GET",
    headers,
  });
}

describe("GET /api/auth/cli/budget/status", () => {
  beforeAll(async () => {
    await startTestContainers();

    await prisma.organization.create({
      data: { id: ORG_ID, name: `Budget Org ${suffix}`, slug: `budget-${suffix}` },
    });
    await prisma.user.create({
      data: {
        id: USER_ID,
        email: `budget-${suffix}@example.com`,
        name: "Budget Tester",
      },
    });
    await prisma.organizationUser.create({
      data: { organizationId: ORG_ID, userId: USER_ID, role: "ADMIN" },
    });

    // Plant a valid access token in Redis. We avoid running the full
    // device-flow + /exchange path here so the test stays focused on
    // the budget/status endpoint itself.
    if (!redisConnection) {
      throw new Error("Redis connection unavailable in test env");
    }
    await redisConnection.set(
      ACCESS_TOKEN_KEY,
      JSON.stringify({
        user_id: USER_ID,
        organization_id: ORG_ID,
        issued_at: Date.now(),
        expires_at: Date.now() + 60 * 60 * 1000,
      }),
      "EX",
      60 * 60,
    );
  }, 60_000);

  afterAll(async () => {
    if (redisConnection) {
      await redisConnection.del(ACCESS_TOKEN_KEY);
    }
    // dbMultiTenancyProtection requires projectId in the WHERE for
    // VirtualKey — resolve project ids explicitly.
    const projects = await prisma.project.findMany({
      where: { team: { organizationId: ORG_ID } },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);
    if (projectIds.length > 0) {
      await prisma.virtualKey.deleteMany({
        where: { projectId: { in: projectIds } },
      });
    }
    await prisma.organizationUser.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.project.deleteMany({
      where: { team: { organizationId: ORG_ID } },
    });
    await prisma.team.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await stopTestContainers();
  }, 60_000);

  describe("when no Bearer token is supplied", () => {
    it("returns 401 unauthorized", async () => {
      const res = await callBudgetStatus(null);
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("unauthorized");
    });
  });

  describe("when the Bearer token is malformed", () => {
    it("returns 401 — only lw_at_ tokens are accepted", async () => {
      const res = await callBudgetStatus("Bearer not-a-real-token");
      expect(res.status).toBe(401);
    });

    it("returns 401 — even if the prefix is right but the body is empty", async () => {
      const res = await callBudgetStatus("Bearer lw_at_");
      expect(res.status).toBe(401);
    });
  });

  describe("when the Bearer token is unknown to Redis", () => {
    it("returns 401 — unknown / expired tokens are rejected", async () => {
      const res = await callBudgetStatus(
        `Bearer lw_at_${"u".repeat(43)}-unknown-${suffix}`,
      );
      expect(res.status).toBe(401);
    });
  });

  describe("when the Bearer token is valid but the user has no personal VK", () => {
    it("returns 200 {ok: true} — graceful degradation, nothing to block", async () => {
      const res = await callBudgetStatus(`Bearer ${VALID_TOKEN}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    });
  });

  // The "personal VK exists + check() returns allow" case requires
  // seeding a default RoutingPolicy + ModelProvider + GatewayProviderCredential
  // (PersonalVirtualKeyService.issue refuses to mint a bare VK without
  // a policy by design — see virtualKey.service.ts auth-boundary).
  // That path is exhaustively covered by personalVirtualKey.service
  // integration tests; here we focus on the budget/status endpoint
  // contract itself. The hard_block / 402 path is exercised end-to-end
  // by gatewayBudgetSync.reactor.integration.test.ts which uses the
  // same GatewayBudgetService.check() code path.
});

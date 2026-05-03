/**
 * @vitest-environment node
 *
 * Integration coverage for the CLI governance debug endpoints under
 * /api/auth/cli/governance/* — the four read-only Bearer adapters
 * the typescript-sdk's `langwatch ingest list/tail/health` and
 * `langwatch governance status` commands consume.
 *
 *   GET /api/auth/cli/governance/status
 *   GET /api/auth/cli/governance/ingest/sources
 *   GET /api/auth/cli/governance/ingest/sources/:id/events
 *   GET /api/auth/cli/governance/ingest/sources/:id/health
 *
 * Hits real Postgres + Redis (testcontainers), no mocks of the auth
 * code path or service classes. Tenant isolation is part of the
 * contract — a Bearer token for org A must NOT be able to read
 * IngestionSources owned by org B, even by guessing IDs.
 *
 * Spec: specs/ai-gateway/governance/cli-ingest-debug.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { connection as redisConnection } from "~/server/redis";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { FREE_PLAN } from "../../../../ee/licensing/constants";
import type { PlanInfo } from "../../../../ee/licensing/planInfo";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";

import { app } from "../auth-cli";

// Phase 4b-6 added a 402 license gate on every /api/auth/cli/governance/*
// route. This test pins read-and-tenancy behavior, not license behavior, so
// override the plan provider to ENTERPRISE for the existing org. 402-on-FREE
// is covered by its own subdescribe at the end of the file using a separate
// org with a plan-provider override that returns FREE for that org's id only.
const enterprisePlan: PlanInfo = { ...FREE_PLAN, type: "ENTERPRISE" };
const freePlan: PlanInfo = FREE_PLAN;

const suffix = nanoid(8);

// Two orgs so we can prove tenant isolation: a token for org A
// cannot resolve an IngestionSource owned by org B even if it
// guesses the ID.
const ORG_A = `org-cli-gov-a-${suffix}`;
const ORG_B = `org-cli-gov-b-${suffix}`;
const USER_A = `usr-cli-gov-a-${suffix}`;
const USER_B = `usr-cli-gov-b-${suffix}`;

const TOKEN_A = `lw_at_${"a".repeat(43)}-${suffix}`;
const TOKEN_B = `lw_at_${"b".repeat(43)}-${suffix}`;

const SOURCE_A_ID = `src-cli-gov-a-${suffix}`;
const SOURCE_B_ID = `src-cli-gov-b-${suffix}`;

async function callGovernance(path: string, authHeader: string | null) {
  const headers: Record<string, string> = {};
  if (authHeader !== null) headers.Authorization = authHeader;
  return await app.request(`/api/auth/cli/governance${path}`, {
    method: "GET",
    headers,
  });
}

// Org C carries a FREE plan for the 402-license-gate subdescribe.
const ORG_C = `org-cli-gov-c-${suffix}`;
const USER_C = `usr-cli-gov-c-${suffix}`;
const TOKEN_C = `lw_at_${"c".repeat(43)}-${suffix}`;
const SOURCE_C_ID = `src-cli-gov-c-${suffix}`;

describe("GET /api/auth/cli/governance/*", () => {
  beforeAll(async () => {
    await startTestContainers();

    // Override plan provider so org A + B get ENTERPRISE (existing tests
    // pin RBAC + tenancy, not license) and org C gets FREE (402 subdescribe).
    resetApp();
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: async ({ organizationId }) =>
          organizationId === ORG_C ? freePlan : enterprisePlan,
      }),
    });

    await prisma.organization.create({
      data: { id: ORG_A, name: `Gov Org A ${suffix}`, slug: `gov-a-${suffix}` },
    });
    await prisma.organization.create({
      data: { id: ORG_B, name: `Gov Org B ${suffix}`, slug: `gov-b-${suffix}` },
    });
    await prisma.user.create({
      data: {
        id: USER_A,
        email: `gov-a-${suffix}@example.com`,
        name: "Gov Tester A",
      },
    });
    await prisma.user.create({
      data: {
        id: USER_B,
        email: `gov-b-${suffix}@example.com`,
        name: "Gov Tester B",
      },
    });
    await prisma.organization.create({
      data: { id: ORG_C, name: `Gov Org C ${suffix}`, slug: `gov-c-${suffix}` },
    });
    await prisma.user.create({
      data: {
        id: USER_C,
        email: `gov-c-${suffix}@example.com`,
        name: "Gov Tester C",
      },
    });
    await prisma.organizationUser.create({
      data: { organizationId: ORG_A, userId: USER_A, role: "ADMIN" },
    });
    await prisma.organizationUser.create({
      data: { organizationId: ORG_B, userId: USER_B, role: "ADMIN" },
    });
    await prisma.organizationUser.create({
      data: { organizationId: ORG_C, userId: USER_C, role: "ADMIN" },
    });

    // One IngestionSource per org. The hashed secret + status are
    // arbitrary — these endpoints don't exercise the receiver path,
    // only the org-scoped read path.
    await prisma.ingestionSource.create({
      data: {
        id: SOURCE_A_ID,
        organizationId: ORG_A,
        sourceType: "otel_generic",
        name: `Source A ${suffix}`,
        ingestSecretHash: `hash-${suffix}-a`,
        status: "active",
        lastEventAt: new Date(),
      },
    });
    await prisma.ingestionSource.create({
      data: {
        id: SOURCE_B_ID,
        organizationId: ORG_B,
        sourceType: "otel_generic",
        name: `Source B ${suffix}`,
        ingestSecretHash: `hash-${suffix}-b`,
        status: "active",
        lastEventAt: new Date(),
      },
    });
    await prisma.ingestionSource.create({
      data: {
        id: SOURCE_C_ID,
        organizationId: ORG_C,
        sourceType: "otel_generic",
        name: `Source C ${suffix}`,
        ingestSecretHash: `hash-${suffix}-c`,
        status: "active",
        lastEventAt: new Date(),
      },
    });

    if (!redisConnection) {
      throw new Error("Redis connection unavailable in test env");
    }
    const redis = redisConnection;
    const planToken = async (token: string, userId: string, orgId: string) => {
      await redis.set(
        `lwcli:access:${token}`,
        JSON.stringify({
          user_id: userId,
          organization_id: orgId,
          issued_at: Date.now(),
          expires_at: Date.now() + 60 * 60 * 1000,
        }),
        "EX",
        60 * 60,
      );
    };
    await planToken(TOKEN_A, USER_A, ORG_A);
    await planToken(TOKEN_B, USER_B, ORG_B);
    await planToken(TOKEN_C, USER_C, ORG_C);
  }, 60_000);

  afterAll(async () => {
    if (redisConnection) {
      await redisConnection.del(`lwcli:access:${TOKEN_A}`);
      await redisConnection.del(`lwcli:access:${TOKEN_B}`);
      await redisConnection.del(`lwcli:access:${TOKEN_C}`);
    }
    await prisma.ingestionSource.deleteMany({
      where: { id: { in: [SOURCE_A_ID, SOURCE_B_ID, SOURCE_C_ID] } },
    });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: { in: [ORG_A, ORG_B, ORG_C] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [USER_A, USER_B, USER_C] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [ORG_A, ORG_B, ORG_C] } },
    });
    resetApp();
    await stopTestContainers();
  }, 60_000);

  describe("auth contract — every endpoint", () => {
    const endpoints = [
      "/status",
      "/ingest/sources",
      `/ingest/sources/${SOURCE_A_ID}/events`,
      `/ingest/sources/${SOURCE_A_ID}/health`,
    ];

    describe("when no Bearer token is supplied", () => {
      it.each(endpoints)("returns 401 for %s", async (path) => {
        const res = await callGovernance(path, null);
        expect(res.status).toBe(401);
      });
    });

    describe("when the Bearer token is malformed", () => {
      it.each(endpoints)("returns 401 for %s", async (path) => {
        const res = await callGovernance(path, "Bearer not-a-real-token");
        expect(res.status).toBe(401);
      });
    });

    describe("when the Bearer token is unknown to Redis", () => {
      it.each(endpoints)("returns 401 for %s", async (path) => {
        const res = await callGovernance(
          path,
          `Bearer lw_at_${"u".repeat(43)}-unknown-${suffix}`,
        );
        expect(res.status).toBe(401);
      });
    });
  });

  describe("GET /governance/status", () => {
    describe("when called with a valid Bearer token", () => {
      it("returns the org's setup-state OR-of-flags shape", async () => {
        const res = await callGovernance("/status", `Bearer ${TOKEN_A}`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          setup: {
            hasPersonalVKs: boolean;
            hasRoutingPolicies: boolean;
            hasIngestionSources: boolean;
            hasAnomalyRules: boolean;
            hasRecentActivity: boolean;
            governanceActive: boolean;
          };
        };
        expect(body).toHaveProperty("setup");
        // Org A has one IngestionSource — that flag must be true.
        expect(body.setup.hasIngestionSources).toBe(true);
        // governanceActive is the OR — at least one true flag is enough.
        expect(body.setup.governanceActive).toBe(true);
        // Boolean shape is stable; assert all 5 flags exist.
        expect(typeof body.setup.hasPersonalVKs).toBe("boolean");
        expect(typeof body.setup.hasRoutingPolicies).toBe("boolean");
        expect(typeof body.setup.hasIngestionSources).toBe("boolean");
        expect(typeof body.setup.hasAnomalyRules).toBe("boolean");
        expect(typeof body.setup.hasRecentActivity).toBe("boolean");
      });
    });
  });

  describe("GET /governance/ingest/sources", () => {
    describe("when called with org A's Bearer token", () => {
      it("returns only org A's sources, not org B's", async () => {
        const res = await callGovernance(
          "/ingest/sources",
          `Bearer ${TOKEN_A}`,
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          sources: Array<{ id: string; name: string }>;
        };
        expect(Array.isArray(body.sources)).toBe(true);
        const ids = body.sources.map((s) => s.id);
        expect(ids).toContain(SOURCE_A_ID);
        expect(ids).not.toContain(SOURCE_B_ID);
      });

      it("includes archived rows when ?include_archived=1 is set", async () => {
        // No archived row in the fixture — assert the flag is at least
        // accepted (200) without changing the contract for the active-only
        // case.
        const res = await callGovernance(
          "/ingest/sources?include_archived=1",
          `Bearer ${TOKEN_A}`,
        );
        expect(res.status).toBe(200);
      });
    });
  });

  describe("GET /governance/ingest/sources/:id/events", () => {
    describe("when called for a source that doesn't exist", () => {
      it("returns 404", async () => {
        const res = await callGovernance(
          "/ingest/sources/does-not-exist/events",
          `Bearer ${TOKEN_A}`,
        );
        expect(res.status).toBe(404);
      });
    });

    describe("when called for a source owned by a different org (tenant isolation)", () => {
      it("returns 404 — the source exists but is invisible to org A's token", async () => {
        // SOURCE_B_ID exists in PG but belongs to ORG_B. From
        // ORG_A's perspective it must look like 'not found' — we
        // never leak which IDs exist in other tenants.
        const res = await callGovernance(
          `/ingest/sources/${SOURCE_B_ID}/events`,
          `Bearer ${TOKEN_A}`,
        );
        expect(res.status).toBe(404);
      });
    });

    describe("when called for a source owned by the caller's org", () => {
      it("returns 200 with {events:[]} (empty when no events have landed)", async () => {
        const res = await callGovernance(
          `/ingest/sources/${SOURCE_A_ID}/events?limit=10`,
          `Bearer ${TOKEN_A}`,
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as { events: unknown[] };
        expect(Array.isArray(body.events)).toBe(true);
      });

      it("respects the limit query param (clamped to 1..200)", async () => {
        // Limit out of range should still 200; the service clamps.
        const res = await callGovernance(
          `/ingest/sources/${SOURCE_A_ID}/events?limit=999`,
          `Bearer ${TOKEN_A}`,
        );
        expect(res.status).toBe(200);
      });
    });
  });

  describe("GET /governance/ingest/sources/:id/health", () => {
    describe("when called for a source that doesn't exist", () => {
      it("returns 404", async () => {
        const res = await callGovernance(
          "/ingest/sources/does-not-exist/health",
          `Bearer ${TOKEN_A}`,
        );
        expect(res.status).toBe(404);
      });
    });

    describe("when called for a source owned by a different org (tenant isolation)", () => {
      it("returns 404 — same as 'does not exist' from the caller's view", async () => {
        const res = await callGovernance(
          `/ingest/sources/${SOURCE_B_ID}/health`,
          `Bearer ${TOKEN_A}`,
        );
        expect(res.status).toBe(404);
      });
    });

    describe("when called for a source owned by the caller's org", () => {
      it("returns 200 with the source + health metric shape", async () => {
        const res = await callGovernance(
          `/ingest/sources/${SOURCE_A_ID}/health`,
          `Bearer ${TOKEN_A}`,
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          source: { id: string; name: string; status: string };
          health: {
            events24h: number;
            events7d: number;
            events30d: number;
            lastSuccessIso: string | null;
          };
        };
        expect(body.source.id).toBe(SOURCE_A_ID);
        expect(typeof body.source.name).toBe("string");
        expect(typeof body.source.status).toBe("string");
        expect(typeof body.health.events24h).toBe("number");
        expect(typeof body.health.events7d).toBe("number");
        expect(typeof body.health.events30d).toBe("number");
        // lastSuccessIso is `string | null` — both acceptable.
      });
    });
  });

  describe("license gate — 402 Payment Required for non-enterprise (4b-6)", () => {
    const endpoints = [
      "/status",
      "/ingest/sources",
      `/ingest/sources/${SOURCE_C_ID}/events`,
      `/ingest/sources/${SOURCE_C_ID}/health`,
    ];

    describe("when called with a valid Bearer for an org on FREE plan", () => {
      it.each(endpoints)("returns 402 with payment_required envelope on %s", async (path) => {
        const res = await callGovernance(path, `Bearer ${TOKEN_C}`);
        expect(res.status).toBe(402);
        const body = (await res.json()) as {
          error: string;
          error_description: string;
          upgrade_url: string;
        };
        expect(body.error).toBe("payment_required");
        expect(body.error_description).toMatch(/Enterprise/i);
        expect(body.upgrade_url).toMatch(/\/settings\/subscription$/);
      });
    });
  });
});

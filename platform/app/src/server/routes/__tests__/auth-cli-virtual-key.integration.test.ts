/**
 * @vitest-environment node
 *
 * Integration coverage for POST /api/auth/cli/virtual-key against real
 * Postgres + Redis.
 *
 * Login mints no credential, so this route is the only way the CLI can get a
 * personal virtual key. It calls it the first time a tool resolves to gateway
 * mode. The first ask returns the org "default" key; later asks return a
 * device-named key, because the default's secret is stored hashed and cannot
 * be handed out twice.
 *
 * Spec: specs/ai-gateway/governance/cli-login.feature
 */
import type { Redis } from "ioredis";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { app } from "../auth-cli";

const suffix = nanoid(8);

// Org A has a reachable provider, so a mint can succeed. Org B has none, so
// the same request must be refused rather than handing out a key whose first
// gateway call would fail.
const ORG_A = `org-vk-a-${suffix}`;
const ORG_B = `org-vk-b-${suffix}`;
const USER_A = `usr-vk-a-${suffix}`;
const USER_B = `usr-vk-b-${suffix}`;
const TOKEN_A = `lw_at_${"a".repeat(43)}-vk-${suffix}`;
const TOKEN_B = `lw_at_${"b".repeat(43)}-vk-${suffix}`;
const MODEL_PROVIDER_ID = `mp-vk-${suffix}`;

let redisConnection: Redis | null = null;

async function issueVirtualKey(token: string | null, body?: Record<string, unknown>) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  const res = await app.request("/api/auth/cli/virtual-key", {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
}

async function liveKeyNames(organizationId: string, userId: string): Promise<string[]> {
  const rows = await prisma.virtualKey.findMany({
    where: { organizationId, principalUserId: userId, revokedAt: null },
    select: { name: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.name);
}

describe("POST /api/auth/cli/virtual-key", () => {
  beforeAll(async () => {
    ({ redisConnection } = await startTestContainers());
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({ redis: redisConnection });

    for (const [orgId, userId, label] of [
      [ORG_A, USER_A, "a"],
      [ORG_B, USER_B, "b"],
    ] as const) {
      await prisma.organization.create({
        data: {
          id: orgId,
          name: `VK Org ${label} ${suffix}`,
          slug: `vk-${label}-${suffix}`,
        },
      });
      await prisma.user.create({
        data: {
          id: userId,
          email: `vk-${label}-${suffix}@example.com`,
          name: `VK Tester ${label}`,
        },
      });
      await prisma.organizationUser.create({
        data: { organizationId: orgId, userId, role: "MEMBER" },
      });
    }

    // Only org A can route anywhere.
    await prisma.modelProvider.create({
      data: {
        id: MODEL_PROVIDER_ID,
        name: `vk-mp-${suffix}`,
        provider: "anthropic",
        enabled: true,
        organizationId: ORG_A,
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_A }] },
      },
    });

    if (!redisConnection) throw new Error("Redis unavailable in test env");
    const redis = redisConnection;
    for (const [token, userId, orgId] of [
      [TOKEN_A, USER_A, ORG_A],
      [TOKEN_B, USER_B, ORG_B],
    ] as const) {
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
    }
  }, 60_000);

  afterAll(async () => {
    if (redisConnection) {
      await redisConnection.del(`lwcli:access:${TOKEN_A}`);
      await redisConnection.del(`lwcli:access:${TOKEN_B}`);
    }
    const orgs = [ORG_A, ORG_B];
    await prisma.virtualKey.deleteMany({
      where: { organizationId: { in: orgs } },
    });
    await prisma.modelProviderScope.deleteMany({
      where: { modelProviderId: MODEL_PROVIDER_ID },
    });
    // Scalar organizationId, not an `in` list: the tenancy guard only honours
    // scalar tenancy predicates on ModelProvider.
    await prisma.modelProvider.deleteMany({ where: { organizationId: ORG_A } });
    await prisma.roleBinding.deleteMany({
      where: { organizationId: { in: orgs } },
    });
    // The route provisions personal Team + Project rows on first mint.
    await prisma.project.deleteMany({
      where: { team: { organizationId: { in: orgs } } },
    });
    await prisma.teamUser.deleteMany({
      where: { team: { organizationId: { in: orgs } } },
    });
    await prisma.team.deleteMany({
      where: { organizationId: { in: orgs } },
    });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: { in: orgs } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [USER_A, USER_B] } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
    await resetApp();
    await stopTestContainers();
  }, 60_000);

  describe("given no Bearer token", () => {
    it("returns 401", async () => {
      const { status } = await issueVirtualKey(null);
      expect(status).toBe(401);
    });
  });

  describe("given an organization with a reachable provider", () => {
    describe("when the CLI asks for a key for the first time", () => {
      /** @scenario "The personal virtual key is issued on first gateway use, not at login" */
      it("issues the default personal key and returns its secret once", async () => {
        expect(await liveKeyNames(ORG_A, USER_A)).toEqual([]);

        const { status, json } = await issueVirtualKey(TOKEN_A);

        expect(status).toBe(201);
        expect(typeof json.id).toBe("string");
        expect(json.secret).toEqual(expect.stringMatching(/^vk-lw-/));
        expect(json.prefix).toEqual(expect.stringMatching(/^vk-lw-/));
        expect(await liveKeyNames(ORG_A, USER_A)).toEqual(["default"]);

        // The secret is never persisted in the clear.
        const row = await prisma.virtualKey.findUniqueOrThrow({
          where: { id: json.id as string },
          select: { hashedSecret: true, principalUserId: true },
        });
        expect(row.hashedSecret).not.toBe(json.secret);
        expect(row.principalUserId).toBe(USER_A);
      });
    });

    describe("when a second machine asks with its own device label", () => {
      /** @scenario "A second machine asks for a key of its own" */
      it("issues an extra device-named key and leaves the default live", async () => {
        const { status, json } = await issueVirtualKey(TOKEN_A, {
          device_label: "Rogerio's MacBook Pro!!",
        });

        expect(status).toBe(201);
        expect(json.secret).toEqual(expect.stringMatching(/^vk-lw-/));
        // The label is reduced to the [a-z0-9-] charset a key name carries.
        const names = await liveKeyNames(ORG_A, USER_A);
        expect(names).toContain("default");
        expect(names).toContain("device-rogerio-s-macbook-pro");
      });
    });

    describe("when a machine asks without a device label", () => {
      it("names the extra key after a random suffix rather than colliding", async () => {
        const before = await liveKeyNames(ORG_A, USER_A);

        const { status, json } = await issueVirtualKey(TOKEN_A);

        expect(status).toBe(201);
        const after = await liveKeyNames(ORG_A, USER_A);
        expect(after.length).toBe(before.length + 1);
        const added = after.filter((n) => !before.includes(n));
        expect(added).toHaveLength(1);
        expect(added[0]).toMatch(/^device-[0-9a-f]{6}$/);
        expect(json.id).toBeTruthy();
      });
    });
  });

  describe("given an organization with no reachable provider", () => {
    describe("when the CLI asks for a key", () => {
      /** @scenario "Asking for a personal virtual key with no providers configured is refused" */
      it("returns 409 no_eligible_providers and creates nothing", async () => {
        const { status, json } = await issueVirtualKey(TOKEN_B);

        expect(status).toBe(409);
        expect(json.error).toBe("no_eligible_providers");
        expect(await liveKeyNames(ORG_B, USER_B)).toEqual([]);
      });
    });
  });
});

/**
 * @vitest-environment node
 *
 * Integration coverage for GET /api/internal/gateway/config/:vk_id, the
 * route the Go gateway calls on every bundle cache miss.
 *
 * Hits the real Hono app and real PG. The materialiser reads
 * `vk.routingPolicy` off whatever the caller included, so a materialiser
 * test that does its own include cannot catch the route forgetting one:
 * the bundle just comes back with an empty alias map and empty deny
 * lists, and the gateway silently stops resolving aliases and enforcing
 * model policy. This exercises the route's own query.
 *
 * The route takes its budget repository from `getApp()`; standing in for
 * the store means standing in for `getApp()`, wired to the same
 * `getClickHouseClientForTenant` resolver the route used to build inline
 * — this test asserts on aliases/policy rules, not spend, so it does not
 * need to control which ClickHouse client that resolves to.
 *
 * Spec: specs/ai-gateway/provider-routing.feature
 *       specs/ai-gateway/governance/routing-policy-aliases-and-rules.feature
 *       specs/ai-gateway/auth-cache.feature
 */
import { createHash, createHmac } from "crypto";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getClickHouseClientForTenant } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import { VirtualKeyService } from "~/server/gateway/virtualKey.service";

vi.mock("~/server/app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
  getApp: () => ({
    gateway: {
      budgets: new GatewayBudgetClickHouseRepository(async (projectId) => {
        const client = await getClickHouseClientForTenant(projectId);
        if (!client) throw new Error("ClickHouse is not configured");
        return client;
      }),
    },
  }),
}));

import { app } from "../gateway-internal";

const suffix = nanoid(8);
const ORG_ID = `org-cfgroute-${suffix}`;
const TEAM_ID = `team-cfgroute-${suffix}`;
const PROJECT_ID = `proj-cfgroute-${suffix}`;
const USER_ID = `usr-cfgroute-${suffix}`;
const RP_ID = `rp-cfgroute-${suffix}`;
const VK_ID = `vk-cfgroute-${suffix}`;
const VK_EXPIRING_ID = `vk-cfgexp-${suffix}`;
const MP_ID = `mp-cfgroute-${suffix}`;
const SECRET = "0123456789abcdef0123456789abcdef";
const DAY_MS = 24 * 60 * 60 * 1000;
/** The key's expiration date as the gateway reads it: unix seconds. */
const EXPIRES_AT = new Date(Date.now() + 7 * DAY_MS);

function signedRequest(path: string, ifNoneMatch?: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyHash = createHash("sha256").update("").digest("hex");
  const canonical = `GET\n${path}\n${timestamp}\n${bodyHash}`;
  const signature = createHmac("sha256", SECRET).update(canonical).digest("hex");
  return new Request(`http://localhost${path}`, {
    method: "GET",
    headers: {
      "X-LangWatch-Gateway-Signature": signature,
      "X-LangWatch-Gateway-Timestamp": timestamp,
      ...(ifNoneMatch ? { "If-None-Match": ifNoneMatch } : {}),
    },
  });
}

describe("GET /api/internal/gateway/config/:vk_id", () => {
  let previousSecret: string | undefined;

  beforeAll(async () => {
    await startTestContainers();
    previousSecret = process.env.LW_GATEWAY_INTERNAL_SECRET;
    process.env.LW_GATEWAY_INTERNAL_SECRET = SECRET;

    await prisma.organization.create({
      data: {
        id: ORG_ID,
        name: `Cfg Org ${suffix}`,
        slug: `cfgroute-${suffix}`,
      },
    });
    await prisma.user.create({
      data: {
        id: USER_ID,
        name: "Cfg Route",
        email: `cfgroute-${suffix}@acme.test`,
      },
    });
    await prisma.modelProvider.create({
      data: {
        id: MP_ID,
        name: "OpenAI",
        provider: "openai",
        enabled: true,
        organizationId: ORG_ID,
        customKeys: { OPENAI_API_KEY: "fake-before-rotation" },
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
      },
    });
    await prisma.routingPolicy.create({
      data: {
        id: RP_ID,
        organizationId: ORG_ID,
        name: `Cfg Policy ${suffix}`,
        modelProviderIds: [MP_ID],
        modelAliases: { chat: "openai/gpt-5-mini" },
        policyRules: { models: { deny: ["^internal-.*$"], allow: null } },
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `Cfg Team ${suffix}`,
        slug: `cfgroute-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `Cfg Project ${suffix}`,
        slug: `cfgroute-proj-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `cfgroute-key-${suffix}`,
      },
    });
    await prisma.virtualKey.create({
      data: {
        id: VK_ID,
        organizationId: ORG_ID,
        name: `Cfg VK ${suffix}`,
        hashedSecret: `hashed-${suffix}`,
        displayPrefix: "vk-lw-cfgro",
        createdById: USER_ID,
        routingPolicyId: RP_ID,
        config: {},
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
      },
    });
    await prisma.virtualKey.create({
      data: {
        id: VK_EXPIRING_ID,
        organizationId: ORG_ID,
        name: `Cfg Expiring VK ${suffix}`,
        hashedSecret: `hashed-exp-${suffix}`,
        displayPrefix: "vk-lw-cfgexp",
        createdById: USER_ID,
        traceProjectId: PROJECT_ID,
        expiresAt: EXPIRES_AT,
        config: {},
        scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
      },
    });
  }, 180_000);

  afterAll(async () => {
    await prisma.virtualKeyScope.deleteMany({
      where: { virtualKeyId: { in: [VK_ID, VK_EXPIRING_ID] } },
    });
    await prisma.gatewayChangeEvent.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.auditLog.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.virtualKey.deleteMany({
      where: { id: { in: [VK_ID, VK_EXPIRING_ID] } },
    });
    await prisma.routingPolicy.deleteMany({ where: { id: RP_ID } });
    await prisma.modelProvider.deleteMany({ where: { id: MP_ID } });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    if (previousSecret === undefined) {
      delete process.env.LW_GATEWAY_INTERNAL_SECRET;
    } else {
      process.env.LW_GATEWAY_INTERNAL_SECRET = previousSecret;
    }
    await stopTestContainers();
  }, 60_000);

  describe("when the VK links a routing policy", () => {
    it("ships the policy's model aliases and model deny rules on the bundle", async () => {
      const path = `/api/internal/gateway/config/${VK_ID}`;
      const res = await app.fetch(signedRequest(path));

      expect(res.status).toBe(200);
      const bundle = (await res.json()) as {
        model_aliases: Record<string, string>;
        policy_rules: { models: { deny: string[]; allow: string[] | null } };
      };
      expect(bundle.model_aliases).toEqual({ chat: "openai/gpt-5-mini" });
      expect(bundle.policy_rules.models.deny).toEqual(["^internal-.*$"]);
    });
  });

  // The gateway revalidates a cached bundle with If-None-Match rather than
  // downloading it again. A rotated credential writes the provider row and
  // nothing else, so a token that only tracks the key's revision answers 304
  // to a bundle carrying the key the operator just replaced.
  describe("when a provider credential is rotated", () => {
    const path = `/api/internal/gateway/config/${VK_ID}`;

    async function apiKeyOnBundle(res: Response) {
      const bundle = (await res.json()) as {
        providers: { id: string; credentials: { api_key?: string } }[];
      };
      return bundle.providers.find((p) => p.id === MP_ID)?.credentials.api_key;
    }

    /** @scenario "a credential written straight to the row still moves the version token" */
    /** @scenario "a key nobody touched keeps its version token" */
    it("answers a fresh bundle instead of confirming the cached one", async () => {
      const cold = await app.fetch(signedRequest(path));
      expect(cold.status).toBe(200);
      const coldETag = cold.headers.get("ETag");
      expect(coldETag).toBeTruthy();
      expect(await apiKeyOnBundle(cold)).toBe("fake-before-rotation");

      // What the gateway does every 60 seconds while nothing changes.
      const revalidated = await app.fetch(signedRequest(path, coldETag ?? ""));
      expect(revalidated.status).toBe(304);

      await prisma.modelProvider.update({
        where: { id: MP_ID },
        data: { customKeys: { OPENAI_API_KEY: "fake-after-rotation" } },
      });

      const afterRotation = await app.fetch(signedRequest(path, coldETag ?? ""));
      expect(afterRotation.status).toBe(200);
      expect(afterRotation.headers.get("ETag")).not.toBe(coldETag);
      expect(await apiKeyOnBundle(afterRotation)).toBe("fake-after-rotation");
    });
  });

  /** Reads the raw JSON, not a parsed object, because the gateway tells an
   *  explicit null apart from a field that is not there at all: the first says
   *  the key never expires, the second says an older control plane answered
   *  nothing and the gateway must keep the date it holds. */
  async function fetchConfig(vkId: string) {
    const res = await app.fetch(signedRequest(`/api/internal/gateway/config/${vkId}`));
    const text = await res.text();
    return {
      status: res.status,
      etag: res.headers.get("ETag"),
      raw: text,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    };
  }

  describe("when the key carries an expiration date", () => {
    /** @scenario "the config endpoint carries the key's expiration date" */
    it("carries the date in unix seconds, and an explicit null for a key that never expires", async () => {
      const expiring = await fetchConfig(VK_EXPIRING_ID);
      expect(expiring.status).toBe(200);
      expect(expiring.body?.expires_at).toBe(Math.floor(EXPIRES_AT.getTime() / 1000));

      const never = await fetchConfig(VK_ID);
      expect(never.status).toBe(200);
      expect(never.body?.expires_at).toBeNull();
      expect(never.raw).toContain('"expires_at":null');
    });

    /** @scenario "changing only the date moves the config version token" */
    it("moves the version token when only the date changes, so the next revalidation brings the new date", async () => {
      const before = await fetchConfig(VK_EXPIRING_ID);
      const shortened = new Date(Date.now() + DAY_MS);

      await VirtualKeyService.create(prisma).update({
        id: VK_EXPIRING_ID,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
        expiresAt: shortened,
      });

      const after = await fetchConfig(VK_EXPIRING_ID);
      expect(after.etag).not.toBe(before.etag);
      expect(after.body?.expires_at).toBe(Math.floor(shortened.getTime() / 1000));

      // The token the gateway held is the one its staleness refresh revalidates
      // with. It has to come back 200 with the new date, not 304, or a shortened
      // date would sit behind the old config until something else evicted the
      // entry.
      const path = `/api/internal/gateway/config/${VK_EXPIRING_ID}`;
      const revalidated = await app.fetch(signedRequest(path, before.etag ?? ""));
      expect(revalidated.status).toBe(200);
      const payload = (await revalidated.json()) as { expires_at: number };
      expect(payload.expires_at).toBe(Math.floor(shortened.getTime() / 1000));

      // And the token it now holds still revalidates to a 304, so an unchanged
      // key stays cheap.
      const unchanged = await app.fetch(signedRequest(path, after.etag ?? ""));
      expect(unchanged.status).toBe(304);
    });
  });
});

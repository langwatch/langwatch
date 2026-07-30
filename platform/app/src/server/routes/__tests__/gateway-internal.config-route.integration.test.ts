/**
 * @vitest-environment node
 *
 * Integration coverage for GET /api/internal/gateway/config/:vk_id, the
 * route the Go gateway calls on every bundle cache miss.
 *
 * Hits the real Hono app and real PG, no mocks. The materialiser reads
 * `vk.routingPolicy` off whatever the caller included, so a materialiser
 * test that does its own include cannot catch the route forgetting one:
 * the bundle just comes back with an empty alias map and empty deny
 * lists, and the gateway silently stops resolving aliases and enforcing
 * model policy. This exercises the route's own query.
 *
 * Spec: specs/ai-gateway/provider-routing.feature
 *       specs/ai-gateway/governance/routing-policy-aliases-and-rules.feature
 */
import { createHash, createHmac } from "crypto";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing.old/__tests__/integration/testContainers";
import { app } from "../gateway-internal";

const suffix = nanoid(8);
const ORG_ID = `org-cfgroute-${suffix}`;
const USER_ID = `usr-cfgroute-${suffix}`;
const RP_ID = `rp-cfgroute-${suffix}`;
const VK_ID = `vk-cfgroute-${suffix}`;
const SECRET = "0123456789abcdef0123456789abcdef";

function signedRequest(path: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyHash = createHash("sha256").update("").digest("hex");
  const canonical = `GET\n${path}\n${timestamp}\n${bodyHash}`;
  const signature = createHmac("sha256", SECRET)
    .update(canonical)
    .digest("hex");
  return new Request(`http://localhost${path}`, {
    method: "GET",
    headers: {
      "X-LangWatch-Gateway-Signature": signature,
      "X-LangWatch-Gateway-Timestamp": timestamp,
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
    await prisma.routingPolicy.create({
      data: {
        id: RP_ID,
        organizationId: ORG_ID,
        name: `Cfg Policy ${suffix}`,
        modelAliases: { chat: "openai/gpt-5-mini" },
        policyRules: { models: { deny: ["^internal-.*$"], allow: null } },
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
  }, 180_000);

  afterAll(async () => {
    await prisma.virtualKeyScope.deleteMany({ where: { virtualKeyId: VK_ID } });
    await prisma.virtualKey.deleteMany({ where: { id: VK_ID } });
    await prisma.routingPolicy.deleteMany({ where: { id: RP_ID } });
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
});

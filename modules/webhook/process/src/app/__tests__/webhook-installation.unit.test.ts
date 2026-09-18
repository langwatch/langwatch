/**
 * @vitest-environment node
 * The feature installs: a process that chose the memory tier gets a working
 * `WebhookApi` over repositories the installer instantiated. Nothing in this
 * file names a repository class or a tier for the app - the module declared
 * both tiers once, and the process said which one it wanted.
 */
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApiFixture } from "@langwatch/api-fixture";
import { WebhookApi } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import { webhookServer } from "../../webhook.server.ts";

const ORGANIZATION_ID = "organization-1";

const entitledPlan: Plan = {
  planSource: "license",
  type: "enterprise",
  name: "Enterprise",
  free: false,
  maxMembers: 10,
  maxMembersLite: 10,
  maxMessagesPerMonth: 10,
  canPublish: true,
  webhookEndpointsEnabled: true,
  prices: { USD: 0, EUR: 0 },
};

/** The two members this feature reads, answered the way opened stores answer. */
function stores() {
  const prisma = new PrismaClient({ accelerateUrl: "prisma://localhost/test" });
  const rateLimiter = { check: async () => ({ allowed: true }) };

  return {
    order: ["prisma", "rateLimiter"],
    read: (name: string) => (name === "prisma" ? prisma : rateLimiter),
  };
}

function process(role: "api" | "worker") {
  return createApp({ role })
    .withModules([withMemoryRepositories(webhookServer)])
    .withStores(stores())
    .provide({
      entitlement: createApiFixture<EntitlementApi>({
        getActivePlan: async () => entitledPlan,
      }),
    });
}

describe("webhook app installation", () => {
  describe("given a process that boots the feature over memory", () => {
    it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
      const runtime = await process(role).boot();

      try {
        const app = runtime.service(WebhookApi);

        expect(runtime.module(webhookServer).provided).toBe(app);

        const { endpoint, secret } = await app.create({
          organizationId: ORGANIZATION_ID,
          url: "https://example.com/hooks/spend",
          enabledEvents: ["gateway.request.completed"],
        });

        expect(secret).not.toBe("");
        await expect(app.getAll({ organizationId: ORGANIZATION_ID })).resolves.toMatchObject([
          { id: endpoint.id },
        ]);
        await expect(app.getAll({ organizationId: "other-organization" })).resolves.toEqual([]);
      } finally {
        await runtime.stop();
      }
    });
  });
});

/**
 * The outbound-webhook endpoint registry, served by the API process.
 *
 * Booted over the memory repositories rather than a Prisma double: the point
 * of the installer is that persistence is chosen once, at boot, so the same
 * graph this test drives is the one `installApiWebhook` builds over Postgres
 * and ClickHouse.
 */
import { InMemoryProcessStore } from "@langwatch/eventing";
import { createApp } from "@langwatch/runtime-composition";
import { WebhookApp, webhookServer } from "@langwatch/webhook-server";
import { describe, expect, it } from "vitest";

const ORGANIZATION_ID = "organization-1";

async function bootWebhook(): Promise<WebhookApp> {
  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("memory", {})
    .withInfrastructure({})
    .withModule(webhookServer, {
      infrastructure: {
        processStore: InMemoryProcessStore.createForTesting(),
        assertEndpointsEntitled: () => Promise.resolve(),
        dispatch: () => Promise.reject(new Error("this boot fires no test delivery")),
      },
    })
    .boot({ role: "api" });

  return runtime.module(webhookServer).provided;
}

describe("given the API process installs the webhook module", () => {
  describe("when an organization creates an endpoint", () => {
    it("reads it back through the registry and its delivery health", async () => {
      const webhook = await bootWebhook();

      const { endpoint, secret } = await webhook.create({
        organizationId: ORGANIZATION_ID,
        url: "https://example.com/hook",
        enabledEvents: ["gateway.request.completed"],
      });

      expect(endpoint.status).toBe("ACTIVE");
      expect(secret).toMatch(/^whsec_/);
      await expect(webhook.getAll({ organizationId: ORGANIZATION_ID })).resolves.toHaveLength(1);
      await expect(
        webhook.getHealth({ organizationId: ORGANIZATION_ID, endpointId: endpoint.id }),
      ).resolves.toMatchObject({ status: "ACTIVE" });
    });
  });

  describe("when no envelope was ever emitted for the organization", () => {
    it("reads the emitted-events log as empty rather than unavailable", async () => {
      const webhook = await bootWebhook();

      await expect(
        webhook.getEmittedEvents({ organizationId: ORGANIZATION_ID, limit: 10 }),
      ).resolves.toEqual({ events: [], nextCursor: null });
    });
  });
});

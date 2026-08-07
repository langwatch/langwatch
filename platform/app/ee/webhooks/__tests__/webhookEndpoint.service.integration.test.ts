// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Organization } from "~/generated/prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "~/server/db";
import {
  WEBHOOK_AUTO_DISABLE_AFTER_MS,
  WEBHOOK_DISABLED_REASON_AUTO,
  WebhookEndpointService,
} from "../webhookEndpoint.service";

const ns = `webhook-svc-${nanoid(8)}`;

let organization: Organization;
const notifyAutoDisabled = vi.fn().mockResolvedValue(undefined);
const service = new WebhookEndpointService({ prisma, notifyAutoDisabled });

beforeAll(async () => {
  organization = await prisma.organization.create({
    data: { name: "Webhook Service Test Org", slug: `--test-org-${ns}` },
  });
});

afterAll(async () => {
  if (!organization?.id) return;
  await prisma.webhookEndpointDelivery.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.webhookEndpoint.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.organization.delete({ where: { id: organization.id } });
});

async function createEndpoint() {
  return service.create({
    organizationId: organization.id,
    url: "https://example.com/hooks/billing",
    enabledEvents: ["gateway.request.completed"],
  });
}

describe("webhook endpoint service", () => {
  it("returns the secret once at create and roll, never on reads", async () => {
    const { endpoint, secret } = await createEndpoint();
    expect(secret).toMatch(/^whsec_/);
    expect(endpoint).not.toHaveProperty("secret");
    expect(endpoint).not.toHaveProperty("secretEncrypted");

    const listed = await service.getAll({ organizationId: organization.id });
    for (const row of listed) {
      expect(row).not.toHaveProperty("secret");
      expect(row).not.toHaveProperty("secretEncrypted");
    }
    const fetched = await service.getById({
      organizationId: organization.id,
      endpointId: endpoint.id,
    });
    expect(fetched).not.toHaveProperty("secret");
    expect(fetched).not.toHaveProperty("secretEncrypted");

    const rolled = await service.rollSecret({
      organizationId: organization.id,
      endpointId: endpoint.id,
    });
    expect(rolled.secret).toMatch(/^whsec_/);
    expect(rolled.secret).not.toBe(secret);
    // The stored secret decrypts to the rolled value, proving the roll took.
    const decrypted = await service.getSigningSecret({
      organizationId: organization.id,
      endpointId: endpoint.id,
    });
    expect(decrypted).toBe(rolled.secret);
  });

  describe("given a rolled signing secret", () => {
    /** @scenario A rolled secret keeps signing for a grace window */
    it("signs with both secrets inside the window and the new one after", async () => {
      const { endpoint, secret: original } = await createEndpoint();
      const rolledAt = new Date();
      const { secret: rolled } = await service.rollSecret({
        organizationId: organization.id,
        endpointId: endpoint.id,
        now: rolledAt,
      });

      const inWindow = await service.getSigningSecrets({
        organizationId: organization.id,
        endpointId: endpoint.id,
        now: new Date(rolledAt.getTime() + 23 * 60 * 60 * 1000),
      });
      // Newest first: a receiver that already swapped reads the new one
      // first, and one that has not still finds its own.
      expect(inWindow).toEqual([rolled, original]);

      const afterWindow = await service.getSigningSecrets({
        organizationId: organization.id,
        endpointId: endpoint.id,
        now: new Date(rolledAt.getTime() + 25 * 60 * 60 * 1000),
      });
      // The window closes on the clock, so a leaked secret's usefulness
      // ends without anything having to sweep it.
      expect(afterWindow).toEqual([rolled]);
    });

    it("serves a single secret before any roll", async () => {
      const { endpoint, secret } = await createEndpoint();
      expect(
        await service.getSigningSecrets({
          organizationId: organization.id,
          endpointId: endpoint.id,
        }),
      ).toEqual([secret]);
    });

    it("keeps only one previous secret when rolled twice inside the window", async () => {
      const { endpoint } = await createEndpoint();
      const first = new Date();
      const { secret: second } = await service.rollSecret({
        organizationId: organization.id,
        endpointId: endpoint.id,
        now: first,
      });
      const { secret: third } = await service.rollSecret({
        organizationId: organization.id,
        endpointId: endpoint.id,
        now: new Date(first.getTime() + 60_000),
      });
      // An operator rolling twice under suspicion of a leak means the
      // oldest secret to stop working, not to ride a chain of windows.
      expect(
        await service.getSigningSecrets({
          organizationId: organization.id,
          endpointId: endpoint.id,
          now: new Date(first.getTime() + 120_000),
        }),
      ).toEqual([third, second]);
    });
  });

  /** @scenario A success resets the failure streak */
  /** @scenario Plain-http receiver URLs need the operator opt-in */
  it("refuses http URLs unless WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS is set", async () => {
    const previous = process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS;
    try {
      delete process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS;
      await expect(
        service.create({
          organizationId: organization.id,
          url: "http://localhost:4101/webhooks/langwatch",
          enabledEvents: ["gateway.request.completed"],
        }),
      ).rejects.toThrow("url must use https");

      process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS = "1";
      const created = await service.create({
        organizationId: organization.id,
        url: "http://localhost:4101/webhooks/langwatch",
        enabledEvents: ["gateway.request.completed"],
      });
      expect(created.endpoint.url).toBe(
        "http://localhost:4101/webhooks/langwatch",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS;
      } else {
        process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS = previous;
      }
    }
  });

  it("clears failingSince on a successful attempt", async () => {
    const { endpoint } = await createEndpoint();
    await service.recordDeliveryAttempt({
      organizationId: organization.id,
      endpointId: endpoint.id,
      dispatchId: "batch-1",
      attempt: 1,
      eventCount: 10,
      outcome: "retryable",
      responseStatus: 503,
    });
    let health = await service.health({
      organizationId: organization.id,
      endpointId: endpoint.id,
    });
    expect(health.failingSince).not.toBeNull();
    expect(health.lastFailureAt).not.toBeNull();

    await service.recordDeliveryAttempt({
      organizationId: organization.id,
      endpointId: endpoint.id,
      dispatchId: "batch-1",
      attempt: 2,
      eventCount: 10,
      outcome: "success",
      responseStatus: 200,
    });
    health = await service.health({
      organizationId: organization.id,
      endpointId: endpoint.id,
    });
    expect(health.failingSince).toBeNull();
    expect(health.lastSuccessAt).not.toBeNull();
    expect(health.status).toBe("ACTIVE");
  });

  /** @scenario Seventy two hours of consecutive failures disables the endpoint */
  it("auto-disables with the automatic reason and fires the notification hook", async () => {
    const { endpoint } = await createEndpoint();
    notifyAutoDisabled.mockClear();
    const t0 = new Date("2026-07-20T00:00:00Z");

    await service.recordDeliveryAttempt({
      organizationId: organization.id,
      endpointId: endpoint.id,
      dispatchId: "batch-x",
      attempt: 1,
      eventCount: 5,
      outcome: "retryable",
      responseStatus: 500,
      now: t0,
    });
    expect(notifyAutoDisabled).not.toHaveBeenCalled();

    await service.recordDeliveryAttempt({
      organizationId: organization.id,
      endpointId: endpoint.id,
      dispatchId: "batch-x",
      attempt: 2,
      eventCount: 5,
      outcome: "retryable",
      responseStatus: 500,
      now: new Date(t0.getTime() + WEBHOOK_AUTO_DISABLE_AFTER_MS + 1),
    });

    const health = await service.health({
      organizationId: organization.id,
      endpointId: endpoint.id,
    });
    expect(health.status).toBe("DISABLED");
    expect(health.disabledReason).toBe(WEBHOOK_DISABLED_REASON_AUTO);
    expect(notifyAutoDisabled).toHaveBeenCalledTimes(1);
    expect(notifyAutoDisabled).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: organization.id,
        endpointId: endpoint.id,
      }),
    );

    // Re-enable restarts the clock: streak cleared, status back to ACTIVE.
    const reEnabled = await service.enable({
      organizationId: organization.id,
      endpointId: endpoint.id,
    });
    expect(reEnabled.status).toBe("ACTIVE");
    expect(reEnabled.failingSince).toBeNull();
    expect(reEnabled.disabledReason).toBeNull();
  });

  it("stores the receiver's status per attempt in the delivery log", async () => {
    const { endpoint } = await createEndpoint();
    await service.recordDeliveryAttempt({
      organizationId: organization.id,
      endpointId: endpoint.id,
      dispatchId: "batch-log",
      attempt: 1,
      eventCount: 3,
      outcome: "retryable",
      responseStatus: 502,
      latencyMs: 123,
      error: "HTTP 502",
      response: { body: "bad gateway" },
    });
    const page = await service.getDeliveries({
      organizationId: organization.id,
      endpointId: endpoint.id,
    });
    expect(page.deliveries[0]).toMatchObject({
      dispatchId: "batch-log",
      attempt: 1,
      eventCount: 3,
      outcome: "retryable",
      responseStatus: 502,
      latencyMs: 123,
      error: "HTTP 502",
    });
  });

  /** @scenario The delivery log is cursor-paginated newest-first */
  it("cursor-paginates the delivery log newest-first", async () => {
    const { endpoint } = await createEndpoint();
    const base = new Date("2026-07-31T00:00:00.000Z").getTime();
    for (let i = 0; i < 5; i++) {
      await service.recordDeliveryAttempt({
        organizationId: organization.id,
        endpointId: endpoint.id,
        dispatchId: `pageable-${i}`,
        attempt: 1,
        eventCount: 1,
        outcome: "success",
        responseStatus: 200,
        latencyMs: 10,
        now: new Date(base + i * 1000),
      });
    }

    const first = await service.getDeliveries({
      organizationId: organization.id,
      endpointId: endpoint.id,
      limit: 2,
    });
    expect(first.deliveries).toHaveLength(2);
    // Newest first: the last-recorded attempt leads.
    expect(first.deliveries[0]!.dispatchId).toBe("pageable-4");
    expect(first.deliveries[1]!.dispatchId).toBe("pageable-3");
    expect(first.nextCursor).not.toBeNull();

    const second = await service.getDeliveries({
      organizationId: organization.id,
      endpointId: endpoint.id,
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.deliveries.map((d) => d.dispatchId)).toEqual([
      "pageable-2",
      "pageable-1",
    ]);
    // No overlap across the page boundary.
    const firstIds = first.deliveries.map((d) => d.id);
    expect(second.deliveries.every((d) => !firstIds.includes(d.id))).toBe(true);
  });
});

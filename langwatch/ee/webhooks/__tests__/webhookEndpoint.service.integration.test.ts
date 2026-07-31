// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Organization } from "@prisma/client";
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

  /** @scenario A success resets the failure streak */
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
    const deliveries = await service.getDeliveries({
      organizationId: organization.id,
      endpointId: endpoint.id,
    });
    expect(deliveries[0]).toMatchObject({
      dispatchId: "batch-log",
      attempt: 1,
      eventCount: 3,
      outcome: "retryable",
      responseStatus: 502,
      latencyMs: 123,
      error: "HTTP 502",
    });
  });
});

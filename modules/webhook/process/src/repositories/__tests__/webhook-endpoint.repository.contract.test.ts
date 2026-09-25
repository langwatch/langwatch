import { Temporal, type Instant } from "@langwatch/time";
/**
 * Tests endpoint registry contract: admission, enable/disable, rotation, auto-disable.
 */
import {
  WebhookEndpointNotFoundError,
  WebhookEndpointValidationError,
} from "@langwatch/webhook-contract";
import { beforeEach, describe, expect, it } from "vitest";

import type { WebhookId, WebhookSecret } from "../../app/webhook.app.ts";
import { MemoryWebhookDatabase } from "../memory/memory.webhook-database.ts";
import { MemoryWebhookEndpointRepository } from "../memory/memory.webhook-endpoint.repository.ts";
import type { WebhookEndpointRepository } from "../webhook-endpoint.repository.ts";

const ORGANIZATION_ID = "organization-1";
const OTHER_ORGANIZATION_ID = "organization-2";

class SequentialIds implements WebhookId {
  #count = 0;

  newEndpointId(): string {
    this.#count += 1;

    return `webhook_endpoint_${this.#count}`;
  }
}

class PassthroughSecrets implements WebhookSecret {
  encrypt(value: string): string {
    return `enc:${value}`;
  }

  decrypt(value: string): string {
    return value.slice("enc:".length);
  }
}

const at = (iso: string): Instant => Temporal.Instant.from(iso);

const backends: readonly Readonly<{ name: string; create: () => WebhookEndpointRepository }>[] = [
  {
    name: "memory",
    create: () =>
      MemoryWebhookEndpointRepository.create({
        database: MemoryWebhookDatabase.create(),
        options: { ids: new SequentialIds(), secrets: new PassthroughSecrets() },
      }),
  },
];

describe.each(backends)("given the $name webhook endpoint repository", ({ create }) => {
  let repository: WebhookEndpointRepository;

  beforeEach(() => {
    repository = create();
  });

  describe("when an http endpoint is created", () => {
    it("reads it back and returns the signing secret exactly once", async () => {
      const { endpoint, secret } = await repository.create({
        organizationId: ORGANIZATION_ID,
        url: "https://example.com/hook",
        enabledEvents: ["gateway.request.completed"],
      });

      expect(endpoint.status).toBe("ACTIVE");
      expect(secret).toMatch(/^whsec_/);
      expect(
        await repository.getSigningSecret({
          organizationId: ORGANIZATION_ID,
          endpointId: endpoint.id,
        }),
      ).toBe(secret);
      expect(await repository.findAll({ organizationId: ORGANIZATION_ID })).toHaveLength(1);
      await expect(repository.findAll({ organizationId: OTHER_ORGANIZATION_ID })).resolves.toEqual(
        [],
      );
    });

    it("rejects a URL that does not use https", async () => {
      await expect(
        repository.create({
          organizationId: ORGANIZATION_ID,
          url: "http://example.com/hook",
          enabledEvents: ["gateway.request.completed"],
        }),
      ).rejects.toThrow(WebhookEndpointValidationError);
    });

    it("rejects an empty event selection", async () => {
      await expect(
        repository.create({
          organizationId: ORGANIZATION_ID,
          url: "https://example.com/hook",
          enabledEvents: [],
        }),
      ).rejects.toThrow(WebhookEndpointValidationError);
    });
  });

  describe("when an endpoint is archived", () => {
    it("stops appearing in reads and future lookups miss it", async () => {
      const { endpoint } = await repository.create({
        organizationId: ORGANIZATION_ID,
        url: "https://example.com/hook",
        enabledEvents: ["gateway.request.completed"],
      });

      await repository.archive({ organizationId: ORGANIZATION_ID, endpointId: endpoint.id });

      await expect(repository.findAll({ organizationId: ORGANIZATION_ID })).resolves.toEqual([]);
      await expect(
        repository.getById({ organizationId: ORGANIZATION_ID, endpointId: endpoint.id }),
      ).rejects.toThrow(WebhookEndpointNotFoundError);
    });
  });

  describe("when a secret is rolled", () => {
    it("keeps the outgoing secret valid until the rotation window closes", async () => {
      const { endpoint, secret: original } = await repository.create({
        organizationId: ORGANIZATION_ID,
        url: "https://example.com/hook",
        enabledEvents: ["gateway.request.completed"],
      });
      const rolledAt = at("2026-01-01T00:00:00Z");

      const { secret: rolled } = await repository.rollSecret({
        organizationId: ORGANIZATION_ID,
        endpointId: endpoint.id,
        now: rolledAt,
      });

      const withinWindow = await repository.findSigningSecrets({
        organizationId: ORGANIZATION_ID,
        endpointId: endpoint.id,
        now: rolledAt.add({ hours: 1 }),
      });
      expect(withinWindow).toEqual([rolled, original]);

      const pastWindow = await repository.findSigningSecrets({
        organizationId: ORGANIZATION_ID,
        endpointId: endpoint.id,
        now: rolledAt.add({ hours: 25 }),
      });
      expect(pastWindow).toEqual([rolled]);
    });
  });

  describe("when an endpoint is disabled and re-enabled", () => {
    it("clears the disabled reason and drops it from the deliverable set while disabled", async () => {
      const { endpoint } = await repository.create({
        organizationId: ORGANIZATION_ID,
        url: "https://example.com/hook",
        enabledEvents: ["gateway.request.completed"],
      });

      const disabled = await repository.disable({
        organizationId: ORGANIZATION_ID,
        endpointId: endpoint.id,
      });
      expect(disabled.status).toBe("DISABLED");
      expect(disabled.disabledReason).toBe("manual");
      await expect(
        repository.findDeliverable({ organizationId: ORGANIZATION_ID, endpointId: endpoint.id }),
      ).resolves.toBeNull();

      const enabled = await repository.enable({
        organizationId: ORGANIZATION_ID,
        endpointId: endpoint.id,
      });
      expect(enabled.status).toBe("ACTIVE");
      expect(enabled.disabledReason).toBeNull();
      await expect(
        repository.findDeliverable({ organizationId: ORGANIZATION_ID, endpointId: endpoint.id }),
      ).resolves.toMatchObject({ id: endpoint.id });
    });
  });

  describe("when delivery attempts keep failing past the 72h streak", () => {
    let endpoint: Awaited<ReturnType<WebhookEndpointRepository["create"]>>["endpoint"];
    let start: Instant;

    beforeEach(async () => {
      ({ endpoint } = await repository.create({
        organizationId: ORGANIZATION_ID,
        url: "https://example.com/hook",
        enabledEvents: ["gateway.request.completed"],
      }));
      start = at("2026-01-01T00:00:00Z");

      await repository.recordDeliveryAttempt({
        organizationId: ORGANIZATION_ID,
        endpointId: endpoint.id,
        dispatchId: "dispatch-1",
        attempt: 1,
        eventCount: 1,
        outcome: "terminal",
        now: start,
      });
    });

    it("auto-disables the endpoint and reports why", async () => {
      await repository.recordDeliveryAttempt({
        organizationId: ORGANIZATION_ID,
        endpointId: endpoint.id,
        dispatchId: "dispatch-2",
        attempt: 1,
        eventCount: 1,
        outcome: "terminal",
        now: start.add({ hours: 73 }),
      });

      const status = await repository.health({
        organizationId: ORGANIZATION_ID,
        endpointId: endpoint.id,
      });
      expect(status.status).toBe("DISABLED");
      expect(status.disabledReason).toBe("auto_failures_72h");

      const stats = await repository.getDeliveryStats({
        organizationId: ORGANIZATION_ID,
        endpointId: endpoint.id,
        since: start.subtract({ minutes: 1 }),
        sampleLimit: 10,
      });
      expect(stats.attempted).toBe(2);
      expect(stats.delivered).toBe(0);
    });

    it("clears the streak on a success in between", async () => {
      await repository.recordDeliveryAttempt({
        organizationId: ORGANIZATION_ID,
        endpointId: endpoint.id,
        dispatchId: "dispatch-2",
        attempt: 1,
        eventCount: 1,
        outcome: "success",
        now: start.add({ hours: 1 }),
      });
      await repository.recordDeliveryAttempt({
        organizationId: ORGANIZATION_ID,
        endpointId: endpoint.id,
        dispatchId: "dispatch-3",
        attempt: 1,
        eventCount: 1,
        outcome: "terminal",
        now: start.add({ hours: 73 }),
      });

      const status = await repository.health({
        organizationId: ORGANIZATION_ID,
        endpointId: endpoint.id,
      });
      expect(status.status).toBe("ACTIVE");
    });
  });

  describe("when the delivery log is pruned", () => {
    it("drops rows older than the retention bound", async () => {
      const { endpoint } = await repository.create({
        organizationId: ORGANIZATION_ID,
        url: "https://example.com/hook",
        enabledEvents: ["gateway.request.completed"],
      });
      const old = at("2026-01-01T00:00:00Z");
      await repository.recordDeliveryAttempt({
        organizationId: ORGANIZATION_ID,
        endpointId: endpoint.id,
        dispatchId: "dispatch-old",
        attempt: 1,
        eventCount: 1,
        outcome: "success",
        now: old,
      });

      const removed = await repository.pruneDeliveries(old.add({ hours: 31 * 24 }));

      expect(removed).toBe(1);
      const { deliveries } = await repository.getDeliveries({
        organizationId: ORGANIZATION_ID,
        endpointId: endpoint.id,
      });
      expect(deliveries).toEqual([]);
    });
  });
});

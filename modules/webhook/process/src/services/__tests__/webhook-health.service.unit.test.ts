/**
 * Endpoint health metrics must accurately represent receiver health; success rates over
 * zero attempts are unknown, and p95 from unsorted lists is arbitrary.
 */

import { InMemoryProcessStore } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import {
  WebhookHealthService,
  type WebhookEndpointHealthSource,
} from "../webhook-health.service.ts";

const NOW = new Date("2026-08-31T12:00:00.000Z").getTime();

const snapshot = {
  status: "ACTIVE" as const,
  disabledReason: null,
  failingSince: null,
  lastSuccessAt: null,
  lastFailureAt: null,
};

function serviceReporting(stats: { attempted: number; delivered: number; latencies: number[] }) {
  const endpoints: WebhookEndpointHealthSource = {
    findStatusSnapshot: async () => snapshot,
    getDeliveryStats: async () => stats,
  };
  return WebhookHealthService.create({
    endpoints,
    processStore: InMemoryProcessStore.createForTesting(),
    now: () => NOW,
  });
}

const health = (stats: { attempted: number; delivered: number; latencies: number[] }) =>
  serviceReporting(stats).health({ organizationId: "organization-1", endpointId: "endpoint-1" });

describe("WebhookHealthService.health", () => {
  describe("when computing the success rate", () => {
    it("is the delivered share of what was attempted", async () => {
      await expect(health({ attempted: 4, delivered: 3, latencies: [] })).resolves.toMatchObject({
        successRate: 0.75,
      });
    });

    it("is unknown, not perfect, when nothing was attempted", async () => {
      // An endpoint nobody sent to has not succeeded at anything, and showing
      // 100% would read as healthy.
      await expect(health({ attempted: 0, delivered: 0, latencies: [] })).resolves.toMatchObject({
        successRate: null,
      });
    });
  });

  describe("when computing the p95 latency", () => {
    it("sorts the samples before picking, whatever order they arrived in", async () => {
      // The samples come back in delivery order. Reading the 95th slot of an
      // unsorted list reports whichever request happened to land there.
      const ascending = Array.from({ length: 100 }, (_, index) => index + 1);
      const shuffled = [...ascending].reverse();

      const [inOrder, outOfOrder] = await Promise.all([
        health({ attempted: 100, delivered: 100, latencies: ascending }),
        health({ attempted: 100, delivered: 100, latencies: shuffled }),
      ]);

      expect(inOrder.p95LatencyMs).toBe(96);
      expect(outOfOrder.p95LatencyMs).toBe(inOrder.p95LatencyMs);
    });

    it("is unknown when no request was timed", async () => {
      await expect(health({ attempted: 3, delivered: 3, latencies: [] })).resolves.toMatchObject({
        p95LatencyMs: null,
      });
    });

    it("answers the only sample when there is one", async () => {
      await expect(health({ attempted: 1, delivered: 1, latencies: [42] })).resolves.toMatchObject({
        p95LatencyMs: 42,
      });
    });

    it("stays inside the samples for a short list", async () => {
      // The `Math.min(length - 1, ...)` in the index is belt and braces: for
      // any whole n at least 1, floor(0.95n) is already at most n - 1, so the
      // clamp never binds. Removing it changes no answer, and this test says
      // so rather than crediting it with a guard.
      const result = await health({ attempted: 3, delivered: 3, latencies: [10, 20, 30] });

      expect(result.p95LatencyMs).toBe(30);
    });
  });

  describe("given the endpoint does not exist", () => {
    it("refuses rather than reporting a healthy one", async () => {
      const service = WebhookHealthService.create({
        endpoints: {
          findStatusSnapshot: async () => null,
          getDeliveryStats: async () => ({ attempted: 0, delivered: 0, latencies: [] }),
        },
        processStore: InMemoryProcessStore.createForTesting(),
        now: () => NOW,
      });

      await expect(
        service.health({ organizationId: "organization-1", endpointId: "missing" }),
      ).rejects.toMatchObject({ code: "webhook_endpoint_not_found" });
    });
  });
});

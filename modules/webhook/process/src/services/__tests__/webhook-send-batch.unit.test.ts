// SPDX-License-Identifier: Apache-2.0

/**
 * What happens to one batch after the transport answers.
 *
 * The transport decides the verdict; this decides what the verdict costs. A
 * retryable failure has to climb the ladder, a terminal one has to stop
 * immediately, and both have to leave a delivery-log row a customer can read
 * — including a reason, because a failed attempt with a blank reason column
 * tells them nothing.
 *
 * The rule most easily lost is that a receiver's Retry-After only means
 * something when there is going to be a retry. Carried onto a terminal
 * failure it would be a backoff floor on a batch that is already dead.
 */

import { createApiFixture } from "@langwatch/api-fixture";
import { DispatchError, type IntentContext, type ProcessStore } from "@langwatch/eventing";
import type { WebhookEndpointView } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import type {
  SendBatchPayload,
  WebhookDeliveryEndpointService,
  WebhookDispatchResult,
} from "../../rules/webhook-delivery-contract.rules.ts";
import {
  WebhookDeliveryService,
  type WebhookDeliveryProcessDeps,
} from "../webhook-delivery.service.ts";

type Recorded = Record<string, unknown>;

const DELIVERABLE: WebhookEndpointView = {
  id: "endpoint-1",
  organizationId: "organization-1",
  destinationKind: "http",
  url: "https://example.test/hook",
  sqs: null,
  enabledEvents: [],
  status: "ACTIVE",
  disabledReason: null,
  disabledAt: null,
  failingSince: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  maxBatchSize: 3,
  maxBatchDelayMs: 1_000,
  maxInFlight: 2,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

function sendBatchWith(options: {
  disposition?: "deliverable" | "paused" | "gone";
  result?: WebhookDispatchResult;
  dispatchThrows?: unknown;
  elapsedMs?: number;
}) {
  const recorded: Recorded[] = [];
  let calls = 0;
  const deps: WebhookDeliveryProcessDeps = {
    processStore: createApiFixture<ProcessStore>({}),
    pruneExpiredIdempotencyReceipts: async () => 0,
    getPlan: async () => ({ webhookEndpointsEnabled: true }),
    endpoints: createApiFixture<WebhookDeliveryEndpointService>({
      getDeliveryDisposition: async () => {
        const state = options.disposition ?? "deliverable";
        return state === "deliverable" ? { state, endpoint: DELIVERABLE } : { state };
      },
      findSigningSecrets: async () => ["secret"],
      getDestinationConfig: async () => ({ kind: "http", url: "https://example.test/hook" }),
      recordDeliveryAttempt: async (attempt) => {
        recorded.push(attempt);
      },
    }),
    dispatch: async () => {
      if (options.dispatchThrows !== undefined) throw options.dispatchThrows;
      return options.result ?? { verdict: "success" as const, status: 200 };
    },
    now: () => {
      calls += 1;
      return calls === 1 ? 1_000 : 1_000 + (options.elapsedMs ?? 250);
    },
  };

  const payload: SendBatchPayload = {
    organizationId: "organization-1",
    endpointId: "endpoint-1",
    batchId: "endpoint-1:abc123",
    envelopes: [
      { id: "envelope-1", type: "t", created: "c", schema_version: "1", data: {} },
      { id: "envelope-2", type: "t", created: "c", schema_version: "1", data: {} },
    ],
  };
  const context: IntentContext = {
    processName: "webhook-delivery",
    projectId: "organization-1",
    processKey: "endpoint:endpoint-1",
    tenantId: "organization-1",
    messageKey: "endpoint-1:abc123",
    attempt: 3,
  };

  const run = WebhookDeliveryService.create(deps).runWebhookSendBatch();
  return {
    recorded,
    send: () => run(payload, context),
  };
}

async function thrownBy(send: () => Promise<unknown>): Promise<DispatchError> {
  try {
    await send();
  } catch (error) {
    if (error instanceof DispatchError) return error;
    throw error;
  }
  throw new Error("expected the send to throw");
}

describe("WebhookDeliveryService.runWebhookSendBatch", () => {
  describe("given the endpoint was deleted", () => {
    it("acknowledges the batch without dispatching or logging an attempt", async () => {
      const { send, recorded } = sendBatchWith({ disposition: "gone" });

      await expect(send()).resolves.toBeUndefined();
      expect(recorded).toHaveLength(0);
    });
  });

  describe("given the endpoint is disabled", () => {
    it("keeps the batch queued with a retryable throw and logs no attempt", async () => {
      // A recorded failure here would put a customer's own pause in their
      // delivery log as an error.
      const { send, recorded } = sendBatchWith({ disposition: "paused" });

      const error = await thrownBy(send);
      expect(error.retryable).toBe(true);
      expect(recorded).toHaveLength(0);
    });
  });

  describe("given the transport accepted the batch", () => {
    it("records a success and does not throw", async () => {
      const { send, recorded } = sendBatchWith({
        result: { verdict: "success", status: 202 },
      });

      await expect(send()).resolves.toBeUndefined();
      expect(recorded[0]).toMatchObject({ outcome: "success", responseStatus: 202 });
    });

    it("logs the attempt against the batch, so a reader can line it up with the send", async () => {
      const { send, recorded } = sendBatchWith({});

      await send();

      expect(recorded[0]).toMatchObject({
        organizationId: "organization-1",
        endpointId: "endpoint-1",
        dispatchId: "endpoint-1:abc123",
        attempt: 3,
        eventCount: 2,
      });
    });

    it("times the attempt", async () => {
      const { send, recorded } = sendBatchWith({ elapsedMs: 900 });

      await send();

      expect(recorded[0]?.latencyMs).toBe(900);
    });
  });

  describe("given the transport reported a retryable failure", () => {
    it("records it and throws so the ladder picks it up", async () => {
      const { send, recorded } = sendBatchWith({
        result: { verdict: "retryable", status: 503, error: "service unavailable" },
      });

      const error = await thrownBy(send);

      expect(recorded[0]).toMatchObject({ outcome: "retryable", error: "service unavailable" });
      expect(error).toBeInstanceOf(DispatchError);
      expect(error.retryable).toBe(true);
    });

    it("honours the receiver's Retry-After as a floor on the next attempt", async () => {
      const { send } = sendBatchWith({
        result: { verdict: "retryable", status: 429, retryAfterMs: 30_000 },
      });

      expect((await thrownBy(send)).retryAfterMs).toBe(30_000);
    });

    it("names the endpoint in the failure, so the ladder's log says which one", async () => {
      const { send } = sendBatchWith({
        result: { verdict: "retryable", status: 503, error: "service unavailable" },
      });

      expect((await thrownBy(send)).message).toContain("endpoint-1");
    });
  });

  describe("given the transport reported a terminal failure", () => {
    it("throws un-retryably, so the batch dead-letters instead of climbing the ladder", async () => {
      const { send, recorded } = sendBatchWith({
        result: { verdict: "terminal", status: 400, error: "malformed" },
      });

      const error = await thrownBy(send);

      expect(recorded[0]).toMatchObject({ outcome: "terminal" });
      expect(error.retryable).toBe(false);
    });

    it("carries no Retry-After, because there is no next attempt to delay", async () => {
      const { send } = sendBatchWith({
        result: { verdict: "terminal", status: 400, retryAfterMs: 30_000 },
      });

      expect((await thrownBy(send)).retryAfterMs).toBeUndefined();
    });
  });

  describe("given a failure the transport had no words for", () => {
    it("still records a reason, rather than a blank column in the delivery log", async () => {
      const { send, recorded } = sendBatchWith({
        result: { verdict: "retryable", status: null },
      });

      await thrownBy(send);

      expect(recorded[0]?.error).toBeTruthy();
    });

    it("omits the response status when the transport had none", async () => {
      // A queue transport has no status code; a null must not be logged as one.
      const { send, recorded } = sendBatchWith({
        result: { verdict: "retryable", status: null },
      });

      await thrownBy(send);

      expect(recorded[0]).not.toHaveProperty("responseStatus");
    });
  });

  describe("given the transport itself threw", () => {
    it("records it as retryable by default and lets the failure through", async () => {
      const { send, recorded } = sendBatchWith({ dispatchThrows: new Error("connection reset") });

      await expect(send()).rejects.toThrow("connection reset");
      expect(recorded[0]).toMatchObject({ outcome: "retryable", error: "connection reset" });
    });

    it("respects a thrower that declares itself terminal", async () => {
      const fatal = Object.assign(new Error("bad destination"), { retryable: false });
      const { send, recorded } = sendBatchWith({ dispatchThrows: fatal });

      await expect(send()).rejects.toThrow("bad destination");
      expect(recorded[0]).toMatchObject({ outcome: "terminal" });
    });
  });
});

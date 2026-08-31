// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

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

import { describe, expect, it } from "vitest";
import { DispatchError } from "@langwatch/eventing";
import { WebhookDeliveryService, type WebhookDispatchResult } from "../webhook-delivery.service";

type Recorded = Record<string, unknown>;

function sendBatchWith(options: {
  deliverable?: boolean;
  result?: WebhookDispatchResult;
  dispatchThrows?: unknown;
  elapsedMs?: number;
}) {
  const recorded: Recorded[] = [];
  let calls = 0;
  const deps = {
    endpoints: {
      tryGetDeliverable: async () => ((options.deliverable ?? true) ? { id: "endpoint-1" } : null),
      getSigningSecrets: async () => ["secret"],
      getDestinationConfig: async () => ({ kind: "http" }),
      recordDeliveryAttempt: async (attempt: Recorded) => {
        recorded.push(attempt);
      },
    },
    dispatch: async () => {
      if (options.dispatchThrows !== undefined) throw options.dispatchThrows;
      return options.result ?? { verdict: "success" as const, status: 200 };
    },
    now: () => {
      calls += 1;
      return calls === 1 ? 1_000 : 1_000 + (options.elapsedMs ?? 250);
    },
  };

  const payload = {
    organizationId: "organization-1",
    endpointId: "endpoint-1",
    batchId: "endpoint-1:abc123",
    envelopes: [
      { id: "envelope-1", type: "t", created: "c", schema_version: "1", data: {} },
      { id: "envelope-2", type: "t", created: "c", schema_version: "1", data: {} },
    ],
  };

  const run = WebhookDeliveryService.create(deps as never).runWebhookSendBatch();
  return {
    recorded,
    send: () => run(payload as never, { attempt: 3 } as never),
  };
}

async function thrownBy(send: () => Promise<unknown>): Promise<DispatchError> {
  try {
    await send();
  } catch (error) {
    return error as DispatchError;
  }
  throw new Error("expected the send to throw");
}

describe("WebhookDeliveryService.runWebhookSendBatch", () => {
  describe("given the endpoint is disabled or gone", () => {
    it("drops the batch without dispatching or logging an attempt", async () => {
      // Deliberate: the spend record still holds the events, so re-enabling
      // and replaying covers the gap. A recorded failure here would put a
      // customer's own pause in their delivery log as an error.
      const { send, recorded } = sendBatchWith({ deliverable: false });

      await expect(send()).resolves.toBeUndefined();
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

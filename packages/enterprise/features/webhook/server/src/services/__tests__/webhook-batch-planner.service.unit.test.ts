// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The delivery controls, as a customer configures them.
 *
 * Three knobs interact here and the interaction is the whole design: a full
 * batch ships even though the delay has not elapsed, a partial one waits, and
 * neither ships past the in-flight cap. The consequence worth protecting is
 * the one a reader would not guess — because full batches ship first, batch
 * size CLIMBS toward its cap while a receiver is behind, so the backlog drains
 * faster exactly when it needs to.
 *
 * Getting any of this wrong is quiet: envelopes still arrive, just too slowly,
 * or in a burst of parallel POSTs at a receiver that was already struggling.
 */

import { describe, expect, it } from "vitest";
import {
  WebhookBatchPlanner,
  WEBHOOK_FLUSH_RECHECK_MS,
  type PendingEnvelope,
} from "../webhook-batch-planner.service";

const NOW = 1_000_000;

function endpoint(over: Record<string, unknown> = {}) {
  return {
    id: "endpoint-1",
    maxBatchSize: 3,
    maxBatchDelayMs: 1_000,
    maxInFlight: 2,
    ...over,
  } as never;
}

function pending(count: number, appendedAtMs = NOW): PendingEnvelope[] {
  return Array.from({ length: count }, (_, index) => ({
    envelope: {
      id: `envelope-${index + 1}`,
      type: "gateway.request.completed",
      created: new Date(NOW).toISOString(),
      schema_version: "1" as const,
      data: {},
    },
    appendedAtMs,
  }));
}

function plan(
  over: Record<string, unknown>,
  input: { pending: PendingEnvelope[]; outstanding?: number; now?: number },
) {
  return WebhookBatchPlanner.for(endpoint(over)).plan({
    organizationId: "organization-1",
    pending: input.pending,
    outstanding: input.outstanding ?? 0,
    now: input.now ?? NOW,
  });
}

function envelopeIdsIn(message: { payload: unknown }): string[] {
  const payload = message.payload as { envelopes: Array<{ id: string }> };
  return payload.envelopes.map((envelope) => envelope.id);
}

describe("WebhookBatchPlanner.plan", () => {
  describe("given a buffer that has reached the batch size", () => {
    it("ships it now, without waiting out the delay", () => {
      const result = plan({}, { pending: pending(3) });

      expect(result.messages).toHaveLength(1);
      expect(result.remaining).toHaveLength(0);
    });
  });

  describe("given a partial batch whose oldest envelope is still waiting", () => {
    it("holds all of it", () => {
      const result = plan({}, { pending: pending(2), now: NOW + 999 });

      expect(result.messages).toHaveLength(0);
      expect(result.remaining).toHaveLength(2);
    });

    it("ships it once the wait is up", () => {
      const result = plan({}, { pending: pending(2), now: NOW + 1_000 });

      expect(result.messages).toHaveLength(1);
      expect(result.remaining).toHaveLength(0);
    });
  });

  describe("given no coalescing delay is configured", () => {
    it("ships on arrival rather than holding for a full batch", () => {
      const result = plan({ maxBatchDelayMs: 0 }, { pending: pending(1) });

      expect(result.messages).toHaveLength(1);
    });
  });

  describe("given more buffered than the in-flight cap allows", () => {
    it("stops at the cap and leaves the rest buffered", () => {
      const result = plan({ maxInFlight: 2 }, { pending: pending(9) });

      expect(result.messages).toHaveLength(2);
      expect(result.remaining).toHaveLength(3);
      expect(result.inFlight).toBe(2);
    });

    it("counts sends already outstanding against the cap", () => {
      const result = plan({ maxInFlight: 2 }, { pending: pending(6), outstanding: 1 });

      expect(result.messages).toHaveLength(1);
      expect(result.remaining).toHaveLength(3);
    });

    it("ships nothing at all once the cap is already reached", () => {
      const result = plan({ maxInFlight: 2 }, { pending: pending(6), outstanding: 2 });

      expect(result.messages).toHaveLength(0);
      expect(result.remaining).toHaveLength(6);
    });
  });

  describe("given a receiver falling behind", () => {
    it("fills each batch to the cap, so the backlog drains faster the deeper it gets", () => {
      // The design's least obvious property: full batches ship first, so a
      // growing buffer is shipped in max-size batches rather than in the
      // dribs a delay-driven flush would produce.
      const result = plan({ maxBatchSize: 3, maxInFlight: 2 }, { pending: pending(7) });

      expect(result.messages.map(envelopeIdsIn)).toEqual([
        ["envelope-1", "envelope-2", "envelope-3"],
        ["envelope-4", "envelope-5", "envelope-6"],
      ]);
      expect(result.remaining.map((entry) => entry.envelope.id)).toEqual(["envelope-7"]);
    });
  });

  describe("given nothing buffered", () => {
    it("ships nothing and reports the outstanding sends unchanged", () => {
      const result = plan({}, { pending: [], outstanding: 1 });

      expect(result.messages).toHaveLength(0);
      expect(result.inFlight).toBe(1);
    });
  });

  describe("the batch's message key", () => {
    it("is derived from the envelopes, so a replan of the same batch is suppressed", () => {
      const first = plan({}, { pending: pending(3) });
      const second = plan({}, { pending: pending(3) });

      expect(first.messages[0]?.messageKey).toBe(second.messages[0]?.messageKey);
    });

    it("differs for different envelopes", () => {
      const first = plan({}, { pending: pending(3) });
      const other = pending(3);
      other[0]!.envelope.id = "envelope-other";

      expect(first.messages[0]?.messageKey).not.toBe(
        plan({}, { pending: other }).messages[0]?.messageKey,
      );
    });

    it("differs when a replay salts the same envelopes", () => {
      const first = plan({}, { pending: pending(3) });
      const salted = pending(3).map((entry) => ({ ...entry, salt: "replay-1" }));

      expect(first.messages[0]?.messageKey).not.toBe(
        plan({}, { pending: salted }).messages[0]?.messageKey,
      );
    });

    it("names the endpoint it is for", () => {
      const result = plan({ id: "endpoint-9" }, { pending: pending(3) });

      expect(result.messages[0]?.messageKey).toMatch(/^send:endpoint-9:/);
    });
  });
});

describe("WebhookBatchPlanner.tryNextWakeAt", () => {
  const planner = () => WebhookBatchPlanner.for(endpoint());

  describe("given nothing left buffered", () => {
    it("arms no wake", () => {
      expect(planner().tryNextWakeAt({ remaining: [], inFlight: 0, now: NOW })).toBeNull();
    });
  });

  describe("given the in-flight cap is what is holding the buffer", () => {
    it("rechecks shortly, rather than waiting out a delay that is not the reason", () => {
      expect(planner().tryNextWakeAt({ remaining: pending(1), inFlight: 2, now: NOW })).toBe(
        NOW + WEBHOOK_FLUSH_RECHECK_MS,
      );
    });
  });

  describe("given the coalescing delay is what is holding it", () => {
    it("wakes when the oldest envelope's wait is up", () => {
      expect(planner().tryNextWakeAt({ remaining: pending(1), inFlight: 0, now: NOW })).toBe(
        NOW + 1_000,
      );
    });

    it("never wakes sooner than the recheck floor", () => {
      // A deadline already in the past would otherwise arm a wake for now,
      // and a stream that wakes itself immediately is a spin.
      const remaining = pending(1, NOW - 10_000);

      expect(planner().tryNextWakeAt({ remaining, inFlight: 0, now: NOW })).toBe(
        NOW + WEBHOOK_FLUSH_RECHECK_MS,
      );
    });
  });
});

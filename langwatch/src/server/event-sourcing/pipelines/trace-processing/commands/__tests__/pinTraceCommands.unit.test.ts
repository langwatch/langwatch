import { describe, expect, it } from "vitest";
import {
  PIN_TRACE_COMMAND_TYPE,
  UNPIN_TRACE_COMMAND_TYPE,
  type TracePinSource,
} from "../../schemas/constants";
import { PinTraceCommand, UnpinTraceCommand } from "../pinTraceCommands";

/**
 * These tests guard the idempotency-key design directly, not through the
 * service or the fold double. The fold reads its stream through
 * `deduplicateEvents`, which drops later events that share an idempotencyKey —
 * so if a `pin → unpin → pin` toggle produced a re-pin whose key collided with
 * the first pin, dedup would drop it and the trace would stay wrongly unpinned.
 * The command keys off `occurredAt` to keep each distinct action in the stream.
 * We assert on the real key the command emits so reverting to a stable key
 * (the original bug) fails here rather than slipping through vacuous tests.
 */

const TENANT = "tenant-1";
const TRACE = "trace-1";

function pinKey({
  source,
  occurredAt,
}: {
  source: TracePinSource;
  occurredAt: number;
}): string {
  const command = new PinTraceCommand();
  const [event] = command.handle({
    tenantId: TENANT,
    aggregateId: TRACE,
    type: PIN_TRACE_COMMAND_TYPE,
    data: {
      tenantId: TENANT,
      traceId: TRACE,
      source,
      reason: null,
      pinnedByUserId: null,
      occurredAt,
    },
  }) as [{ idempotencyKey?: string }];
  return event.idempotencyKey ?? "";
}

function unpinKey({
  source,
  occurredAt,
}: {
  source: TracePinSource;
  occurredAt: number;
}): string {
  const command = new UnpinTraceCommand();
  const [event] = command.handle({
    tenantId: TENANT,
    aggregateId: TRACE,
    type: UNPIN_TRACE_COMMAND_TYPE,
    data: { tenantId: TENANT, traceId: TRACE, source, occurredAt },
  }) as [{ idempotencyKey?: string }];
  return event.idempotencyKey ?? "";
}

describe("pin/unpin command idempotency keys", () => {
  describe("when a trace is pinned, unpinned, then pinned again", () => {
    it("emits three distinct keys so dedup keeps every toggle action", () => {
      const keys = [
        pinKey({ source: "manual", occurredAt: 1_000 }),
        unpinKey({ source: "manual", occurredAt: 1_001 }),
        pinKey({ source: "manual", occurredAt: 1_002 }),
      ];

      expect(new Set(keys).size).toBe(3);
    });
  });

  describe("when the same pin action is retried (same occurredAt)", () => {
    it("emits an identical key so queue retries still collapse", () => {
      const first = pinKey({ source: "manual", occurredAt: 5_000 });
      const retry = pinKey({ source: "manual", occurredAt: 5_000 });

      expect(retry).toBe(first);
    });
  });

  describe("makeJobId", () => {
    describe("when a manual pin and a share pin land in the same millisecond", () => {
      it("produces distinct job ids so neither is dropped at the queue", () => {
        const manual = PinTraceCommand.makeJobId?.({
          tenantId: TENANT,
          traceId: TRACE,
          source: "manual",
          reason: null,
          pinnedByUserId: null,
          occurredAt: 9_000,
        });
        const share = PinTraceCommand.makeJobId?.({
          tenantId: TENANT,
          traceId: TRACE,
          source: "share",
          reason: null,
          pinnedByUserId: null,
          occurredAt: 9_000,
        });

        expect(manual).toBeDefined();
        expect(manual).not.toBe(share);
      });
    });
  });
});

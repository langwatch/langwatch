import type { AggregateEvent } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { mapToSessionContribution } from "../contributions";

const TENANT = "tenant-1";
const SESSION = "session-1";

function spanEvent(overrides: Partial<Record<string, unknown>> = {}): AggregateEvent {
  return {
    type: "coding_agent_session/spanFactsContributed",
    data: {
      tenantId: TENANT,
      sessionId: SESSION,
      agent: "claude_code",
      occurredAt: 1_000,
      acceptedAt: 1_000,
      traceId: "trace-1",
      spanId: "span-1",
      ...overrides,
    },
  };
}

describe("given mapToSessionContribution — the item-grain map projection", () => {
  describe("when a span contribution is mapped", () => {
    it("produces a contribution record keyed by the span's own natural id", () => {
      const record = mapToSessionContribution(spanEvent());
      expect(record).not.toBeNull();
      expect(record?.kind).toBe("span");
      expect(record?.sourceId).toBe("span-1");
      expect(record?.sessionId).toBe(SESSION);
    });
  });

  describe("when the SAME contribution is mapped twice (a redelivery)", () => {
    it("produces an identical record — the key never changes with the delivery", () => {
      const event = spanEvent();
      const first = mapToSessionContribution(event);
      const second = mapToSessionContribution(event);
      expect(first).toEqual(second);
    });
  });

  describe("when two DIFFERENT contributions for the same session are mapped", () => {
    it("derive different natural keys, so neither collapses the other at merge", () => {
      const first = mapToSessionContribution(spanEvent({ spanId: "span-1" }));
      const second = mapToSessionContribution(spanEvent({ spanId: "span-2" }));
      expect(first?.sourceId).not.toBe(second?.sourceId);
    });
  });

  describe("when the event is not a contribution this pipeline declares", () => {
    it("returns null rather than guessing a shape", () => {
      const record = mapToSessionContribution({
        type: "some_other_pipeline/somethingHappened",
        data: {},
      });
      expect(record).toBeNull();
    });
  });
});

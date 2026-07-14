/**
 * The coding-agent session store (ADR-041).
 *
 * The gate is the whole point: EVERY trace in the project flows through this
 * fold, so without it an ordinary chat trace would write an empty row for itself
 * and the table would be mostly noise.
 */
import { describe, expect, it, vi } from "vitest";
import type { CodingAgentSessionRepository } from "~/server/app-layer/traces/repositories/coding-agent-session.repository";
import type { ProjectionStoreContext } from "../../../../projections/projectionStoreContext";
import type { CodingAgentSessionState } from "../codingAgentSession.foldProjection";
import { CodingAgentSessionStore } from "../codingAgentSession.store";
import { createInitCodingAgentSession } from "../services/coding-agent-session.derivation";

const context = {
  tenantId: "tenant-1",
  aggregateId: "trace-1",
  retentionPolicy: { traces: 90 },
} as unknown as ProjectionStoreContext;

function state(over: Partial<CodingAgentSessionState> = {}): CodingAgentSessionState {
  return {
    ...createInitCodingAgentSession(),
    traceId: "trace-1",
    startedAtMs: 1_700_000_000_000,
    createdAt: 0,
    updatedAt: 0,
    LastEventOccurredAt: 0,
    ...over,
  };
}

function repo() {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    getByTraceId: vi.fn().mockResolvedValue(null),
  } satisfies CodingAgentSessionRepository;
}

describe("CodingAgentSessionStore", () => {
  describe("given a session that actually ran", () => {
    it("writes the row, with the work it did", async () => {
      const r = repo();
      await new CodingAgentSessionStore(r).store(
        state({
          modelCalls: 3,
          toolCalls: 5,
          costUsd: 0.42,
          cacheCreationTokens: 200,
          toolsDenied: 1,
          truncated: true,
        }),
        context,
      );

      expect(r.upsert).toHaveBeenCalledTimes(1);
      const [row, retentionDays] = r.upsert.mock.calls[0]!;
      expect(row.traceId).toBe("trace-1");
      expect(row.modelCalls).toBe(3);
      expect(row.toolCalls).toBe(5);
      expect(row.costUsd).toBeCloseTo(0.42);
      expect(row.cacheCreationTokens).toBe(200);
      expect(row.toolsDenied).toBe(1);
      expect(row.truncated).toBe(true);
      // The tenant's retention, stamped onto the row.
      expect(retentionDays).toBe(90);
    });
  });

  describe("given a trace that is not a coding agent", () => {
    // Every trace flows through this fold. Without the gate, every chat trace in
    // the project would write an empty row and the table would be mostly noise.
    it("writes NOTHING at all", async () => {
      const r = repo();
      await new CodingAgentSessionStore(r).store(state(), context);

      expect(r.upsert).not.toHaveBeenCalled();
    });

    it("is filtered out of a batch, without dropping the real sessions", async () => {
      const r = repo();
      const store = new CodingAgentSessionStore(r);

      await store.storeBatch([
        { state: state(), context },
        { state: state({ traceId: "trace-2", toolCalls: 2 }), context },
        { state: state(), context },
      ]);

      expect(r.upsert).toHaveBeenCalledTimes(1);
      expect(r.upsert.mock.calls[0]![0].traceId).toBe("trace-2");
    });
  });

  describe("given a session whose trace id never landed on the state", () => {
    it("falls back to the aggregate id, so the row is still addressable", async () => {
      const r = repo();
      await new CodingAgentSessionStore(r).store(
        state({ traceId: "", modelCalls: 1 }),
        context,
      );

      expect(r.upsert.mock.calls[0]![0].traceId).toBe("trace-1");
    });
  });

  describe("read-back", () => {
    // The row is an aggregate, not a copy: its counters survive a round-trip but
    // the fold's ordering and first-seen rules do not, so rebuilding state from
    // it would quietly produce a different session than replaying the events.
    it("returns null, so continuity comes from the cache + refold-on-miss", async () => {
      expect(await new CodingAgentSessionStore(repo()).get()).toBeNull();
    });
  });
});

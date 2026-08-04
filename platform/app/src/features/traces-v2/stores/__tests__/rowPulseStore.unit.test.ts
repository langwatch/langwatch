// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRowPulseStore } from "../rowPulseStore";

beforeEach(() => {
  vi.useFakeTimers();
  // Reset store state between tests.
  useRowPulseStore.setState({
    pulsingIds: new Set(),
    lastPulseAt: new Map(),
    evictionTimers: new Map(),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rowPulseStore", () => {
  describe("given a new traceId", () => {
    describe("when pulse is called", () => {
      it("adds the traceId to pulsingIds", () => {
        useRowPulseStore.getState().pulse("trace-abc");
        expect(useRowPulseStore.getState().pulsingIds.has("trace-abc")).toBe(
          true,
        );
      });

      it("evicts the traceId after 1200ms", () => {
        useRowPulseStore.getState().pulse("trace-abc");
        expect(useRowPulseStore.getState().pulsingIds.has("trace-abc")).toBe(
          true,
        );
        vi.advanceTimersByTime(1200);
        expect(useRowPulseStore.getState().pulsingIds.has("trace-abc")).toBe(
          false,
        );
      });
    });
  });

  describe("given a burst of events for the same traceId within 600ms", () => {
    describe("when pulse is called twice within the coalesce window", () => {
      it("only adds the traceId once (coalesces the burst)", () => {
        const { pulse } = useRowPulseStore.getState();

        pulse("trace-xyz");
        // The first pulse should add to pulsing set.
        expect(useRowPulseStore.getState().pulsingIds.has("trace-xyz")).toBe(
          true,
        );

        // Advance time just inside the coalesce window.
        vi.advanceTimersByTime(400);

        // Second pulse within coalesce window — should be skipped.
        pulse("trace-xyz");

        // Only one eviction timer should be active (no second timer started).
        expect(useRowPulseStore.getState().evictionTimers.size).toBe(1);
      });

      it("keeps only one active eviction timer so the row pulses once", () => {
        const { pulse } = useRowPulseStore.getState();

        pulse("trace-xyz");
        vi.advanceTimersByTime(300);
        pulse("trace-xyz"); // within coalesce window, ignored

        // Timer from first pulse is still running — no second timer spawned.
        expect(useRowPulseStore.getState().evictionTimers.size).toBe(1);

        // After the original pulse duration the trace is evicted.
        vi.advanceTimersByTime(900); // total 1200ms
        expect(useRowPulseStore.getState().pulsingIds.has("trace-xyz")).toBe(
          false,
        );
      });
    });
  });

  describe("given two events for the same traceId beyond the coalesce window", () => {
    describe("when pulse is called a second time after 600ms", () => {
      it("re-triggers the animation and resets the eviction timer", () => {
        const { pulse } = useRowPulseStore.getState();

        pulse("trace-def");
        vi.advanceTimersByTime(700); // past coalesce window

        // Row should still be pulsing (eviction timer hasn't fired yet).
        expect(useRowPulseStore.getState().pulsingIds.has("trace-def")).toBe(
          true,
        );

        // Second pulse after coalesce window — should restart the eviction timer.
        pulse("trace-def");

        // We're now 700ms in + the eviction was reset, so we need 1200ms more
        // before it evicts.
        vi.advanceTimersByTime(600);
        expect(useRowPulseStore.getState().pulsingIds.has("trace-def")).toBe(
          true,
        );
        vi.advanceTimersByTime(600); // total 1200ms after second pulse
        expect(useRowPulseStore.getState().pulsingIds.has("trace-def")).toBe(
          false,
        );
      });
    });
  });

  describe("given multiple distinct traceIds", () => {
    describe("when each receives a pulse", () => {
      it("tracks them independently", () => {
        const { pulse } = useRowPulseStore.getState();
        pulse("trace-1");
        pulse("trace-2");
        pulse("trace-3");

        const { pulsingIds } = useRowPulseStore.getState();
        expect(pulsingIds.has("trace-1")).toBe(true);
        expect(pulsingIds.has("trace-2")).toBe(true);
        expect(pulsingIds.has("trace-3")).toBe(true);

        vi.advanceTimersByTime(1200);
        const afterEviction = useRowPulseStore.getState().pulsingIds;
        expect(afterEviction.size).toBe(0);
      });
    });
  });
});

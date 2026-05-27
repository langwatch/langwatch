import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TraceReadDerivationService,
  type NormalizedSpanReader,
} from "../trace-read-derivation.service";

/**
 * Counts how many times each underlying span read is issued. The derivations
 * return empty results — the test only cares about read amplification, not the
 * derived values (covered by scenario-role-metrics.derivation tests).
 */
class CountingReader implements NormalizedSpanReader {
  spanReads = 0;
  eventReads = 0;

  async getNormalizedSpansByTraceId() {
    this.spanReads++;
    return [];
  }

  async getTraceEventsByTraceId() {
    this.eventReads++;
    return [];
  }
}

const CUTOFF_PARAMS = { tenantId: "t1", traceId: "trace-1", occurredAtMs: 1000 };

afterEach(() => {
  vi.useRealTimers();
});

describe("TraceReadDerivationService", () => {
  describe("given several reactor invocations derive trace data for the same trace at one fold cutoff", () => {
    describe("when they run within one coalesced batch window", () => {
      /** @scenario Repeated trace-level derivations for one trace read stored spans once */
      it("reads the stored events once, not once per invocation", async () => {
        const reader = new CountingReader();
        const service = new TraceReadDerivationService(reader);

        for (let i = 0; i < 10; i++) await service.deriveEvents(CUTOFF_PARAMS);

        expect(reader.eventReads).toBe(1);
      });

      it("shares the scenario-role-metrics read across invocations", async () => {
        const reader = new CountingReader();
        const service = new TraceReadDerivationService(reader);

        for (let i = 0; i < 10; i++) {
          await service.deriveScenarioRoleMetrics(CUTOFF_PARAMS);
        }

        expect(reader.spanReads).toBe(1);
      });

      it("collapses concurrent in-flight reads into one", async () => {
        const reader = new CountingReader();
        const service = new TraceReadDerivationService(reader);

        await Promise.all([
          service.deriveEvents(CUTOFF_PARAMS),
          service.deriveEvents(CUTOFF_PARAMS),
          service.deriveEvents(CUTOFF_PARAMS),
        ]);

        expect(reader.eventReads).toBe(1);
      });
    });
  });

  describe("given trace data already derived at one fold cutoff", () => {
    describe("when trace data is derived again at a later cutoff", () => {
      /** @scenario A later fold cutoff derives from stored spans again */
      it("reads the stored spans again for the newer cutoff", async () => {
        const reader = new CountingReader();
        const service = new TraceReadDerivationService(reader);

        await service.deriveEvents(CUTOFF_PARAMS);
        await service.deriveEvents({ ...CUTOFF_PARAMS, occurredAtMs: 2000 });

        expect(reader.eventReads).toBe(2);
      });
    });
  });

  describe("given a live derivation with no fold cutoff", () => {
    describe("when it is derived repeatedly", () => {
      it("reads every time because a live read is non-deterministic", async () => {
        const reader = new CountingReader();
        const service = new TraceReadDerivationService(reader);
        const live = { tenantId: "t1", traceId: "trace-1" };

        await service.deriveEvents(live);
        await service.deriveEvents(live);

        expect(reader.eventReads).toBe(2);
      });
    });
  });

  describe("given the read window has elapsed", () => {
    describe("when the same derivation runs again", () => {
      it("reads the stored events again", async () => {
        vi.useFakeTimers();
        const reader = new CountingReader();
        const service = new TraceReadDerivationService(reader);

        await service.deriveEvents(CUTOFF_PARAMS);
        vi.setSystemTime(Date.now() + 31_000);
        await service.deriveEvents(CUTOFF_PARAMS);

        expect(reader.eventReads).toBe(2);
      });
    });
  });

  describe("given a read that rejects", () => {
    describe("when the same derivation is retried", () => {
      it("does not cache the failure", async () => {
        let attempts = 0;
        const reader: NormalizedSpanReader = {
          async getNormalizedSpansByTraceId() {
            return [];
          },
          async getTraceEventsByTraceId() {
            attempts++;
            if (attempts === 1) throw new Error("clickhouse blip");
            return [];
          },
        };
        const service = new TraceReadDerivationService(reader);

        await expect(service.deriveEvents(CUTOFF_PARAMS)).rejects.toThrow(
          "clickhouse blip",
        );
        await expect(service.deriveEvents(CUTOFF_PARAMS)).resolves.toEqual([]);
        expect(attempts).toBe(2);
      });
    });
  });
});

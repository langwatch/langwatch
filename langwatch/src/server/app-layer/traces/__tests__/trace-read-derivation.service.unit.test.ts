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

// One coalesced batch: every per-event reactor observes the same final fold
// state, so foldVersion (spanCount) is identical across the batch.
const BATCH_PARAMS = {
  tenantId: "t1",
  traceId: "trace-1",
  occurredAtMs: 1000,
  foldVersion: 5,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("TraceReadDerivationService", () => {
  describe("given several reactor invocations derive trace data for the same trace at one fold version", () => {
    describe("when they run within one coalesced batch", () => {
      /** @scenario Repeated trace-level derivations within one fold version read stored spans once */
      it("reads the stored events once, not once per invocation", async () => {
        const reader = new CountingReader();
        const service = new TraceReadDerivationService(reader);

        for (let i = 0; i < 10; i++) await service.deriveEvents(BATCH_PARAMS);

        expect(reader.eventReads).toBe(1);
      });

      it("shares the scenario-role-metrics read across invocations", async () => {
        const reader = new CountingReader();
        const service = new TraceReadDerivationService(reader);

        for (let i = 0; i < 10; i++) {
          await service.deriveScenarioRoleMetrics(BATCH_PARAMS);
        }

        expect(reader.spanReads).toBe(1);
      });

      it("collapses concurrent in-flight reads into one", async () => {
        const reader = new CountingReader();
        const service = new TraceReadDerivationService(reader);

        await Promise.all([
          service.deriveEvents(BATCH_PARAMS),
          service.deriveEvents(BATCH_PARAMS),
          service.deriveEvents(BATCH_PARAMS),
        ]);

        expect(reader.eventReads).toBe(1);
      });
    });
  });

  describe("given trace data already derived at one fold version", () => {
    describe("when the fold advances with newer spans", () => {
      /** @scenario A derivation re-reads once the fold has advanced with new spans */
      it("reads the stored spans again rather than serving the earlier result", async () => {
        const reader = new CountingReader();
        const service = new TraceReadDerivationService(reader);

        await service.deriveEvents(BATCH_PARAMS);
        await service.deriveEvents({ ...BATCH_PARAMS, foldVersion: 6 });

        expect(reader.eventReads).toBe(2);
      });
    });

    describe("when more spans arrive but the partition hint stays the same", () => {
      // occurredAtMs is the trace's earliest span time and only a partition
      // hint, so it does not change as the trace grows; keying on it would
      // serve stale spans. The advancing foldVersion is what forces a re-read.
      it("re-reads on the advanced fold version even with an unchanged occurredAtMs", async () => {
        const reader = new CountingReader();
        const service = new TraceReadDerivationService(reader);

        await service.deriveEvents({ ...BATCH_PARAMS, occurredAtMs: 1000, foldVersion: 5 });
        await service.deriveEvents({ ...BATCH_PARAMS, occurredAtMs: 1000, foldVersion: 7 });

        expect(reader.eventReads).toBe(2);
      });
    });
  });

  describe("given a live derivation with no fold version", () => {
    describe("when it is derived repeatedly", () => {
      it("reads every time because a live read is non-deterministic", async () => {
        const reader = new CountingReader();
        const service = new TraceReadDerivationService(reader);
        const live = { tenantId: "t1", traceId: "trace-1", occurredAtMs: 1000 };

        await service.deriveEvents(live);
        await service.deriveEvents(live);

        expect(reader.eventReads).toBe(2);
      });
    });
  });

  describe("given the read window has elapsed", () => {
    describe("when the same fold version is derived again", () => {
      it("reads the stored events again", async () => {
        vi.useFakeTimers();
        const reader = new CountingReader();
        const service = new TraceReadDerivationService(reader);

        await service.deriveEvents(BATCH_PARAMS);
        vi.setSystemTime(Date.now() + 31_000);
        await service.deriveEvents(BATCH_PARAMS);

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

        await expect(service.deriveEvents(BATCH_PARAMS)).rejects.toThrow(
          "clickhouse blip",
        );
        await expect(service.deriveEvents(BATCH_PARAMS)).resolves.toEqual([]);
        expect(attempts).toBe(2);
      });
    });
  });
});

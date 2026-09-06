import type { DerivedTraceEvent, NormalizedSpan } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";
import { TraceDerivationSpanReaderPort } from "../../ports/trace-derivation-span-reader.port.ts";
import { TraceModelCostPort } from "../../ports/trace-model-cost.port.ts";
import { ScenarioRoleMetricsDerivationService } from "../scenario-role-metrics-derivation.service.ts";
import { SpanCostService } from "../span-cost.service.ts";
import { TraceEventDerivationService } from "../trace-event-derivation.service.ts";

/**
 * Read amplification across a coalesced fold batch. A coalesced batch dispatches
 * its subscribers once per event against ONE shared final fold state, so a
 * derivation that reads per invocation turns one multi-megabyte trace read into
 * hundreds — the amplification that saturated ClickHouse during a backlog
 * drain. The memo is keyed on the fold version, so it holds only while the fold
 * has not moved.
 */

/** Counts how many times each underlying span read is issued. */
class CountingReader extends TraceDerivationSpanReaderPort {
  spanReads = 0;
  eventReads = 0;

  async findNormalizedSpansByTraceId(): Promise<NormalizedSpan[]> {
    this.spanReads++;
    return [];
  }

  async findDerivedEventsByTraceId(): Promise<DerivedTraceEvent[]> {
    this.eventReads++;
    return [];
  }
}

const spanCosts = SpanCostService.create({
  modelCosts: new (class extends TraceModelCostPort {
    estimate(): number {
      return 0;
    }
  })(),
});

// One coalesced batch: every per-event subscriber observes the same final fold
// state, so the fold version is identical across the batch.
const BATCH_PARAMS = {
  tenantId: "t1",
  projectId: "t1",
  traceId: "trace-1",
  occurredAtMs: 1000,
  foldVersion: 5,
};

describe("trace-level derivations", () => {
  describe("given several subscriber invocations derive trace data for the same trace at one fold version", () => {
    describe("when they run within one coalesced batch", () => {
      /** @scenario Repeated trace-level derivations within one fold version read stored spans once */
      it("reads the stored events once, not once per invocation", async () => {
        const reader = new CountingReader();
        const service = TraceEventDerivationService.create({ spans: reader });

        for (let i = 0; i < 10; i++) await service.derive(BATCH_PARAMS);

        expect(reader.eventReads).toBe(1);
      });

      /** @scenario Repeated trace-level derivations within one fold version read stored spans once */
      it("shares the scenario-role-metrics read across invocations", async () => {
        const reader = new CountingReader();
        const service = ScenarioRoleMetricsDerivationService.create({
          spans: reader,
          spanCosts,
        });

        for (let i = 0; i < 10; i++) await service.derive(BATCH_PARAMS);

        expect(reader.spanReads).toBe(1);
      });
    });
  });

  describe("given the fold has advanced with new spans", () => {
    describe("when a later batch derives the same trace again", () => {
      /** @scenario A derivation re-reads once the fold has advanced with new spans */
      it("re-reads the stored events for the newer fold version", async () => {
        const reader = new CountingReader();
        const service = TraceEventDerivationService.create({ spans: reader });

        await service.derive(BATCH_PARAMS);
        await service.derive({ ...BATCH_PARAMS, foldVersion: 6 });

        // The version is in the memo key, so a moved fold is a miss — never a
        // stale answer from the batch before it.
        expect(reader.eventReads).toBe(2);
      });

      /** @scenario A derivation re-reads once the fold has advanced with new spans */
      it("re-reads the stored spans for the newer fold version", async () => {
        const reader = new CountingReader();
        const service = ScenarioRoleMetricsDerivationService.create({
          spans: reader,
          spanCosts,
        });

        await service.derive(BATCH_PARAMS);
        await service.derive({ ...BATCH_PARAMS, foldVersion: 6 });

        expect(reader.spanReads).toBe(2);
      });
    });
  });

  describe("given a live read that carries no fold watermark", () => {
    describe("when it is issued twice", () => {
      it("always hits storage, never the memo", async () => {
        const reader = new CountingReader();
        const service = TraceEventDerivationService.create({ spans: reader });

        const { foldVersion: _ignored, ...live } = BATCH_PARAMS;
        await service.derive(live);
        await service.derive(live);

        expect(reader.eventReads).toBe(2);
      });
    });
  });
});

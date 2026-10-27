/**
 * @vitest-environment node
 * The shared recall over a trace event read: one read per event, a bounded pool of reads, and a
 * byte budget per trace, with every reference answering rather than the recall throwing.
 */
import { describe, expect, it } from "vitest";

import {
  offloadedFieldKey,
  type OffloadedFieldReference,
} from "../../rules/trace-offload-recall.rules.ts";
import {
  OFFLOAD_RECALL_CONCURRENCY,
  OFFLOAD_RECALL_TRACE_BUDGET_BYTES,
  TraceEventPayloadFieldNotFoundError,
  TraceOffloadBudgetExceededError,
  TracePayloadReaderRepository,
} from "../trace-payload-reader.repository.ts";

type FieldsRead = {
  tenantId: string;
  traceId: string;
  eventId: string;
  fields: readonly string[];
};

/** A reader serving events from a map, keeping every read it was asked and how many overlapped. */
class FakePayloadReader extends TracePayloadReaderRepository {
  readonly reads: FieldsRead[] = [];
  peakInFlight = 0;
  private inFlight = 0;

  constructor(
    private readonly events: Record<string, Record<string, string>>,
    private readonly options: { failing?: Set<string>; delayMs?: number } = {},
  ) {
    super();
  }

  async readFields(input: FieldsRead): Promise<ReadonlyMap<string, string>> {
    this.reads.push(input);
    this.inFlight++;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, this.options.delayMs ?? 0));
      if (this.options.failing?.has(input.eventId)) {
        throw new Error(`event ${input.eventId} is unavailable`);
      }
      const event = this.events[input.eventId] ?? {};
      return new Map(
        input.fields.flatMap((field) => {
          const value = event[field];
          return value === undefined ? [] : [[field, value] as const];
        }),
      );
    } finally {
      this.inFlight--;
    }
  }
}

const ref = (traceId: string, eventId: string, field: string): OffloadedFieldReference => ({
  traceId,
  eventId,
  field,
});

describe("TracePayloadReaderRepository.recall", () => {
  describe("given two fields of the same trace event", () => {
    describe("when both are recalled", () => {
      /** @scenario "Several offloaded fields of one span event are recalled with one read of it" */
      it("reads the event once, asking for both fields", async () => {
        const reader = new FakePayloadReader({ e1: { a: "A", b: "B" } });

        const outcomes = await reader.recall({
          tenantId: "tenant-1",
          references: [ref("t1", "e1", "a"), ref("t1", "e1", "b")],
        });

        expect(reader.reads).toHaveLength(1);
        expect(reader.reads[0]).toMatchObject({
          tenantId: "tenant-1",
          traceId: "t1",
          eventId: "e1",
        });
        expect([...reader.reads[0]!.fields].toSorted()).toEqual(["a", "b"]);
        expect(outcomes.get(offloadedFieldKey(ref("t1", "e1", "a")))).toEqual({
          ok: true,
          value: "A",
        });
        expect(outcomes.get(offloadedFieldKey(ref("t1", "e1", "b")))).toEqual({
          ok: true,
          value: "B",
        });
      });
    });
  });

  describe("given the same field referenced twice", () => {
    describe("when recalled", () => {
      it("reads it once and answers it once", async () => {
        const reader = new FakePayloadReader({ e1: { a: "A" } });

        const outcomes = await reader.recall({
          tenantId: "tenant-1",
          references: [ref("t1", "e1", "a"), ref("t1", "e1", "a")],
        });

        expect(reader.reads).toHaveLength(1);
        expect(reader.reads[0]!.fields).toEqual(["a"]);
        expect(outcomes.size).toBe(1);
      });
    });
  });

  describe("given more events than the concurrency allows", () => {
    describe("when recalled with a concurrency of 3", () => {
      /** @scenario "A recall keeps a bounded number of event reads in flight" */
      it("never has more than 3 event reads in flight, and reads every event", async () => {
        const events = Object.fromEntries(
          Array.from({ length: 12 }, (_v, i) => [`e${i}`, { a: `A${i}` }]),
        );
        const reader = new FakePayloadReader(events, { delayMs: 2 });

        const outcomes = await reader.recall({
          tenantId: "tenant-1",
          references: Object.keys(events).map((eventId) => ref("t1", eventId, "a")),
          concurrency: 3,
        });

        expect(reader.reads).toHaveLength(12);
        expect(reader.peakInFlight).toBeGreaterThan(1);
        expect(reader.peakInFlight).toBeLessThanOrEqual(3);
        expect([...outcomes.values()].every((outcome) => outcome.ok)).toBe(true);
      });
    });

    describe("when recalled without a concurrency", () => {
      it("stays within the default pool", async () => {
        const events = Object.fromEntries(
          Array.from({ length: OFFLOAD_RECALL_CONCURRENCY * 2 }, (_v, i) => [`e${i}`, { a: "A" }]),
        );
        const reader = new FakePayloadReader(events, { delayMs: 2 });

        await reader.recall({
          tenantId: "tenant-1",
          references: Object.keys(events).map((eventId) => ref("t1", eventId, "a")),
        });

        expect(reader.peakInFlight).toBeLessThanOrEqual(OFFLOAD_RECALL_CONCURRENCY);
      });
    });
  });

  describe("given a trace that has already recalled its byte budget", () => {
    describe("when later events of that trace and events of another trace are recalled", () => {
      /** @scenario "A trace past its recall budget keeps the previews of the rest" */
      it("does not read the later events of the spent trace, which answer budget exceeded", async () => {
        const reader = new FakePayloadReader({
          big1: { a: "x".repeat(60) },
          big2: { a: "y".repeat(60) },
          big3: { a: "z".repeat(60) },
          other: { a: "o".repeat(60) },
        });

        const outcomes = await reader.recall({
          tenantId: "tenant-1",
          references: [
            ref("spent", "big1", "a"),
            ref("spent", "big2", "a"),
            ref("spent", "big3", "a"),
            ref("other-trace", "other", "a"),
          ],
          concurrency: 1,
          traceBudgetBytes: 100,
        });

        // 60 bytes is under the budget, 120 is over it: the third event is never read.
        expect(reader.reads.map((read) => read.eventId)).toEqual(["big1", "big2", "other"]);
        const third = outcomes.get(offloadedFieldKey(ref("spent", "big3", "a")));
        expect(third?.ok).toBe(false);
        expect(!third?.ok && third?.error).toBeInstanceOf(TraceOffloadBudgetExceededError);
        expect(outcomes.get(offloadedFieldKey(ref("other-trace", "other", "a")))?.ok).toBe(true);
        expect(outcomes.get(offloadedFieldKey(ref("spent", "big1", "a")))?.ok).toBe(true);
        expect(outcomes.get(offloadedFieldKey(ref("spent", "big2", "a")))?.ok).toBe(true);
      });

      it("answers every field of a skipped event, not only the first", async () => {
        const reader = new FakePayloadReader({
          e1: { a: "x".repeat(200) },
          e2: { a: "A", b: "B" },
        });

        const outcomes = await reader.recall({
          tenantId: "tenant-1",
          references: [ref("t1", "e1", "a"), ref("t1", "e2", "a"), ref("t1", "e2", "b")],
          concurrency: 1,
          traceBudgetBytes: 100,
        });

        for (const field of ["a", "b"]) {
          const outcome = outcomes.get(offloadedFieldKey(ref("t1", "e2", field)));
          expect(!outcome?.ok && outcome?.error).toBeInstanceOf(TraceOffloadBudgetExceededError);
        }
      });
    });

    describe("when the budget is left at its default", () => {
      it("is large enough to recall ordinary payloads whole", async () => {
        expect(OFFLOAD_RECALL_TRACE_BUDGET_BYTES).toBeGreaterThan(1024 * 1024);
        const reader = new FakePayloadReader({ e1: { a: "x".repeat(1024) } });

        const outcomes = await reader.recall({
          tenantId: "tenant-1",
          references: [ref("t1", "e1", "a")],
        });

        expect(outcomes.get(offloadedFieldKey(ref("t1", "e1", "a")))?.ok).toBe(true);
      });
    });
  });

  describe("given reads that cannot be served", () => {
    describe("when the event lacks a requested field", () => {
      it("answers field-not-found for that field and the value for the rest", async () => {
        const reader = new FakePayloadReader({ e1: { a: "A" } });

        const outcomes = await reader.recall({
          tenantId: "tenant-1",
          references: [ref("t1", "e1", "a"), ref("t1", "e1", "missing")],
        });

        expect(outcomes.get(offloadedFieldKey(ref("t1", "e1", "a")))).toEqual({
          ok: true,
          value: "A",
        });
        const missing = outcomes.get(offloadedFieldKey(ref("t1", "e1", "missing")));
        expect(!missing?.ok && missing?.error).toBeInstanceOf(TraceEventPayloadFieldNotFoundError);
      });
    });

    describe("when the read throws", () => {
      it("answers the thrown error for each of the event's fields, never rejecting", async () => {
        const reader = new FakePayloadReader({ ok: { a: "A" } }, { failing: new Set(["bad"]) });

        const outcomes = await reader.recall({
          tenantId: "tenant-1",
          references: [ref("t1", "bad", "a"), ref("t1", "bad", "b"), ref("t1", "ok", "a")],
        });

        for (const field of ["a", "b"]) {
          const outcome = outcomes.get(offloadedFieldKey(ref("t1", "bad", field)));
          expect(outcome).toMatchObject({
            ok: false,
            error: expect.objectContaining({ message: "event bad is unavailable" }),
          });
        }
        expect(outcomes.get(offloadedFieldKey(ref("t1", "ok", "a")))).toEqual({
          ok: true,
          value: "A",
        });
      });
    });

    describe("when there is nothing to recall", () => {
      it("answers an empty map without reading", async () => {
        const reader = new FakePayloadReader({});

        const outcomes = await reader.recall({ tenantId: "tenant-1", references: [] });

        expect(outcomes.size).toBe(0);
        expect(reader.reads).toEqual([]);
      });
    });
  });
});

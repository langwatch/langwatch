/**
 * The trace-sample card binds to the traces a TURN surfaced, not to whichever
 * `trace search` tool call it happens to sit next to.
 *
 * The Analytics skill answers "show me a sample" by probing with several
 * `trace search` calls — most match nothing — plus the one that actually finds
 * the traces it reports. Rendered per-call, the empty probes each drew a full
 * "No traces matched" card: they buried the answering search (the card read "0
 * traces" while the turn found 71) and stacked into a wall of four. These tests
 * pin the fix: only the search that carries traces earns a card, and an empty
 * result never stacks.
 */
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { toCapabilityCalls } from "../components/LangyToolActivity";

/** One `trace search` tool part, shaped as the AI-SDK stream delivers it. */
function traceSearch({
  id,
  totalHits,
  rows,
}: {
  id: string;
  totalHits: number;
  rows: number;
}) {
  return {
    type: "tool-langwatch.trace.search",
    toolCallId: id,
    state: "output-available",
    input: { command: `langwatch trace search --format json # ${id}` },
    output: {
      traces: Array.from({ length: rows }, (_, i) => ({
        trace_id: `${id}_row_${i}`,
        timestamps: { started_at: 1750000000000 + i },
        input: { value: `question ${i}` },
        metrics: { total_time_ms: 1000, total_cost: 0.001 },
      })),
      pagination: { totalHits },
    },
  };
}

function message(parts: unknown[]): UIMessage {
  return { id: "turn", role: "assistant", parts } as unknown as UIMessage;
}

describe("toCapabilityCalls trace-card selection", () => {
  describe("given one search that found rows beside several empty probes", () => {
    const turn = message([
      traceSearch({ id: "probe_a", totalHits: 0, rows: 0 }),
      traceSearch({ id: "probe_b", totalHits: 0, rows: 0 }),
      traceSearch({ id: "answer", totalHits: 71, rows: 4 }),
      traceSearch({ id: "probe_c", totalHits: 0, rows: 0 }),
    ]);

    describe("when the turn's capability cards are collected", () => {
      it("renders one card, not a stack of empties", () => {
        expect(toCapabilityCalls(turn)).toHaveLength(1);
      });

      it("binds that card to the search that carried the traces", () => {
        const [card] = toCapabilityCalls(turn);

        expect(card?.id).toBe("answer");
      });
    });
  });

  describe("given every search matched nothing", () => {
    const turn = message([
      traceSearch({ id: "probe_a", totalHits: 0, rows: 0 }),
      traceSearch({ id: "probe_b", totalHits: 0, rows: 0 }),
      traceSearch({ id: "probe_c", totalHits: 0, rows: 0 }),
    ]);

    describe("when the turn's capability cards are collected", () => {
      it("says 'nothing matched' once, not four times", () => {
        const cards = toCapabilityCalls(turn);

        expect(cards).toHaveLength(1);
        expect(cards[0]?.id).toBe("probe_a");
      });
    });
  });

  describe("given two distinct searches both found rows", () => {
    const turn = message([
      traceSearch({ id: "errors", totalHits: 12, rows: 3 }),
      traceSearch({ id: "empty", totalHits: 0, rows: 0 }),
      traceSearch({ id: "slow", totalHits: 5, rows: 2 }),
    ]);

    describe("when the turn's capability cards are collected", () => {
      it("keeps both answering cards and drops the empty probe", () => {
        const ids = toCapabilityCalls(turn).map((c) => c.id);

        expect(ids).toEqual(["errors", "slow"]);
      });
    });
  });

  describe("given a single trace search", () => {
    describe("when it found nothing", () => {
      it("still renders its one honest empty card", () => {
        const turn = message([
          traceSearch({ id: "only", totalHits: 0, rows: 0 }),
        ]);

        expect(toCapabilityCalls(turn)).toHaveLength(1);
      });
    });
  });

  describe("given trace cards mixed with another capability card", () => {
    const turn = message([
      traceSearch({ id: "probe", totalHits: 0, rows: 0 }),
      traceSearch({ id: "answer", totalHits: 9, rows: 3 }),
      {
        type: "tool-langwatch.dataset.list",
        toolCallId: "datasets",
        state: "output-available",
        input: {},
        output: { datasets: [{ id: "ds_1", name: "Golden questions" }] },
      },
    ]);

    describe("when the turn's capability cards are collected", () => {
      it("leaves the non-trace card untouched by the trace-collapse", () => {
        const ids = toCapabilityCalls(turn).map((c) => c.id);

        expect(ids).toEqual(["answer", "datasets"]);
      });
    });
  });
});

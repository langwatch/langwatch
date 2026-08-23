/**
 * The persist gate on log-only traces: a summary row exists once the trace
 * says something. A span is always something; a log record is something when
 * it contributed content a reader can see (input, output, cost, tokens, a
 * model). Ambient process telemetry — an agent that started and died before
 * its first prompt — folds a log count and nothing else, and used to mint a
 * span-less row with a dash in every column, filed at the epoch.
 *
 * Feature: specs/traces/trace-summary-storage-anchor.feature
 */

import type { ProjectionStoreContext } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import type { TraceSummaryRepository } from "~/server/app-layer/traces/repositories/trace-summary.repository";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { TraceSummaryStore } from "../traceSummary.store";

const context = {
  tenantId: "project_test",
  aggregateId: "trace_1",
} as unknown as ProjectionStoreContext;

/** The fields the gate reads, over a state that is otherwise irrelevant. */
function state(overrides: Partial<TraceSummaryData>): TraceSummaryData {
  return {
    traceId: "trace_1",
    spanCount: 0,
    computedInput: null,
    computedOutput: null,
    totalCost: null,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    models: [],
    attributes: {},
    ...overrides,
  } as TraceSummaryData;
}

function storeWithRecorder() {
  const upsert = vi.fn(async () => undefined);
  const repo = { upsert } as unknown as TraceSummaryRepository;
  return { store: new TraceSummaryStore(repo), upsert };
}

describe("the trace summary persist gate", () => {
  describe("given a trace whose only signal is content-free log records", () => {
    /** @scenario "A content-free log batch persists no summary" */
    it("stores nothing", async () => {
      const { store, upsert } = storeWithRecorder();

      await store.store(
        state({
          attributes: { "langwatch.reserved.log_record_count": "23" },
        }),
        context,
      );

      expect(upsert).not.toHaveBeenCalled();
    });
  });

  describe("given a log record that contributed the trace's input", () => {
    /** @scenario "A log record carrying content persists the summary" */
    it("stores the summary", async () => {
      const { store, upsert } = storeWithRecorder();

      await store.store(
        state({
          attributes: { "langwatch.reserved.log_record_count": "1" },
          computedInput: JSON.stringify({
            type: "chat_messages",
            value: [{ role: "user", content: "Good morning." }],
          }),
        }),
        context,
      );

      expect(upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a log record whose only contribution is a cost", () => {
    /** @scenario "A log record whose only contribution is a cost persists the summary" */
    it("stores the summary", async () => {
      const { store, upsert } = storeWithRecorder();

      await store.store(
        state({
          attributes: { "langwatch.reserved.log_record_count": "1" },
          totalCost: 0.02,
        }),
        context,
      );

      expect(upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a trace whose first signal is a span", () => {
    /** @scenario "A span persists the summary regardless of content" */
    it("stores the summary with no content check", async () => {
      const { store, upsert } = storeWithRecorder();

      await store.store(state({ spanCount: 1 }), context);

      expect(upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a batch mixing both shapes", () => {
    it("stores only the entries that carry a signal", async () => {
      const upsertBatch = vi.fn(async () => undefined);
      const repo = {
        upsert: vi.fn(async () => undefined),
        upsertBatch,
      } as unknown as TraceSummaryRepository;
      const store = new TraceSummaryStore(repo);

      await store.storeBatch([
        {
          state: state({
            attributes: { "langwatch.reserved.log_record_count": "23" },
          }),
          context,
        },
        { state: state({ traceId: "trace_2", spanCount: 2 }), context },
      ]);

      expect(upsertBatch).toHaveBeenCalledTimes(1);
      const calls = upsertBatch.mock.calls as unknown as Array<
        [Array<{ data: TraceSummaryData }>]
      >;
      expect(calls[0]![0].map((entry) => entry.data.traceId)).toEqual([
        "trace_2",
      ]);
    });
  });
});

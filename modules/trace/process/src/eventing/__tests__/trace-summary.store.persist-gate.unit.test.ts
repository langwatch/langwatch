/** Persist gate for log-only traces: summary rows require visible content
 * (not just log count). */
import { createTenantId, type ProjectionStoreContext } from "@langwatch/eventing";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import type { TraceSummaryProjectionRepository } from "../../repositories/projection/trace-summary-projection.repository.ts";
import { TraceSummaryStore } from "../trace-summary.store.ts";

const context: ProjectionStoreContext = {
  tenantId: createTenantId("project_test"),
  aggregateId: "trace_1",
};

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
  const upsert = vi.fn<TraceSummaryProjectionRepository["upsert"]>(async () => undefined);
  const upsertBatch = vi.fn<TraceSummaryProjectionRepository["upsertBatch"]>(async () => undefined);
  const storage: TraceSummaryProjectionRepository = {
    upsert,
    upsertBatch,
    findByTraceId: async () => null,
  };
  return {
    store: TraceSummaryStore.create({ storage, defaultRetentionDays: () => 30 }),
    upsert,
    upsertBatch,
  };
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
      const { store, upsertBatch } = storeWithRecorder();

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
      expect(upsertBatch.mock.calls[0]![0].map((entry) => entry.data.traceId)).toEqual(["trace_2"]);
    });
  });
});

/**
 * @vitest-environment jsdom
 * A cell edit sent before a column rename lands is refused as stale by the server; the
 * rename re-keyed the queued edit, which then syncs again under the new column name. A refusal
 * after a reorder sends the same record once more under the new column order.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PendingSavedChanges } from "../../../../model/pending-saved-changes.ts";
import { DATASET_SYNC_DEBOUNCE_MS, useDatasetRecordSync } from "../use-dataset-record-sync.ts";

type Handlers = { onSuccess: () => void; onError: (error: { message: string }) => void };
const { updates } = vi.hoisted(() => ({
  updates: [] as { input: Record<string, unknown>; handlers: Handlers }[],
}));

vi.mock("@langwatch/dataset-client", () => ({
  datasetClient: {
    datasetRecord: {
      update: {
        useMutation: () => ({
          mutate: (input: Record<string, unknown>, handlers: Handlers) =>
            updates.push({ input, handlers }),
        }),
      },
      deleteMany: { useMutation: () => ({ mutate: () => undefined }) },
    },
  },
}));

const records: Record<string, Record<string, string>> = {
  before: { id: "rec-1", input: "question one", test: "edited" },
  after: { id: "rec-1", input: "question one", test2: "edited" },
};

function renderSync(pending: PendingSavedChanges = { "ds-1": { "rec-1": { test: "edited" } } }) {
  const onStatus = vi.fn();
  const clearPendingChange = vi.fn();
  const hook = renderHook(
    ({
      pending,
      record,
      columns,
    }: {
      pending: PendingSavedChanges;
      record: Record<string, string>;
      columns: string[] | undefined;
    }) =>
      useDatasetRecordSync({
        projectId: "project-1",
        pendingSavedChanges: pending,
        resolveFullRecord: () => ({ id: "rec-1", ...record }),
        resolveColumns: () => columns ?? Object.keys(record).filter((key) => key !== "id"),
        clearPendingChange,
        onStatus,
      }),
    {
      initialProps: {
        pending,
        record: records.before!,
        columns: undefined as string[] | undefined,
      },
    },
  );
  return { ...hook, onStatus, clearPendingChange };
}

beforeEach(() => {
  vi.useFakeTimers();
  updates.length = 0;
});

afterEach(() => vi.useRealTimers());

describe("given a cell edit synced under a column a rename then removed", () => {
  describe("when the server refuses it as stale after the rename re-keyed the edit", () => {
    /** @scenario "A pending saved-dataset cell edit follows a column rename" */
    it("reports no error and syncs the edit again under the new column", () => {
      const { rerender, onStatus } = renderSync();
      act(() => {
        vi.advanceTimersByTime(DATASET_SYNC_DEBOUNCE_MS);
      });
      expect(updates[0]?.input).toMatchObject({ columns: ["input", "test"] });

      rerender({
        pending: { "ds-1": { "rec-1": { test2: "edited" } } },
        record: records.after!,
        columns: undefined,
      });
      act(() => {
        updates[0]?.handlers.onError({ message: "dataset_stale_columns" });
      });
      act(() => {
        vi.advanceTimersByTime(DATASET_SYNC_DEBOUNCE_MS);
      });

      expect(onStatus).not.toHaveBeenCalledWith("error", expect.anything());
      expect(updates[1]?.input).toMatchObject({
        updatedRecord: { input: "question one", test2: "edited" },
        columns: ["input", "test2"],
      });
    });
  });

  describe("when the server refuses it as stale after a reorder of the same columns", () => {
    /** @scenario "A record write that arrives during a column edit waits for it and is refused when keyed by a removed column" */
    it("sends the same record once more under the new order and reports no error", () => {
      const pending = { "ds-1": { "rec-1": { test: "edited" } } } as PendingSavedChanges;
      const { rerender, onStatus, clearPendingChange } = renderSync(pending);
      act(() => {
        vi.advanceTimersByTime(DATASET_SYNC_DEBOUNCE_MS);
      });

      rerender({ pending, record: records.before!, columns: ["test", "input"] });
      act(() => {
        updates[0]?.handlers.onError({ message: "dataset_stale_columns" });
      });
      expect(updates[1]?.input).toMatchObject({ columns: ["test", "input"] });
      expect(onStatus, "the retry is still saving").not.toHaveBeenCalledWith("saved");
      act(() => {
        updates[1]?.handlers.onSuccess();
      });

      expect(onStatus).not.toHaveBeenCalledWith("error", expect.anything());
      expect(clearPendingChange).toHaveBeenCalledWith("ds-1", "rec-1");
    });
  });

  describe("when the server refuses it as stale and nothing re-keyed the edit", () => {
    /** @scenario "A pending saved-dataset cell edit follows a column rename" */
    it("reports the refusal", () => {
      const { onStatus } = renderSync();
      act(() => {
        vi.advanceTimersByTime(DATASET_SYNC_DEBOUNCE_MS);
      });

      act(() => {
        updates[0]?.handlers.onError({ message: "dataset_stale_columns" });
      });

      expect(onStatus).toHaveBeenCalledWith("error", "dataset_stale_columns");
    });
  });
});

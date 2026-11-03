/**
 * @vitest-environment jsdom
 * A cell edit sent before a column rename lands is refused as stale by the server; the
 * rename re-keyed the queued edit, which then syncs again under the new column name.
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

function renderSync() {
  const onStatus = vi.fn();
  const clearPendingChange = vi.fn();
  const hook = renderHook(
    ({ pending, record }: { pending: PendingSavedChanges; record: Record<string, string> }) =>
      useDatasetRecordSync({
        projectId: "project-1",
        pendingSavedChanges: pending,
        resolveFullRecord: () => ({ id: "rec-1", ...record }),
        clearPendingChange,
        onStatus,
      }),
    {
      initialProps: {
        pending: { "ds-1": { "rec-1": { test: "edited" } } } as PendingSavedChanges,
        record: records.before!,
      },
    },
  );
  return { ...hook, onStatus };
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

      rerender({ pending: { "ds-1": { "rec-1": { test2: "edited" } } }, record: records.after! });
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

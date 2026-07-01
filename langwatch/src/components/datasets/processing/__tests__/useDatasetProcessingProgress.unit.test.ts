// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATASET_PROGRESS_STALE_RECONCILE_MS } from "~/server/datasets/dataset-progress";

/**
 * ADR-034: the reconciliation glue the pure view test can't reach — the SSE
 * onData filter, the terminal/gap → getById reconcile, and the enabled gate.
 * The tRPC subscription is mocked to capture its callbacks so the test can drive
 * events and the gap timer directly.
 */

let capturedOnData: ((event: unknown) => void) | undefined;
let capturedEnabled: boolean | undefined;

vi.mock("~/utils/api", () => ({
  api: {
    dataset: {
      onDatasetProgress: {
        useSubscription: (
          _input: unknown,
          opts: { enabled?: boolean; onData?: (event: unknown) => void },
        ) => {
          capturedOnData = opts.onData;
          capturedEnabled = opts.enabled;
        },
      },
    },
  },
}));

// Imported after the mock is registered.
const { useDatasetProcessingProgress } = await import(
  "../useDatasetProcessingProgress"
);

const base = { projectId: "p1", datasetId: "d1", status: "processing" as const };

beforeEach(() => {
  capturedOnData = undefined;
  capturedEnabled = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDatasetProcessingProgress", () => {
  describe("when a tick targets a different dataset", () => {
    it("ignores it — no reconcile, no live update", () => {
      const onReconcile = vi.fn();
      const { result } = renderHook(() =>
        useDatasetProcessingProgress({ ...base, onReconcile }),
      );
      act(() =>
        capturedOnData?.({
          datasetId: "other",
          type: "progress",
          bytesRead: 5,
          totalBytes: 10,
        }),
      );
      expect(onReconcile).not.toHaveBeenCalled();
      expect(result.current).toEqual({
        kind: "indeterminate",
        phase: "processing",
      });
    });
  });

  describe("when a progress tick for this dataset arrives", () => {
    it("becomes determinate from the input bytes", () => {
      const { result } = renderHook(() =>
        useDatasetProcessingProgress(base),
      );
      act(() =>
        capturedOnData?.({
          datasetId: "d1",
          type: "progress",
          phase: "processing",
          bytesRead: 250,
          totalBytes: 1000,
          rows: 4,
        }),
      );
      expect(result.current).toMatchObject({
        kind: "determinate",
        percent: 25,
        rows: 4,
      });
    });
  });

  describe("when a terminal done event arrives", () => {
    it("reconciles the durable status via getById", () => {
      const onReconcile = vi.fn();
      renderHook(() =>
        useDatasetProcessingProgress({ ...base, onReconcile }),
      );
      act(() =>
        capturedOnData?.({ datasetId: "d1", type: "done", phase: "ready" }),
      );
      expect(onReconcile).toHaveBeenCalledTimes(1);
    });
  });

  describe("when no tick arrives for the stale window", () => {
    it("reconciles via getById on the gap timer", () => {
      vi.useFakeTimers();
      const onReconcile = vi.fn();
      renderHook(() =>
        useDatasetProcessingProgress({ ...base, onReconcile }),
      );
      act(() => {
        vi.advanceTimersByTime(2 * DATASET_PROGRESS_STALE_RECONCILE_MS + 100);
      });
      expect(onReconcile).toHaveBeenCalled();
    });
  });

  describe("when the dataset is already settled", () => {
    it("does not subscribe", () => {
      renderHook(() =>
        useDatasetProcessingProgress({ ...base, status: "ready" }),
      );
      expect(capturedEnabled).toBe(false);
    });
  });
});

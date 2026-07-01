// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADR-034: the bulk-drawer progress map. The tRPC subscription is mocked to
 * capture its onData so the test can drive events directly. The load-bearing
 * behaviour: a terminal event drops the cached tick so a retry of the same
 * datasetId doesn't reuse a stale percent.
 */

let capturedOnData: ((event: unknown) => void) | undefined;

vi.mock("~/utils/api", () => ({
  api: {
    dataset: {
      onDatasetProgress: {
        useSubscription: (
          _input: unknown,
          opts: { enabled?: boolean; onData?: (event: unknown) => void },
        ) => {
          capturedOnData = opts.onData;
        },
      },
    },
  },
}));

const { useDatasetProgressMap } = await import("../useDatasetProgressMap");

beforeEach(() => {
  capturedOnData = undefined;
});

describe("useDatasetProgressMap", () => {
  describe("when a progress tick arrives", () => {
    it("records the latest tick under its datasetId", () => {
      const { result } = renderHook(() =>
        useDatasetProgressMap({ projectId: "p1", enabled: true }),
      );
      act(() =>
        capturedOnData?.({
          datasetId: "d1",
          type: "progress",
          bytesRead: 250,
          totalBytes: 1000,
          rows: 4,
        }),
      );
      expect(result.current.d1).toMatchObject({ bytesRead: 250, rows: 4 });
    });
  });

  describe("when a terminal event arrives for a cached dataset", () => {
    it("drops the cached tick so a retry starts indeterminate", () => {
      const { result } = renderHook(() =>
        useDatasetProgressMap({ projectId: "p1", enabled: true }),
      );
      act(() =>
        capturedOnData?.({
          datasetId: "d1",
          type: "progress",
          bytesRead: 900,
          totalBytes: 1000,
        }),
      );
      expect(result.current.d1).toBeDefined();

      act(() => capturedOnData?.({ datasetId: "d1", type: "done" }));
      expect(result.current.d1).toBeUndefined();
    });
  });
});

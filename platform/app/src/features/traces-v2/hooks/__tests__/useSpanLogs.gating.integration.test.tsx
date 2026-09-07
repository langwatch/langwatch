/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "~/utils/api";
import { useSpanLogs } from "../useSpanLogs";

vi.mock("~/utils/api", () => ({
  api: {
    tracesV2: {
      header: { useQuery: vi.fn() },
      traceLogs: { useQuery: vi.fn() },
    },
  },
}));

vi.mock("../useTraceQueryArgs", () => ({
  useTraceQueryArgs: () => ({
    isReady: true,
    queryArgs: { projectId: "project-1", traceId: "trace-1" },
  }),
}));

const headerQuery = vi.mocked(api.tracesV2.header.useQuery);
const traceLogsQuery = vi.mocked(api.tracesV2.traceLogs.useQuery);

function headerData(
  over: { attributes?: Record<string, string>; origin?: string } = {},
) {
  return {
    data: {
      attributes: over.attributes ?? {},
      origin: over.origin ?? "application",
    },
  } as ReturnType<typeof api.tracesV2.header.useQuery>;
}

function logsEnabled(): boolean {
  const options = traceLogsQuery.mock.calls[0]![1] as { enabled: boolean };
  return options.enabled;
}

describe("useSpanLogs gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    traceLogsQuery.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof api.tracesV2.traceLogs.useQuery>);
  });

  describe("when the open trace is an ordinary LLM trace with zero log records", () => {
    it("never fires the traceLogs query", () => {
      headerQuery.mockReturnValue(headerData());

      renderHook(() => useSpanLogs());

      expect(logsEnabled()).toBe(false);
    });
  });

  describe("when the header counts log records on the trace", () => {
    it("enables the traceLogs query", () => {
      headerQuery.mockReturnValue(
        headerData({
          attributes: { "langwatch.reserved.log_record_count": "3" },
        }),
      );

      renderHook(() => useSpanLogs());

      expect(logsEnabled()).toBe(true);
    });
  });

  describe("when a coding-agent trace predates the count stamping", () => {
    it("fails open on the origin so the transcript logs still load", () => {
      headerQuery.mockReturnValue(headerData({ origin: "coding_agent" }));

      renderHook(() => useSpanLogs());

      expect(logsEnabled()).toBe(true);
    });
  });

  describe("while the header is still loading", () => {
    it("holds the traceLogs query back rather than firing blind", () => {
      headerQuery.mockReturnValue({
        data: undefined,
      } as ReturnType<typeof api.tracesV2.header.useQuery>);

      renderHook(() => useSpanLogs());

      expect(logsEnabled()).toBe(false);
    });
  });
});

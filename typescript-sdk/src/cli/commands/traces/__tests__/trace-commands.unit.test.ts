import { describe, it, expect, vi, beforeEach } from "vitest";
import { TracesApiError } from "@/client-sdk/services/traces/traces-api.service";

vi.mock("@/client-sdk/services/traces/traces-api.service", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    TracesApiService: vi.fn(),
  };
});

vi.mock("../../../utils/apiKey", () => ({
  checkApiKey: vi.fn(),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

vi.mock("@/cli/utils/governance/resolveEndpoint", () => ({
  resolveControlPlaneUrl: () => "https://langwatch.test",
}));

import { TracesApiService } from "@/client-sdk/services/traces/traces-api.service";
import { searchTracesCommand } from "../search";
import { exportTracesCommand } from "../export";
import { getTraceCommand } from "../get";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty — suppresses output during tests
};

const mockProcessExit = () => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
};

describe("searchTracesCommand()", () => {
  let mockSearch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch = vi.fn();
    vi.mocked(TracesApiService).mockImplementation(function () { return ({
      search: mockSearch,
      get: vi.fn(),
    }) as unknown as TracesApiService; });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when traces are found", () => {
    it("calls search and prints results", async () => {
      mockSearch.mockResolvedValue({
        traces: [{ traceId: "trace_1", input: "hello", output: "world" }],
        pagination: { totalHits: 1 },
      });

      await searchTracesCommand({});

      expect(mockSearch).toHaveBeenCalledOnce();
    });
  });

  describe("when no traces are found", () => {
    it("prints empty-state message", async () => {
      mockSearch.mockResolvedValue({
        traces: [],
        pagination: { totalHits: 0 },
      });

      await searchTracesCommand({});

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe("when format is json", () => {
    it("outputs raw JSON", async () => {
      const result = {
        traces: [{ traceId: "t1" }],
        pagination: { totalHits: 1 },
      };
      mockSearch.mockResolvedValue(result);

      await searchTracesCommand({ format: "json" });

      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify(result, null, 2),
      );
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      mockSearch.mockRejectedValue(
        new TracesApiError("Network error", "search traces"),
      );

      await expect(searchTracesCommand({})).rejects.toThrow(ProcessExitError);
    });
  });

  describe("when --origin is provided", () => {
    /** @scenario Search traces filtered by origin */
    it("passes the origin as a traces.origin filter to the search API", async () => {
      mockSearch.mockResolvedValue({
        traces: [],
        pagination: { totalHits: 0 },
      });

      await searchTracesCommand({ origin: "application" });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: { "traces.origin": ["application"] },
        }),
      );
    });

    /** @scenario Search traces filtered by multiple origins */
    it("splits comma-separated origins into one filter value each", async () => {
      mockSearch.mockResolvedValue({
        traces: [],
        pagination: { totalHits: 0 },
      });

      await searchTracesCommand({ origin: "application, evaluation" });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: { "traces.origin": ["application", "evaluation"] },
        }),
      );
    });
  });

  describe("when --origin is not provided", () => {
    it("sends no filters field so the search body stays unchanged", async () => {
      mockSearch.mockResolvedValue({
        traces: [],
        pagination: { totalHits: 0 },
      });

      await searchTracesCommand({});

      expect(mockSearch.mock.calls[0]![0]).not.toHaveProperty("filters");
    });
  });
});

describe("exportTracesCommand()", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ traces: [], pagination: { totalHits: 0 } }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    mockProcessExit();
  });

  describe("when --origin is provided", () => {
    /** @scenario Export traces filtered by origin */
    it("passes the origin as a traces.origin filter to the search API", async () => {
      await exportTracesCommand({ origin: "application,evaluation" });

      const body = JSON.parse(
        (fetchMock.mock.calls[0]![1] as { body: string }).body,
      ) as Record<string, unknown>;
      expect(body.filters).toEqual({
        "traces.origin": ["application", "evaluation"],
      });
    });
  });

  describe("when --origin is not provided", () => {
    it("sends no filters field so the export body stays unchanged", async () => {
      await exportTracesCommand({});

      const body = JSON.parse(
        (fetchMock.mock.calls[0]![1] as { body: string }).body,
      ) as Record<string, unknown>;
      expect(body).not.toHaveProperty("filters");
    });
  });
});

describe("getTraceCommand()", () => {
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet = vi.fn();
    vi.mocked(TracesApiService).mockImplementation(function () { return ({
      search: vi.fn(),
      get: mockGet,
    }) as unknown as TracesApiService; });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when trace is found", () => {
    it("calls get with the provided trace ID", async () => {
      mockGet.mockResolvedValue({ traceId: "trace_abc", input: "test" });

      await getTraceCommand("trace_abc", {});

      expect(mockGet).toHaveBeenCalledWith("trace_abc", { format: "digest" });
    });
  });

  describe("when trace is not found", () => {
    it("exits with code 1", async () => {
      mockGet.mockRejectedValue(
        new TracesApiError("Not found", "get trace"),
      );

      await expect(getTraceCommand("nonexistent", {})).rejects.toThrow(ProcessExitError);
    });
  });
});

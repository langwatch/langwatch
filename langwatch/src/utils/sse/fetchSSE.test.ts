import { fetchSSE } from "./fetchSSE";
import { RetriableError, FatalError } from "./errors";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock fetchEventSource
vi.mock("@microsoft/fetch-event-source");

type FetchEventSourceOptions = {
  onopen: (response: any) => void;
  onmessage: (event: { data: string }) => void;
  onclose: () => void;
  onerror: (err: any) => void;
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: any;
};

describe("fetchSSE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call fetchEventSource with correct parameters", async () => {
    const mockFetchEventSource = fetchEventSource as unknown as ReturnType<
      typeof vi.fn
    >;
    (mockFetchEventSource as any).mockImplementation(
      (url: string, options: FetchEventSourceOptions) => {
        // Simulate successful connection
        options.onopen({
          ok: true,
          headers: { get: () => "text/event-stream" },
        });
        return Promise.resolve();
      }
    );

    const onEvent = vi.fn();

    await fetchSSE({
      endpoint: "/api/test",
      payload: { test: "data" },
      onEvent,
      timeout: 5000,
    });

    expect(mockFetchEventSource).toHaveBeenCalledWith(
      "/api/test",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        }),
        body: JSON.stringify({ test: "data" }),
        signal: expect.any(Object),
      })
    );
  });

  it("should process events correctly", async () => {
    const mockFetchEventSource = fetchEventSource as unknown as ReturnType<
      typeof vi.fn
    >;
    (mockFetchEventSource as any).mockImplementation(
      (url: string, options: FetchEventSourceOptions) => {
        // Simulate successful connection
        options.onopen({
          ok: true,
          headers: { get: () => "text/event-stream" },
        });

        // Simulate events
        options.onmessage({ data: JSON.stringify({ type: "test", value: 1 }) });
        options.onmessage({ data: JSON.stringify({ type: "test", value: 2 }) });

        return Promise.resolve();
      }
    );

    const onEvent = vi.fn();

    await fetchSSE({
      endpoint: "/api/test",
      payload: { test: "data" },
      onEvent,
    });

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenNthCalledWith(1, { type: "test", value: 1 });
    expect(onEvent).toHaveBeenNthCalledWith(2, { type: "test", value: 2 });
  });

  it("should stop processing when shouldStopProcessing returns true", async () => {
    const mockAbort = vi.fn();
    const mockFetchEventSource = fetchEventSource as unknown as ReturnType<
      typeof vi.fn
    >;

    (mockFetchEventSource as any).mockImplementation(
      (url: string, options: FetchEventSourceOptions) => {
        // Save abort function to call later
        const controller = { abort: mockAbort };
        options.signal = controller;

        // Simulate successful connection
        options.onopen({
          ok: true,
          headers: { get: () => "text/event-stream" },
        });

        // Simulate events
        options.onmessage({ data: JSON.stringify({ type: "test", value: 1 }) });
        options.onmessage({ data: JSON.stringify({ type: "stop", value: 2 }) });
        options.onmessage({ data: JSON.stringify({ type: "test", value: 3 }) });

        return Promise.resolve();
      }
    );

    const onEvent = vi.fn();
    const shouldStopProcessing = vi.fn((event) => event.type === "stop");

    await fetchSSE({
      endpoint: "/api/test",
      payload: { test: "data" },
      onEvent,
      shouldStopProcessing,
    });

    expect(shouldStopProcessing).toHaveBeenCalledTimes(2);
    expect(mockAbort).toHaveBeenCalledTimes(1);
    // The third event shouldn't be processed if aborted correctly
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("should handle client errors as FatalError", async () => {
    const mockFetchEventSource = fetchEventSource as unknown as ReturnType<
      typeof vi.fn
    >;
    (mockFetchEventSource as any).mockImplementation(
      (url: string, options: FetchEventSourceOptions) => {
        // Simulate client error (400)
        options.onopen({
          ok: false,
          status: 400,
          statusText: "Bad Request",
          headers: { get: () => "application/json" },
          json: () => Promise.resolve({ error: "Invalid input" }),
        });

        return Promise.resolve();
      }
    );

    const onError = vi.fn();

    await fetchSSE({
      endpoint: "/api/test",
      payload: { test: "data" },
      onEvent: vi.fn(),
      onError,
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe("Invalid input");
    expect(onError.mock.calls[0][0].name).toBe("FatalError");
  });

  it("should handle server errors as RetriableError", async () => {
    const mockFetchEventSource = fetchEventSource as unknown as ReturnType<
      typeof vi.fn
    >;
    (mockFetchEventSource as any).mockImplementation(
      (url: string, options: FetchEventSourceOptions) => {
        // Simulate server error (500)
        options.onopen({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          headers: { get: () => "application/json" },
        });

        return Promise.resolve();
      }
    );

    const onError = vi.fn();

    await fetchSSE({
      endpoint: "/api/test",
      payload: { test: "data" },
      onEvent: vi.fn(),
      onError,
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toContain("Server error: 500");
    expect(onError.mock.calls[0][0].name).toBe("RetriableError");
  });

  it("should handle timeout correctly", async () => {
    vi.useFakeTimers();

    const mockAbort = vi.fn();
    const mockFetchEventSource = fetchEventSource as unknown as ReturnType<
      typeof vi.fn
    >;

    (mockFetchEventSource as any).mockImplementation(
      (url: string, options: FetchEventSourceOptions) => {
        // Save abort function to call later
        const controller = { abort: mockAbort };
        options.signal = controller;

        // Simulate successful connection
        options.onopen({
          ok: true,
          headers: { get: () => "text/event-stream" },
        });

        // Return a promise that never resolves
        return new Promise(() => {});
      }
    );

    const fetchPromise = fetchSSE({
      endpoint: "/api/test",
      payload: { test: "data" },
      onEvent: vi.fn(),
      timeout: 5000,
    });

    // Fast-forward time to trigger timeout
    vi.advanceTimersByTime(5001);

    expect(mockAbort).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});

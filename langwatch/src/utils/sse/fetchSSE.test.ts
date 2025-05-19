import { fetchSSE } from "./fetchSSE";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { FetchSSETimeoutError } from "./errors";

vi.mock("~/utils/logger", () => ({
  createLogger: (name: string) => ({
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
  }),
}));

vi.mock("@microsoft/fetch-event-source");

type FetchEventSourceMockOptions = {
  onopen: (response: any) => Promise<void> | void;
  onmessage: (event: { data: string }) => void;
  onclose: () => void;
  onerror: (err: any) => void;
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
};

describe("fetchSSE", () => {
  let mockFetchEventSource: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchEventSource = fetchEventSource as unknown as ReturnType<
      typeof vi.fn
    >;

    // Default successful connection
    mockFetchEventSource.mockImplementation(
      (url: string, options: FetchEventSourceMockOptions) => {
        Promise.resolve().then(() => {
          if (options.signal.aborted) {
            options.onerror(new Error("Aborted"));
            return;
          }
          options.onopen({
            ok: true,
            headers: { get: () => "text/event-stream" },
          });
        });
        return Promise.resolve();
      }
    );
  });

  it("should make request with correct parameters", async () => {
    const onEvent = vi.fn();
    await fetchSSE({
      endpoint: "/api/test",
      payload: { test: "data" },
      onEvent,
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
      })
    );
  });

  it("should process events and handle stop condition", async () => {
    const onEvent = vi.fn();
    const shouldStopProcessing = vi.fn((event) => event.type === "stop");

    mockFetchEventSource.mockImplementation(
      (url: string, options: FetchEventSourceMockOptions) => {
        options.onopen({
          ok: true,
          headers: { get: () => "text/event-stream" },
        });
        options.onmessage({ data: JSON.stringify({ type: "test", value: 1 }) });
        options.onmessage({ data: JSON.stringify({ type: "stop", value: 2 }) });
        return Promise.resolve();
      }
    );

    await fetchSSE({
      endpoint: "/api/test",
      payload: {},
      onEvent,
      shouldStopProcessing,
    });

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(shouldStopProcessing).toHaveBeenCalledWith({
      type: "stop",
      value: 2,
    });
  });

  describe("error handling", () => {
    describe("with onError callback", () => {
      it("should handle HTTP errors", async () => {
        const onError = vi.fn();

        mockFetchEventSource.mockImplementation(
          async (url: string, options: FetchEventSourceMockOptions) => {
            await options.onopen({
              ok: false,
              status: 500,
              statusText: "Server Error",
              headers: { get: () => "application/json" },
            });
            return Promise.resolve();
          }
        );

        await fetchSSE({
          endpoint: "/api/test",
          payload: {},
          onEvent: vi.fn(),
          onError,
        });

        expect(onError).toHaveBeenCalledWith(expect.any(Error));
      });

      it("should handle JSON parsing errors", async () => {
        const onError = vi.fn();

        mockFetchEventSource.mockImplementation(
          (url: string, options: FetchEventSourceMockOptions) => {
            options.onopen({
              ok: true,
              headers: { get: () => "text/event-stream" },
            });
            options.onmessage({ data: "invalid json" });
            return Promise.resolve();
          }
        );

        await fetchSSE({
          endpoint: "/api/test",
          payload: {},
          onEvent: vi.fn(),
          onError,
        });

        expect(onError).toHaveBeenCalledWith(expect.any(Error));
      });

      it("should handle timeouts", async () => {
        vi.useFakeTimers();
        const onError = vi.fn();

        const ssePromise = fetchSSE({
          endpoint: "/api/test",
          payload: {},
          onEvent: vi.fn(),
          onError,
          timeout: 100,
        });

        await vi.advanceTimersByTimeAsync(101);
        await ssePromise;

        expect(onError).toHaveBeenCalledWith(expect.any(FetchSSETimeoutError));
        vi.useRealTimers();
      });
    });

    describe("without onError callback", () => {
      it("should throw errors when no onError callback is provided", async () => {
        mockFetchEventSource.mockImplementation(
          (url: string, options: FetchEventSourceMockOptions) => {
            options.onopen({
              ok: true,
              headers: { get: () => "text/event-stream" },
            });
            options.onmessage({ data: "invalid json" });
            return Promise.resolve();
          }
        );

        await expect(
          fetchSSE({
            endpoint: "/api/test",
            payload: {},
            onEvent: vi.fn(),
          })
        ).rejects.toThrow();
      });

      it("should throw timeout errors when no onError callback is provided", async () => {
        vi.useFakeTimers();

        await expect(async () => {
          fetchSSE({
            endpoint: "/api/test",
            payload: {},
            onEvent: vi.fn(),
            timeout: 100,
          });

          await vi.advanceTimersByTimeAsync(101);
        }).rejects.toThrow(FetchSSETimeoutError);

        vi.useRealTimers();
      });
    });
  });
});

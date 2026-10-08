/**
 * `LW.useChartQuery` as it ships: the shim is evaluated as a string and the
 * hook is driven through a minimal React, so the embedded fetch policy is
 * proven to resolve inside the frame.
 * @see specs/analytics/dashboard-widget-resilience.feature
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildShimScript } from "../chart-frame-shim-source.ts";

interface HookResult {
  data: unknown;
  status: string;
  isError: boolean;
  isRefetchError: boolean;
  isFetching: boolean;
  error: { code?: string; retryable?: boolean } | null;
  refetchError: { code?: string } | null;
  refetch: () => void;
}

type PortMessage = { type: string; requestId: number };

/** The shim with one mounted `useChartQuery("q")`, and the parent's side of its port. */
function mountHook() {
  const listeners: ((event: unknown) => void)[] = [];
  const parent = {};
  let state: unknown;
  let seeded = false;
  let mounted = false;
  const ref = { current: null as unknown };
  const react = {
    useState: (initial: unknown) => {
      if (!seeded) {
        state = initial;
        seeded = true;
      }
      const setState = (next: unknown) => {
        state = typeof next === "function" ? (next as (value: unknown) => unknown)(state) : next;
      };
      return [state, setState];
    },
    useRef: () => ref,
    useEffect: (effect: () => void) => {
      if (!mounted) {
        mounted = true;
        effect();
      }
    },
  };
  const win = {
    parent,
    React: react,
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      if (type === "message") listeners.push(handler);
    },
    LW: undefined as { useChartQuery: (name: string) => HookResult } | undefined,
  };
  const quiet = { log() {}, info() {}, warn() {}, error() {} };
  // The shim ships as a string; evaluating it is the test.
  // oxlint-disable-next-line no-implied-eval
  new Function("window", "console", "setInterval", buildShimScript())(win, quiet, () => 0);

  const asked: PortMessage[] = [];
  const port = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage: (message: PortMessage) => {
      if (message.type === "lw:query") asked.push(message);
    },
  };
  for (const handler of listeners) {
    handler({
      data: { type: "lw:init", source: "", dashboardContext: { theme: "light" }, params: {} },
      source: parent,
      ports: [port],
    });
  }

  const render = () => win.LW!.useChartQuery("q");
  render();
  const answer = async (reply: Record<string, unknown>) => {
    const request = asked.at(-1)!;
    port.onmessage?.({ data: { requestId: request.requestId, ...reply } });
    await vi.advanceTimersByTimeAsync(0);
  };
  return { render, answer, asked };
}

const BUSY = { code: "lwql_busy", title: "Busy", message: "Try again", retryable: true };

describe("LW.useChartQuery, evaluated as the frame runs it", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when a refresh fails over rows already loaded", () => {
    /** @scenario "A failed refresh keeps the chart that was on screen" */
    it("still returns the rows, with isError false and the failure as refetchError", async () => {
      const { render, answer } = mountHook();
      await vi.advanceTimersByTimeAsync(0);
      await answer({ type: "lw:query-result", result: { rows: [{ n: 1 }] } });

      render().refetch();
      await vi.advanceTimersByTimeAsync(0);
      await answer({
        type: "lw:query-error",
        error: { code: "unknown", title: "Something went wrong", message: "We've been notified." },
      });

      const result = render();
      expect(result.data).toEqual([{ n: 1 }]);
      expect(result).toMatchObject({ status: "success", isError: false, isRefetchError: true });
      expect(result.refetchError?.code).toBe("unknown");
    });
  });

  describe("when the first load is refused as busy", () => {
    /** @scenario "A retryable failure is retried with backoff before it counts" */
    it("asks again after a pause and shows the rows the retry brings", async () => {
      const { render, answer, asked } = mountHook();
      await vi.advanceTimersByTimeAsync(0);
      await answer({ type: "lw:query-error", error: BUSY });
      expect(render()).toMatchObject({ isError: false, isFetching: true });

      await vi.advanceTimersByTimeAsync(400);
      expect(asked).toHaveLength(2);
      await answer({ type: "lw:query-result", result: { rows: [1, 2] } });

      expect(render()).toMatchObject({ status: "success", data: [1, 2], isError: false });
    });

    /** @scenario "An error state is only for a query that never had data" */
    it("is an error state once three retries are spent", async () => {
      const { render, answer, asked } = mountHook();
      await vi.advanceTimersByTimeAsync(0);
      for (let attempts = 0; attempts < 4; attempts += 1) {
        await answer({ type: "lw:query-error", error: BUSY });
        await vi.advanceTimersByTimeAsync(5000);
      }

      const result = render();
      expect(asked).toHaveLength(4);
      expect(result).toMatchObject({ status: "error", isError: true, data: null });
      expect(result.error).toMatchObject({ code: "lwql_busy", retryable: true });
    });
  });
});

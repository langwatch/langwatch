/**
 * @vitest-environment jsdom
 *
 * The chart-frame bridge bounds how many `lw:query` requests a frame can have
 * in flight at once: author code can fan out an unbounded number of real
 * backend queries (a render loop, a huge Promise.all), so past the cap the
 * bridge rejects immediately rather than piling onto the executor.
 *
 * @see specs/analytics/custom-chart-playground.feature
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createFrameBridge } from "../frameBridge";

const MAX_CONCURRENT = 8;

/**
 * Stands up a bridge against a fake iframe, capturing the MessagePort the
 * bridge transfers to the frame so the test can drive it from the frame side.
 */
function mountBridge(
  executeQuery: Parameters<typeof createFrameBridge>[0]["executeQuery"],
) {
  const iframe = document.createElement("iframe");
  let transferredPort: MessagePort | undefined;
  Object.defineProperty(iframe, "contentWindow", {
    configurable: true,
    value: {
      postMessage: (
        _msg: unknown,
        _origin: string,
        transfer: Transferable[],
      ) => {
        transferredPort = transfer?.[0] as MessagePort;
      },
    },
  });
  document.body.appendChild(iframe);

  const bridge = createFrameBridge({
    iframe,
    executeQuery,
    dashboardContext: {
      timeWindow: { start: 0, end: 1 },
      granularitySeconds: 3600,
      timezone: "UTC",
      theme: "light",
      projectId: "project_1",
    },
    onLog: vi.fn(),
    onHeightChange: vi.fn(),
    onTeardown: vi.fn(),
  });
  iframe.dispatchEvent(new Event("load"));

  return { bridge, framePort: transferredPort! };
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("given a frame that keeps opening queries without them settling", () => {
  describe(`when it exceeds ${MAX_CONCURRENT} in-flight queries`, () => {
    it("rejects the overflow query with an overloaded error", async () => {
      // Never resolves — every query stays in flight, filling the slots.
      const executeQuery = vi.fn(() => new Promise<never>(() => {}));
      const { framePort } = mountBridge(executeQuery);

      const replies: Array<{ type: string; error?: { code: string } }> = [];
      framePort.onmessage = (event) => replies.push(event.data);
      framePort.start();

      for (let requestId = 0; requestId <= MAX_CONCURRENT; requestId++) {
        framePort.postMessage({
          type: "lw:query",
          requestId,
          queryName: "main",
          params: {},
        });
      }
      await flush();

      // The first MAX_CONCURRENT reached the executor; the next did not.
      expect(executeQuery).toHaveBeenCalledTimes(MAX_CONCURRENT);
      const overloaded = replies.find(
        (reply) => reply.type === "lw:query-error",
      );
      expect(overloaded?.error?.code).toBe("dashboard_widget_query_overloaded");
    });
  });
});

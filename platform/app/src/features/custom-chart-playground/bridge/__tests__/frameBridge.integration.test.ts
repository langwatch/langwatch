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

import { CHART_FRAME_RECEIPT_MAX_MARKUP_CHARS } from "../bridgeProtocol";
import { createFrameBridge } from "../frameBridge";

const MAX_CONCURRENT = 8;

/**
 * Stands up a bridge against a fake iframe, capturing the MessagePort the
 * bridge transfers to the frame so the test can drive it from the frame side.
 */
function mountBridge(
  executeQuery: Parameters<typeof createFrameBridge>[0]["executeQuery"],
  source = "export default function Widget() { return null; }",
  extra: Partial<Parameters<typeof createFrameBridge>[0]> = {},
) {
  const iframe = document.createElement("iframe");
  let transferredPort: MessagePort | undefined;
  const initMessages: Array<Record<string, unknown>> = [];
  Object.defineProperty(iframe, "contentWindow", {
    configurable: true,
    value: {
      postMessage: (
        msg: Record<string, unknown>,
        _origin: string,
        transfer: Transferable[],
      ) => {
        initMessages.push(msg);
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
    params: { threshold: 3 },
    source,
    onLog: vi.fn(),
    onHeightChange: vi.fn(),
    onTeardown: vi.fn(),
    ...extra,
  });
  iframe.dispatchEvent(new Event("load"));

  return { bridge, framePort: transferredPort!, initMessages };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("given a sandboxed chart frame is mounted with widget source", () => {
  describe("when the frame document loads", () => {
    /** @scenario "The parent delivers the widget source on init" */
    it("posts exactly one lw:init carrying the widget source, dashboard context and params", () => {
      const source = "export default () => null;";
      const { initMessages } = mountBridge(vi.fn(), source);

      expect(initMessages).toHaveLength(1);
      const init = initMessages[0]!;
      expect(init.type).toBe("lw:init");
      expect(init.source).toBe(source);
      expect(init.dashboardContext).toMatchObject({ projectId: "project_1" });
      expect(init.params).toEqual({ threshold: 3 });
    });
  });

  describe("when the bridge attaches to the iframe", () => {
    /** @scenario "The bridge listens for the frame before navigating it" */
    it("registers the load listener before assigning src", () => {
      const iframe = document.createElement("iframe");
      document.body.appendChild(iframe);

      const listeners: string[] = [];
      const originalAddEventListener = iframe.addEventListener;
      const originalSrcSetter = Object.getOwnPropertyDescriptor(
        HTMLIFrameElement.prototype,
        "src",
      )?.set;

      iframe.addEventListener = function (
        this: HTMLIFrameElement,
        type: string,
        listener: EventListener,
        options?: boolean | AddEventListenerOptions,
      ) {
        listeners.push(`addEventListener:${type}`);
        return originalAddEventListener.call(this, type, listener, options);
      } as any;

      if (originalSrcSetter) {
        Object.defineProperty(iframe, "src", {
          set(value: string) {
            listeners.push(`src:${value}`);
            originalSrcSetter.call(this, value);
          },
          get() {
            const srcDescriptor = Object.getOwnPropertyDescriptor(
              HTMLIFrameElement.prototype,
              "src",
            );
            return srcDescriptor?.get?.call(this) ?? "";
          },
        });
      }

      // Create bridge — the load listener should be registered before src is assigned
      createFrameBridge({
        iframe,
        executeQuery: vi.fn(),
        dashboardContext: {
          timeWindow: { start: 0, end: 1 },
          granularitySeconds: 3600,
          timezone: "UTC",
          theme: "light",
          projectId: "project_1",
        },
        source: "export default () => null;",
        onLog: vi.fn(),
        onHeightChange: vi.fn(),
        onTeardown: vi.fn(),
      });

      // Verify addEventListener("load") came before src assignment
      const loadListenerIndex = listeners.indexOf("addEventListener:load");
      const srcAssignmentIndex = listeners.findIndex((l) =>
        l.startsWith("src:"),
      );

      expect(loadListenerIndex).toBeGreaterThanOrEqual(0);
      expect(srcAssignmentIndex).toBeGreaterThan(loadListenerIndex);

      document.body.removeChild(iframe);
    });
  });
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
      // Each postMessage dispatches its "message" event asynchronously, so
      // wait for the executor to actually observe all MAX_CONCURRENT calls
      // rather than assuming a single flush drains every pending dispatch.
      await vi.waitFor(() => {
        expect(executeQuery).toHaveBeenCalledTimes(MAX_CONCURRENT);
      });

      // The first MAX_CONCURRENT reached the executor; the next did not.
      const overloaded = await vi.waitFor(() => {
        const reply = replies.find((r) => r.type === "lw:query-error");
        expect(reply).toBeDefined();
        return reply;
      });
      expect(overloaded?.error?.code).toBe("dashboard_widget_query_overloaded");
    });
  });
});

describe("given a sandboxed chart frame reports what it rendered", () => {
  describe("when the frame posts a render receipt", () => {
    /** @scenario "A mounted widget reports a render receipt with its markup" */
    it("delivers it to onRenderReceipt without the type discriminator", async () => {
      const onRenderReceipt = vi.fn();
      const { framePort } = mountBridge(vi.fn(), undefined, {
        onRenderReceipt,
      });
      framePort.start();

      framePort.postMessage({
        type: "lw:render-receipt",
        status: "ok",
        markup: '<div id="lw-root"><svg /></div>',
        isMarkupTruncated: false,
        height: 240,
      });

      await vi.waitFor(() => {
        expect(onRenderReceipt).toHaveBeenCalledTimes(1);
      });
      const receipt = onRenderReceipt.mock.calls[0]![0];
      expect(receipt).not.toHaveProperty("type");
      expect(receipt).toMatchObject({
        status: "ok",
        markup: '<div id="lw-root"><svg /></div>',
        isMarkupTruncated: false,
        height: 240,
      });
    });
  });

  describe("when the frame posts oversized markup directly on the port", () => {
    /** @scenario "An oversized render receipt is clamped and flagged" */
    it("clamps the markup to the cap and flags isMarkupTruncated", async () => {
      const onRenderReceipt = vi.fn();
      const { framePort } = mountBridge(vi.fn(), undefined, {
        onRenderReceipt,
      });
      framePort.start();

      const oversized = "a".repeat(
        CHART_FRAME_RECEIPT_MAX_MARKUP_CHARS + 1_000,
      );
      framePort.postMessage({
        type: "lw:render-receipt",
        status: "ok",
        markup: oversized,
        isMarkupTruncated: false,
        height: 100,
      });

      await vi.waitFor(() => {
        expect(onRenderReceipt).toHaveBeenCalledTimes(1);
      });
      const receipt = onRenderReceipt.mock.calls[0]![0];
      expect(receipt.markup).toHaveLength(CHART_FRAME_RECEIPT_MAX_MARKUP_CHARS);
      expect(receipt.isMarkupTruncated).toBe(true);
    });
  });

  describe("when a message claims to be a render receipt but is malformed", () => {
    /** @scenario "A malformed render receipt is dropped" */
    it("drops a message with a bad status and never calls onRenderReceipt", async () => {
      const onRenderReceipt = vi.fn();
      const { framePort } = mountBridge(vi.fn(), undefined, {
        onRenderReceipt,
      });
      framePort.start();

      framePort.postMessage({
        type: "lw:render-receipt",
        status: "pending",
        markup: "<div />",
        isMarkupTruncated: false,
        height: 10,
      });
      framePort.postMessage({
        type: "lw:render-receipt",
        status: "ok",
        markup: 42,
        isMarkupTruncated: false,
        height: 10,
      });

      // Flush the throttle window; nothing valid was ever queued.
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(onRenderReceipt).not.toHaveBeenCalled();
    });
  });

  describe("when the frame posts many receipts synchronously", () => {
    /** @scenario "Rapid render receipts are throttled to the latest" */
    it("delivers at most one receipt per 100ms, carrying the last payload", async () => {
      const onRenderReceipt = vi.fn();
      const { framePort } = mountBridge(vi.fn(), undefined, {
        onRenderReceipt,
      });
      framePort.start();

      for (let i = 0; i < 10; i++) {
        framePort.postMessage({
          type: "lw:render-receipt",
          status: "ok",
          markup: `<div>${i}</div>`,
          isMarkupTruncated: false,
          height: i,
        });
      }

      await vi.waitFor(() => {
        expect(onRenderReceipt).toHaveBeenCalledTimes(1);
      });

      const receipt = onRenderReceipt.mock.calls[0]![0];
      expect(receipt.markup).toBe("<div>9</div>");
      expect(receipt.height).toBe(9);

      // No further, delayed deliveries trickle in after the window closes.
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(onRenderReceipt).toHaveBeenCalledTimes(1);
    });
  });
});

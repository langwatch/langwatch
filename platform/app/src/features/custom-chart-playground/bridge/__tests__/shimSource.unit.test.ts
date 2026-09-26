/**
 * @vitest-environment jsdom
 *
 * The frame-side shim only initialises from its own parent window: `lw:init`
 * from any other source (or when the document has no real parent, e.g. opened
 * at top level) is ignored, so a hostile window cannot post its own widget
 * source and get it executed.
 *
 * The shim ships as a string of plain JS, so this evaluates that string in a
 * fully controlled `window` and drives the real "message" listener it installs
 * — a served-HTML substring check would not exercise the guard.
 *
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 */

import { describe, expect, it, vi } from "vitest";

import { buildShimScript } from "../shimSource";

interface FrameWindow {
  parent: unknown;
  addEventListener: (type: string, handler: (event: unknown) => void) => void;
  __lwActivateAuthor?: () => void;
  __LW_AUTHOR_SOURCE__?: string;
  [key: string]: unknown;
}

/**
 * Evaluates the shim source with a controlled `window`, capturing the
 * "message" listener it installs so a test can dispatch init events with an
 * arbitrary `source`. `setInterval` is stubbed so the heartbeat schedules no
 * real timer, and `window.parent` is a distinct object so the shim's
 * `window.parent !== window` check reflects an embedded frame.
 */
function evaluateShim() {
  const listeners: Record<string, Array<(event: unknown) => void>> = {};
  const parent = { name: "parent-window" };
  const activateAuthor = vi.fn();
  // Everything the shim posts over the transferred port, in order — so a test
  // can assert a render receipt was sent.
  const posts: Array<Record<string, unknown>> = [];

  const win: FrameWindow = {
    parent,
    __lwActivateAuthor: activateAuthor,
    addEventListener: (type, handler) => {
      (listeners[type] ??= []).push(handler);
    },
  };

  const fakeConsole = {
    log: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  const run = new Function(
    "window",
    "console",
    "setInterval",
    buildShimScript(),
  );
  run(win, fakeConsole, () => 0);

  const dispatchInit = (source: unknown, widgetSource: string) => {
    const port = {
      onmessage: null as unknown,
      postMessage: (message: Record<string, unknown>) => posts.push(message),
    };
    const event = {
      data: {
        type: "lw:init",
        source: widgetSource,
        dashboardContext: { theme: "light" },
        params: {},
      },
      source,
      ports: [port],
    };
    for (const handler of listeners.message ?? []) handler(event);
  };

  return { win, parent, activateAuthor, dispatchInit, posts };
}

describe("given the frame's shim is listening for lw:init", () => {
  describe("when an lw:init arrives whose source is not the parent window", () => {
    /** @scenario "The frame ignores init messages that do not come from its parent" */
    it("ignores it: no widget source is published and the author runtime is not activated", () => {
      const { win, activateAuthor, dispatchInit } = evaluateShim();

      dispatchInit({ name: "attacker-window" }, "window.top.location = 'evil'");

      expect(win.__LW_AUTHOR_SOURCE__).toBeUndefined();
      expect(activateAuthor).not.toHaveBeenCalled();
    });
  });

  describe("when an lw:init arrives whose source is the parent window", () => {
    /** @scenario "The frame ignores init messages that do not come from its parent" */
    it("accepts it: publishes the widget source and activates the author runtime", () => {
      const { win, parent, activateAuthor, dispatchInit } = evaluateShim();

      dispatchInit(parent, "export default () => null;");

      expect(win.__LW_AUTHOR_SOURCE__).toBe("export default () => null;");
      expect(activateAuthor).toHaveBeenCalledTimes(1);
    });
  });
});

describe("given the shim has been initialised by its parent", () => {
  describe("when the author runtime reports a successful mount", () => {
    /** @scenario "A mounted widget reports a render receipt with its markup" */
    it("posts a debounced render receipt carrying the widget root's markup", () => {
      vi.useFakeTimers();
      try {
        // The real shim runs with #lw-root already in the frame document; the
        // shim reads `document` (the real jsdom document here) directly.
        const root = document.createElement("div");
        root.id = "lw-root";
        root.innerHTML = "<svg data-chart='1'></svg>";
        document.body.appendChild(root);

        const { win, parent, dispatchInit, posts } = evaluateShim();
        dispatchInit(parent, "export default () => null;");

        const report = win.__lwReportRender as (
          status: string,
          errorText?: string,
        ) => void;
        expect(typeof report).toBe("function");
        report("ok");
        // Debounced by 250ms — nothing posted until the timer fires.
        expect(
          posts.find((m) => m.type === "lw:render-receipt"),
        ).toBeUndefined();
        vi.advanceTimersByTime(300);

        const receipt = posts.find((m) => m.type === "lw:render-receipt");
        expect(receipt).toBeDefined();
        expect(receipt?.status).toBe("ok");
        expect(String(receipt?.markup)).toContain('id="lw-root"');
        expect(String(receipt?.markup)).toContain("data-chart");
        expect(receipt?.isMarkupTruncated).toBe(false);
      } finally {
        document.getElementById("lw-root")?.remove();
        vi.useRealTimers();
      }
    });
  });

  describe("when the author runtime reports an error", () => {
    /** @scenario "A widget that fails to compile or throws reports an error receipt" */
    it("posts a receipt whose status is error and carries the error text", () => {
      vi.useFakeTimers();
      try {
        const root = document.createElement("div");
        root.id = "lw-root";
        document.body.appendChild(root);

        const { win, parent, dispatchInit, posts } = evaluateShim();
        dispatchInit(parent, "export default () => null;");

        (win.__lwReportRender as (status: string, errorText?: string) => void)(
          "error",
          "Compile error: unexpected token",
        );
        vi.advanceTimersByTime(300);

        const receipt = posts.find((m) => m.type === "lw:render-receipt");
        expect(receipt?.status).toBe("error");
        expect(receipt?.errorText).toBe("Compile error: unexpected token");
      } finally {
        document.getElementById("lw-root")?.remove();
        vi.useRealTimers();
      }
    });
  });

  describe("when a query result arrives and the chart re-renders", () => {
    /** @scenario "A receipt follows the widget's data" */
    it("posts an updated receipt for the new markup after the debounce", async () => {
      vi.useFakeTimers();
      try {
        const root = document.createElement("div");
        root.id = "lw-root";
        root.innerHTML = "<svg data-chart='1'></svg>";
        document.body.appendChild(root);

        const { win, parent, dispatchInit, posts } = evaluateShim();
        dispatchInit(parent, "export default () => null;");

        const report = win.__lwReportRender as (
          status: string,
          errorText?: string,
        ) => void;
        report("ok");
        vi.advanceTimersByTime(300);
        expect(
          posts.filter((m) => m.type === "lw:render-receipt"),
        ).toHaveLength(1);

        // Data lands after mount: the chart library appends a label under
        // #lw-root, the same shape a query result driving a re-render takes.
        const label = document.createElement("span");
        label.textContent = "42";
        root.appendChild(label);

        // MutationObserver callbacks fire as microtasks, independent of the
        // faked setTimeout — flush them before advancing the debounce timer.
        await Promise.resolve();
        await Promise.resolve();
        vi.advanceTimersByTime(300);

        const receipts = posts.filter((m) => m.type === "lw:render-receipt");
        expect(receipts).toHaveLength(2);
        expect(String(receipts[1]?.markup)).toContain(">42<");
      } finally {
        document.getElementById("lw-root")?.remove();
        vi.useRealTimers();
      }
    });
  });
});

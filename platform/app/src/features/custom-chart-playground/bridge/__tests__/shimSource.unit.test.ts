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
    const port = { onmessage: null as unknown, postMessage: () => {} };
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

  return { win, parent, activateAuthor, dispatchInit };
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

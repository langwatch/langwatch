/**
 * @vitest-environment jsdom
 *
 * The sandboxed chart frame points its iframe at the shared frame-document
 * route (not an inline srcdoc) and delivers the widget source over lw:init.
 * A change to the widget code remounts the iframe so a fresh document load
 * carries a fresh lw:init with the new source.
 *
 * `createFrameBridge` is mocked to a spy: the claim here is which `source` the
 * frame HANDS the bridge and that the iframe element is a NEW one after a code
 * change — the bridge's own postMessage behaviour is covered by its own tests.
 *
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { bridgeMock } = vi.hoisted(() => ({ bridgeMock: vi.fn() }));

vi.mock("../bridge/frameBridge", () => ({
  createFrameBridge: (options: { source: string }) => {
    bridgeMock(options);
    return { postDashboardContextChange: vi.fn(), dispose: vi.fn() };
  },
}));

import { SandboxedChartFrame } from "../SandboxedChartFrame";

const dashboardContext = {
  timeWindow: { start: 0, end: 1 },
  granularitySeconds: 3600,
  theme: "light" as const,
};

const ui = (code: string) => (
  <ChakraProvider value={defaultSystem}>
    <SandboxedChartFrame
      code={code}
      executeQuery={vi.fn()}
      dashboardContext={dashboardContext}
      onLog={vi.fn()}
    />
  </ChakraProvider>
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("given a sandboxed chart frame", () => {
  describe("when it mounts", () => {
    /** @scenario "The parent delivers the widget source on init" */
    it("lets the bridge navigate to the frame route and hands it the source", () => {
      const { container } = render(ui("A"));

      const iframe = container.querySelector("iframe");
      expect(iframe?.hasAttribute("src")).toBe(false);
      expect(iframe?.hasAttribute("srcdoc")).toBe(false);
      expect(bridgeMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ source: "A" }),
      );
    });
  });

  describe("when the widget source changes", () => {
    /** @scenario "The frame reloads when the widget code changes" */
    it("remounts the iframe and re-inits the bridge with the new source", () => {
      const { container, rerender } = render(ui("A"));
      const first = container.querySelector("iframe");

      rerender(ui("B"));
      const second = container.querySelector("iframe");

      expect(second).not.toBe(first);
      expect(bridgeMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ source: "B" }),
      );
    });
  });
});

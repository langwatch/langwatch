/**
 * @vitest-environment jsdom
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 *
 * The frame points at the shared frame-document route and hands the widget
 * source to the bridge; a code change remounts the iframe for a fresh init.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { bridgeMock } = vi.hoisted(() => ({ bridgeMock: vi.fn() }));

vi.mock("../../../behavior/frame-bridge.ts", () => ({
  FrameBridgeSession: {
    create: (options: { source: string }) => {
      bridgeMock(options);
      return { postDashboardContextChange: vi.fn(), dispose: vi.fn() };
    },
  },
}));

import { SandboxedChartFrame } from "../sandboxed-chart-frame.tsx";

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
      expect(bridgeMock).toHaveBeenLastCalledWith(expect.objectContaining({ source: "A" }));
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
      expect(bridgeMock).toHaveBeenLastCalledWith(expect.objectContaining({ source: "B" }));
    });
  });
});

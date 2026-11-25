/**
 * @vitest-environment jsdom
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 *
 * The frame points at the shared frame-document route and hands the widget
 * source to the bridge; a code change remounts the iframe for a fresh init.
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock(import("@langwatch/design-system/color-mode"), async (importOriginal) => ({
  ...(await importOriginal()),
  getRawColorValue: () => "#123456",
}));

const { bridgeMock } = vi.hoisted(() => ({ bridgeMock: vi.fn() }));

vi.mock("../../../../../behavior/frame-bridge.ts", () => ({
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

const ui = (
  code: string,
  theme: "light" | "dark" = "light",
  onIdleChange?: (idle: boolean) => void,
  cover?: ReactNode,
  onSignal?: (signal: { problem: boolean }) => void,
) => (
  <DesignSystemProvider forcedTheme="light">
    <SandboxedChartFrame
      code={code}
      executeQuery={vi.fn()}
      dashboardContext={{ ...dashboardContext, theme }}
      onLog={vi.fn()}
      onIdleChange={onIdleChange}
      cover={cover}
      onSignal={onSignal}
    />
  </DesignSystemProvider>
);

const reportedProblem = () => {
  const options = bridgeMock.mock.calls.at(-1)?.[0] as {
    onSignal: (signal: { problem: boolean }) => void;
    onTeardown: () => void;
  };
  act(() => options.onSignal({ problem: true }));
  return options;
};
/** The context the bridge the frame built last sends when its frame loads. */
function lastBridgeContext(): unknown {
  const [options] = bridgeMock.mock.lastCall as [{ readDashboardContext: () => unknown }];
  return options.readDashboardContext();
}

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
      expect(lastBridgeContext()).toMatchObject({
        colors: expect.objectContaining({ "bg.card": "#123456", "chart.1": "#123456" }),
      });
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

  describe("when the host theme changes", () => {
    it("remounts the iframe and re-inits the bridge with the new theme", () => {
      const { container, rerender } = render(ui("A", "light"));
      const first = container.querySelector("iframe");

      rerender(ui("A", "dark"));
      const second = container.querySelector("iframe");

      expect(second).not.toBe(first);
      expect(lastBridgeContext()).toMatchObject({ theme: "dark" });
    });
  });

  describe("when its frame said it was idle and the widget source changes", () => {
    /** @scenario "The frame reloads when the widget code changes" */
    it("tells its host the new frame is not idle yet", () => {
      const onIdleChange = vi.fn();
      const { rerender } = render(ui("A", "light", onIdleChange));
      const options = bridgeMock.mock.calls.at(-1)?.[0] as {
        onIdleChange: (idle: boolean) => void;
      };
      act(() => options.onIdleChange(true));
      expect(onIdleChange).toHaveBeenLastCalledWith(true);

      rerender(ui("B", "light", onIdleChange));

      expect(onIdleChange).toHaveBeenLastCalledWith(false);
    });
  });

  describe("when it is given a cover", () => {
    /** @scenario "The loading skeleton covers a running frame, never its restart notice" */
    it("draws the cover over the running iframe", () => {
      const { container } = render(ui("A", "light", undefined, <p>Loading cover</p>));

      expect(container.querySelector("iframe")).not.toBeNull();
      expect(screen.getByText("Loading cover")).toBeTruthy();
    });

    /** @scenario "The loading skeleton covers a running frame, never its restart notice" */
    it("draws no cover while the frame is restarting", () => {
      render(ui("A", "light", undefined, <p>Loading cover</p>));
      const options = bridgeMock.mock.calls.at(-1)?.[0] as { onTeardown: () => void };

      act(() => options.onTeardown());

      expect(screen.getByText("The chart stopped responding. Restarting…")).toBeTruthy();
      expect(screen.queryByText("Loading cover")).toBeNull();
    });
  });

  describe("when its frame reported a problem and is torn down", () => {
    /** @scenario "AC244 Widget actions: Investigate and Propose a fix show only while the widget reports its problem" */
    it("clears the problem at teardown and again when the new frame starts", () => {
      const onSignal = vi.fn();
      render(ui("A", "light", undefined, undefined, onSignal));
      const options = reportedProblem();
      expect(onSignal).toHaveBeenLastCalledWith({ problem: true });

      act(() => options.onTeardown());

      expect(onSignal).toHaveBeenLastCalledWith({ problem: false });
    });
  });

  describe("when its frame reported a problem and is taken away", () => {
    /** @scenario "AC244 Widget actions: Investigate and Propose a fix show only while the widget reports its problem" */
    it("clears the problem as the frame leaves", () => {
      const onSignal = vi.fn();
      const { unmount } = render(ui("A", "light", undefined, undefined, onSignal));
      reportedProblem();
      expect(onSignal).toHaveBeenLastCalledWith({ problem: true });

      unmount();

      expect(onSignal).toHaveBeenLastCalledWith({ problem: false });
    });
  });
});

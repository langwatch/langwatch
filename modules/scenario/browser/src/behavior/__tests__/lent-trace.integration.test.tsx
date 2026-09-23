// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { uiDeclarations, type UiDeclarations } from "@langwatch/browser-host/declarations";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const declarations: { current: UiDeclarations | undefined } = vi.hoisted(() => ({
  current: undefined,
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUiDeclarations: () => declarations.current,
}));

import { SetupWithAgentButton, TracePreviewHoverCard } from "../lent-trace.tsx";

const traceLends = uiDeclarations([
  {
    name: "trace",
    installation: {
      capabilities: {
        setupWithAgentButton: {
          load: async () => ({
            default: ({ surface }: { surface: string }) => <button>setup {surface}</button>,
          }),
        },
        tracePreviewHoverCard: {
          load: async () => ({
            default: ({ traceId, children }: { traceId: string; children: React.ReactNode }) => (
              <div data-testid={`peek-${traceId}`}>{children}</div>
            ),
          }),
        },
      },
    },
  },
]);

afterEach(() => {
  cleanup();
  declarations.current = undefined;
});

describe("what trace lends scenario", () => {
  describe("given trace is installed", () => {
    it("renders trace's setup menu for the surface it is handed", async () => {
      declarations.current = traceLends;
      render(<SetupWithAgentButton surface="simulations" />);
      expect(await screen.findByRole("button", { name: "setup simulations" })).toBeInTheDocument();
    });

    it("wraps the trigger in trace's hover peek", async () => {
      declarations.current = traceLends;
      render(
        <TracePreviewHoverCard traceId="trace_1">
          <span>turn 2</span>
        </TracePreviewHoverCard>,
      );
      expect(await screen.findByTestId("peek-trace_1")).toHaveTextContent("turn 2");
    });
  });

  describe("given nothing lends them", () => {
    it("renders no setup menu", () => {
      declarations.current = uiDeclarations([]);
      const { container } = render(<SetupWithAgentButton surface="simulations" />);
      expect(container).toBeEmptyDOMElement();
    });

    it("keeps the trigger without a peek", () => {
      declarations.current = uiDeclarations([]);
      render(
        <TracePreviewHoverCard traceId="trace_1">
          <span>turn 2</span>
        </TracePreviewHoverCard>,
      );
      expect(screen.getByText("turn 2")).toBeInTheDocument();
    });
  });
});

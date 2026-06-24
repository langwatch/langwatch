/**
 * Tests for GraphCardHeader's alert-button wiring (Phase 5.2 of ADR-034).
 *
 * The header used to open the legacy `customGraphAlert` drawer; it now
 * opens the unified `automation` drawer pre-filled with the graph + series
 * the chart represents. The bell variant additionally carries the trigger
 * id so the drawer hydrates that row in edit mode.
 *
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { openDrawerMock } = vi.hoisted(() => ({
  openDrawerMock: vi.fn(),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: openDrawerMock }),
}));

vi.mock("~/utils/compat/next-router", () => {
  const router = {
    query: {},
    asPath: "/",
    push: vi.fn(),
    replace: vi.fn(),
  };
  return {
    useRouter: () => router,
    default: router,
  };
});

import { GraphCardHeader } from "../GraphCardHeader";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

interface RenderOptions {
  trigger?: { id: string; active: boolean; alertType: string | null } | null;
}

function renderHeader({ trigger = null }: RenderOptions = {}) {
  return render(
    <GraphCardHeader
      graphId="graph_123"
      name="p95 latency"
      graph={{
        graphType: "line",
        series: [
          { name: "p95 latency", key: "latency", aggregation: "p95" },
          { name: "error rate", key: "error_rate", aggregation: "avg" },
        ],
        includePrevious: false,
        timeScale: "full",
      }}
      projectSlug="proj"
      colSpan={1}
      rowSpan={1}
      filters={{}}
      trigger={trigger}
      isDragging={false}
      dragAttributes={
        {} as unknown as Parameters<typeof GraphCardHeader>[0]["dragAttributes"]
      }
      dragListeners={undefined}
      onSizeChange={vi.fn()}
      onDelete={vi.fn()}
      isDeleting={false}
    />,
    { wrapper: Wrapper },
  );
}

describe("GraphCardHeader", () => {
  beforeEach(() => {
    openDrawerMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given no trigger is configured", () => {
    describe("when the Add alert button is clicked", () => {
      it("opens the automations drawer pre-filled with this graph and its first series", async () => {
        renderHeader();

        await userEvent.click(
          screen.getByRole("button", { name: /add alert/i }),
        );

        expect(openDrawerMock).toHaveBeenCalledTimes(1);
        expect(openDrawerMock).toHaveBeenCalledWith("automation", {
          prefilledGraphId: "graph_123",
          prefilledSeriesName: "0/latency/p95",
        });
      });
    });
  });

  describe("given an active trigger is configured for this graph", () => {
    describe("when the bell icon is clicked", () => {
      it("opens the automations drawer in edit mode for that trigger pre-filled with this graph and its first series", async () => {
        const { container } = renderHeader({
          trigger: { id: "trigger_abc", active: true, alertType: "WARNING" },
        });

        // The active-alert variant renders a clickable Box wrapping a
        // `<Bell>` icon (no role / aria-label is attached at this layer,
        // so the lucide class is the most stable handle we have).
        const bellSvg = container.querySelector("svg.lucide-bell");
        expect(bellSvg).not.toBeNull();
        const bellWrapper = bellSvg?.closest("div");
        if (!bellWrapper) throw new Error("bell wrapper not found");

        await userEvent.click(bellWrapper);

        expect(openDrawerMock).toHaveBeenCalledTimes(1);
        expect(openDrawerMock).toHaveBeenCalledWith("automation", {
          automationId: "trigger_abc",
          prefilledGraphId: "graph_123",
          prefilledSeriesName: "0/latency/p95",
        });
      });
    });
  });
});

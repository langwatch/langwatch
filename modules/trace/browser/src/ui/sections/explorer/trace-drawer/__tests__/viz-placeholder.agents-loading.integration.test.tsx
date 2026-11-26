/**
 * @vitest-environment jsdom
 * The viz pane body with the Agents tab selected before the span tree has loaded.
 * @see modules/trace/specs/agent-call-graph.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VizBody } from "../viz-placeholder.tsx";

afterEach(cleanup);

describe("<VizBody/>", () => {
  describe("when the Agents tab is selected and the span tree is still loading", () => {
    /** @scenario "The Agents pane shows a loading state and an error state with a retry" */
    it("shows the Agents loading state, not the waterfall skeleton", () => {
      renderWithDesignSystem(
        <VizBody
          vizTab="agents"
          spans={[]}
          isLoading
          isCollapsed={false}
          braidedOwners={undefined}
          promptSpanIds={new Set()}
          a2aSpanIds={new Set()}
          agentsTab={{
            showsAgents: false,
            isSettled: false,
            graph: undefined,
            isGraphError: false,
            retryGraph: vi.fn(),
          }}
          selectedSpanId={null}
          onSelectSpan={vi.fn()}
          onClearSpan={vi.fn()}
        />,
      );

      expect(screen.getByTestId("agent-call-graph-loading")).toBeTruthy();
      expect(screen.queryByTestId("waterfall-skeleton")).toBeNull();
    });
  });

  describe("when another tab is selected and the span tree is still loading", () => {
    it("shows the waterfall skeleton", () => {
      renderWithDesignSystem(
        <VizBody
          vizTab="waterfall"
          spans={[]}
          isLoading
          isCollapsed={false}
          braidedOwners={undefined}
          promptSpanIds={new Set()}
          a2aSpanIds={new Set()}
          agentsTab={{
            showsAgents: false,
            isSettled: true,
            graph: undefined,
            isGraphError: false,
            retryGraph: vi.fn(),
          }}
          selectedSpanId={null}
          onSelectSpan={vi.fn()}
          onClearSpan={vi.fn()}
        />,
      );

      expect(screen.getByTestId("waterfall-skeleton")).toBeTruthy();
    });
  });
});

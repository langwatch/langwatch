// @vitest-environment jsdom
/**
 * The expanded leaderboard is addressable: `CurrentDrawer` renders it from a
 * URL, so it is reachable without ever passing the chart's expand affordance.
 * That makes the rollout gate on the chart necessary but not sufficient — a
 * link shared out of an organization that has the leaderboard would otherwise
 * hand the whole thing to one that has not been given it.
 *
 * @see specs/experiments/comparison-leaderboard.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const rollout = vi.hoisted(() => ({ enabled: true }));

vi.mock("../batch-evaluation-results/useShowComparisonLeaderboard", () => ({
  useShowComparisonLeaderboard: () => rollout.enabled,
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn() }),
}));

import type {
  BatchComparisonColumn,
  BatchResultRow,
} from "../batch-evaluation-results/types";
import { ComparisonLeaderboardDrawer } from "../ComparisonLeaderboardDrawer";

const VARIANTS = ["target-1", "target-2", "target-3"];

const column: BatchComparisonColumn = {
  evaluatorId: "comparison-1",
  name: "Comparison",
  variants: VARIANTS.map((id, i) => ({ id, name: `Variant ${i + 1}` })),
  verdictsByRow: Object.fromEntries(
    Array.from({ length: 6 }, (_, rowIndex) => [
      rowIndex,
      {
        rowIndex,
        winnerId: VARIANTS[rowIndex % VARIANTS.length]!,
        candidateIds: VARIANTS,
        reasoning: "that one read better",
      },
    ]),
  ),
};

const rows: BatchResultRow[] = Array.from({ length: 6 }, (_, index) => ({
  index,
  datasetEntry: { input: "test" },
  targets: Object.fromEntries(
    VARIANTS.map((id) => [
      id,
      {
        targetId: id,
        output: { output: "response" },
        cost: 0.001,
        duration: 500,
        error: null,
        traceId: null,
        evaluatorResults: [],
      },
    ]),
  ),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderDrawer = () =>
  render(
    <ComparisonLeaderboardDrawer
      evaluatorId={column.evaluatorId}
      column={column}
      rows={rows}
    />,
    { wrapper: Wrapper },
  );

describe("the expanded comparison leaderboard, opened straight from a URL", () => {
  afterEach(() => {
    rollout.enabled = true;
    cleanup();
  });

  describe("given an organization the rollout has not reached", () => {
    /** @scenario "A shared leaderboard link opens nothing for an organization without it" */
    it("renders nothing at all", () => {
      rollout.enabled = false;

      const { container } = renderDrawer();

      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByText(/leaderboard/i)).not.toBeInTheDocument();
    });
  });

  describe("given an organization that has the leaderboard", () => {
    it("opens it, so the guard above is not simply refusing everything", () => {
      renderDrawer();

      expect(screen.getByText("Comparison — leaderboard")).toBeInTheDocument();
    });
  });
});

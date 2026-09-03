import "@testing-library/jest-dom/vitest";

// @vitest-environment jsdom
/**
 * The expanded leaderboard is addressable: `CurrentDrawer` renders it from a
 * URL, so it is reachable without ever passing the chart's expand affordance.
 * That makes the rollout gate on the chart necessary but not sufficient — a
 * link shared out of an organization that has the leaderboard would otherwise
 * hand the whole thing to one that has not been given it.
 *
 * PORTED WITH THE DRAWER from
 * `platform/app/src/components/__tests__/ComparisonLeaderboardDrawer.gate.integration.test.tsx`.
 * The two mocks that named platform modules now name this package's own
 * rollout hook and `@langwatch/ui-drawer`; every assertion is unchanged.
 *
 * @see specs/experiments/comparison-leaderboard.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const rollout = vi.hoisted(() => ({ enabled: true }));

vi.mock("../../../../behavior/batch-evaluation-results/use-show-comparison-leaderboard", () => ({
  useShowComparisonLeaderboard: () => rollout.enabled,
}));

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn() }),
}));

import { ComparisonLeaderboardDrawer } from "../comparison-leaderboard-drawer";
import type { BatchComparisonColumn, BatchResultRow } from "../../batch-evaluation-results.types";

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
    <ComparisonLeaderboardDrawer evaluatorId={column.evaluatorId} column={column} rows={rows} />,
    { wrapper: Wrapper },
  );

/**
 * What `CurrentDrawer` actually mounts from a URL: the one serializable prop
 * and nothing else. The tests above hand-feed `column` and `rows`, which a
 * query string cannot carry — so they were passing on a path no reader takes.
 */
const renderDrawerFromUrlAlone = () =>
  render(<ComparisonLeaderboardDrawer evaluatorId={column.evaluatorId} />, {
    wrapper: Wrapper,
  });

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

  describe("when the link is opened cold, carrying no in-memory run data", () => {
    /** @scenario "A pasted leaderboard link explains where to find the run" */
    it("points at the results page instead of throwing", () => {
      renderDrawerFromUrlAlone();

      expect(
        screen.getByTestId(`leaderboard-needs-results-page-${column.evaluatorId}`),
      ).toBeInTheDocument();
    });

    /**
     * The reason this case matters beyond the crash: the rollout gate used to
     * sit BELOW the dereference that threw, so on the one route it exists to
     * guard it was never reached.
     */
    /** @scenario "A shared leaderboard link opens nothing for an organization without it" */
    it("still refuses an organization the rollout has not reached", () => {
      rollout.enabled = false;

      const { container } = renderDrawerFromUrlAlone();

      expect(container).toBeEmptyDOMElement();
    });
  });
});

/**
 * @vitest-environment jsdom
 *
 * Renders the real ThroughputStatTiles via React Testing Library against an
 * actual ChakraProvider — no shallow rendering, no module mocks.
 */
import { ChakraProvider, defaultSystem, SimpleGrid } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThroughputStatTiles } from "../ThroughputStatTiles";

const renderTiles = (
  overrides: Partial<React.ComponentProps<typeof ThroughputStatTiles>["data"]> = {},
) => {
  const defaults: React.ComponentProps<typeof ThroughputStatTiles>["data"] = {
    throughputIngestedPerSec: 534,
    peakIngestedPerSec: 7700,
    completedPerSec: 379,
    peakCompletedPerSec: 7100,
    totalCompleted: 205_700_000,
    failedPerSec: 0,
    totalFailed: 0,
    totalGroups: 0,
    latencyP50Ms: 0,
    peakLatencyP50Ms: 0,
    latencyP99Ms: 0,
    peakLatencyP99Ms: 0,
    queues: [],
  };
  return render(
    <ChakraProvider value={defaultSystem}>
      <SimpleGrid columns={10}>
        <ThroughputStatTiles data={{ ...defaults, ...overrides }} />
      </SimpleGrid>
    </ChakraProvider>,
  );
};

afterEach(cleanup);

describe("ThroughputStatTiles", () => {
  describe("the Completed/s tile", () => {
    it("shows the per-second peak alongside the running total", () => {
      renderTiles({ peakCompletedPerSec: 7100, totalCompleted: 205_700_000 });

      const tile = screen.getByTestId("ops-completed-stat");
      // Peak mirrors the Staged/s tile; the total M is kept.
      expect(within(tile).getByText(/peak 7\.1k · 205\.7M total/)).toBeTruthy();
    });

    it("still shows the total when there is no recorded peak yet", () => {
      renderTiles({ peakCompletedPerSec: 0, totalCompleted: 1500 });

      const tile = screen.getByTestId("ops-completed-stat");
      expect(within(tile).getByText(/peak 0\.00 · 1\.5k total/)).toBeTruthy();
    });
  });
});

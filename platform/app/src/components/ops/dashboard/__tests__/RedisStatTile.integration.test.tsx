/**
 * @vitest-environment jsdom
 *
 * Renders the real RedisStatTile via React Testing Library against an actual
 * ChakraProvider — no shallow rendering, no module mocks.
 *
 * Memory, processor and connections are ONE tile (specs/ops/ops-dashboard-density.feature,
 * "Redis statistics read as one subject"): three separate tiles are what pushed
 * the strip to eleven entries in a ten-column grid and orphaned the last onto a
 * row of its own.
 */
import { ChakraProvider, defaultSystem, HStack } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RedisStatTile } from "../RedisStatTile";

const renderTile = (
  overrides: Partial<React.ComponentProps<typeof RedisStatTile>["data"]> = {},
) => {
  const defaults: React.ComponentProps<typeof RedisStatTile>["data"] = {
    redisMemoryUsedBytes: 3_200_000_000,
    redisMemoryPeakBytes: 10_500_000_000,
    redisMemoryMaxBytes: 10_400_000_000,
    redisConnectedClients: 24,
    redisEngineCpuPercent: 12.3,
  };
  return render(
    <ChakraProvider value={defaultSystem}>
      <HStack>
        <RedisStatTile data={{ ...defaults, ...overrides }} />
      </HStack>
    </ChakraProvider>,
  );
};

const tile = () => screen.getByTestId("redis-stat-tile");

afterEach(cleanup);

describe("RedisStatTile", () => {
  describe("given normal Redis pressure", () => {
    describe("when the tile renders", () => {
      it("shows the memory used as a single MB/GB value", () => {
        renderTile({ redisMemoryUsedBytes: 3_200_000_000 });
        // 3.2 * 10^9 / 1024^3 ≈ 2.98GB
        expect(screen.getByTestId("redis-memory-stat").textContent).toContain("2.98GB");
      });

      it("shows the memory percent and configured maximum", () => {
        renderTile({
          redisMemoryUsedBytes: 3_200_000_000,
          redisMemoryMaxBytes: 10_400_000_000,
        });
        // 3.2 / 10.4 = 30.769… → 30.8%, 10.4 * 10^9 / 1024^3 ≈ 9.69GB
        expect(tile().textContent).toContain("30.8%");
        expect(tile().textContent).toContain("9.69GB");
      });

      it("shows the engine-processor percent", () => {
        renderTile({ redisEngineCpuPercent: 12.3 });
        expect(screen.getByTestId("redis-engine-cpu-stat").textContent).toContain(
          "12.3%",
        );
      });

      it("shows the connection count", () => {
        renderTile({ redisConnectedClients: 24 });
        expect(screen.getByTestId("redis-clients-stat").textContent).toContain("24");
      });

      /** @scenario "Statistic labels are spelled out" */
      it("spells its labels out rather than abbreviating them", () => {
        renderTile();
        // "conns" cost the reader a guess to save a few pixels.
        expect(tile().textContent).toContain("connections");
        expect(tile().textContent).not.toContain("conns");
      });

      /** @scenario "Redis statistics read as one subject" */
      it("carries all three figures in one tile", () => {
        renderTile();
        expect(tile().textContent).toContain("2.98GB");
        expect(tile().textContent).toContain("12.3%");
        expect(tile().textContent).toContain("24");
      });
    });
  });

  describe("given the engine-processor sample is not ready yet", () => {
    describe("when the tile renders on the first collection cycle", () => {
      it("shows a dash and says it is still sampling", () => {
        renderTile({ redisEngineCpuPercent: null });
        expect(screen.getByTestId("redis-engine-cpu-stat").textContent).toContain("—");
        expect(tile().textContent).toContain("sampling");
      });
    });
  });

  describe("given Redis memory is near eviction", () => {
    describe("when the used:max ratio crosses the 80% threshold", () => {
      it("marks the tile as warning", () => {
        renderTile({
          redisMemoryUsedBytes: 9_500_000_000,
          redisMemoryMaxBytes: 10_000_000_000,
        });
        expect(tile().textContent).toContain("95%");
        // Chakra v3 applies `color="red.500"` via a CSS variable on a class,
        // not inline style — pin the warning state via data-warning.
        expect(tile().getAttribute("data-warning")).toBe("true");
      });

      it("does NOT mark it as warning below the threshold", () => {
        renderTile({
          redisMemoryUsedBytes: 7_900_000_000,
          redisMemoryMaxBytes: 10_000_000_000,
        });
        expect(tile().textContent).toContain("79%");
        expect(tile().getAttribute("data-warning")).toBe("false");
      });

      it("uses the raw ratio, so 79.95% does not round up and trigger it", () => {
        renderTile({
          redisMemoryUsedBytes: 7_995_000_000,
          redisMemoryMaxBytes: 10_000_000_000,
        });
        // Displayed percent rounds to 80.0%, but the threshold check uses the
        // raw 79.95 so warning stays false.
        expect(tile().textContent).toContain("80%");
        expect(tile().getAttribute("data-warning")).toBe("false");
      });
    });
  });

  describe("given the engine processor crosses its threshold", () => {
    it("marks the tile as warning", () => {
      renderTile({ redisEngineCpuPercent: 85 });
      expect(tile().getAttribute("data-warning")).toBe("true");
    });
  });

  describe("given Redis has no maximum memory configured", () => {
    it("labels the figure without inventing a percentage", () => {
      renderTile({ redisMemoryMaxBytes: 0 });
      expect(tile().textContent).toContain("memory");
      expect(tile().textContent).not.toContain("% of");
    });
  });
});

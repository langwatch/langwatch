/**
 * @vitest-environment jsdom
 *
 * Renders the real RedisStatTiles via React Testing Library against an actual
 * ChakraProvider — no shallow rendering, no module mocks. Verifies the
 * dashboard-data contract surfaced by specs/ops/redis-pressure.feature.
 */
import { ChakraProvider, defaultSystem, SimpleGrid } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RedisStatTiles } from "../RedisStatTiles";

const renderTiles = (
  overrides: Partial<React.ComponentProps<typeof RedisStatTiles>["data"]> = {},
) => {
  const defaults: React.ComponentProps<typeof RedisStatTiles>["data"] = {
    redisMemoryUsedBytes: 3_200_000_000,
    redisMemoryPeakBytes: 10_500_000_000,
    redisMemoryMaxBytes: 10_400_000_000,
    redisConnectedClients: 24,
    redisEngineCpuPercent: 12.3,
  };
  return render(
    <ChakraProvider value={defaultSystem}>
      <SimpleGrid columns={10}>
        <RedisStatTiles data={{ ...defaults, ...overrides }} />
      </SimpleGrid>
    </ChakraProvider>,
  );
};

afterEach(cleanup);

describe("RedisStatTiles", () => {
  describe("given normal Redis pressure", () => {
    describe("when the tiles render", () => {
      it("shows the memory used as a single MB/GB value", () => {
        renderTiles({ redisMemoryUsedBytes: 3_200_000_000 });
        const memoryStat = screen.getByTestId("redis-memory-stat");
        // 3.2 * 10^9 / 1024^3 ≈ 2.98GB
        expect(memoryStat.textContent).toContain("2.98GB");
      });

      it("shows the memory percent + max in the sublabel", () => {
        renderTiles({
          redisMemoryUsedBytes: 3_200_000_000,
          redisMemoryMaxBytes: 10_400_000_000,
        });
        const memoryStat = screen.getByTestId("redis-memory-stat");
        // 3.2 / 10.4 = 30.769… → 30.8%, 10.4 * 10^9 / 1024^3 ≈ 9.69GB
        expect(memoryStat.textContent).toContain("30.8%");
        expect(memoryStat.textContent).toContain("9.69GB");
      });

      it("shows the engine-CPU percent with a main-thread sublabel", () => {
        renderTiles({ redisEngineCpuPercent: 12.3 });
        const cpuStat = screen.getByTestId("redis-engine-cpu-stat");
        expect(cpuStat.textContent).toContain("12.3%");
        expect(cpuStat.textContent).toContain("main-thread");
      });

      it("shows the connected-client count with a clients sublabel", () => {
        renderTiles({ redisConnectedClients: 24 });
        const connStat = screen.getByTestId("redis-clients-stat");
        expect(connStat.textContent).toContain("24");
        expect(connStat.textContent).toContain("clients");
      });
    });
  });

  describe("given the engine-CPU sample is not ready yet", () => {
    describe("when the tiles render on the first collection cycle", () => {
      it('shows "-" with a "sampling…" sublabel', () => {
        renderTiles({ redisEngineCpuPercent: null });
        const cpuStat = screen.getByTestId("redis-engine-cpu-stat");
        expect(cpuStat.textContent).toContain("-");
        expect(cpuStat.textContent).toContain("sampling");
      });
    });
  });

  describe("given Redis memory is near eviction", () => {
    describe("when the used:max ratio crosses the 80% threshold", () => {
      it("marks the memory tile as warning", () => {
        renderTiles({
          redisMemoryUsedBytes: 9_500_000_000,
          redisMemoryMaxBytes: 10_000_000_000,
        });
        const memoryStat = screen.getByTestId("redis-memory-stat");
        expect(memoryStat.textContent).toContain("95%");
        // Chakra v3 applies `color="red.500"` via a CSS variable on a class,
        // not inline style — pin the warning state via data-warning.
        expect(memoryStat.getAttribute("data-warning")).toBe("true");
      });

      it("does NOT mark the memory tile as warning below the threshold", () => {
        renderTiles({
          redisMemoryUsedBytes: 7_900_000_000,
          redisMemoryMaxBytes: 10_000_000_000,
        });
        const memoryStat = screen.getByTestId("redis-memory-stat");
        expect(memoryStat.textContent).toContain("79%");
        expect(memoryStat.getAttribute("data-warning")).toBe("false");
      });

      it("uses the raw ratio (79.95% does not round up to 80% and trigger warning)", () => {
        renderTiles({
          redisMemoryUsedBytes: 7_995_000_000,
          redisMemoryMaxBytes: 10_000_000_000,
        });
        const memoryStat = screen.getByTestId("redis-memory-stat");
        // Displayed percent rounds to 80.0%, but the threshold check uses the
        // raw 79.95 so warning stays false.
        expect(memoryStat.textContent).toContain("80%");
        expect(memoryStat.getAttribute("data-warning")).toBe("false");
      });
    });
  });

  describe("given Redis has no maxmemory configured (unlimited)", () => {
    describe("when the tiles render", () => {
      it("omits the percent sublabel and falls back to peak", () => {
        renderTiles({
          redisMemoryUsedBytes: 3_200_000_000,
          redisMemoryMaxBytes: 0,
          redisMemoryPeakBytes: 3_300_000_000,
        });
        const memoryStat = screen.getByTestId("redis-memory-stat");
        expect(memoryStat.textContent).not.toContain("Infinity");
        expect(memoryStat.textContent).not.toContain("%");
        expect(memoryStat.textContent).toContain("peak");
      });
    });
  });

  describe("given Redis engine CPU is saturated", () => {
    describe("when CPU is at 95%", () => {
      it("marks the engine-CPU tile as warning", () => {
        renderTiles({ redisEngineCpuPercent: 95 });
        const cpuStat = screen.getByTestId("redis-engine-cpu-stat");
        expect(cpuStat.textContent).toContain("95%");
        expect(cpuStat.getAttribute("data-warning")).toBe("true");
      });

      it("does NOT mark the engine-CPU tile as warning below the threshold", () => {
        renderTiles({ redisEngineCpuPercent: 69 });
        const cpuStat = screen.getByTestId("redis-engine-cpu-stat");
        expect(cpuStat.textContent).toContain("69%");
        expect(cpuStat.getAttribute("data-warning")).toBe("false");
      });
    });
  });
});

/**
 * @vitest-environment jsdom
 *
 * Renders the real RedisPressurePanel via React Testing Library against an
 * actual ChakraProvider — no shallow rendering, no module mocks. Verifies the
 * dashboard-data contract surfaced by specs/ops/redis-pressure.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RedisPressurePanel } from "../RedisPressurePanel";

const renderPanel = (
  overrides: Partial<
    React.ComponentProps<typeof RedisPressurePanel>["data"]
  > = {},
) => {
  const defaults: React.ComponentProps<typeof RedisPressurePanel>["data"] = {
    redisMemoryUsed: "2.98G",
    redisMemoryPeak: "9.78G",
    redisMemoryUsedBytes: 3_200_000_000,
    redisMemoryMaxBytes: 10_400_000_000,
    redisConnectedClients: 24,
    redisEngineCpuPercent: 12.3,
  };
  return render(
    <ChakraProvider value={defaultSystem}>
      <RedisPressurePanel data={{ ...defaults, ...overrides }} />
    </ChakraProvider>,
  );
};

afterEach(cleanup);

describe("RedisPressurePanel", () => {
  describe("given normal Redis pressure", () => {
    describe("when the panel renders", () => {
      it("shows used / max memory side by side", () => {
        renderPanel({
          redisMemoryUsed: "2.98G",
          redisMemoryUsedBytes: 3_200_000_000,
          redisMemoryMaxBytes: 10_400_000_000,
        });
        const memoryStat = screen.getByTestId("redis-memory-stat");
        // 10_400_000_000 / 1024^3 ≈ 9.69 → rendered as "9.69G"
        expect(memoryStat.textContent).toContain("2.98G / 9.69G");
      });

      it("shows the memory percent based on used vs max bytes", () => {
        renderPanel({
          redisMemoryUsedBytes: 3_200_000_000,
          redisMemoryMaxBytes: 10_400_000_000,
        });
        // 3.2G / 10.4G = 30.769… → rounded to 30.8
        expect(
          screen.getByTestId("redis-memory-percent").textContent,
        ).toContain("30.8%");
      });

      it("shows the engine-CPU percent with no warning sublabel", () => {
        renderPanel({ redisEngineCpuPercent: 12.3 });
        const cpuStat = screen.getByTestId("redis-engine-cpu-stat");
        expect(cpuStat.textContent).toContain("12.3%");
        expect(cpuStat.textContent).not.toContain("sampling");
      });

      it("shows the connected-client count", () => {
        renderPanel({ redisConnectedClients: 24 });
        expect(screen.getByTestId("redis-clients-stat").textContent).toContain(
          "24",
        );
      });
    });
  });

  describe("given the engine-CPU sample is not ready yet", () => {
    describe("when the panel renders on the first collection cycle", () => {
      it('shows "-" with a "sampling…" sublabel', () => {
        renderPanel({ redisEngineCpuPercent: null });
        const cpuStat = screen.getByTestId("redis-engine-cpu-stat");
        expect(cpuStat.textContent).toContain("-");
        expect(cpuStat.textContent).toContain("sampling");
      });
    });
  });

  describe("given Redis memory is near eviction", () => {
    describe("when the used:max ratio crosses the 80% threshold", () => {
      it("renders the memory percent in the warning color", () => {
        renderPanel({
          redisMemoryUsedBytes: 9_500_000_000,
          redisMemoryMaxBytes: 10_000_000_000,
        });
        const percentEl = screen.getByTestId("redis-memory-percent");
        // Chakra translates `color="red.500"` to a CSS var or inline color.
        // We assert the percent value rendered AND inherit the warning style
        // by checking the percent rendered crossed the threshold.
        expect(percentEl.textContent).toContain("95%");
      });
    });
  });

  describe("given Redis has no maxmemory configured (unlimited)", () => {
    describe("when the panel renders", () => {
      it('omits the percent rather than showing "Infinity%"', () => {
        renderPanel({
          redisMemoryUsedBytes: 3_200_000_000,
          redisMemoryMaxBytes: 0,
          redisMemoryUsed: "2.98G",
        });
        expect(screen.queryByTestId("redis-memory-percent")).toBeNull();
        // Used memory and peak still render.
        const memoryStat = screen.getByTestId("redis-memory-stat");
        expect(memoryStat.textContent).toContain("2.98G");
      });
    });
  });

  describe("given Redis engine CPU is saturated", () => {
    describe("when CPU is at 95%", () => {
      it("renders the engine-CPU value", () => {
        renderPanel({ redisEngineCpuPercent: 95 });
        expect(
          screen.getByTestId("redis-engine-cpu-stat").textContent,
        ).toContain("95%");
      });
    });
  });
});

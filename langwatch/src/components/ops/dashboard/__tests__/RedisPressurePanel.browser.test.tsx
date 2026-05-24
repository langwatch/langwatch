/**
 * Visual capture for the Redis pressure panel — runs the component inside a
 * real Chromium via Playwright (vitest browser mode), takes screenshots of
 * each state, and writes them to `__screenshots__/` so they
 * can be uploaded to the PR description. Not committed; __screenshots__/ is
 * gitignored via the repo-wide rule.
 *
 * Not a regression test — it asserts the panel renders without throwing, but
 * its real job is producing the PNGs the PR reviewer needs.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { page } from "@vitest/browser/context";
import { afterEach, describe, expect, it } from "vitest";
import { RedisPressurePanel } from "../RedisPressurePanel";

const wrap = (panel: React.ReactNode) => (
  <ChakraProvider value={defaultSystem}>
    <div
      style={{
        padding: 16,
        background: "white",
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      {panel}
    </div>
  </ChakraProvider>
);

afterEach(cleanup);

describe("RedisPressurePanel — visual capture", () => {
  describe("when Redis is in a healthy state (real prod-like numbers)", () => {
    it("captures the healthy panel", async () => {
      const { container } = render(
        wrap(
          <RedisPressurePanel
            data={{
              redisMemoryUsed: "2.98G",
              redisMemoryPeak: "9.78G",
              redisMemoryUsedBytes: 3_200_000_000,
              redisMemoryMaxBytes: 10_400_000_000,
              redisConnectedClients: 24,
              redisEngineCpuPercent: 12.3,
            }}
          />,
        ),
      );
      expect(container).toBeDefined();
      await page.viewport(1280, 400);
      await page.screenshot({
        path: "__screenshots__/redis-pressure-healthy.png",
      });
    });
  });

  describe("when the CPU sample is not ready yet (first cycle)", () => {
    it('captures the panel showing "-" with "sampling…" sublabel', async () => {
      const { container } = render(
        wrap(
          <RedisPressurePanel
            data={{
              redisMemoryUsed: "1.42G",
              redisMemoryPeak: "1.42G",
              redisMemoryUsedBytes: 1_520_000_000,
              redisMemoryMaxBytes: 10_400_000_000,
              redisConnectedClients: 8,
              redisEngineCpuPercent: null,
            }}
          />,
        ),
      );
      expect(container).toBeDefined();
      await page.viewport(1280, 400);
      await page.screenshot({
        path: "__screenshots__/redis-pressure-sampling.png",
      });
    });
  });

  describe("when Redis is saturated — like the 2026-05-21 incident", () => {
    it("captures both memory and CPU rendered in the warning color", async () => {
      const { container } = render(
        wrap(
          <RedisPressurePanel
            data={{
              redisMemoryUsed: "9.21G",
              redisMemoryPeak: "9.78G",
              redisMemoryUsedBytes: 9_900_000_000,
              redisMemoryMaxBytes: 10_400_000_000,
              redisConnectedClients: 47,
              redisEngineCpuPercent: 98.4,
            }}
          />,
        ),
      );
      expect(container).toBeDefined();
      await page.viewport(1280, 400);
      await page.screenshot({
        path: "__screenshots__/redis-pressure-saturated.png",
      });
    });
  });

  describe("when Redis is configured with no maxmemory (unlimited)", () => {
    it("captures the panel without a percent value", async () => {
      const { container } = render(
        wrap(
          <RedisPressurePanel
            data={{
              redisMemoryUsed: "2.98G",
              redisMemoryPeak: "9.78G",
              redisMemoryUsedBytes: 3_200_000_000,
              redisMemoryMaxBytes: 0,
              redisConnectedClients: 24,
              redisEngineCpuPercent: 12.3,
            }}
          />,
        ),
      );
      expect(container).toBeDefined();
      await page.viewport(1280, 400);
      await page.screenshot({
        path: "__screenshots__/redis-pressure-unlimited.png",
      });
    });
  });
});

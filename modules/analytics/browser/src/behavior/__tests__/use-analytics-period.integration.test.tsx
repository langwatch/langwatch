/**
 * @vitest-environment jsdom
 * Pins the render seam: `now` must stay referentially stable across
 * renders, or `{ startDate, endDate }` keys into an endless refetch loop.
 */

import { Temporal } from "@langwatch/time";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../testing.tsx";
import { useAnalyticsPeriod } from "../use-analytics-period.ts";

function harness(query: Record<string, string | undefined> = {}) {
  const host = new StubAnalyticsHost({ route: { params: {}, query } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AnalyticsTestHarness host={host}>{children}</AnalyticsTestHarness>
  );
  return { host, wrapper };
}

describe("the analytics period, at the render seam", () => {
  describe("given an address carrying a relative preset", () => {
    describe("when the component renders again without the address changing", () => {
      /** @scenario "A relative window does not move between renders" */
      it("hands back the very same window object", () => {
        const { wrapper } = harness({ period: "7d" });
        const { result, rerender } = renderHook(() => useAnalyticsPeriod(), { wrapper });

        const first = result.current.period;
        rerender();
        rerender();

        expect(result.current.period).toBe(first);
      });

      it("keeps the two instants identical, which is what the reads key on", () => {
        const { wrapper } = harness({ period: "24h" });
        const { result, rerender } = renderHook(() => useAnalyticsPeriod(), { wrapper });

        const start = result.current.period.startDate.epochMilliseconds;
        const end = result.current.period.endDate.epochMilliseconds;
        rerender();

        expect(result.current.period.startDate.epochMilliseconds).toBe(start);
        expect(result.current.period.endDate.epochMilliseconds).toBe(end);
      });
    });
  });

  describe("given a reader who picks a preset", () => {
    describe("when the write reaches the address", () => {
      /** @scenario "A range and a preset are the same setting, so one replaces the other" */
      /** @scenario "Switching from absolute back to a relative quick selector clears absolute params" */
      it("names the preset and REMOVES any absolute range, which is the same setting said twice", () => {
        const { host, wrapper } = harness({
          startDate: "2026-06-01T00:00:00.000Z",
          endDate: "2026-06-08T00:00:00.000Z",
        });
        const { result } = renderHook(() => useAnalyticsPeriod(), { wrapper });

        result.current.setRelativePeriod("7d");

        expect(host.lastQuery?.period).toBe("7d");
        expect(host.lastQuery?.startDate).toBeUndefined();
        expect(host.lastQuery?.endDate).toBeUndefined();
      });

      /** @scenario "Picking explicit dates stores the selection as absolute" */
      it("names an absolute range and REMOVES the preset, in the other direction", () => {
        const { host, wrapper } = harness({ period: "7d" });
        const { result } = renderHook(() => useAnalyticsPeriod(), { wrapper });

        result.current.setPeriod(
          Temporal.Instant.from("2026-06-01T00:00:00.000Z"),
          Temporal.Instant.from("2026-06-08T00:00:00.000Z"),
        );

        expect(host.lastQuery?.period).toBeUndefined();
        expect(host.lastQuery?.startDate).toBe("2026-06-01T00:00:00.000Z");
        expect(host.lastQuery?.endDate).toBe("2026-06-08T00:00:00.000Z");
      });

      /**
       * A backwards range queries nothing, and every chart would report empty
       * with nothing on screen to say why. The write orders them.
       */
      /** @scenario "A backwards range is ordered rather than queried" */
      it("orders a backwards range on the way out rather than writing it", () => {
        const { host, wrapper } = harness();
        const { result } = renderHook(() => useAnalyticsPeriod(), { wrapper });

        result.current.setPeriod(
          Temporal.Instant.from("2026-06-08T00:00:00.000Z"),
          Temporal.Instant.from("2026-06-01T00:00:00.000Z"),
        );

        expect(host.lastQuery?.startDate).toBe("2026-06-01T00:00:00.000Z");
        expect(host.lastQuery?.endDate).toBe("2026-06-01T00:00:00.000Z");
      });
    });
  });
});

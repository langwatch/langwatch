/**
 * @vitest-environment jsdom
 * A custom range lives in the address beside the presets, and the board reads its window.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */
import { cleanup } from "@testing-library/react";
import { act, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useDashboardAutoRefresh } from "../../../../behavior/use-dashboard-auto-refresh.ts";
import type { AnalyticsRouteReading } from "../../../../model/analytics-host.ts";
import { StubAnalyticsHost } from "../../../../testing.tsx";
import {
  NO_PROCEDURES,
  renderDashboards,
} from "../../__tests__/render-dashboards.test-helpers.tsx";
import { useBoardPeriod } from "../use-board-period.ts";

afterEach(cleanup);

const FROM = Date.UTC(2026, 9, 1, 8);
const TO = Date.UTC(2026, 9, 3, 18);

function mount(route: AnalyticsRouteReading) {
  const latest: { current?: ReturnType<typeof useBoardPeriod> } = {};
  function Probe() {
    latest.current = useBoardPeriod();
    return null;
  }
  const host = new StubAnalyticsHost({ flags: { release_dashboards: true }, route });
  renderDashboards({ element: <Probe />, host, answer: NO_PROCEDURES });
  return { latest: () => latest.current!, host };
}

describe("given a member picking a custom range", () => {
  /** @scenario "AC19e A custom range reads a fixed window from a start to an end" */
  it("writes the window to the address and keeps the rest of it", () => {
    const { latest, host } = mount({ params: {}, query: { range: "7d", grain: "1d", tab: "x" } });

    act(() => latest().setCustom({ from: FROM, to: TO }));

    expect(host.queries.at(-1)).toEqual({
      range: "custom",
      from: "2026-10-01T08:00:00Z",
      to: "2026-10-03T18:00:00Z",
      grain: "1d",
      tab: "x",
    });
  });

  /** @scenario "AC19e A custom range reads a fixed window from a start to an end" */
  it("reads every widget over exactly the window an address names", () => {
    const { latest } = mount({
      params: {},
      query: { range: "custom", from: "2026-10-01T08:00:00Z", to: "2026-10-03T18:00:00Z" },
    });

    expect(latest().range).toBe("custom");
    expect(latest().period).toEqual({
      periodStart: FROM,
      periodEnd: TO,
      granularitySeconds: 86_400,
    });
    expect(latest().refreshApplies).toBe(false);
  });

  /** @scenario "AC19e A custom range reads a fixed window from a start to an end" */
  it("drops the window from the address when a preset is picked again", () => {
    const { latest, host } = mount({
      params: {},
      query: { range: "custom", from: "2026-10-01T08:00:00Z", to: "2026-10-03T18:00:00Z" },
    });

    act(() => latest().setRange("24h"));

    expect(host.queries.at(-1)).toEqual({ range: "24h" });
  });

  /** @scenario "AC19e A custom range reads a fixed window from a start to an end" */
  it("sets a grain the window cannot carry back to auto", () => {
    const { latest, host } = mount({ params: {}, query: { range: "1h", grain: "1m" } });

    act(() => latest().setCustom({ from: FROM, to: FROM + 30 * 86_400_000 }));

    expect(host.queries.at(-1)).toMatchObject({ range: "custom", grain: "auto" });
  });
});

describe("given a board on a custom range that has ended", () => {
  /** @scenario "AC19f Refresh does not apply to a custom range that has ended" */
  it("does not poll, and keeps the member's pick for the next range", () => {
    const latest: {
      current?: ReturnType<typeof useDashboardAutoRefresh>;
      end?: (ended: boolean) => void;
    } = {};
    function Probe() {
      const [ended, setEnded] = useState(false);
      latest.end = setEnded;
      latest.current = useDashboardAutoRefresh({ ended });
      return null;
    }
    const host = new StubAnalyticsHost({ flags: { release_dashboards: true } });
    renderDashboards({ element: <Probe />, host, answer: NO_PROCEDURES });
    act(() => latest.current!.setOption("5m"));
    expect(latest.current!.refetchInterval).toBe(300_000);

    act(() => latest.end!(true));
    expect(latest.current!.option).toBe("off");
    expect(latest.current!.refetchInterval).toBe(false);

    act(() => latest.end!(false));
    expect(latest.current!.option).toBe("5m");
  });
});
